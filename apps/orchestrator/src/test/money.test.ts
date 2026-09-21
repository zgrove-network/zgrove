import assert from "node:assert/strict";
import { test } from "node:test";

import { BUCKET_SECONDS } from "@zgrove/db";

import { formatZec, parseInstant, parseZec, ZAT_PER_ZEC } from "../cli/money.js";

test("a decimal amount becomes exact zatoshi", () => {
  // The trap this exists to avoid, with ordinary numbers rather than
  // contrived ones: multiplying through a float loses a zatoshi that is owed.
  assert.notEqual(2.55 * ZAT_PER_ZEC, 255_000_000);
  assert.equal(Math.floor(2.55 * ZAT_PER_ZEC), 254_999_999);
  assert.equal(parseZec("2.55"), 255_000_000);

  assert.notEqual(0.00007 * ZAT_PER_ZEC, 7_000);
  assert.equal(parseZec("0.00007"), 7_000);

  assert.equal(parseZec("0"), 0);
  assert.equal(parseZec("1"), 100_000_000);
  assert.equal(parseZec("0.00000001"), 1);
  assert.equal(parseZec("0.42500000"), 42_500_000);
  assert.equal(parseZec("21000000"), 2_100_000_000_000_000);
});

test("more precision than ZEC has is refused, not rounded away", () => {
  // Dropping the ninth digit would quietly change what somebody is paid.
  assert.throws(() => parseZec("0.123456789"), /decimals/);
  assert.throws(() => parseZec("-1"), /Not a ZEC amount/);
  assert.throws(() => parseZec("1e8"), /Not a ZEC amount/);
  assert.throws(() => parseZec(""), /Not a ZEC amount/);
  assert.throws(() => parseZec("0.1.2"), /Not a ZEC amount/);
});

test("formatting round-trips and never rounds", () => {
  for (const text of ["0.00000000", "0.00000001", "0.42500000", "1.00000000", "21000000.00000000"]) {
    assert.equal(formatZec(parseZec(text)), text);
  }
  assert.equal(formatZec(1), "0.00000001");
  assert.equal(formatZec(100_000_001), "1.00000001");
});

test("a calendar date is midnight UTC and lands on a bucket boundary", () => {
  const day = parseInstant("2026-09-20");
  assert.equal(new Date(day * 1000).toISOString(), "2026-09-20T00:00:00.000Z");

  // Payout windows must be bucket-aligned, so plain dates have to qualify or
  // the friendliest way to name a window would be the one that is refused.
  assert.equal(day % BUCKET_SECONDS, 0);

  assert.equal(parseInstant("1758399900"), 1_758_399_900);
  assert.throws(() => parseInstant("20 Sept"), /Not a time/);
});
