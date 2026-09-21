import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { migrate, openDatabase } from "@zgrove/db";

/**
 * Gets a fresh checkout to the point where the only thing left is filling in
 * values only the operator has. Everything it does is safe to repeat: it
 * creates what is missing and never replaces what is there.
 */

/** Values with no safe default, and why each one has none. */
const REQUIRED: readonly { name: string; why: string }[] = [
  {
    name: "ZGROVE_UPSTREAM_HOST",
    why: "the pool to relay to; there is no sensible guess",
  },
  {
    name: "ZGROVE_UPSTREAM_PORT",
    why: "its stratum port",
  },
  {
    name: "ZGROVE_UPSTREAM_LOGIN",
    why: "the account the pool pays. Relaying under the wrong one hands the work away",
  },
  {
    name: "ZGROVE_ALGO",
    why: "labels every share; rows under the wrong algorithm cannot be repaired later",
  },
];

export function runInit(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      db: { type: "string" },
      env: { type: "string", default: ".env" },
    },
    allowPositionals: false,
  });

  const lines: string[] = [];

  const databasePath = values.db ?? env["ZGROVE_DB_PATH"] ?? "data/zgrove.sqlite";
  const existed = existsSync(databasePath);
  mkdirSync(dirname(resolve(databasePath)), { recursive: true });

  const db = openDatabase(databasePath);
  try {
    const applied = migrate(db);
    lines.push(
      existed
        ? `database ${databasePath}: ${applied.length === 0 ? "already up to date" : `migrations ${applied.join(", ")} applied`}`
        : `database ${databasePath}: created, schema at migration ${applied.at(-1) ?? 0}`,
    );
  } finally {
    db.close();
  }

  const envPath = values.env ?? ".env";
  if (existsSync(envPath)) {
    // Never overwritten. It is the one file here that holds anything an
    // operator cannot get back.
    lines.push(`${envPath}: already exists, left alone`);
  } else if (existsSync(".env.example")) {
    copyFileSync(".env.example", envPath);
    lines.push(`${envPath}: created from .env.example`);
  } else {
    lines.push(`${envPath}: no .env.example here to copy from`);
  }

  const missing = REQUIRED.filter((entry) => {
    const value = env[entry.name];
    return value === undefined || value.trim() === "";
  });

  lines.push("");
  if (missing.length === 0) {
    lines.push("Everything required is set. Start with: zgrove-orchestrator");
  } else {
    lines.push(`Fill these in ${envPath} before starting:`);
    for (const entry of missing) {
      lines.push(`  ${entry.name}`);
      lines.push(`    ${entry.why}`);
    }
    lines.push("");
    lines.push("Then: zgrove account --payout <shielded address>");
    lines.push("      zgrove enroll --account <id> --worker <name> --key <public key>");
  }

  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

export const INIT_USAGE = `zgrove init — prepare a checkout to be started

  --db <path>    accounting database (default: $ZGROVE_DB_PATH or data/zgrove.sqlite)
  --env <path>   environment file to create (default: .env)

Creates the database and an environment file, migrates an existing database in
place, and lists what still needs a value. Safe to run again: it creates what
is missing and replaces nothing.
`;
