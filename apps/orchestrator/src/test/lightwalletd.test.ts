import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ExplorerUnavailable } from "../wallet/chain.js";
import {
  createLightwalletdLookup,
  readAnswer,
  spendsNothingTransparent,
  txFilter,
  type GrpcAnswer,
} from "../wallet/lightwalletd.js";

/**
 * Real mainnet transactions, four shapes either side of NU5. The offsets this
 * module reads are constants, and a constant is only as good as the bytes it
 * was checked against, so none of these are constructed.
 */
const FIXTURES = JSON.parse(
  readFileSync(join(process.cwd(), "src", "test", "fixtures", "raw-transactions.json"), "utf8"),
) as {
  transactions: Record<string, { txid: string; height: number; version: number; raw: string }>;
};

function raw(name: string): Uint8Array {
  const tx = FIXTURES.transactions[name];
  assert.ok(tx, `no fixture ${name}`);
  return Uint8Array.from(Buffer.from(tx.raw, "hex"));
}

/** The same answer, cut off partway through, as a dropped connection leaves it. */
function truncated(answer: GrpcAnswer): GrpcAnswer {
  return { ...answer, body: answer.body.subarray(0, answer.body.length - 100) };
}

/** The same answer, with the byte that says it was compressed set. */
function compressed(answer: GrpcAnswer): GrpcAnswer {
  const body = Uint8Array.from(answer.body);
  body[0] = 1;
  return { ...answer, body };
}

const OPTIONS = { endpoint: "lightwalletd.invalid:443", timeoutMs: 1000 };
const TXID = "51ece162d1d2b664c528aa63901e6f2274b4055cb439a6afa8f6b6a3e8dcf7dc";

/** A gRPC answer carrying RawTransaction { data, height }. */
function answerWith(data: Uint8Array, height: number): GrpcAnswer {
  const varint = (n: number) => {
    const out: number[] = [];
    let rest = n;
    do {
      const low = rest & 0x7f;
      rest >>>= 7;
      out.push(rest === 0 ? low : low | 0x80);
    } while (rest !== 0);
    return out;
  };
  const message = Uint8Array.from([
    ...(data.length === 0 ? [] : [(1 << 3) | 2, ...varint(data.length), ...data]),
    ...(height === 0 ? [] : [(2 << 3) | 0, ...varint(height)]),
  ]);
  return {
    status: "0",
    message: "",
    body: Uint8Array.from([
      0,
      (message.length >>> 24) & 0xff,
      (message.length >>> 16) & 0xff,
      (message.length >>> 8) & 0xff,
      message.length & 0xff,
      ...message,
    ]),
  };
}

test("whether a transaction spent anything transparent is read from real transactions", () => {
  // Orchard is the case the explorers got wrong: they decode no part of the
  // bundle, so a fully shielded payment looked like an empty transaction.
  assert.equal(spendsNothingTransparent(raw("orchardV6")), true, "orchard v6");
  assert.equal(spendsNothingTransparent(raw("transparentV5")), false, "transparent v5");

  // This one spends from a shielded pool and pays a transparent address, so
  // its input count is zero and the byte immediately after it is not. Without
  // it the whole suite passes with the offset one byte out, because in every
  // other fixture the two bytes happen to agree. What the check answers is
  // whether anything transparent was *spent*; a transparent output says
  // nothing about that, and cannot, since the recipient of a shielded payment
  // is not on the chain to check in the first place.
  assert.equal(spendsNothingTransparent(raw("shieldedSpendV6")), true, "z->t v6");

  // Pre-NU5 the count sits twelve bytes earlier. Both answers have to come out
  // of the same fixture pair, or the offset is being read off the wrong field.
  assert.equal(spendsNothingTransparent(raw("saplingV4Shielded")), true, "shielded v4");
  assert.equal(spendsNothingTransparent(raw("saplingV4Transparent")), false, "t-input v4");
});

