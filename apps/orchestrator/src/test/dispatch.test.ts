import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createAccounting,
  createDispatch,
  createPayouts,
  createRegistry,
  migrate,
  openDatabase,
  type Db,
  type Dispatch,
} from "@zgrove/db";

import { DispatchRefused, planSend, resume, send } from "../wallet/dispatch.js";
import type { OperationStatus, ShieldedRecipient, Zallet } from "../wallet/zallet.js";

const DAY = Math.floor(Date.UTC(2026, 8, 20) / 1000);
const TREASURY = "u1treasury";

interface Fake extends Zallet {
  readonly calls: { from: string; recipients: readonly ShieldedRecipient[] }[];
}

function fakeZallet(
  behaviour: {
    status?: OperationStatus["status"];
    fail?: boolean;
    broadcast?: boolean;
  } = {},
): Fake {
  const calls: { from: string; recipients: readonly ShieldedRecipient[] }[] = [];
  return {
    calls,
    async sendMany(from, recipients) {
      calls.push({ from, recipients });
      if (behaviour.fail === true) {
        throw new Error("zallet refused the send");
      }
      return "opid-1";
    },
    async operationStatus() {
      const status = behaviour.status ?? "success";
      return {
        status,
        txid: status === "success" ? "deadbeef" : null,
        txids: status === "success" ? ["deadbeef"] : [],
        broadcast: behaviour.broadcast ?? true,
        error: status === "failed" ? "insufficient funds" : null,
      };
    },
    async balanceForAccount() {
      return { pools: {} };
    },
  };
}

function seeded(): { db: Db; dispatch: Dispatch; roundId: number } {
  const db = openDatabase(":memory:");
  migrate(db);
  const registry = createRegistry(db);
  const accounting = createAccounting(db);

  for (const [id, weight] of [
    ["acct_a", 300],
    ["acct_b", 100],
  ] as const) {
    registry.createAccount({ id, payoutAddress: `u1${id}` }, DAY);
    const binding = registry.registerWorkerKey({
      publicKey: `k-${id}`,
      accountId: id,
      workerName: "rig1",
      atSeconds: DAY,
    });
    accounting.recordShare({
      workerId: binding.workerId,
      algo: "equihash",
      outcome: "accepted",
      difficulty: weight,
      atSeconds: DAY + 60,
    });
  }

  const payouts = createPayouts(db);
  const round = payouts.plan({
    periodStart: DAY,
    periodEnd: DAY + 86_400,
    totalZat: 400_000_000,
    feeBpsFor: () => 0,
    minPayoutZat: 0,
    atSeconds: DAY + 86_400,
  });

  return { db, dispatch: createDispatch(db), roundId: payouts.record(round, DAY + 86_400) };
}

test("the send is built from what was recorded, not recomputed", async () => {
  const { db, dispatch, roundId } = seeded();
  const round = dispatch.load(roundId);
  assert.ok(round !== null);

  const plan = planSend(round, TREASURY);

  // 3:1 weight over 4 ZEC, in the decimal form the RPC takes.
  assert.deepEqual(
    [...plan.recipients].sort((a, b) => a.address.localeCompare(b.address)),
    [
      { address: "u1acct_a", amount: "3.00000000" },
      { address: "u1acct_b", amount: "1.00000000" },
    ],
  );
  assert.equal(plan.totalZat, 400_000_000);
  db.close();
});

test("a successful send records the txid and closes the round", async () => {
  const { db, dispatch, roundId } = seeded();
  const zallet = fakeZallet();

  const result = await send(
    planSend(dispatch.load(roundId)!, TREASURY),
    dispatch,
    zallet,
    { minConf: null, waitMs: 1_000, pollMs: 1 },
    DAY,
  );

  assert.equal(result.txid, "deadbeef");
  const after = dispatch.load(roundId);
  assert.equal(after?.dispatchState, "sent");
  assert.equal(after?.txid, "deadbeef");
  assert.equal(after?.operationId, "opid-1");
  assert.equal(after?.fromAddress, TREASURY);
  db.close();
});

test("a round cannot be sent twice", async () => {
  const { db, dispatch, roundId } = seeded();
  const zallet = fakeZallet();

  await send(
    planSend(dispatch.load(roundId)!, TREASURY),
    dispatch,
    zallet,
    { minConf: null, waitMs: 1_000, pollMs: 1 },
    DAY,
  );

  // Shielded ZEC cannot be recalled, so the second attempt has to be refused
  // before it reaches the wallet, not after.
  assert.throws(() => planSend(dispatch.load(roundId)!, TREASURY), DispatchRefused);
  assert.equal(zallet.calls.length, 1);
  db.close();
});

test("two senders racing the same round produce one send", async () => {
  const { db, dispatch, roundId } = seeded();
  const zallet = fakeZallet();
  const plan = planSend(dispatch.load(roundId)!, TREASURY);

  // Both hold a plan built while the round was still planned. The claim in
  // the UPDATE is what decides, not the plan they are holding.
  const first = send(plan, dispatch, zallet, { minConf: null, waitMs: 1_000, pollMs: 1 }, DAY);
  await assert.rejects(
    send(plan, dispatch, zallet, { minConf: null, waitMs: 1_000, pollMs: 1 }, DAY),
    DispatchRefused,
  );
  await first;

  assert.equal(zallet.calls.length, 1);
  db.close();
});

