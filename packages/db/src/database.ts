import Database from "better-sqlite3";

export type Db = Database.Database;

export interface OpenOptions {
  readonly readonly?: boolean;
}

/**
 * Opens the accounting database. One writer only, as the architecture assumes:
 * the orchestrator holds the write handle and everything else, the stats CLI
 * included, opens readonly.
 */
export function openDatabase(path: string, options: OpenOptions = {}): Db {
  const db = new Database(path, { readonly: options.readonly ?? false });

  // WAL so a readonly stats query never blocks the proxy mid-share.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // A reader that arrives during a checkpoint should wait, not fail.
  db.pragma("busy_timeout = 5000");

  // NORMAL rather than FULL: an OS crash or power loss can cost the most
  // recent commits, where FULL would cost an fsync on every share written.
  // The exposure is bounded by how often the proxy flushes, and this is worth
  // revisiting before anything in this database settles a payout.
  db.pragma("synchronous = NORMAL");

  return db;
}
