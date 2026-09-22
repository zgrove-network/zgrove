import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { migrate, openDatabase } from "@zgrove/db";

import { runBackup } from "../cli/backup.js";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "zgrove-backup-"));
}

function quietly(run: () => number): number {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return run();
  } finally {
    process.stdout.write = original;
  }
}

function tablesIn(path: string): string[] {
  const db = openDatabase(path, { readonly: true });
  try {
    return db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
  } finally {
    db.close();
  }
}

test("a backup carries commits that are still only in the write-ahead log", () => {
  const dir = scratch();
  const source = join(dir, "zgrove.sqlite");

  // Held open and never checkpointed: everything written here is in the WAL
  // and nowhere else, which is exactly the state a running pool is in.
  const live = openDatabase(source);
  migrate(live);
  live.exec("CREATE TABLE probe (n INTEGER)");
  live.prepare("INSERT INTO probe VALUES (?)").run(42);

  // The mistake this command exists to prevent. A copy of the main file taken
  // now has none of it.
  const raw = join(dir, "raw.sqlite");
  copyFileSync(source, raw);
  assert.equal(tablesIn(raw).includes("probe"), false);

  const target = join(dir, "backup.sqlite");
  assert.equal(quietly(() => runBackup(["--to", target, "--db", source], {})), 0);

  const copy = openDatabase(target, { readonly: true });
  try {
    assert.equal(copy.prepare<[], { n: number }>("SELECT n FROM probe").get()?.n, 42);
    assert.ok(tablesIn(target).includes("schema_migrations"));
  } finally {
    copy.close();
    live.close();
  }
});

test("a backup never overwrites a file that is already there", () => {
  const dir = scratch();
  const source = join(dir, "zgrove.sqlite");
  migrate(openDatabase(source));

  const target = join(dir, "backup.sqlite");
  writeFileSync(target, "yesterday's good backup");

  assert.throws(() => runBackup(["--to", target, "--db", source], {}), /already exists/);
});
