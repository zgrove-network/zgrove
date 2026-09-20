import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONTRIBUTOR_LOGIN,
  UPSTREAM_LOGIN,
  UPSTREAM_PASSWORD,
  authorizedMiner,
  startHarness,
  until,
} from "./harness.js";

test("upstream is told the pool's account, never the contributor's", async () => {
  const harness = await startHarness();
  try {
    const miner = await authorizedMiner(harness);

    miner.send({
      id: 3,
      method: "mining.submit",
      params: [CONTRIBUTOR_LOGIN, "job1", "ntime", "nonce"],
    });
    await miner.waitFor((message) => message["id"] === 3, "submit answer");

    const authorize = harness
      .upstreamSaw()
      .find((line) => line["method"] === "mining.authorize");
    const submit = harness
      .upstreamSaw()
      .find((line) => line["method"] === "mining.submit");

    assert.deepEqual(authorize?.["params"], [UPSTREAM_LOGIN, UPSTREAM_PASSWORD]);

    // A share names its worker in the same leading position as authorize, so
    // relaying it untouched would put a contributor's address in front of the
    // pool on every share.
    assert.equal((submit?.["params"] as unknown[])[0], UPSTREAM_LOGIN);

    // The strongest form of the claim: the contributor's login is nowhere in
    // anything upstream received.
    assert.equal(
      JSON.stringify(harness.upstreamSaw()).includes("t1ContributorAddress"),
      false,
    );
  } finally {
    await harness.stop();
  }
});

test("a login the proxy cannot parse is refused and not relayed", async () => {
  const harness = await startHarness();
  try {
    const miner = await harness.connectMiner();
    const before = harness.upstreamSaw().length;

    miner.send({
      id: 1,
      method: "mining.authorize",
      params: ["not a valid login", "x"],
    });
    const answer = await miner.waitFor(
      (message) => message["id"] === 1,
      "authorize refusal",
    );

    assert.equal(answer["result"], false);
    assert.deepEqual((answer["error"] as unknown[])[0], 24);
    assert.equal(harness.upstreamSaw().length, before);
  } finally {
    await harness.stop();
  }
});

test("a submit before authorize is refused, because it names nobody", async () => {
  const harness = await startHarness();
  try {
    const miner = await harness.connectMiner();
    const before = harness.upstreamSaw().length;

    miner.send({
      id: 1,
      method: "mining.submit",
      params: [CONTRIBUTOR_LOGIN, "job1", "ntime", "nonce"],
    });
    const answer = await miner.waitFor((message) => message["id"] === 1, "refusal");

    // Relaying it would credit the pool account with work no contributor can
    // be paid for.
    assert.equal(answer["result"], false);
    assert.equal(harness.upstreamSaw().length, before);
  } finally {
    await harness.stop();
  }
});

test("a second login on one socket ends the session", async () => {
  const harness = await startHarness();
  try {
    const miner = await authorizedMiner(harness);

    // Shares already credited to the first worker would otherwise sit under
    // the second, which no later reconciliation can unpick.
    miner.send({
      id: 9,
      method: "mining.authorize",
      params: ["t1SomebodyElse.rig9", "x"],
    });
    await miner.waitForClose();
  } finally {
    await harness.stop();
  }
});

test("a duplicate submit id still in flight is refused", async () => {
  const harness = await startHarness({ answerSubmit: () => null });
  try {
    const miner = await authorizedMiner(harness);

    miner.send({
      id: 5,
      method: "mining.submit",
      params: [CONTRIBUTOR_LOGIN, "job1", "ntime", "nonce"],
    });
    await until(
      () =>
        harness.upstreamSaw().some((line) => line["method"] === "mining.submit") ||
        undefined,
      "the first submit to reach upstream",
    );

    miner.send({
      id: 5,
      method: "mining.submit",
      params: [CONTRIBUTOR_LOGIN, "job2", "ntime", "nonce"],
    });
    const answer = await miner.waitFor(
      (message) => message["id"] === 5,
      "duplicate refusal",
    );

    // Upstream answers an id once, so one of the two would be unmatchable.
    assert.equal(answer["result"], false);
    assert.equal((answer["error"] as unknown[])[1], "Duplicate submit id still in flight");
  } finally {
    await harness.stop();
  }
});

test("an upstream that drops takes the miner down with it", async () => {
  const harness = await startHarness();
  try {
    const miner = await authorizedMiner(harness);

    // A reconnect would be issued a different extranonce, invalidating every
    // job the miner holds; dropping it makes the miner start a coherent
    // session instead.
    harness.dropUpstream();
    await miner.waitForClose();
  } finally {
    await harness.stop();
  }
});
