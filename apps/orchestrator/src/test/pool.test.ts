import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorkerStats } from "@zgrove/db";

import { summarisePool } from "../control/pool.js";

const OPTIONS = {
  algo: "autolykos2",
  upstream: "2miners",
  stratum: "pool.zgrove.network:3333",
  windowSeconds: 3600,
  workPerDifficulty: 2 ** 32,
  asOf: 1_758_000_000,
};

function worker(over: Partial<WorkerStats>): WorkerStats {
  return {
    workerId: 1,
    username: "acct_anonymous",
    workerName: "rig",
    accepted: 0,
    rejected: 0,
    unresolved: 0,
    acceptedDifficulty: 0,
    acceptedUsdMicros: 0,
    lastBucket: null,
    ...over,
  };
}

test("the public summary carries nothing that identifies a contributor", () => {
  // This is the product's whole claim. A status page that leaks who
  // contributed what is worse than no status page: it looks like proof of
  // the opposite of what the pool says about itself.
  const account = "acct_5f3a9c";
  const rig = "a-contributors-rig";
  const otherAccount = "u1verylongshieldedaddress";
  const otherRig = "k-publickey-of-a-worker";
  const secrets = [account, rig, otherAccount, otherRig];

  const summary = summarisePool(
    [
      worker({ workerId: 7, username: account, workerName: rig, accepted: 400, acceptedDifficulty: 400 }),
      worker({ workerId: 8, username: otherAccount, workerName: otherRig, accepted: 100, acceptedDifficulty: 100 }),
    ],
    OPTIONS,
  );

  const json = JSON.stringify(summary);
  for (const secret of secrets) {
    assert.ok(!json.includes(secret), `the summary leaked ${secret}`);
  }
  // Nor the internal row ids, which are a handle on a person even without a name.
  assert.ok(!json.includes('"workerId"'), "the summary leaked a worker id");
  assert.equal(Object.keys(summary).length, 10, "a new field was added; check it is not per-contributor");
});

test("totals are the sum, and each outcome stays in its own column", () => {
  const summary = summarisePool(
    [
      worker({ accepted: 300, rejected: 2, unresolved: 1, acceptedDifficulty: 300 }),
      worker({ workerId: 2, accepted: 100, rejected: 0, unresolved: 4, acceptedDifficulty: 100 }),
    ],
    OPTIONS,
  );

  assert.equal(summary.accepted, 400);
  assert.equal(summary.rejected, 2);
  assert.equal(summary.unresolved, 5);
});

test("a contributor is a rig that got a share accepted, not one that merely connected", () => {
  // A rig that submitted only rejects has not contributed anything, and
  // counting it would inflate the one number a visitor reads first.
  const summary = summarisePool(
    [
      worker({ accepted: 10, acceptedDifficulty: 10 }),
      worker({ workerId: 2, accepted: 0, rejected: 50 }),
      worker({ workerId: 3, accepted: 0, unresolved: 3 }),
    ],
    OPTIONS,
  );

  assert.equal(summary.contributors, 1);
});

test("hashrate comes from accepted difficulty over the window", () => {
  const summary = summarisePool(
    [worker({ accepted: 1, acceptedDifficulty: 3600 })],
    { ...OPTIONS, windowSeconds: 3600, workPerDifficulty: 1000 },
  );
  assert.equal(summary.hashrate, 1000, "3600 weight over 3600s at 1000 hashes each");
});

test("an empty pool reports zeroes rather than dividing by nothing", () => {
  const summary = summarisePool([], { ...OPTIONS, windowSeconds: 0 });
  assert.equal(summary.contributors, 0);
  assert.equal(summary.hashrate, 0);
  assert.ok(Number.isFinite(summary.hashrate));
});
