import assert from "node:assert/strict";
import { test } from "node:test";

import { createTransactionLookup } from "../wallet/lookup.js";
import { txFilter, type GrpcAnswer } from "../wallet/lightwalletd.js";

const TXID = "51ece162d1d2b664c528aa63901e6f2274b4055cb439a6afa8f6b6a3e8dcf7dc";
const NOT_FOUND: GrpcAnswer = { status: "5", message: "not found", body: new Uint8Array() };

function withFetch(run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (url: string) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  }) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("nothing configured goes to lightwalletd, not to an explorer", async () => {
  // The explorers are unreachable from the machine that runs payouts, so the
  // default has to be the one that works there. Getting this wrong is silent
  // until the day money moves.
  let asked: Uint8Array | null = null;
  const lookup = createTransactionLookup({ timeoutMs: 1000 }, async (_options, _path, message) => {
    asked = message;
    return NOT_FOUND;
  });

  assert.equal(lookup.source, "lightwalletd zec.rocks:443");
  await lookup.transaction(TXID);
  assert.deepEqual(asked, txFilter(TXID));
});

test("an explorer is used only when one was asked for", async () => {
  const lookup = createTransactionLookup({
    explorerUrl: "https://explorer.example/tx/",
    timeoutMs: 1000,
  });
  assert.equal(lookup.source, "https://explorer.example/tx/");

  await withFetch(async () => {
    const facts = await lookup.transaction(TXID);
    assert.equal(facts.exists, false);
  });
});

test("an empty setting is not a configured explorer", async () => {
  // An unset variable in a compose file arrives as "", and reading that as a
  // URL would send every lookup to the empty string.
  for (const empty of ["", "   "]) {
    const lookup = createTransactionLookup({ explorerUrl: empty, timeoutMs: 1000 });
    assert.equal(lookup.source, "lightwalletd zec.rocks:443", JSON.stringify(empty));
  }
});

test("a different light wallet server can be named", async () => {
  const endpoints: string[] = [];
  const lookup = createTransactionLookup(
    { lightwalletd: "mainnet.lightwalletd.com:9067", timeoutMs: 1000 },
    async (options) => {
      endpoints.push(options.endpoint);
      return NOT_FOUND;
    },
  );

  assert.equal(lookup.source, "lightwalletd mainnet.lightwalletd.com:9067");
  await lookup.transaction(TXID);
  assert.deepEqual(endpoints, ["mainnet.lightwalletd.com:9067"]);
});
