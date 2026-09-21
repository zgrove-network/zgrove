import assert from "node:assert/strict";
import { test } from "node:test";

import { feeBpsForBalance, parseFeeTiers } from "../tiers.js";

test("tiers are read cheapest-first whatever order they are written in", () => {
  const tiers = parseFeeTiers("5000000:100, 0:200 ,25000000:50,1000000:150");
  assert.deepEqual(
    tiers.map((t) => [t.atLeast, t.feeBps]),
    [
      [25_000_000, 50],
      [5_000_000, 100],
      [1_000_000, 150],
      [0, 200],
    ],
  );
});

test("a balance gets the best tier it reaches, and no better", () => {
  const tiers = parseFeeTiers("0:200,1000000:150,5000000:100,25000000:50");

  assert.equal(feeBpsForBalance(tiers, 0), 200);
  assert.equal(feeBpsForBalance(tiers, 999_999), 200);
  assert.equal(feeBpsForBalance(tiers, 1_000_000), 150);
  assert.equal(feeBpsForBalance(tiers, 4_999_999), 150);
  assert.equal(feeBpsForBalance(tiers, 25_000_000), 50);

  // More than the top tier is still the top tier. Stake buys a rate, not a
  // share, so there is nothing beyond the ladder to buy.
  assert.equal(feeBpsForBalance(tiers, 10_000_000_000), 50);
});

test("a ladder with no bottom rung is refused", () => {
  // Without a tier at zero, an account holding nothing has no rate, and the
  // alternative is inventing one at the moment of paying them.
  assert.throws(() => parseFeeTiers("1000000:150"), /tier at 0/);
  assert.throws(() => parseFeeTiers(""), /No fee tiers/);
});

test("a nonsense ladder is refused rather than rounded into shape", () => {
  assert.throws(() => parseFeeTiers("0:20000"), /0-10000/);
  assert.throws(() => parseFeeTiers("0:-1"), /0-10000/);
  assert.throws(() => parseFeeTiers("-5:100,0:200"), /whole number/);
  assert.throws(() => parseFeeTiers("abc:100,0:200"), /whole number/);
  assert.throws(() => parseFeeTiers("0:1.5"), /0-10000/);
});
