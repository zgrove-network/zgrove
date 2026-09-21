import assert from "node:assert/strict";
import { test } from "node:test";

import { createAccounting } from "../accounting.js";
import { openDatabase, type Db } from "../database.js";
import { migrate } from "../migrate.js";
import { createPayouts, splitByWeight, type Payouts } from "../payouts.js";
import { createRegistry } from "../registry.js";

// Bucket-aligned, as a real payout window has to be.
const START = 1_758_399_900;
const END = START + 86_400;

interface Fixture {
  readonly db: Db;
  readonly payouts: Payouts;
  credit(accountId: string, weight: number, atSeconds?: number): void;
}

function fixture(): Fixture {
  const db = openDatabase(":memory:");
  migrate(db);
  const registry = createRegistry(db);
  const accounting = createAccounting(db);
  const payouts = createPayouts(db);

  return {
    db,
    payouts,
    credit(accountId, weight, atSeconds = START + 60) {
      if (registry.findAccount(accountId) === null) {
        registry.createAccount({ id: accountId, payoutAddress: `u1${accountId}` }, START);
      }
      const binding = registry.registerWorkerKey({
        publicKey: `key-${accountId}`,
        accountId,
        workerName: "rig1",
        atSeconds: START,
      });
      accounting.recordShare({
        workerId: binding.workerId,
        algo: "equihash",
        outcome: "accepted",
        difficulty: weight,
        atSeconds,
      });
    },
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

test("a split hands out every unit of the total and no more", () => {
  // The property that must never break: money is conserved across the split.
  const cases: readonly number[][] = [
    [1, 1, 1],
    [1, 2, 3],
    [7, 11, 13, 17],
    [1, 999_999],
    [3, 3, 3, 3, 3, 3, 3],
    [0.5, 0.25, 0.25],
  ];

  for (const weights of cases) {
    for (const total of [1, 2, 7, 100, 100_001, 12_345_678]) {
      const parts = splitByWeight(total, weights, sum(weights));
      assert.equal(
        sum(parts),
        total,
        `weights ${weights.join(",")} total ${total} summed to ${sum(parts)}`,
      );
      assert.ok(parts.every((part) => part >= 0));
    }
  }
});

test("equal weights split as evenly as integers allow", () => {
  // 10 zatoshi over 3 accounts is 4/3/3, never 3/3/3 with one lost.
  const parts = splitByWeight(10, [1, 1, 1], 3);
  assert.equal(sum(parts), 10);
  assert.deepEqual([...parts].sort((a, b) => b - a), [4, 3, 3]);
});

test("a split of nothing, or among nobody, creates nothing", () => {
  assert.deepEqual(splitByWeight(0, [1, 2], 3), [0, 0]);
  assert.deepEqual(splitByWeight(100, [], 0), []);
  assert.deepEqual(splitByWeight(100, [0, 0], 0), [0, 0]);
});

test("a round conserves the distributable amount", () => {
  const { db, payouts, credit } = fixture();
  credit("acct_a", 600_000);
  credit("acct_b", 300_000);
  credit("acct_c", 100_001);

  const round = payouts.plan({
    periodStart: START,
    periodEnd: END,
    totalZat: 1_000_000_001,
    feeBpsFor: () => 100,
    minPayoutZat: 0,
    atSeconds: END,
  });

  const paid = sum(round.entries.map((e) => e.amountZat));
  const carried = sum(round.entries.map((e) => e.carriedOutZat));
  const carriedIn = sum(round.entries.map((e) => e.carriedInZat));

  assert.equal(paid + carried, round.distributableZat + carriedIn);
  assert.equal(round.feeZat + round.distributableZat, round.totalZat);
  db.close();
});

test("the fee is floored, so rounding never costs a contributor", () => {
  const { db, payouts, credit } = fixture();
  credit("acct_a", 1);

  // 1% of 999 is 9.99. Rounding up would take a zatoshi that is owed.
  const round = payouts.plan({
    periodStart: START,
    periodEnd: END,
    totalZat: 999,
    feeBpsFor: () => 100,
    minPayoutZat: 0,
    atSeconds: END,
  });

  assert.equal(round.feeZat, 9);
  assert.equal(round.distributableZat, 990);
  db.close();
});

test("a share below the minimum is carried, not dropped and not dusted", () => {
  const { db, payouts, credit } = fixture();
  credit("acct_big", 1_000_000);
  credit("acct_small", 1);

  const round = payouts.plan({
    periodStart: START,
    periodEnd: END,
    totalZat: 100_000_000,
    feeBpsFor: () => 0,
    minPayoutZat: 1_000_000,
    atSeconds: END,
  });

  const small = round.entries.find((e) => e.accountId === "acct_small");
  assert.ok(small !== undefined);
  assert.equal(small.amountZat, 0);
  assert.ok(small.carriedOutZat > 0, "the small account keeps what it earned");

  // Still conserved: what is not paid is carried, never lost.
  const paid = sum(round.entries.map((e) => e.amountZat));
  const carried = sum(round.entries.map((e) => e.carriedOutZat));
  assert.equal(paid + carried, round.distributableZat);
  db.close();
});

test("carried value accumulates and is eventually paid out", () => {
  const { db, payouts, credit } = fixture();
  credit("acct_small", 1);

  const first = payouts.plan({
    periodStart: START,
    periodEnd: END,
    totalZat: 500_000,
    feeBpsFor: () => 0,
    minPayoutZat: 1_000_000,
    atSeconds: END,
  });
  assert.equal(first.entries[0]?.amountZat, 0);
  payouts.record(first, END);
  assert.equal(payouts.carriedForward("acct_small"), 500_000);

  // The rig keeps mining, and the next round adds what was held back.
  credit("acct_small", 1, END + 60);
  const second = payouts.plan({
    periodStart: END,
    periodEnd: END + 86_400,
    totalZat: 600_000,
    feeBpsFor: () => 0,
    minPayoutZat: 1_000_000,
    atSeconds: END + 86_400,
  });

  assert.equal(second.entries[0]?.carriedInZat, 500_000);
  assert.equal(second.entries[0]?.amountZat, 1_100_000);
  assert.equal(second.entries[0]?.carriedOutZat, 0);

  payouts.record(second, END + 86_400);
  assert.equal(payouts.carriedForward("acct_small"), 0);
  db.close();
});

test("the same period cannot be recorded twice", () => {
  const { db, payouts, credit } = fixture();
  credit("acct_a", 100);

  const round = payouts.plan({
    periodStart: START,
    periodEnd: END,
    totalZat: 1_000_000,
    feeBpsFor: () => 0,
    minPayoutZat: 0,
    atSeconds: END,
  });

  payouts.record(round, END);

  // There is no way to take ZEC back out of a shielded address, so paying a
  // window twice has to be impossible rather than merely unlikely.
  assert.throws(() => payouts.record(round, END), /UNIQUE/);
  db.close();
});

test("weight decides the split and only accepted weight counts", () => {
  const { db, payouts, credit } = fixture();
  credit("acct_a", 300);
  credit("acct_b", 100);

  const round = payouts.plan({
    periodStart: START,
    periodEnd: END,
    totalZat: 400,
    feeBpsFor: () => 0,
    minPayoutZat: 0,
    atSeconds: END,
  });

  const a = round.entries.find((e) => e.accountId === "acct_a");
  const b = round.entries.find((e) => e.accountId === "acct_b");
  assert.equal(a?.amountZat, 300);
  assert.equal(b?.amountZat, 100);
  db.close();
});

test("a total with no work behind it is refused, not quietly absorbed", () => {
  const { db, payouts } = fixture();

  // Nobody mined in this window, so there is nobody for the money to reach.
  assert.throws(
    () =>
      payouts.plan({
        periodStart: START,
        periodEnd: END,
        totalZat: 1_000_000,
        feeBpsFor: () => 0,
        minPayoutZat: 0,
        atSeconds: END,
      }),
    /no accepted work/,
  );
  db.close();
});

test("a nonsense round is refused before it can be recorded", () => {
  const { db, payouts, credit } = fixture();
  const base = { periodStart: START, periodEnd: END, feeBpsFor: () => 0, minPayoutZat: 0, atSeconds: END };

  // A window that starts mid-bucket would drop that bucket without a word.
  assert.throws(
    () => payouts.plan({ ...base, periodStart: START + 1, totalZat: 1 }),
    /bucket boundaries/,
  );

  assert.throws(() => payouts.plan({ ...base, totalZat: -1 }), /zatoshi/);
  assert.throws(() => payouts.plan({ ...base, totalZat: 1.5 }), /zatoshi/);
  assert.throws(
    () => payouts.plan({ ...base, periodEnd: START, totalZat: 1 }),
    /end after it starts/,
  );
  // A bad rate is refused per account, so it needs an account to refuse for.
  credit("acct_a", 100);
  assert.throws(
    () => payouts.plan({ ...base, feeBpsFor: () => 10_001, totalZat: 1 }),
    /basis points/,
  );
  db.close();
});

test("each account pays its own rate out of its own share", () => {
  const { db, payouts, credit } = fixture();
  credit("acct_staked", 500);
  credit("acct_plain", 500);

  const round = payouts.plan({
    periodStart: START,
    periodEnd: END,
    totalZat: 1_000_000,
    // Equal work, different tiers. One fee off the top could not express this.
    feeBpsFor: (id) => (id === "acct_staked" ? 50 : 200),
    minPayoutZat: 0,
    atSeconds: END,
  });

  const staked = round.entries.find((e) => e.accountId === "acct_staked");
  const plain = round.entries.find((e) => e.accountId === "acct_plain");

  assert.equal(staked?.grossZat, 500_000);
  assert.equal(plain?.grossZat, 500_000);
  assert.equal(staked?.feeZat, 2_500);
  assert.equal(plain?.feeZat, 10_000);
  assert.equal(staked?.amountZat, 497_500);
  assert.equal(plain?.amountZat, 490_000);

  // The discount comes out of the pool's cut, not out of the other
  // contributor's share: equal work still means equal gross.
  assert.equal(round.feeZat, 12_500);
  db.close();
});

test("fees and payouts still account for every zatoshi", () => {
  const { db, payouts, credit } = fixture();
  credit("acct_a", 333);
  credit("acct_b", 333);
  credit("acct_c", 334);

  const round = payouts.plan({
    periodStart: START,
    periodEnd: END,
    totalZat: 1_000_003,
    feeBpsFor: (id) => (id === "acct_a" ? 50 : id === "acct_b" ? 137 : 200),
    minPayoutZat: 0,
    atSeconds: END,
  });

  const paid = sum(round.entries.map((e) => e.amountZat));
  const carried = sum(round.entries.map((e) => e.carriedOutZat));
  const fees = sum(round.entries.map((e) => e.feeZat));
  const gross = sum(round.entries.map((e) => e.grossZat));

  assert.equal(gross, round.totalZat);
  assert.equal(paid + carried + fees, round.totalZat);
  assert.equal(fees, round.feeZat);
  db.close();
});

test("a zero-fee tier charges nothing at all", () => {
  const { db, payouts, credit } = fixture();
  credit("acct_free", 1);

  const round = payouts.plan({
    periodStart: START,
    periodEnd: END,
    totalZat: 999_999,
    feeBpsFor: () => 0,
    minPayoutZat: 0,
    atSeconds: END,
  });

  assert.equal(round.feeZat, 0);
  assert.equal(round.entries[0]?.amountZat, 999_999);
  db.close();
});
