import assert from "node:assert/strict";
import { test } from "node:test";

import { createAccounting, type Accounting } from "../accounting.js";
import { BUCKET_SECONDS, bucketStartFor } from "../buckets.js";
import { openDatabase, type Db } from "../database.js";
import { migrate } from "../migrate.js";

const RIG1 = {
  username: "t1ContributorAddress",
  workerName: "rig1",
  login: "t1ContributorAddress.rig1",
} as const;

const RIG2 = {
  username: "t1ContributorAddress",
  workerName: "rig2",
  login: "t1ContributorAddress.rig2",
} as const;

function freshDatabase(): { db: Db; accounting: Accounting } {
  const db = openDatabase(":memory:");
  migrate(db);
  return { db, accounting: createAccounting(db) };
}

test("migrating twice applies each migration once", () => {
  const db = openDatabase(":memory:");

  // The property is idempotence, not how many migrations exist today, or
  // this test has to be edited every time one is added.
  const first = migrate(db);
  assert.ok(first.length > 0);
  assert.deepEqual([...first].sort((a, b) => a - b), [...first]);
  assert.deepEqual(migrate(db), []);

  db.close();
});

test("a reconnecting worker resolves to the row its shares point at", () => {
  const { db, accounting } = freshDatabase();

  const first = accounting.touchWorker(RIG1, 1_000);
  const second = accounting.touchWorker(RIG1, 2_000);
  assert.equal(second, first);

  const row = db
    .prepare("SELECT first_seen_at, last_seen_at FROM workers WHERE id = ?")
    .get(first) as { first_seen_at: number; last_seen_at: number };

  // Recency moves, the origin does not: the two answer different questions.
  assert.equal(row.first_seen_at, 1_000);
  assert.equal(row.last_seen_at, 2_000);

  db.close();
});

test("weight is credited only where upstream accepted", () => {
  const { db, accounting } = freshDatabase();
  const worker = accounting.touchWorker(RIG1, 1_000);

  accounting.recordShare({
    workerId: worker,
    algo: "equihash",
    outcome: "accepted",
    difficulty: 4,
    atSeconds: 1_000,
  });
  // A worker cannot buy weight with shares upstream threw away.
  accounting.recordShare({
    workerId: worker,
    algo: "equihash",
    outcome: "rejected",
    difficulty: 99,
    atSeconds: 1_000,
  });

  const stats = accounting.statsBetween(0, 10_000);
  assert.equal(stats.length, 1);
  assert.equal(stats[0]?.accepted, 1);
  assert.equal(stats[0]?.rejected, 1);
  assert.equal(stats[0]?.acceptedDifficulty, 4);

  db.close();
});

test("shares either side of a bucket boundary land in two rows", () => {
  const { db, accounting } = freshDatabase();
  const worker = accounting.touchWorker(RIG1, 0);

  const bucket = bucketStartFor(1_758_400_123);
  const inside = bucket + BUCKET_SECONDS - 1;
  const after = bucket + BUCKET_SECONDS;

  for (const at of [bucket, inside, after]) {
    accounting.recordShare({
      workerId: worker,
      algo: "equihash",
      outcome: "accepted",
      difficulty: 1,
      atSeconds: at,
    });
  }

  const rows = db
    .prepare(
      "SELECT bucket_start, accepted FROM share_buckets ORDER BY bucket_start",
    )
    .all() as { bucket_start: number; accepted: number }[];

  assert.deepEqual(rows, [
    { bucket_start: bucket, accepted: 2 },
    { bucket_start: bucket + BUCKET_SECONDS, accepted: 1 },
  ]);

  db.close();
});

test("bucket starts are aligned and stable across the window", () => {
  const start = bucketStartFor(1_758_400_123);
  assert.equal(start % BUCKET_SECONDS, 0);
  assert.equal(bucketStartFor(start), start);
  assert.equal(bucketStartFor(start + BUCKET_SECONDS - 1), start);
  assert.equal(bucketStartFor(start + BUCKET_SECONDS), start + BUCKET_SECONDS);
});

test("the reporting window excludes its upper bound", () => {
  const { db, accounting } = freshDatabase();
  const worker = accounting.touchWorker(RIG1, 0);
  const bucket = bucketStartFor(1_758_400_123);

  accounting.recordShare({
    workerId: worker,
    algo: "equihash",
    outcome: "accepted",
    difficulty: 1,
    atSeconds: bucket,
  });

  // Half-open, so consecutive windows neither double-count nor skip a bucket.
  assert.equal(accounting.statsBetween(bucket, bucket + 1)[0]?.accepted, 1);
  assert.equal(accounting.statsBetween(bucket, bucket)[0]?.accepted, 0);
  assert.equal(accounting.statsBetween(bucket + 1, bucket + 999)[0]?.accepted, 0);

  db.close();
});

test("a worker that submits nothing is still reported", () => {
  const { db, accounting } = freshDatabase();
  accounting.touchWorker(RIG1, 0);
  accounting.touchWorker(RIG2, 0);

  accounting.recordShare({
    workerId: 1,
    algo: "equihash",
    outcome: "accepted",
    difficulty: 1,
    atSeconds: 1_000,
  });

  const stats = accounting.statsBetween(0, 10_000);
  assert.equal(stats.length, 2);

  // The silent rig is the row an operator is looking for, so it has to
  // survive the join rather than be filtered out by it.
  const silent = stats.find((row) => row.workerName === "rig2");
  assert.equal(silent?.accepted, 0);
  assert.equal(silent?.lastBucket, null);

  db.close();
});

test("the schema refuses a duplicate worker and an orphan bucket", () => {
  const { db, accounting } = freshDatabase();
  accounting.touchWorker(RIG1, 0);

  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO workers (username, worker_name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)",
        )
        .run(RIG1.username, RIG1.workerName, 0, 0),
    /UNIQUE/,
  );

  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO share_buckets (worker_id, bucket_start, algo) VALUES (?, ?, ?)",
        )
        .run(999, 0, "equihash"),
    /FOREIGN KEY/,
  );

  db.close();
});

test("a submit upstream never answered is counted apart from a rejection", () => {
  const { db, accounting } = freshDatabase();
  const worker = accounting.touchWorker(RIG1, 1_000);

  accounting.recordShare({
    workerId: worker,
    algo: "equihash",
    outcome: "unresolved",
    difficulty: 64,
    atSeconds: 1_000,
  });

  const stats = accounting.statsBetween(0, 10_000);

  // Folded into rejections it would blame the worker for the pool's silence;
  // folded into acceptances it would invent confirmed work. It is neither.
  assert.equal(stats[0]?.accepted, 0);
  assert.equal(stats[0]?.rejected, 0);
  assert.equal(stats[0]?.unresolved, 1);
  assert.equal(stats[0]?.acceptedDifficulty, 0);

  db.close();
});
