import { StringDecoder } from "node:string_decoder";
import { connect, createServer, type Server, type Socket } from "node:net";

import {
  MAX_STRATUM_LINE_BYTES,
  StratumMethod,
  decodeStratumLine,
  isShareAccepted,
  isStratumRequest,
  isStratumResponse,
  type StratumMessage,
} from "@zgrove/protocol";

import type { Ledger } from "./ledger.js";

/**
 * A stratum relay on the contributor's own machine, between their miner and
 * the proxy. The miner connects here, this connects onward, and every byte in
 * both directions is passed through untouched.
 *
 * Observation happens on a copy. The relay never parses what it forwards and
 * never forwards what it parsed, so nothing it misunderstands — a dialect it
 * does not know, a line it cannot decode, a message longer than its ceiling —
 * can change a byte the miner or the proxy receives. A tap that could break
 * mining would cost contributors the earnings it exists to protect.
 */

export interface RelayTarget {
  readonly host: string;
  readonly port: number;
}

export interface Relay {
  /** Where to point the miner. Always loopback. */
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

/** Recent jobs are held so a share's job can be written beside it. */
const JOBS_HELD = 64;

interface Pending {
  readonly at: number;
  readonly id: string;
  readonly jobId: string;
  readonly params: readonly unknown[];
  readonly extranonce1: string | null;
  readonly difficulty: number | null;
  readonly target: string | null;
}

/** Splits a byte stream into lines without owning it. */
function lineSplitter(onLine: (line: string) => void): (chunk: Buffer) => void {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let blinded = false;

  return (chunk) => {
    if (blinded) return;
    pending += decoder.write(chunk);

    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      onLine(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }

    // Past the ceiling this direction stops being watched. It keeps being
    // relayed: going blind is the tap's problem, never the miner's.
    if (pending.length > MAX_STRATUM_LINE_BYTES) {
      blinded = true;
      pending = "";
    }
  };
}

function watchSession(ledger: Ledger, now: () => number) {
  let extranonce1: string | null = null;
  let difficulty: number | null = null;
  let target: string | null = null;

  const subscribes = new Set<string>();
  const pending = new Map<string, Pending>();
  const jobs = new Map<string, readonly unknown[]>();
  const written = new Set<string>();

  function writeJob(jobId: string): void {
    if (written.has(jobId)) return;
    const params = jobs.get(jobId);
    if (params === undefined) return;
    ledger.append({ kind: "job", at: now(), jobId, params });
    written.add(jobId);
    if (written.size > JOBS_HELD * 4) {
      const oldest = written.values().next().value;
      if (oldest !== undefined) written.delete(oldest);
    }
  }

  function resolve(entry: Pending, outcome: "accepted" | "rejected" | "unanswered", error?: string) {
    writeJob(entry.jobId);
    ledger.append({
      kind: "share",
      at: entry.at,
      id: entry.id,
      jobId: entry.jobId,
      params: entry.params,
      extranonce1: entry.extranonce1,
      difficulty: entry.difficulty,
      target: entry.target,
      outcome,
      ...(error === undefined ? {} : { error }),
    });
  }

  /** Miner to proxy. */
  function fromMiner(message: StratumMessage): void {
    if (!isStratumRequest(message) || message.id === null) return;
    const id = String(message.id);

    if (message.method === StratumMethod.Subscribe) {
      subscribes.add(id);
      return;
    }

    if (message.method === StratumMethod.Submit) {
      const jobId = message.params[1];
      pending.set(id, {
        at: now(),
        id,
        jobId: typeof jobId === "string" ? jobId : String(jobId),
        // The first parameter is the login, which is a session token.
        params: message.params.slice(1),
        extranonce1,
        difficulty,
        target,
      });
    }
  }

  /** Proxy to miner. */
  function fromProxy(message: StratumMessage): void {
    if (isStratumResponse(message)) {
      const id = message.id === null ? null : String(message.id);
      if (id === null) return;

      if (subscribes.has(id)) {
        subscribes.delete(id);
        // Bitcoin-style pools answer [subscriptions, extranonce1, size];
        // Equihash pools answer [session, nonce1]. Both put it second.
        const result = message.result;
        if (Array.isArray(result) && typeof result[1] === "string") {
          extranonce1 = result[1];
        }
        return;
      }

      const entry = pending.get(id);
      if (entry === undefined) return;
      pending.delete(id);

      // The same definition of accepted the proxy's own accounting uses. A
      // tap with its own idea of acceptance would disagree with the books for
      // reasons that have nothing to do with honesty.
      if (isShareAccepted(message)) {
        resolve(entry, "accepted");
      } else {
        const reason = message.error === null ? undefined : String(message.error[1]);
        resolve(entry, "rejected", reason);
      }
      return;
    }

    switch (message.method) {
      case StratumMethod.Notify: {
        const jobId = message.params[0];
        if (jobId === undefined) return;
        jobs.set(String(jobId), message.params);
        if (jobs.size > JOBS_HELD) {
          const oldest = jobs.keys().next().value;
          if (oldest !== undefined) jobs.delete(oldest);
        }
        return;
      }
      case StratumMethod.SetDifficulty: {
        const value = message.params[0];
        if (typeof value === "number" && Number.isFinite(value)) difficulty = value;
        return;
      }
      case "mining.set_target": {
        const value = message.params[0];
        if (typeof value === "string") target = value;
        return;
      }
      case StratumMethod.SetExtranonce: {
        const value = message.params[0];
        if (typeof value === "string") extranonce1 = value;
        return;
      }
      default:
        return;
    }
  }

  /** A submit nobody answered before the connection went is neither. */
  function drain(): void {
    for (const entry of pending.values()) resolve(entry, "unanswered");
    pending.clear();
  }

  return { fromMiner, fromProxy, drain };
}

export function startRelay(
  target: RelayTarget,
  ledger: Ledger,
  now: () => number = () => Math.floor(Date.now() / 1000),
): Promise<Relay> {
  const sockets = new Set<Socket>();

  const server: Server = createServer((miner) => {
    sockets.add(miner);
    const upstream = connect(target.port, target.host);
    sockets.add(upstream);

    const session = watchSession(ledger, now);
    const minerLines = lineSplitter((line) => {
      const message = decodeStratumLine(line);
      if (message !== null) session.fromMiner(message);
    });
    const proxyLines = lineSplitter((line) => {
      const message = decodeStratumLine(line);
      if (message !== null) session.fromProxy(message);
    });

    miner.on("data", (chunk: Buffer) => {
      upstream.write(chunk);
      minerLines(chunk);
    });
    upstream.on("data", (chunk: Buffer) => {
      miner.write(chunk);
      proxyLines(chunk);
    });

    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      session.drain();
      miner.destroy();
      upstream.destroy();
      sockets.delete(miner);
      sockets.delete(upstream);
    };

    miner.on("close", finish);
    upstream.on("close", finish);
    miner.on("error", finish);
    upstream.on("error", finish);
  });

  return new Promise((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("relay did not bind a port"));
        return;
      }
      resolveStart({
        host: "127.0.0.1",
        port: address.port,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}
