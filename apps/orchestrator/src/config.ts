import type { ControlServerOptions } from "./control/server.js";
import type { SessionOptions } from "./session.js";
import type { StratumServerOptions } from "./server.js";

/** Everything a session needs except the login resolver, which is wired from
 * live stores rather than read from the environment. */
export type SessionConfig = Omit<SessionOptions, "resolveLogin">;

export interface AccountingConfig {
  readonly databasePath: string;
  /** Labels every bucket row. One algorithm per process for now. */
  readonly algo: string;
}

export interface ControlConfig {
  readonly server: ControlServerOptions;
  readonly challengeTtlSeconds: number;
  readonly maxOutstandingChallenges: number;
  readonly sessionTtlSeconds: number;
  readonly maxSessions: number;
}

export interface OrchestratorConfig {
  readonly stratum: StratumServerOptions;
  readonly session: SessionConfig;
  readonly control: ControlConfig;
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
    control: {
      server: {
        // Loopback by default: this endpoint hands out bearer tokens and
        // speaks plain HTTP, so exposing it is a deliberate act behind TLS.
        host: env["ZGROVE_CONTROL_HOST"] ?? "127.0.0.1",
        port: readNumber(env, "ZGROVE_CONTROL_PORT", 3334),
        maxBodyBytes: readNumber(env, "ZGROVE_CONTROL_MAX_BODY", 8 * 1024),
        // What a worker is told to point its miner at, which is not always
        // the interface the proxy binds.
        stratumHost:
          env["ZGROVE_ADVERTISED_STRATUM_HOST"] ??
          env["ZGROVE_STRATUM_HOST"] ??
          "127.0.0.1",
        stratumPort: readNumber(env, "ZGROVE_STRATUM_PORT", 3333),
      },
      challengeTtlSeconds: readNumber(env, "ZGROVE_CHALLENGE_TTL_SECONDS", 60),
      maxOutstandingChallenges: readNumber(env, "ZGROVE_MAX_CHALLENGES", 1024),
      sessionTtlSeconds: readNumber(env, "ZGROVE_SESSION_TTL_SECONDS", 3600),
      maxSessions: readNumber(env, "ZGROVE_MAX_SESSIONS", 4096),
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
