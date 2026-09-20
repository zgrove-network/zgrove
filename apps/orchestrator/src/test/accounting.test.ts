import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorkerStats } from "@zgrove/db";

import {
  CONTRIBUTOR_LOGIN,
  authorizedMiner,
  startHarness,
  until,
  type Harness,
} from "./harness.js";

const DIFFICULTY = 512;

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
