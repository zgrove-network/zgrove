import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDatabase } from "@zgrove/db";

import { runInit } from "../cli/init.js";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "zgrove-init-"));
}

function capture(run: () => number): { code: number; out: string } {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => {
    written.push(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    return { code: run(), out: written.join("") };
  } finally {
    process.stdout.write = original;
  }
}

test("a fresh directory gets a migrated database and an env file", () => {
  const dir = scratch();
  const dbPath = join(dir, "data", "zgrove.sqlite");
  const envPath = join(dir, ".env");
  writeFileSync(join(dir, ".env.example"), "ZGROVE_UPSTREAM_HOST=\n");

  const previous = process.cwd();
  process.chdir(dir);
  try {
    const { code, out } = capture(() => runInit(["--db", dbPath, "--env", envPath], {}));
    assert.equal(code, 0);
    assert.match(out, /created/);
  } finally {
    process.chdir(previous);
  }

  assert.ok(existsSync(dbPath));
  assert.ok(existsSync(envPath));

  const db = openDatabase(dbPath, { readonly: true });
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name")
    .all("table")
    .map((row) => (row as { name: string }).name);
  db.close();

  assert.ok(tables.includes("workers"));
  assert.ok(tables.includes("share_buckets"));
  assert.ok(tables.includes("payout_rounds"));
});

test("running it again changes nothing that already exists", () => {
  const dir = scratch();
  const dbPath = join(dir, "data", "zgrove.sqlite");
  const envPath = join(dir, ".env");
  writeFileSync(join(dir, ".env.example"), "FROM_EXAMPLE=1\n");
  writeFileSync(envPath, "ZGROVE_UPSTREAM_HOST=already.set\n");

  const previous = process.cwd();
  process.chdir(dir);
  try {
    capture(() => runInit(["--db", dbPath, "--env", envPath], {}));
    const { out } = capture(() => runInit(["--db", dbPath, "--env", envPath], {}));
    assert.match(out, /already up to date/);
    assert.match(out, /left alone/);
  } finally {
    process.chdir(previous);
  }

  // The env file is the only thing here holding something an operator cannot
  // get back, so it is never replaced.
  assert.equal(readFileSync(envPath, "utf8"), "ZGROVE_UPSTREAM_HOST=already.set\n");
});

test("it names what is still missing, and why", () => {
  const dir = scratch();
  const previous = process.cwd();
  process.chdir(dir);

  try {
    const { out } = capture(() =>
      runInit(["--db", join(dir, "z.sqlite"), "--env", join(dir, ".env")], {
        ZGROVE_UPSTREAM_HOST: "pool.example",
        ZGROVE_UPSTREAM_PORT: "3333",
      }),
    );

    // The two that are set are not asked for again; the two that matter most
    // are, with the reason attached rather than just the name.
    assert.doesNotMatch(out, /ZGROVE_UPSTREAM_HOST\n/);
    assert.match(out, /ZGROVE_UPSTREAM_LOGIN/);
    assert.match(out, /hands the work away/);
    assert.match(out, /ZGROVE_ALGO/);
    assert.match(out, /cannot be repaired later/);
  } finally {
    process.chdir(previous);
  }
});

test("nothing is missing when everything is set", () => {
  const dir = scratch();
  const previous = process.cwd();
  process.chdir(dir);

  try {
    const { out } = capture(() =>
      runInit(["--db", join(dir, "z.sqlite"), "--env", join(dir, ".env")], {
        ZGROVE_UPSTREAM_HOST: "pool.example",
        ZGROVE_UPSTREAM_PORT: "3333",
        ZGROVE_UPSTREAM_LOGIN: "t1account",
        ZGROVE_ALGO: "equihash",
      }),
    );
    assert.match(out, /Everything required is set/);
  } finally {
    process.chdir(previous);
  }
});
