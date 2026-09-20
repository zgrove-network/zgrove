#!/usr/bin/env node
import { attest, AttestationRefused } from "./client.js";
import { loadWorkerConfig } from "./config.js";
import { defaultKeyPath, loadKeyPair, loadOrCreateKeyPair } from "./keystore.js";
import { startMiner } from "./miner.js";

const USAGE = `zgrove-worker — the contributor agent

  init       create this rig's key and print the public half
  show-key   print the public key of an existing rig
  run        attest to the orchestrator and run the miner

Environment:
  ZGROVE_ACCOUNT_ID         the account this rig earns for (required for run)
  ZGROVE_CONTROL_URL        orchestrator control plane (default http://127.0.0.1:3334)
  ZGROVE_WORKER_KEY_PATH    key file (default ~/.zgrove/worker.key)
  ZGROVE_MINER_COMMAND      miner binary; omit to print the target and stop
  ZGROVE_MINER_ARGS         JSON array; {host} {port} {token} are filled in
`;

/** Backoff between a miner exiting and the next attempt. */
const FIRST_RETRY_MS = 2_000;
const MAX_RETRY_MS = 60_000;

async function main(argv: readonly string[]): Promise<number> {
  const [command] = argv;

  switch (command) {
    case "init":
      return runInit();
    case "show-key":
      return runShowKey();
    case "run":
      return runAgent();
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      return 0;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      return 2;
  }
}

function runInit(): number {
  const path = process.env["ZGROVE_WORKER_KEY_PATH"] ?? defaultKeyPath();
  const keys = loadOrCreateKeyPair(path);

  process.stdout.write(
    `${keys.publicKey}\n\n` +
      `Key: ${path}\n` +
      `Give the operator that public key. On the orchestrator:\n` +
      `  zgrove enroll --account <id> --worker <name> --key ${keys.publicKey}\n`,
  );
  return 0;
}

function runShowKey(): number {
  const path = process.env["ZGROVE_WORKER_KEY_PATH"] ?? defaultKeyPath();
  const keys = loadKeyPair(path);
  if (keys === null) {
    throw new Error(`No key at ${path}. Run "zgrove-worker init" first.`);
  }

  process.stdout.write(`${keys.publicKey}\n`);
  return 0;
}

async function runAgent(): Promise<number> {
  const config = loadWorkerConfig(process.env);
  const keys = loadOrCreateKeyPair(config.keyPath);

  const session = await attest(
    {
      baseUrl: config.controlUrl,
      accountId: config.accountId,
      requestTimeoutMs: config.requestTimeoutMs,
    },
    keys,
  );

  if (config.miner === null) {
    // Useful on its own: it proves the rig is enrolled and prints what to
    // point a miner at, without this agent having to launch one.
    process.stdout.write(
      `stratum+tcp://${session.stratumHost}:${session.stratumPort}\n` +
        `user: ${session.token}\n`,
    );
    return 0;
  }

  let stopping = false;
  let retryMs = FIRST_RETRY_MS;
  let current = startMiner(config.miner, {
    host: session.stratumHost,
    port: session.stratumPort,
    token: session.token,
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stopping = true;
      current.stop();
    });
  }

  while (!stopping) {
    await current.exited;
    if (stopping) {
      break;
    }

    await sleep(retryMs);
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);

    // Re-attested on every restart rather than reusing the old token. The
    // miner only ever dies here, so this is the one moment a fresh token
    // costs nothing, and the previous one may well be gone.
    const next = await attest(
      {
        baseUrl: config.controlUrl,
        accountId: config.accountId,
        requestTimeoutMs: config.requestTimeoutMs,
      },
      keys,
    ).catch((error: unknown) => {
      process.stderr.write(`${describe(error)}\n`);
      return null;
    });

    if (next === null) {
      continue;
    }

    retryMs = FIRST_RETRY_MS;
    current = startMiner(config.miner, {
      host: next.stratumHost,
      port: next.stratumPort,
      token: next.token,
    });
  }

  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  if (error instanceof AttestationRefused) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  // A contributor at a terminal wants the sentence, not the stack.
  process.stderr.write(`${describe(error)}\n`);
  process.exitCode = 1;
}
