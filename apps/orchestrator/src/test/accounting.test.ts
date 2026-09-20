import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRegistry,
  migrate,
  openDatabase,
  type WorkerStats,
} from "@zgrove/db";
import { isSessionToken } from "@zgrove/protocol";

import { createSessionStore } from "../control/sessions.js";

import {
  CONTRIBUTOR_LOGIN,
  authorizedMiner,
  startHarness,
  until,
  type Harness,
} from "./harness.js";

const DIFFICULTY = 512;
const NOW = 1_758_400_000;

function submit(id: number, job: string): Record<string, unknown> {
  return {
    id,
    method: "mining.submit",
    params: [CONTRIBUTOR_LOGIN, job, "ntime", "nonce"],
  };
}

async function settled(
  harness: Harness,
  predicate: (stats: WorkerStats) => boolean,
  label: string,
): Promise<WorkerStats> {
  return until(() => {
    const row = harness.accounting.statsBetween(0, 4_000_000_000)[0];
    return row !== undefined && predicate(row) ? row : undefined;
  }, label);
}

test("an accepted share is credited to the contributor at upstream's difficulty", async () => {
  const harness = await startHarness({ difficulty: DIFFICULTY });
  try {
    const miner = await authorizedMiner(harness);
    miner.send(submit(3, "job1"));

    const row = await settled(harness, (stats) => stats.accepted === 1, "the share");

    // The worker the miner named, not the account upstream was told.
    assert.equal(row.username, "t1ContributorAddress");
    assert.equal(row.workerName, "rig1");
    assert.equal(row.rejected, 0);
    assert.equal(row.acceptedDifficulty, DIFFICULTY);
  } finally {
    await harness.stop();
  }
});

test("a share upstream rejects is counted without weight", async () => {
  const harness = await startHarness({
    difficulty: DIFFICULTY,
    answerSubmit: (request) => ({
      id: request["id"],
      result: false,
      error: [23, "Low difficulty share"],
    }),
  });
  try {
    const miner = await authorizedMiner(harness);
    miner.send(submit(3, "job1"));

    const row = await settled(harness, (stats) => stats.rejected === 1, "the rejection");

    assert.equal(row.accepted, 0);
    // Weight follows acceptance, or a worker could raise its own reported
    // hashrate with shares the pool threw away.
    assert.equal(row.acceptedDifficulty, 0);
  } finally {
    await harness.stop();
  }
});

test("a share answered with a string-spelled id is still credited", async () => {
  const harness = await startHarness({
    difficulty: DIFFICULTY,
    // Pools are free to answer a numeric id with its string form, and some
    // do. Matching on the number alone loses every share on such a pool while
    // everything still looks healthy.
    answerSubmit: (request) => ({
      id: String(request["id"]),
      result: true,
      error: null,
    }),
  });
  try {
    const miner = await authorizedMiner(harness);
    miner.send(submit(3, "job1"));

    const row = await settled(harness, (stats) => stats.accepted === 1, "the share");
    assert.equal(row.acceptedDifficulty, DIFFICULTY);
  } finally {
    await harness.stop();
  }
});

test("a submit upstream never answers is recorded as neither", async () => {
  const harness = await startHarness({
    difficulty: DIFFICULTY,
    submitTimeoutMs: 100,
    // The first submit is abandoned; the second is answered.
    answerSubmit: (request) =>
      request["id"] === 3
        ? null
        : { id: request["id"], result: true, error: null },
  });
  try {
    const miner = await authorizedMiner(harness);

    miner.send(submit(3, "abandoned"));
    await until(
      () =>
        harness.upstreamSaw().some((line) => line["method"] === "mining.submit") ||
        undefined,
      "the abandoned submit to reach upstream",
    );

    await new Promise((resolve) => setTimeout(resolve, 150));
    miner.send(submit(4, "answered"));

    const row = await settled(harness, (stats) => stats.accepted === 1, "the second share");

    // Counting silence as a rejection would blame the worker for the pool;
    // counting it as accepted would invent work nobody confirmed. It gets a
    // column of its own so a pool going quiet is visible as itself.
    assert.equal(row.accepted, 1);
    assert.equal(row.rejected, 0);
    assert.equal(row.unresolved, 1);
    assert.equal(row.acceptedDifficulty, DIFFICULTY);
  } finally {
    await harness.stop();
  }
});

test("a session token credits the worker the key was bound to", async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  const registry = createRegistry(db);
  registry.createAccount({ id: "acct_c", payoutAddress: "u1shielded" }, NOW);

  const binding = registry.registerWorkerKey({
    publicKey: "key-rig1",
    accountId: "acct_c",
    workerName: "rig1",
    atSeconds: NOW,
  });

  const sessions = createSessionStore({ ttlSeconds: 3600, maxSessions: 8 });
  const token = sessions.issue(binding, NOW).token;

  const harness = await startHarness({
    difficulty: DIFFICULTY,
    resolveLogin: (raw) => {
      if (typeof raw !== "string" || !isSessionToken(raw)) {
        return { ok: false, reason: "not-a-string" };
      }
      const session = sessions.resolve(raw, NOW);
      return session === null
        ? { ok: false, reason: "unknown-token" }
        : {
            ok: true,
            identity: {
              username: session.accountId,
              workerName: session.workerName,
              login: `${session.accountId}.${session.workerName}`,
            },
          };
    },
  });

  try {
    const miner = await authorizedMiner(harness, token);
    miner.send({
      id: 3,
      method: "mining.submit",
      params: [token, "job1", "ntime", "nonce"],
    });

    const row = await settled(harness, (stats) => stats.accepted === 1, "the share");

    // The token names the account and the rig; the payout address never
    // appeared on the wire at all.
    assert.equal(row.username, "acct_c");
    assert.equal(row.workerName, "rig1");
    assert.equal(row.acceptedDifficulty, DIFFICULTY);
  } finally {
    await harness.stop();
    db.close();
  }
});

test("a token the orchestrator does not know is refused", async () => {
  const harness = await startHarness({
    resolveLogin: () => ({ ok: false, reason: "unknown-token" }),
  });
  try {
    const miner = await harness.connectMiner();
    const before = harness.upstreamSaw().length;

    miner.send({
      id: 1,
      method: "mining.authorize",
      params: ["zgt_expiredtokenvalue", "x"],
    });
    const answer = await miner.waitFor((m) => m["id"] === 1, "refusal");

    // An expired token is a worker that can no longer be named, so it is
    // refused here rather than relayed under the pool's account.
    assert.equal(answer["result"], false);
    assert.equal((answer["error"] as unknown[])[1], "Unauthorized worker: unknown-token");
    assert.equal(harness.upstreamSaw().length, before);
  } finally {
    await harness.stop();
  }
});
