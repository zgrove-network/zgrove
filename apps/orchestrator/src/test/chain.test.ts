import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createChainLookup } from "../wallet/chain.js";

/**
 * Real explorer responses, recorded from Zcash mainnet, so the check is held
 * against what the explorer actually says rather than against a shape written
 * to match the code. The fixtures live in src and are read from there.
 */
const FIXTURES = join(process.cwd(), "src", "test", "fixtures");

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
