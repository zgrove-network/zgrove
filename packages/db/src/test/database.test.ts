import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import Database from "better-sqlite3";

import { openDatabase } from "../database.js";

test("a readonly handle opens a file that is not in WAL mode", () => {
  // A backup made by VACUUM INTO has no write-ahead log. Asking a readonly
  // handle to switch the journal mode is a write, and it used to make every
  // backup unopenable — including by the stats command pointed at one.
  const path = join(mkdtempSync(join(tmpdir(), "zgrove-db-")), "rollback.sqlite");
  const plain = new Database(path);
  plain.pragma("journal_mode = DELETE");
  plain.exec("CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (7);");
  plain.close();

  const reader = openDatabase(path, { readonly: true });
  try {
    assert.equal(reader.prepare<[], { n: number }>("SELECT n FROM t").get()?.n, 7);
    // And it left the file as it found it.
    assert.equal(reader.pragma("journal_mode", { simple: true }), "delete");
  } finally {
    reader.close();
  }
});

test("the writer still puts a new database into WAL, durably", () => {
  const path = join(mkdtempSync(join(tmpdir(), "zgrove-db-")), "live.sqlite");
  const writer = openDatabase(path);
  try {
    assert.equal(writer.pragma("journal_mode", { simple: true }), "wal");
    // 2 is FULL: a payout record is on disk before the call returns.
    assert.equal(writer.pragma("synchronous", { simple: true }), 2);
  } finally {
    writer.close();
  }
});
