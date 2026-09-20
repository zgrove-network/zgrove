import { connect, createServer, type Server, type Socket } from "node:net";

import { createAccounting, migrate, openDatabase, type Accounting } from "@zgrove/db";

import { createStratumServer } from "../server.js";
import { createSession, type Session } from "../session.js";

export const UPSTREAM_LOGIN = "POOL_ACCOUNT_ADDRESS";
export const UPSTREAM_PASSWORD = "pool-password";
export const CONTRIBUTOR_LOGIN = "t1ContributorAddress.rig1";

/** A line of JSON, as either side of a stratum connection writes it. */
export type Line = Record<string, unknown>;

/** Answers a submit, or returns null to leave it hanging. */
export type SubmitAnswer = (request: Line) => Line | null;

export interface HarnessOptions {
  readonly answerSubmit?: SubmitAnswer;
  readonly submitTimeoutMs?: number;
  readonly maxPendingSubmits?: number;
  readonly difficulty?: number;
}

export interface Harness {
  readonly accounting: Accounting;
  /** Everything the fake pool received, in order. */
  upstreamSaw(): readonly Line[];
  connectMiner(): Promise<FakeMiner>;
  dropUpstream(): void;
  stop(): Promise<void>;
}

export interface FakeMiner {
  send(message: Line): void;
  received(): readonly Line[];
  waitFor(match: (message: Line) => boolean, label: string): Promise<Line>;
  waitForClose(): Promise<void>;
}

const WAIT_TIMEOUT_MS = 2_000;

/**
 * The fakes parse and build stratum lines with plain JSON rather than through
 * the protocol package. A fake that shares a codec with the code under test
 * agrees with it by construction, including where both are wrong.
 */
export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const upstreamSaw: Line[] = [];
  const upstreamSockets = new Set<Socket>();
  const difficulty = options.difficulty ?? 512;

  const pool = createServer((socket) => {
    upstreamSockets.add(socket);
    socket.on("close", () => upstreamSockets.delete(socket));

    readLines(socket, (request) => {
      upstreamSaw.push(request);

      switch (request["method"]) {
        case "mining.subscribe":
          writeLine(socket, { id: request["id"], result: [[], "ab", 4], error: null });
          return;
        case "mining.authorize":
          writeLine(socket, { id: request["id"], result: true, error: null });
          writeLine(socket, {
            id: null,
            method: "mining.set_difficulty",
            params: [difficulty],
          });
          return;
        case "mining.submit": {
          const answer = (options.answerSubmit ?? acceptEverything)(request);
          if (answer !== null) {
            writeLine(socket, answer);
          }
          return;
        }
        default:
          return;
      }
    });
  });
  await listen(pool);

  const db = openDatabase(":memory:");
  migrate(db);
  const accounting = createAccounting(db);
  const workerIds = new Map<string, number>();

  const sessions = new Map<number, Session>();
  const proxy = createStratumServer(
    { host: "127.0.0.1", port: 0, maxConnections: 16, idleTimeoutMs: 60_000 },
    {
      onConnect() {},
      onUndecodable() {},
      onMessage(connection, message) {
        let session = sessions.get(connection.id);
        if (session === undefined) {
          session = createSession(
            connection,
            {
              upstream: {
                host: "127.0.0.1",
                port: portOf(pool),
                connectTimeoutMs: 2_000,
              },
              upstreamLogin: UPSTREAM_LOGIN,
              upstreamPassword: UPSTREAM_PASSWORD,
              maxQueuedMessages: 32,
              submitTimeoutMs: options.submitTimeoutMs ?? 60_000,
              maxPendingSubmits: options.maxPendingSubmits ?? 256,
            },
            {
              onIdentity() {},
              onDifficulty() {},
              onShare(share) {
                let workerId = workerIds.get(share.identity.login);
                if (workerId === undefined) {
                  workerId = accounting.touchWorker(share.identity, share.atSeconds);
                  workerIds.set(share.identity.login, workerId);
                }
                accounting.recordShare({
                  workerId,
                  algo: "equihash",
                  accepted: share.accepted,
                  difficulty: share.difficulty,
                  atSeconds: share.atSeconds,
                });
              },
            },
          );
          sessions.set(connection.id, session);
        }
        session.handleMinerMessage(message);
      },
      onDisconnect(connection, reason) {
        const session = sessions.get(connection.id);
        sessions.delete(connection.id);
        session?.end(reason);
      },
    },
  );
  await listen(proxy);

  return {
    accounting,
    upstreamSaw: () => upstreamSaw,

    async connectMiner() {
      const socket = connect(portOf(proxy), "127.0.0.1");
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });

      const received: Line[] = [];
      let closed = false;
      socket.on("close", () => {
        closed = true;
      });
      readLines(socket, (message) => received.push(message));

      return {
        send(message) {
          socket.write(`${JSON.stringify(message)}\n`);
        },
        received: () => received,
        async waitFor(match, label) {
          const found = await until(() => received.find(match), label);
          return found;
        },
        async waitForClose() {
          await until(() => (closed ? true : undefined), "miner socket to close");
        },
      };
    },

    dropUpstream() {
      for (const socket of upstreamSockets) {
        socket.destroy();
      }
    },

    async stop() {
      for (const session of sessions.values()) {
        session.end("test over");
      }
      await Promise.all([close(proxy), close(pool)]);
      db.close();
    },
  };
}

const acceptEverything: SubmitAnswer = (request) => ({
  id: request["id"],
  result: true,
  error: null,
});

/** Polls rather than sleeps, so a test waits only as long as it has to. */
export async function until<T>(
  probe: () => T | undefined,
  label: string,
): Promise<T> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  for (;;) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function readLines(socket: Socket, onLine: (line: Line) => void): void {
  socket.setEncoding("utf8");
  let pending = "";

  socket.on("data", (chunk: string) => {
    pending += chunk;
    for (
      let newline = pending.indexOf("\n");
      newline !== -1;
      newline = pending.indexOf("\n")
    ) {
      const text = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (text.length > 0) {
        onLine(JSON.parse(text) as Line);
      }
    }
  });
}

function writeLine(socket: Socket, message: Line): void {
  socket.write(`${JSON.stringify(message)}\n`);
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Server is not listening on a TCP port");
  }
  return address.port;
}

/**
 * Drives a miner through subscribe and authorize, and waits for the
 * difficulty the pool pushes afterwards. Returning before that arrived would
 * leave the weight a later submit is credited at up to a race.
 */
export async function authorizedMiner(
  harness: Harness,
  login: string = CONTRIBUTOR_LOGIN,
): Promise<FakeMiner> {
  const miner = await harness.connectMiner();

  miner.send({ id: 1, method: "mining.subscribe", params: ["lolMiner/1.0"] });
  await miner.waitFor((message) => message["id"] === 1, "subscribe result");

  miner.send({ id: 2, method: "mining.authorize", params: [login, "worker-password"] });
  await miner.waitFor(
    (message) => message["id"] === 2 && message["result"] === true,
    "authorize result",
  );
  await miner.waitFor(
    (message) => message["method"] === "mining.set_difficulty",
    "difficulty push",
  );

  return miner;
}
