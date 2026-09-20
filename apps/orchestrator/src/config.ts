import type { StratumServerOptions } from "./server.js";

export interface OrchestratorConfig {
  readonly stratum: StratumServerOptions;
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
  };
}

function readNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got ${raw}`);
  }
  return value;
}
