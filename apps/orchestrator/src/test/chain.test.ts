import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ExplorerUnavailable, createChainLookup } from "../wallet/chain.js";

/**
 * Real explorer responses, recorded from Zcash mainnet, so the check is held
 * against what the explorer actually says rather than against a shape written
 * to match the code. The fixtures live in src and are read from there.
 */
const FIXTURES = join(process.cwd(), "src", "test", "fixtures");

function withRaw(body: string, status = 200): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch;
  return () => (globalThis.fetch = original);
}

function withResponse(name: string): { txid: string; restore: () => void } {
  const body = readFileSync(join(FIXTURES, `blockchair-${name}.json`), "utf8");
  const txid = Object.keys((JSON.parse(body) as { data: object }).data)[0] ?? "";
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(body, { status: 200 })) as typeof fetch;
  return { txid, restore: () => (globalThis.fetch = original) };
}

const lookup = createChainLookup({ explorerUrl: "https://explorer.invalid/", timeoutMs: 1000 });

test("an Orchard payment is recognised as shielded, though the explorer decodes none of it", async () => {
  // A v6 transaction with its value in an Orchard bundle. The explorer parses
  // no part of that bundle: no Sapling outputs, no joinsplits, a value delta
  // of zero, even a fee of zero. It is also exactly what a light wallet like
  // Zashi sends. Reading it as transparent refused real payments.
  const { txid, restore } = withResponse("orchard");
  try {
    const facts = await lookup.transaction(txid);
    assert.equal(facts.exists, true);
    assert.equal(facts.shielded, true);
  } finally {
    restore();
  }
});

test("a Sapling payment is still recognised as shielded", async () => {
  const { txid, restore } = withResponse("sapling");
  try {
    assert.equal((await lookup.transaction(txid)).shielded, true);
  } finally {
    restore();
  }
});

test("a transparent-only transaction is still refused, whatever its id", async () => {
  const { txid, restore } = withResponse("transparent");
  try {
    const facts = await lookup.transaction(txid);
    assert.equal(facts.exists, true);
    assert.equal(facts.shielded, false);
  } finally {
    restore();
  }
});

test("an explorer that will not answer is not reported as a missing transaction", async () => {
  // Recorded from blockchair while rate limited: HTTP 430, data null, and the
  // refusal in context. Read as not-found it says "your payment never
  // happened" to somebody who has just sent money, and the obvious response to
  // that is to send it again. Shielded ZEC cannot be recalled.
  const body = readFileSync(join(FIXTURES, "blockchair-ratelimited.json"), "utf8");

  const restoreStatus = withRaw(body, 430);
  await assert.rejects(lookup.transaction("a".repeat(64)), ExplorerUnavailable);
  restoreStatus();

  // The same refusal served with a 200, which is how blockchair sometimes
  // reports it: the code that matters is inside the body.
  const restoreBody = withRaw(body, 200);
  await assert.rejects(lookup.transaction("a".repeat(64)), ExplorerUnavailable);
  restoreBody();

  // Another explorer, or a proxy in front of one, can fail with a body that
  // looks like a perfectly ordinary empty answer. The status is the only thing
  // that distinguishes it.
  const restoreFiveHundred = withRaw(JSON.stringify({ data: {}, context: { code: 200 } }), 500);
  await assert.rejects(lookup.transaction("a".repeat(64)), ExplorerUnavailable);
  restoreFiveHundred();

  const restoreDead = (() => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as typeof fetch;
    return () => (globalThis.fetch = original);
  })();
  await assert.rejects(lookup.transaction("a".repeat(64)), ExplorerUnavailable);
  restoreDead();
});

test("an explorer that answers, about a transaction that is not there, still says so", async () => {
  // The other side of it: a real answer with no such transaction has to stay
  // a plain not-found, or settle would never be able to refuse a wrong id.
  const restore = withRaw(JSON.stringify({ data: {}, context: { code: 200 } }), 200);
  try {
    const facts = await lookup.transaction("b".repeat(64));
    assert.equal(facts.exists, false);
  } finally {
    restore();
  }
});
