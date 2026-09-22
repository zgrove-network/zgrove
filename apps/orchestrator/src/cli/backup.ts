import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { openDatabase } from "@zgrove/db";

export const BACKUP_USAGE = `zgrove backup --to <path>

Writes a complete, consistent copy of the database to <path>, safely, while
the orchestrator keeps running.

  --to <path>   where to write it; must not already exist
  --db <path>   database to copy (default $ZGROVE_DB_PATH, then data/zgrove.sqlite)

Do not copy the database file by other means. It runs in WAL mode, so recent
commits live in a separate write-ahead log until a checkpoint folds them in.
A plain copy of the main file taken before then is missing them — on a young
database, measured, it is missing everything: no tables at all.
`;

/**
 * VACUUM INTO rather than a file copy. It reads through SQLite, so it sees the
 * database as a reader would — write-ahead log included — and it writes a
 * single self-contained file with no log of its own beside it.
 */
export function runBackup(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      to: { type: "string" },
      db: { type: "string" },
    },
    allowPositionals: false,
  });

  const target = values.to;
  if (target === undefined || target.trim() === "") {
    throw new Error("--to <path> is required");
  }
  // VACUUM INTO refuses an existing file anyway; saying so in words is kinder
  // than surfacing SQLite's message, and it never overwrites a good backup.
  if (existsSync(target)) {
    throw new Error(`${target} already exists; choose a new path`);
  }

  const source = values.db ?? env["ZGROVE_DB_PATH"] ?? "data/zgrove.sqlite";
  if (!existsSync(source)) {
    throw new Error(`No database at ${source}`);
  }

  const db = openDatabase(source);
  try {
    db.prepare("VACUUM INTO ?").run(target);
  } finally {
    db.close();
  }

  process.stdout.write(`${target}\n`);
  return 0;
}