test("a transaction older than Overwinter is refused rather than guessed at", () => {
  // No version group field, so every offset here is wrong. Reading one anyway
  // would answer "shielded" from whatever byte happened to be zero.
  const ancient = Uint8Array.from([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.throws(() => spendsNothingTransparent(ancient), /predates Overwinter/);
});

test("a transaction too short to hold the count is refused, not read past", () => {
  assert.throws(() => spendsNothingTransparent(raw("orchardV6").subarray(0, 12)), ExplorerUnavailable);
  assert.throws(() => spendsNothingTransparent(new Uint8Array([0x05, 0x00])), ExplorerUnavailable);
});

test("the txid is sent in the order the wire wants, not the order it is written", () => {
  const filter = txFilter(TXID);
  assert.equal(filter[0], (3 << 3) | 2, "TxFilter field 3, length-delimited");
  assert.equal(filter[1], 32);

  const sent = Buffer.from(filter.subarray(2)).toString("hex");
  assert.equal(sent, Buffer.from(TXID, "hex").reverse().toString("hex"));
  assert.notEqual(sent, TXID, "a txid is displayed reversed; sending it as written asks about nothing");
});

test("a txid that is not one is refused before anything is sent", () => {
  for (const bad of ["", "abc", TXID.toUpperCase(), `${TXID}00`, `${TXID.slice(0, 63)}g`]) {
    assert.throws(() => txFilter(bad), /64 hex characters/, bad);
  }
});

test("a transaction that is on the chain is reported with its height", () => {
  const facts = readAnswer(answerWith(raw("orchardV6"), 3_492_515));
  assert.deepEqual(facts, { exists: true, blockHeight: 3_492_515, shielded: true });
});

test("a transaction still in the mempool exists but sits in no block", () => {
  const facts = readAnswer(answerWith(raw("orchardV6"), 0));
  assert.deepEqual(facts, { exists: true, blockHeight: null, shielded: true });
});

test("NOT_FOUND is the one answer that means the transaction is not there", () => {
  assert.deepEqual(readAnswer({ status: "5", message: "not found", body: new Uint8Array() }), {
    exists: false,
    blockHeight: null,
    shielded: false,
  });
  // Some servers report it as an empty success instead.
  assert.deepEqual(readAnswer(answerWith(new Uint8Array(), 0)), {
    exists: false,
    blockHeight: null,
    shielded: false,
  });
});

test("a server that failed is never read as a payment that was never made", () => {
  // This is the whole point of the module. Every one of these arrives as an
  // empty body, which is byte-for-byte what a real NOT_FOUND looks like. If
  // any of them returns exists:false, the operator is told their payout is not
  // on the chain, and the obvious thing to do about that is to pay twice.
  const failures: GrpcAnswer[] = [
    { status: "14", message: "unavailable", body: new Uint8Array() },
    { status: "2", message: "internal", body: new Uint8Array() },
    { status: "8", message: "resource exhausted", body: new Uint8Array() },
    { status: "16", message: "unauthenticated", body: new Uint8Array() },
    { status: "4", message: "deadline exceeded", body: new Uint8Array() },
    { status: "0", message: "", body: new Uint8Array() },
    { status: "0", message: "", body: Uint8Array.from([0, 0, 0, 0]) },
    // A success flagged as compressed. Its payload decodes perfectly as a
    // RawTransaction, so nothing downstream would notice; it just is not one.
    compressed(answerWith(raw("orchardV6"), 3_492_515)),
    // A connection that died halfway through a real answer. The frame still
    // says how long the transaction was, and the bytes that did arrive parse:
    // the header, the version group and the input count are all in the first
    // twenty-one. Read without checking the length, half a transaction answers
    // the shielded question as confidently as a whole one.
    truncated(answerWith(raw("orchardV6"), 3_492_515)),
    // A success whose body is not a RawTransaction at all.
    { status: "0", message: "", body: Uint8Array.from([0, 0, 0, 0, 2, 0x0d, 0x01]) },
  ];

  for (const failure of failures) {
    assert.throws(
      () => readAnswer(failure),
      ExplorerUnavailable,
      `status ${failure.status}, ${failure.body.length} bytes`,
    );
  }
});

test("the error tells the operator not to send the money again", () => {
  assert.throws(
    () => readAnswer({ status: "14", message: "unavailable", body: new Uint8Array() }),
    /do not send it again/,
  );
});

test("a lookup asks for the transaction it was given, at the right method", async () => {
  const asked: Array<{ path: string; message: Uint8Array }> = [];
  const lookup = createLightwalletdLookup(OPTIONS, async (_options, path, message) => {
    asked.push({ path, message });
    return answerWith(raw("transparentV5"), 3_492_516);
  });

  const facts = await lookup.transaction(TXID);
  assert.deepEqual(facts, { exists: true, blockHeight: 3_492_516, shielded: false });

  assert.equal(asked.length, 1);
  assert.equal(asked[0]?.path, "/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetTransaction");
  assert.deepEqual(asked[0]?.message, txFilter(TXID));
});

test("a transport that could not reach anyone fails the lookup", async () => {
  const lookup = createLightwalletdLookup(OPTIONS, async () => {
    throw new ExplorerUnavailable("connect ECONNREFUSED");
  });
  await assert.rejects(lookup.transaction(TXID), ExplorerUnavailable);
});
