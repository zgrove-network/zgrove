import {
  StratumMethod,
  isShareAccepted,
  isStratumRequest,
  isStratumResponse,
  parseWorkerLogin,
  type StratumId,
  type StratumMessage,
  type StratumRequest,
  type WorkerIdentity,
} from "@zgrove/protocol";

import type { ShareOutcome } from "@zgrove/db";

import { log } from "./log.js";
import type { MinerConnection } from "./server.js";
import { dialUpstream, type UpstreamConnection, type UpstreamOptions } from "./upstream.js";

export interface SessionOptions {
  readonly upstream: UpstreamOptions;
  /** The pool account every miner is relayed under. */
  readonly upstreamLogin: string;
  readonly upstreamPassword: string;
  readonly maxQueuedMessages: number;
  /** How long a submit waits for an answer before it is given up on. */
  readonly submitTimeoutMs: number;
  readonly maxPendingSubmits: number;
}

/** A submit that has been relayed and is waiting on upstream's verdict. */
interface PendingSubmit {
  readonly identity: WorkerIdentity;
  readonly jobId: string | null;
  /** Difficulty in force when the share was sent, not when it was answered:
   * upstream can retune between the two, and the share was worth what it was
   * worth when it was made. */
  readonly difficulty: number;
  readonly atSeconds: number;
  readonly sentAtMs: number;
}

export interface ResolvedShare {
  readonly identity: WorkerIdentity;
  /** What upstream answered, including having answered nothing. */
  readonly outcome: ShareOutcome;
  readonly difficulty: number;
  readonly atSeconds: number;
  readonly jobId: string | null;
}

export interface SessionHooks {
  onIdentity(identity: WorkerIdentity): void;
  onDifficulty(difficulty: number): void;
  /** Called once per submit, however it ended. */
  onShare(share: ResolvedShare): void;
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

/** Stratum's catch-all code, used where no specific one fits. */
const OTHER_ERROR = 20;

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

  // Insertion-ordered, which is also age order, so expiry walks the front and
  // stops at the first entry still in time.
  const pending = new Map<string, PendingSubmit>();

  // Upstream is free to answer a numeric id with its string spelling, and
  // some do. Keying on the text form means a share is still matched to its
  // submitter when that happens, instead of silently going unaccounted.
  function pendingKey(id: StratumId): string {
    return String(id);
  }

  function expirePending(nowMs: number): void {
    for (const [key, submit] of pending) {
      if (nowMs - submit.sentAtMs < options.submitTimeoutMs) {
        return;
      }
      pending.delete(key);
      // Recorded in its own column rather than folded into rejections. An
      // upstream that goes quiet has to be visible as itself, or the reports
      // show a worker that simply stopped producing.
      emit(submit, "unresolved");
      log("warn", "share.unresolved", {
        miner: miner.id,
        worker: submit.identity.login,
      });
    }
  }

  function resolveSubmit(id: StratumId, accepted: boolean): boolean {
    const key = pendingKey(id);
    const submit = pending.get(key);
    if (submit === undefined) {
      return false;
    }

    pending.delete(key);
    emit(submit, accepted ? "accepted" : "rejected");
    return true;
  }

  function emit(submit: PendingSubmit, outcome: ShareOutcome): void {
    hooks.onShare({
      identity: submit.identity,
      outcome,
      difficulty: submit.difficulty,
      atSeconds: submit.atSeconds,
      jobId: submit.jobId,
    });
  }

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
        // Never relayed. client.reconnect names a host and port for the
        // miner to move to, and that host is the upstream pool. Passing it
        // on would send the contributor straight there, still mining under
        // the pool account this proxy authorized, with nothing left in the
        // path to record that the work was theirs. Ending the session makes
        // the miner redial here instead.
        if (
          isStratumRequest(message) &&
          message.method === StratumMethod.Reconnect
        ) {
          log("info", "upstream.reconnect_refused", { miner: miner.id });
          end("upstream asked the miner to reconnect elsewhere");
          return;
        }

        observeDifficulty(message);

        // Resolved before the answer is relayed, so a share is accounted for
        // even if writing to the miner's socket fails.
        if (isStratumResponse(message) && message.id !== null) {
          resolveSubmit(message.id, isShareAccepted(message));
        }

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

    const nowMs = Date.now();
    expirePending(nowMs);

    // An upstream that has stopped answering leaves every share in limbo, and
    // the session is no longer accounting for anything. Ending it is honest;
    // growing this map is not.
    if (pending.size >= options.maxPendingSubmits) {
      end("upstream left too many submits unanswered");
      return;
    }

    const key = pendingKey(request.id);
    if (pending.has(key)) {
      // Upstream answers an id once. A second submit under an id still in
      // flight would make one of the two shares unmatchable, so it is refused
      // rather than allowed to quietly displace the first.
      miner.send({
        id: request.id,
        result: false,
        error: [OTHER_ERROR, "Duplicate submit id still in flight"],
      });
      return;
    }

    const jobId = request.params[1];
    pending.set(key, {
      identity,
      jobId: typeof jobId === "string" ? jobId : null,
      difficulty,
      atSeconds: Math.floor(nowMs / 1000),
      sentAtMs: nowMs,
    });

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
