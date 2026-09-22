#!/usr/bin/env node
import { attest, AttestationRefused } from "./client.js";
import { defaultLedgerPath, loadWorkerConfig } from "./config.js";
import { defaultKeyPath, loadKeyPair, loadOrCreateKeyPair } from "./keystore.js";
import { openLedger, summarise } from "./ledger.js";
import { startMiner, type RunningMiner } from "./miner.js";
import { startRelay, type Relay } from "./relay.js";

const USAGE = `zgrove-worker — the contributor agent

  init       create this rig's key and print the public half
  show-key   print the public key of an existing rig
  run        attest to the orchestrator and run the miner
  ledger     what this rig's own record says it was accepted for

Environment:
  ZGROVE_ACCOUNT_ID         the account this rig earns for (required for run)
  ZGROVE_CONTROL_URL        orchestrator control plane (default http://127.0.0.1:3334)
  ZGROVE_WORKER_KEY_PATH    key file (default ~/.zgrove/worker.key)
  ZGROVE_WORKER_LEDGER_PATH share record (default ~/.zgrove/shares.jsonl)
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
    case "ledger":
      return runLedger();
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

/**
 * What a contributor compares their payout against. Read from their own
 * machine, so it needs nothing from the operator to be believed.
 */
function runLedger(): number {
  const path = process.env["ZGROVE_WORKER_LEDGER_PATH"] ?? defaultLedgerPath();
  const now = Math.floor(Date.now() / 1000);
  const windows: readonly [string, number][] = [
    ["last 24 hours", now - 86_400],
    ["last 30 days", now - 30 * 86_400],
    ["everything", 0],
  ];

  const lines = [`ledger: ${path}`, ""];
  for (const [label, from] of windows) {
    const s = summarise(path, from);
    lines.push(
      `${label.padEnd(14)} accepted ${String(s.accepted).padStart(7)}` +
        `   rejected ${String(s.rejected).padStart(6)}` +
        `   unanswered ${String(s.unanswered).padStart(5)}` +
        `   accepted difficulty ${s.acceptedDifficulty}`,
    );
  }
  lines.push(
    "",
    "Accepted means the proxy answered true with no error, the same test its",
    "own accounting applies. If a payout was computed from fewer accepted",
    "shares than this, the records disagree; the shares themselves are in the",
    "file and each one can be checked against the job beside it.",
  );
  process.stdout.write(`${lines.join("\n")}\n`);
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

  const ledger = openLedger(config.ledgerPath);
  const miner = config.miner;

  // The miner talks to a relay on this machine rather than to the proxy, so
  // this rig keeps its own record of what it sent and what it was told. The
  // relay forwards bytes untouched; see relay.ts.
  async function launch(target: { stratumHost: string; stratumPort: number; token: string }) {
    const relay = await startRelay({ host: target.stratumHost, port: target.stratumPort }, ledger);
    const running = startMiner(miner, { host: relay.host, port: relay.port, token: target.token });
    return { relay, running };
  }

  let stopping = false;
  let retryMs = FIRST_RETRY_MS;
  let current: { relay: Relay; running: RunningMiner } = await launch(session);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stopping = true;
      current.running.stop();
    });
  }

  while (!stopping) {
    await current.running.exited;
    // Closing the relay drains its open submits into the ledger as unanswered.
    await current.relay.close();
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
    current = await launch(next);
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
