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
  const readonly = options.readonly ?? false;
  const db = new Database(path, { readonly });

  // WAL so a readonly stats query never blocks the proxy mid-share. Set by
  // the writer only: changing the journal mode writes the file header, which a
  // readonly handle cannot do. A reader takes whatever mode the file is in —
  // WAL for the live database, rollback for a backup, which VACUUM INTO writes
  // without a log — and setting it here made every backup unopenable.
  if (!readonly) {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("foreign_keys = ON");

  // A reader that arrives during a checkpoint should wait, not fail.
  db.pragma("busy_timeout = 5000");

  // FULL: every commit is on disk before it returns. This database now
  // settles payouts, and a dispatch record lost to a power cut is a payment
  // this process can no longer account for.
  //
  // The cost is an fsync per share, since each share is its own commit.
  // Measured on an SSD: 45 µs a share, a ceiling near 22,000 shares a second,
  // against 11 µs under NORMAL. A thousand GPUs produce on the order of a
  // hundred shares a second. Network block storage fsyncs slower than a local
  // SSD, so the ceiling on a VPS will be lower — still far above the load.
  // When it is not, batch shares into one transaction per flush rather than
  // loosening this.
  db.pragma("synchronous = FULL");

  return db;
}
