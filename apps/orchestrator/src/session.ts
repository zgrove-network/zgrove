import {
  StratumMethod,
  isStratumRequest,
  parseWorkerLogin,
  type StratumMessage,
  type StratumRequest,
  type WorkerIdentity,
} from "@zgrove/protocol";

import { log } from "./log.js";
import type { MinerConnection } from "./server.js";
import { dialUpstream, type UpstreamConnection, type UpstreamOptions } from "./upstream.js";

export interface SessionOptions {
  readonly upstream: UpstreamOptions;
  /** The pool account every miner is relayed under. */
  readonly upstreamLogin: string;
  readonly upstreamPassword: string;
  readonly maxQueuedMessages: number;
}

export interface SessionHooks {
  onIdentity(identity: WorkerIdentity): void;
  onDifficulty(difficulty: number): void;
}

export interface Session {
  identity(): WorkerIdentity | null;
  /** Difficulty upstream last set, which is the weight a share is worth. */
  difficulty(): number;
  handleMinerMessage(message: StratumMessage): void;
  end(reason: string): void;
}

/** Stratum's conventional code for a login the pool will not accept. */
const UNAUTHORIZED_WORKER = 24;

/**
 * Pairs one miner socket with one upstream socket and relays between them.
 *
 * The substitution at the authorize boundary is the whole arrangement in one
 * place: upstream is told the pool's account, and the login the miner
 * actually sent is kept here as the attribution key. Upstream settles the
 * work; who earned it is ours to know.
 */
export function createSession(
  miner: MinerConnection,
  options: SessionOptions,
  hooks: SessionHooks,
): Session {
  let upstream: UpstreamConnection | null = null;
  let upstreamReady = false;
  let identity: WorkerIdentity | null = null;
  let difficulty = 1;
  let ended = false;

  const queued: StratumMessage[] = [];

  function ensureUpstream(): void {
    if (upstream !== null) {
      return;
    }

    upstream = dialUpstream(options.upstream, {
      onReady() {
        upstreamReady = true;
        log("info", "upstream.ready", { miner: miner.id });
        for (const message of queued.splice(0)) {
          upstream?.send(message);
        }
      },

      onMessage(message) {
        observeDifficulty(message);
        miner.send(message);
      },

      onUndecodable(line) {
        log("warn", "upstream.undecodable", {
          miner: miner.id,
          bytes: Buffer.byteLength(line, "utf8"),
        });
      },

      // No reconnect. A new upstream socket would be reissued a different
      // extranonce, so every job the miner is working on becomes invalid;
      // dropping the miner makes it redial and start a coherent session.
      onClose(reason) {
        end(`upstream gone: ${reason}`);
      },
    });
  }

  function observeDifficulty(message: StratumMessage): void {
    if (!isStratumRequest(message) || message.method !== StratumMethod.SetDifficulty) {
      return;
    }

    const value = message.params[0];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      log("warn", "upstream.bad_difficulty", { miner: miner.id });
      return;
    }

    difficulty = value;
    hooks.onDifficulty(value);
  }

  function forward(message: StratumMessage): void {
    ensureUpstream();

    if (upstreamReady) {
      upstream?.send(message);
      return;
    }

    // Held until the upstream handshake completes. The cap is here because a
    // peer that keeps talking into an upstream that never answers would
    // otherwise buy unbounded memory with one socket.
    if (queued.length >= options.maxQueuedMessages) {
      end("upstream did not become ready before the miner ran ahead");
      return;
    }
    queued.push(message);
  }

  function handleAuthorize(request: StratumRequest): void {
    const parsed = parseWorkerLogin(request.params[0]);
    if (!parsed.ok) {
      log("warn", "miner.login_rejected", {
        miner: miner.id,
        reason: parsed.reason,
      });
      miner.send({
        id: request.id,
        result: false,
        error: [UNAUTHORIZED_WORKER, `Unauthorized worker: ${parsed.reason}`],
      });
      return;
    }

    // One socket belongs to one worker. Allowing a second login to take over
    // mid-session would leave shares already credited to the first sitting
    // under the second, which is a misattribution no later reconciliation can
    // undo.
    if (identity !== null && identity.login !== parsed.identity.login) {
      end("miner tried to authorize as a second worker");
      return;
    }

    if (identity === null) {
      identity = parsed.identity;
      log("info", "miner.authorized", {
        miner: miner.id,
        worker: identity.login,
      });
      hooks.onIdentity(identity);
    }

    // What upstream is told. The miner's own login never leaves this process.
    forward({
      id: request.id,
      method: request.method,
      params: [
        options.upstreamLogin,
        options.upstreamPassword,
        ...request.params.slice(2),
      ],
    });
  }

  function handleSubmit(request: StratumRequest): void {
    // A share carries the worker login in its leading parameter, exactly as
    // authorize does, so the same substitution has to happen here. Relaying
    // it untouched would put a contributor's address in front of the upstream
    // pool on every single share, which is the one thing this pool exists to
    // prevent, and most pools would reject the share anyway for naming a
    // worker they never authorized.
    if (identity === null) {
      // A share from a session that never authorized cannot be attributed to
      // anyone. Relaying it would credit the pool account with work no
      // contributor can be paid for.
      miner.send({
        id: request.id,
        result: false,
        error: [UNAUTHORIZED_WORKER, "Unauthorized worker: submit before authorize"],
      });
      return;
    }

    forward({
      id: request.id,
      method: request.method,
      params: [options.upstreamLogin, ...request.params.slice(1)],
    });
  }

  function end(reason: string): void {
    if (ended) {
      return;
    }
    ended = true;
    upstream?.close(reason);
    miner.close(reason);
  }

  return {
    identity: () => identity,
    difficulty: () => difficulty,

    handleMinerMessage(message) {
      if (ended) {
        return;
      }

      if (isStratumRequest(message)) {
        if (message.method === StratumMethod.Authorize) {
          handleAuthorize(message);
          return;
        }
        if (message.method === StratumMethod.Submit) {
          handleSubmit(message);
          return;
        }
      }

      forward(message);
    },

    end,
  };
}
