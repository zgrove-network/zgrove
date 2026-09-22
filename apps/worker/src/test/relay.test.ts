import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { isShareAccepted, type StratumResponse } from "@zgrove/protocol";

import { openLedger, summarise, type LedgerRecord, type ShareRecord } from "../ledger.js";
import { startRelay, type Relay } from "../relay.js";

const TOKEN = "zgt_secret-session-token";

/** Stands in for the proxy: records every byte and lets a test answer. */
async function fakeProxy(): Promise<{
  server: Server;
  port: number;
  received: () => string;
  peer: () => Promise<Socket>;
}> {
  let bytes = "";
  let resolvePeer: (s: Socket) => void = () => {};
  const peer = new Promise<Socket>((r) => (resolvePeer = r));

  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.on("data", (d: string) => (bytes += d));
    resolvePeer(socket);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { server, port: address.port, received: () => bytes, peer: () => peer };
}

function memoryLedger(): { records: LedgerRecord[]; append(r: LedgerRecord): void } {
  const records: LedgerRecord[] = [];
  return { records, append: (r) => records.push(r) };
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 2000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function minerOn(relay: Relay): Promise<{ socket: Socket; received: () => string }> {
  const socket = connect(relay.port, relay.host);
  let bytes = "";
  socket.setEncoding("utf8");
  socket.on("data", (d: string) => (bytes += d));
  await new Promise<void>((r) => socket.once("connect", () => r()));
  return { socket, received: () => bytes };
}

/**
 * Opens a proxy, a relay in front of it and a miner, and hands their teardown
 * to the test context. Released in t.after rather than at the end of the body:
 * an assertion that fails midway would otherwise skip the cleanup, and the
 * open sockets keep the runner alive — a red test becomes a hung suite, which
 * in CI is a timeout hours later instead of a failure now.
 */
async function rig(t: TestContext, clock?: () => number) {
  const proxy = await fakeProxy();
  const ledger = memoryLedger();
  const relay = await startRelay({ host: "127.0.0.1", port: proxy.port }, ledger, clock);
  const miner = await minerOn(relay);
  t.after(async () => {
    miner.socket.destroy();
    await relay.close();
    await new Promise<void>((r) => proxy.server.close(() => r()));
  });
  return { proxy, ledger, relay, miner };
}

function shares(records: readonly LedgerRecord[]): ShareRecord[] {
  return records.filter((r): r is ShareRecord => r.kind === "share");
}

test("every byte crosses untouched in both directions, including ones it cannot read", async (t) => {
  const { proxy, miner } = await rig(t);

  // A line the tap cannot decode, and a valid one split across two writes.
  const upward = 'not json at all\n{"id":1,"method":"mining.subsc';
  const upwardRest = 'ribe","params":[]}\n';
  miner.socket.write(upward);
  miner.socket.write(upwardRest);
  await until(() => proxy.received().length === (upward + upwardRest).length, "proxy bytes");
  assert.equal(proxy.received(), upward + upwardRest);

  const downward = '{"id":1,"result":[[],"ab12",4],"error":null}\n\x00garbage\n';
  (await proxy.peer()).write(downward);
  await until(() => miner.received().length === downward.length, "miner bytes");
  assert.equal(miner.received(), downward);
});

test("an accepted share is written with what verifies it, and without the token", async (t) => {
  let clock = 1_000;
  const { proxy, ledger, miner } = await rig(t, () => clock);
  const upstream = await proxy.peer();

  miner.socket.write('{"id":1,"method":"mining.subscribe","params":[]}\n');
  await until(() => proxy.received().includes("subscribe"), "subscribe");
  upstream.write('{"id":1,"result":[[],"ab12",4],"error":null}\n');
  upstream.write('{"id":null,"method":"mining.set_difficulty","params":[8]}\n');
  upstream.write('{"id":null,"method":"mining.notify","params":["job-7","prevhash","cb1","cb2",[],"v","nbits","ntime",true]}\n');
  await until(() => miner.received().includes("job-7"), "notify");

  miner.socket.write(
    `{"id":42,"method":"mining.submit","params":["${TOKEN}","job-7","00000001","ntime","nonce"]}\n`,
  );
  await until(() => proxy.received().includes('"id":42'), "submit");

  // Difficulty moves after the share was sent. The share keeps the old one.
  upstream.write('{"id":null,"method":"mining.set_difficulty","params":[16]}\n');
  clock = 1_005;
  upstream.write('{"id":42,"result":true,"error":null}\n');
  await until(() => shares(ledger.records).length === 1, "ledger share");

  const [share] = shares(ledger.records);
  assert.ok(share);
  assert.equal(share.outcome, "accepted");
  assert.equal(share.jobId, "job-7");
  assert.equal(share.extranonce1, "ab12");
  assert.equal(share.difficulty, 8);
  assert.equal(share.at, 1_000);
  assert.deepEqual(share.params, ["job-7", "00000001", "ntime", "nonce"]);

  // The job the share is proof against sits beside it.
  const job = ledger.records.find((r) => r.kind === "job");
  assert.ok(job && job.kind === "job");
  assert.equal(job.jobId, "job-7");

  assert.equal(JSON.stringify(ledger.records).includes(TOKEN), false);
});

test("a rejection is recorded as one, with the proxy's reason", async (t) => {
  const { proxy, ledger, miner } = await rig(t);
  const upstream = await proxy.peer();

  miner.socket.write(`{"id":"s1","method":"mining.submit","params":["${TOKEN}","j","e","t","n"]}\n`);
  await until(() => proxy.received().includes("s1"), "submit");
  upstream.write('{"id":"s1","result":null,"error":[21,"Job not found",null]}\n');
  await until(() => shares(ledger.records).length === 1, "rejection");

  const [share] = shares(ledger.records);
  assert.equal(share?.outcome, "rejected");
  assert.equal(share?.error, "Job not found");
});

test("a submit still waiting when the connection drops is unanswered, not rejected", async (t) => {
  const { proxy, ledger, miner } = await rig(t);
  await proxy.peer();

  miner.socket.write(`{"id":9,"method":"mining.submit","params":["${TOKEN}","j","e","t","n"]}\n`);
  await until(() => proxy.received().includes('"id":9'), "submit");
  (await proxy.peer()).destroy();
  await until(() => shares(ledger.records).length === 1, "drain");

  assert.equal(shares(ledger.records)[0]?.outcome, "unanswered");
});

test("the tap calls a share accepted exactly when the proxy's books would", async (t) => {
  // The tally is only worth comparing against the books if both apply one
  // definition. These are the answers where a looser reading — "result is
  // truthy" — would call a share accepted that the proxy counts as rejected,
  // and a contributor would be shown a discrepancy that is nobody's lie.
  const answers: readonly Omit<StratumResponse, "id">[] = [
    { result: true, error: null },
    { result: false, error: null },
    { result: null, error: [21, "Job not found"] },
    { result: true, error: [23, "Low difficulty share"] },
    { result: "ok", error: null },
    { result: 1, error: null },
    { result: {}, error: null },
  ];

  const { proxy, ledger, miner } = await rig(t);
  const upstream = await proxy.peer();

  for (const [i, answer] of answers.entries()) {
    const id = `edge-${i}`;
    miner.socket.write(`{"id":"${id}","method":"mining.submit","params":["${TOKEN}","j","e","t","n"]}\n`);
    await until(() => proxy.received().includes(id), `submit ${id}`);
    upstream.write(`${JSON.stringify({ id, ...answer })}\n`);
    await until(() => shares(ledger.records).length === i + 1, `verdict ${id}`);
  }

  for (const [i, answer] of answers.entries()) {
    const expected = isShareAccepted({ id: `edge-${i}`, ...answer }) ? "accepted" : "rejected";
    assert.equal(
      shares(ledger.records)[i]?.outcome,
      expected,
      `answer ${JSON.stringify(answer)}`,
    );
  }
});

test("a summary counts outcomes and survives a torn last line", () => {
  const path = join(mkdtempSync(join(tmpdir(), "zgrove-ledger-")), "shares.jsonl");
  const share = (at: number, outcome: string, difficulty: number | null) =>
    `${JSON.stringify({ kind: "share", at, id: String(at), jobId: "j", params: [], extranonce1: null, difficulty, target: null, outcome })}\n`;

  writeFileSync(path, "");
  appendFileSync(path, `${JSON.stringify({ kind: "job", at: 1, jobId: "j", params: [] })}\n`);
  appendFileSync(path, share(10, "accepted", 8));
  appendFileSync(path, share(20, "accepted", 16));
  appendFileSync(path, share(30, "rejected", 16));
  appendFileSync(path, share(40, "unanswered", 16));
  // Power lost mid-write.
  appendFileSync(path, '{"kind":"share","at":50,"outc');

  const all = summarise(path);
  assert.equal(all.accepted, 2);
  assert.equal(all.rejected, 1);
  assert.equal(all.unanswered, 1);
  assert.equal(all.acceptedDifficulty, 24);
  assert.equal(all.firstAt, 10);
  assert.equal(all.lastAt, 40);

  const windowed = summarise(path, 15, 35);
  assert.equal(windowed.accepted, 1);
  assert.equal(windowed.rejected, 1);
});

test("a ledger path that does not exist yet is made, and made private", () => {
  const root = mkdtempSync(join(tmpdir(), "zgrove-ledger-"));
  const path = join(root, "not", "there", "shares.jsonl");

  openLedger(path).append({ kind: "job", at: 1, jobId: "j", params: [] });

  // It is this rig's whole work history, so it gets the key file's treatment.
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(join(root, "not", "there")).mode & 0o777, 0o700);
});
