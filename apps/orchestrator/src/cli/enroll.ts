import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

import { createRegistry, migrate, openDatabase } from "@zgrove/db";
import { decodePublicKey } from "@zgrove/protocol";

/**
 * Enrolment is deliberately an operator action rather than something a worker
 * can do for itself. A key proves only that a key is held; deciding that this
 * key earns for that account is the moment trust is granted, and it should
 * take somebody doing it.
 */

export function runAccount(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      db: { type: "string" },
      id: { type: "string" },
      payout: { type: "string" },
    },
    allowPositionals: false,
  });

  if (values.payout === undefined || values.payout.trim() === "") {
    throw new Error("--payout is required: the shielded address earnings go to");
  }

  const id = values.id ?? `acct_${randomBytes(9).toString("base64url")}`;
  const now = Math.floor(Date.now() / 1000);

  withRegistry(databasePath(values.db, env), (registry) => {
    registry.createAccount({ id, payoutAddress: values.payout as string }, now);
  });

  process.stdout.write(`${id}\n`);
  return 0;
}

export function runEnroll(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      db: { type: "string" },
      account: { type: "string" },
      worker: { type: "string" },
      key: { type: "string" },
    },
    allowPositionals: false,
  });

  const account = required(values.account, "--account");
  const worker = required(values.worker, "--worker");
  const key = required(values.key, "--key");

  // Checked before it is written, because a malformed key in this table is a
  // worker that can never attest and a failure nobody sees until it tries.
  try {
    decodePublicKey(key);
  } catch {
    throw new Error("--key is not a base64url ed25519 public key");
  }

  const now = Math.floor(Date.now() / 1000);

  withRegistry(databasePath(values.db, env), (registry) => {
    if (registry.findAccount(account) === null) {
      throw new Error(`No such account: ${account}. Create it first.`);
    }

    const binding = registry.registerWorkerKey({
      publicKey: key,
      accountId: account,
      workerName: worker,
      atSeconds: now,
    });

    process.stdout.write(
      `enrolled ${binding.accountId}.${binding.workerName} as worker ${binding.workerId}\n`,
    );
  });

  return 0;
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${flag} is required`);
  }
  return value.trim();
}

function databasePath(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  return flag ?? env["ZGROVE_DB_PATH"] ?? "data/zgrove.sqlite";
}

/** Opens for writing and migrates, so enrolling works on a fresh install
 * before the orchestrator has ever been started. */
function withRegistry(path: string, body: (registry: ReturnType<typeof createRegistry>) => void): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = openDatabase(path);
  try {
    migrate(db);
    body(createRegistry(db));
  } finally {
    db.close();
  }
}

export const ACCOUNT_USAGE = `zgrove account — create a contributor account

  --payout <addr>  shielded address earnings are paid to (required)
  --id <id>        account id; generated when omitted
  --db <path>      accounting database
`;

export const ENROLL_USAGE = `zgrove enroll — bind a rig's key to an account

  --account <id>   the account the rig earns for (required)
  --worker <name>  the rig's name (required)
  --key <base64>   the rig's public key, from "zgrove-worker show-key" (required)
  --db <path>      accounting database
`;
