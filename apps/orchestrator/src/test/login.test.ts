import assert from "node:assert/strict";
import { test } from "node:test";

import { createRegistry, migrate, openDatabase, type Registry } from "@zgrove/db";

import { createSessionStore, type SessionStore } from "../control/sessions.js";
import { createLoginResolver } from "../login.js";

const NOW = 1_758_400_000;

function setup(allowLegacyLogin: boolean): {
  resolve: (raw: unknown) => ReturnType<ReturnType<typeof createLoginResolver>>;
  sessions: SessionStore;
  registry: Registry;
  close(): void;
} {
  const db = openDatabase(":memory:");
  migrate(db);
  const registry = createRegistry(db);
  const sessions = createSessionStore({ ttlSeconds: 3600, maxSessions: 8 });

  return {
    resolve: createLoginResolver({
      sessions,
      registry,
      allowLegacyLogin,
      now: () => NOW,
    }),
    sessions,
    registry,
    close: () => db.close(),
  };
}

test("a live token names the worker it was issued to", () => {
  const { resolve, sessions, registry, close } = setup(false);
  registry.createAccount({ id: "acct_a", payoutAddress: "u1a" }, NOW);
  const binding = registry.registerWorkerKey({
    publicKey: "key-1",
    accountId: "acct_a",
    workerName: "rig1",
    atSeconds: NOW,
  });

  const token = sessions.issue(binding, NOW).token;
  const parsed = resolve(token);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.identity.username, "acct_a");
  assert.equal(parsed.ok && parsed.identity.workerName, "rig1");
  close();
});

test("a plain name is refused by default", () => {
  const { resolve, close } = setup(false);

  // The default has to be closed. A deployment that forgets the switch should
  // fail safe, not fall back to the path the whole identity work replaced.
  const parsed = resolve("t1SomeAddress.rig1");
  assert.equal(parsed.ok, false);
  assert.equal(!parsed.ok && parsed.reason, "legacy-login-disabled");
  close();
});

test("with the legacy path open, an unenrolled name still works", () => {
  const { resolve, close } = setup(true);

  // This is the migration case: workers that have not attested yet keep
  // mining while they move across.
  const parsed = resolve("t1SomeAddress.rig1");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.identity.username, "t1SomeAddress");
  close();
});

test("an account with an enrolled rig can no longer be claimed by name", () => {
  const { resolve, registry, close } = setup(true);
  registry.createAccount({ id: "acct_a", payoutAddress: "u1a" }, NOW);
  registry.registerWorkerKey({
    publicKey: "key-1",
    accountId: "acct_a",
    workerName: "rig1",
    atSeconds: NOW,
  });

  // The rule the identity work exists for. An account that can still be taken
  // by typing its name gains nothing from also being able to prove itself,
  // and the legacy switch must not reopen that for accounts already migrated.
  const parsed = resolve("acct_a.rig1");
  assert.equal(parsed.ok, false);
  assert.equal(!parsed.ok && parsed.reason, "account-requires-attestation");
  close();
});

test("an expired or unknown token is refused, never fallen back on", () => {
  const { resolve, close } = setup(true);

  // A token that does not resolve must not be reinterpreted as a name. It
  // would land under a worker called "default" owned by nobody.
  const parsed = resolve("zgt_neverIssuedTokenValue");
  assert.equal(parsed.ok, false);
  assert.equal(!parsed.ok && parsed.reason, "unknown-token");
  close();
});

test("a malformed login is still malformed when the legacy path is open", () => {
  const { resolve, close } = setup(true);
  assert.equal(resolve("not a valid login").ok, false);
  assert.equal(resolve(42).ok, false);
  close();
});
