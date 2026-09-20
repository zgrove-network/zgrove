import assert from "node:assert/strict";
import { test } from "node:test";

import { createAccounting } from "../accounting.js";
import { openDatabase, type Db } from "../database.js";
import { migrate } from "../migrate.js";
import { createRegistry, type Registry } from "../registry.js";

const ACCOUNT = {
  id: "acct_contributor",
  payoutAddress: "u1exampleshieldedaddress",
} as const;

function freshRegistry(): { db: Db; registry: Registry } {
  const db = openDatabase(":memory:");
  migrate(db);
  const registry = createRegistry(db);
  registry.createAccount(ACCOUNT, 1_000);
  return { db, registry };
}

test("registering the same key twice returns the same binding", () => {
  const { db, registry } = freshRegistry();

  const first = registry.registerWorkerKey({
    publicKey: "key-rig1",
    accountId: ACCOUNT.id,
    workerName: "rig1",
    atSeconds: 1_000,
  });
  const second = registry.registerWorkerKey({
    publicKey: "key-rig1",
    accountId: ACCOUNT.id,
    workerName: "rig1",
    atSeconds: 2_000,
  });

  // A rig that restarts must land on the row its shares already point at.
  assert.deepEqual(second, first);
  db.close();
});

test("a key cannot be moved to another account", () => {
  const { db, registry } = freshRegistry();
  registry.createAccount(
    { id: "acct_other", payoutAddress: "u1someoneelse" },
    1_000,
  );

  registry.registerWorkerKey({
    publicKey: "key-rig1",
    accountId: ACCOUNT.id,
    workerName: "rig1",
    atSeconds: 1_000,
  });

  // Rebinding would carry the work already recorded under this key across to
  // whoever claimed it.
  assert.throws(
    () =>
      registry.registerWorkerKey({
        publicKey: "key-rig1",
        accountId: "acct_other",
        workerName: "rig1",
        atSeconds: 2_000,
      }),
    /already registered to another account/,
  );
  db.close();
});

test("two rigs on one account are two workers", () => {
  const { db, registry } = freshRegistry();

  const rig1 = registry.registerWorkerKey({
    publicKey: "key-rig1",
    accountId: ACCOUNT.id,
    workerName: "rig1",
    atSeconds: 1_000,
  });
  const rig2 = registry.registerWorkerKey({
    publicKey: "key-rig2",
    accountId: ACCOUNT.id,
    workerName: "rig2",
    atSeconds: 1_000,
  });

  assert.notEqual(rig1.workerId, rig2.workerId);
  assert.equal(rig1.accountId, rig2.accountId);
  db.close();
});

test("a registered key resolves to the worker its shares are credited to", () => {
  const { db, registry } = freshRegistry();
  const accounting = createAccounting(db);

  const binding = registry.registerWorkerKey({
    publicKey: "key-rig1",
    accountId: ACCOUNT.id,
    workerName: "rig1",
    atSeconds: 1_000,
  });

  accounting.recordShare({
    workerId: binding.workerId,
    algo: "equihash",
    outcome: "accepted",
    difficulty: 256,
    atSeconds: 1_000,
  });

  const found = registry.findWorkerKey("key-rig1");
  assert.equal(found?.workerId, binding.workerId);

  // The identity path and the accounting path have to name the same row, or
  // a proven worker is credited to someone else.
  const stats = accounting.statsBetween(0, 10_000);
  assert.equal(stats.length, 1);
  assert.equal(stats[0]?.username, ACCOUNT.id);
  assert.equal(stats[0]?.workerName, "rig1");
  assert.equal(stats[0]?.acceptedDifficulty, 256);

  db.close();
});

test("an unknown key resolves to nothing", () => {
  const { db, registry } = freshRegistry();
  assert.equal(registry.findWorkerKey("never-seen"), null);
  db.close();
});

test("a key cannot be registered to an account that does not exist", () => {
  const { db, registry } = freshRegistry();

  assert.throws(
    () =>
      registry.registerWorkerKey({
        publicKey: "key-rig1",
        accountId: "acct_missing",
        workerName: "rig1",
        atSeconds: 1_000,
      }),
    /FOREIGN KEY/,
  );
  db.close();
});