test("a wallet that refuses leaves the round failed and nothing in flight", async () => {
  const { db, dispatch, roundId } = seeded();

  await assert.rejects(
    send(
      planSend(dispatch.load(roundId)!, TREASURY),
      dispatch,
      fakeZallet({ fail: true }),
      { minConf: null, waitMs: 1_000, pollMs: 1 },
      DAY,
    ),
    /refused the send/,
  );

  assert.equal(dispatch.load(roundId)?.dispatchState, "failed");
  db.close();
});

test("a send still building is left resumable, not lost", async () => {
  const { db, dispatch, roundId } = seeded();
  const zallet = fakeZallet({ status: "executing" });

  const result = await send(
    planSend(dispatch.load(roundId)!, TREASURY),
    dispatch,
    zallet,
    { minConf: null, waitMs: 5, pollMs: 1 },
    DAY,
  );

  assert.equal(result.txid, null);
  const stuck = dispatch.load(roundId);
  assert.equal(stuck?.dispatchState, "sending");
  assert.equal(stuck?.operationId, "opid-1");

  // The operation id is the handle that makes it recoverable.
  const finished = await resume(stuck!, dispatch, fakeZallet());
  assert.equal(finished.txid, "deadbeef");
  assert.equal(dispatch.load(roundId)?.dispatchState, "sent");
  db.close();
});

test("a built but unbroadcast send is a failure, not a payment", async () => {
  const { db, dispatch, roundId } = seeded();

  // zallet records the transactions in the wallet even when broadcasting is
  // off. The operation succeeds and hands back a txid, and the money has not
  // moved. Believing the operation here would tell contributors otherwise.
  await assert.rejects(
    send(
      planSend(dispatch.load(roundId)!, TREASURY),
      dispatch,
      fakeZallet({ broadcast: false }),
      { minConf: null, waitMs: 1_000, pollMs: 1 },
      DAY,
    ),
    /did not broadcast/,
  );

  assert.equal(dispatch.load(roundId)?.dispatchState, "failed");
  assert.equal(dispatch.load(roundId)?.txid, null);
  db.close();
});

test("a round stuck with no operation id is never retried on its own", async () => {
  const { db, dispatch, roundId } = seeded();
  dispatch.begin(roundId, TREASURY, DAY);

  // This is the crash between claiming the round and hearing back. Whether
  // money left is unknown, so a human has to look rather than a retry guess.
  await assert.rejects(
    resume(dispatch.load(roundId)!, dispatch, fakeZallet()),
    /by hand/,
  );
  assert.equal(dispatch.load(roundId)?.dispatchState, "sending");
  db.close();
});

test("a round that pays nobody is refused rather than sent empty", async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  const registry = createRegistry(db);
  const accounting = createAccounting(db);
  registry.createAccount({ id: "acct_tiny", payoutAddress: "u1tiny" }, DAY);
  const binding = registry.registerWorkerKey({
    publicKey: "k",
    accountId: "acct_tiny",
    workerName: "rig1",
    atSeconds: DAY,
  });
  accounting.recordShare({
    workerId: binding.workerId,
    algo: "equihash",
    outcome: "accepted",
    difficulty: 1,
    atSeconds: DAY + 60,
  });

  const payouts = createPayouts(db);
  const round = payouts.plan({
    periodStart: DAY,
    periodEnd: DAY + 86_400,
    totalZat: 1_000,
    feeBpsFor: () => 0,
    minPayoutZat: 100_000,
    atSeconds: DAY,
  });
  const id = payouts.record(round, DAY);

  assert.throws(
    () => planSend(createDispatch(db).load(id)!, TREASURY),
    /pays nobody/,
  );
  db.close();
});

test("a round settled by hand is recorded as settled by hand", () => {
  const { db, dispatch, roundId } = seeded();

  assert.equal(dispatch.settleExternally(roundId, "abc123", DAY), true);

  const after = dispatch.load(roundId);
  assert.equal(after?.dispatchState, "sent");
  assert.equal(after?.txid, "abc123");

  // A hand-made payment and one this process watched complete are different
  // evidence, and a receipt that blurred them would overstate the weaker one.
  assert.equal(after?.settlement, "external");
  db.close();
});

test("a round cannot be settled twice, or settled after being sent", () => {
  const { db, dispatch, roundId } = seeded();

  assert.equal(dispatch.settleExternally(roundId, "abc123", DAY), true);

  // Shielded ZEC cannot be recalled, so a second settlement has to be refused
  // by the same conditional claim the wallet path uses.
  assert.equal(dispatch.settleExternally(roundId, "def456", DAY), false);
  assert.equal(dispatch.load(roundId)?.txid, "abc123");
  db.close();
});

test("a round is anchored only once it is paid, and only once", () => {
  const { db, dispatch, roundId } = seeded();

  // An unpaid round has no commitment worth making public yet: the receipt it
  // would anchor does not exist.
  assert.equal(dispatch.recordAnchor(roundId, "sig-early", DAY), false);
  assert.equal(dispatch.load(roundId)?.anchorSignature, null);

  assert.equal(dispatch.settleExternally(roundId, "abc123", DAY), true);
  assert.equal(dispatch.recordAnchor(roundId, "sig-first", DAY), true);

  // The anchor is what proves a receipt was not changed afterwards. A second
  // one silently replacing the first would undo exactly that.
  assert.equal(dispatch.recordAnchor(roundId, "sig-second", DAY), false);
  assert.equal(dispatch.load(roundId)?.anchorSignature, "sig-first");
  db.close();
});
