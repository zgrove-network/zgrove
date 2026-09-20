import type { SessionOptions } from "./session.js";
import type { StratumServerOptions } from "./server.js";

export interface AccountingConfig {
  readonly databasePath: string;
  /** Labels every bucket row. One algorithm per process for now. */
  readonly algo: string;
}

export interface OrchestratorConfig {
  readonly stratum: StratumServerOptions;
  readonly session: SessionOptions;
  readonly accounting: AccountingConfig;
}

/**
 * Binds to loopback unless told otherwise. The proxy authenticates nobody
 * yet, so the public interface is something an operator opts into rather than
 * something a fresh checkout does by accident.
 */
export function loadConfig(env: NodeJS.ProcessEnv): OrchestratorConfig {
  return {
    stratum: {
      host: env["ZGROVE_STRATUM_HOST"] ?? "127.0.0.1",
      port: readNumber(env, "ZGROVE_STRATUM_PORT", 3333),
      maxConnections: readNumber(env, "ZGROVE_MAX_CONNECTIONS", 512),
      // Generous: upstream job pushes and miner submits both reset it, so
      // this only fires on a peer that has genuinely stopped talking.
      idleTimeoutMs: readNumber(env, "ZGROVE_IDLE_TIMEOUT_MS", 600_000),
    },
    session: {
      upstream: {
        host: readRequired(env, "ZGROVE_UPSTREAM_HOST"),
        port: readNumber(env, "ZGROVE_UPSTREAM_PORT", 0),
        connectTimeoutMs: readNumber(env, "ZGROVE_UPSTREAM_TIMEOUT_MS", 10_000),
      },
      // Not a default. Relaying under the wrong account would hand the work
      // to whoever owns it, so an unset value has to stop the process.
      upstreamLogin: readRequired(env, "ZGROVE_UPSTREAM_LOGIN"),
      upstreamPassword: env["ZGROVE_UPSTREAM_PASSWORD"] ?? "x",
      maxQueuedMessages: readNumber(env, "ZGROVE_MAX_QUEUED_MESSAGES", 32),
      submitTimeoutMs: readNumber(env, "ZGROVE_SUBMIT_TIMEOUT_MS", 60_000),
      maxPendingSubmits: readNumber(env, "ZGROVE_MAX_PENDING_SUBMITS", 256),
    },
    accounting: {
      databasePath: env["ZGROVE_DB_PATH"] ?? "data/zgrove.sqlite",
      // Not a default. Rows labelled with the wrong algorithm are wrong in a
      // way nothing downstream can detect, let alone repair.
      algo: readRequired(env, "ZGROVE_ALGO"),
    },
  };
}

function readRequired(env: NodeJS.ProcessEnv, name: string): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    throw new Error(`${name} must be set`);
  }
  return raw.trim();
}

function readNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    if (fallback === 0) {
      throw new Error(`${name} must be set`);
    }
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got ${raw}`);
  }
  return value;
}
