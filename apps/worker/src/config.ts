import { homedir } from "node:os";
import { join } from "node:path";

import { defaultKeyPath } from "./keystore.js";
import type { MinerCommand } from "./miner.js";

export interface WorkerConfig {
  readonly controlUrl: string;
  readonly accountId: string;
  readonly keyPath: string;
  /** This rig's own record of its shares. See ledger.ts. */
  readonly ledgerPath: string;
  readonly requestTimeoutMs: number;
  readonly miner: MinerCommand | null;
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  return {
    controlUrl: (env["ZGROVE_CONTROL_URL"] ?? "http://127.0.0.1:3334").replace(
      /\/+$/,
      "",
    ),
    accountId: required(env, "ZGROVE_ACCOUNT_ID"),
    keyPath: env["ZGROVE_WORKER_KEY_PATH"] ?? defaultKeyPath(),
    ledgerPath: env["ZGROVE_WORKER_LEDGER_PATH"] ?? defaultLedgerPath(),
    requestTimeoutMs: Number(env["ZGROVE_REQUEST_TIMEOUT_MS"] ?? 15_000),
    miner: readMiner(env),
  };
}

export function defaultLedgerPath(): string {
  return join(homedir(), ".zgrove", "shares.jsonl");
}

/**
 * Null means "print the target and stop". A contributor who wants to run the
 * miner themselves should not have to let this agent launch one, and neither
 * should someone checking that attestation works at all.
 */
function readMiner(env: NodeJS.ProcessEnv): MinerCommand | null {
  const command = env["ZGROVE_MINER_COMMAND"];
  if (command === undefined || command.trim() === "") {
    return null;
  }

  // A JSON array rather than a command line, because splitting a command line
  // correctly is a parser nobody should be writing, and getting it wrong is
  // how an argument becomes two.
  const raw = env["ZGROVE_MINER_ARGS"] ?? "[]";
  let args: unknown;
  try {
    args = JSON.parse(raw);
  } catch {
    throw new Error("ZGROVE_MINER_ARGS must be a JSON array of strings");
  }

  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new Error("ZGROVE_MINER_ARGS must be a JSON array of strings");
  }

  return { command: command.trim(), args: args as string[] };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} must be set`);
  }
  return value.trim();
}
