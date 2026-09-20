import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Db } from "./database.js";

/** Resolved from the module's own location, which is a sibling of the
 * migrations directory whether this runs from src or from dist. */
const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

const FILE_NAME = /^(\d+)_([A-Za-z0-9_-]+)\.sql$/;

interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/**
 * Applies every migration the database has not seen, each inside its own
 * transaction, and returns the versions applied. Safe to call on every start:
 * an up-to-date database applies nothing.
 */
export function migrate(db: Db): readonly number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: number }).version),
  );

  const pending = loadMigrations().filter(
    (migration) => !applied.has(migration.version),
  );

  const apply = db.transaction((migration: Migration) => {
    db.exec(migration.sql);
    db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
    ).run(migration.version, migration.name, Math.floor(Date.now() / 1000));
  });

  for (const migration of pending) {
    apply(migration);
  }

  return pending.map((migration) => migration.version);
}

function loadMigrations(): readonly Migration[] {
  const migrations: Migration[] = [];
  const seen = new Set<number>();

  for (const file of readdirSync(MIGRATIONS_DIR)) {
    if (!file.endsWith(".sql")) {
      continue;
    }

    const match = FILE_NAME.exec(file);
    if (match === null) {
      throw new Error(`Migration must be named <version>_<name>.sql: ${file}`);
    }

    const version = Number(match[1] ?? "");
    if (seen.has(version)) {
      throw new Error(`Two migrations claim version ${version}`);
    }
    seen.add(version);

    migrations.push({
      version,
      name: match[2] ?? "",
      sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8"),
    });
  }

  // Filename order is lexicographic and would put 10 before 9.
  return migrations.sort((a, b) => a.version - b.version);
}
