import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hashLeafContent,
  hashNode,
  leafHash,
  merkleRoot,
  proofFor,
  sortEntries,
  verifyProof,
  type ReceiptEntry,
} from "../receipt.js";

const ROUND: readonly ReceiptEntry[] = [
  { accountId: "acct_c", amountZat: 100 },
  { accountId: "acct_a", amountZat: 300 },
  { accountId: "acct_b", amountZat: 200 },
];

test("the same entries always commit to the same root", () => {
  const shuffled = [ROUND[1]!, ROUND[2]!, ROUND[0]!];
  assert.equal(merkleRoot(ROUND), merkleRoot(shuffled));
  assert.deepEqual(
    sortEntries(ROUND).map((e) => e.accountId),
    ["acct_a", "acct_b", "acct_c"],
  );
});

test("a contributor can prove their own entry is in the commitment", () => {
  for (const entry of ROUND) {
    const proof = { ...proofFor(ROUND, entry.accountId), round: 1 };
    assert.equal(proof.amountZat, entry.amountZat);
    assert.equal(proof.commitment, merkleRoot(ROUND));
    assert.equal(verifyProof(proof), true);
  }
});

test("a changed amount stops verifying", () => {
  const proof = proofFor(ROUND, "acct_a");

  // The point of the commitment: an amount cannot be edited after the fact.
  assert.equal(verifyProof({ ...proof, amountZat: proof.amountZat + 1 }), false);
  assert.equal(verifyProof({ ...proof, accountId: "acct_b" }), false);
});

test("a proof from one round does not verify against another", () => {
  const other: ReceiptEntry[] = [
    { accountId: "acct_a", amountZat: 300 },
    { accountId: "acct_b", amountZat: 999 },
  ];
  const proof = proofFor(ROUND, "acct_a");
  assert.equal(verifyProof({ ...proof, commitment: merkleRoot(other) }), false);
});

test("an internal node can never also be a valid leaf", () => {
  const left = leafHash({ accountId: "acct_a", amountZat: 300 });
  const right = leafHash({ accountId: "acct_b", amountZat: 200 });

  // Without separate tags, a node over two children hashes identically to a
  // leaf whose content happens to be those children concatenated — and a
  // proof could then be forged for an entry nobody ever recorded. The tags
  // are what makes the two hashes different for the same bytes.
  assert.notEqual(
    hashNode(left, right).toString("hex"),
    hashLeafContent(Buffer.concat([left, right])).toString("hex"),
  );

  // And a bare leaf is never the root of a tree that has one.
  assert.notEqual(
    merkleRoot([
      { accountId: "acct_a", amountZat: 300 },
      { accountId: "acct_b", amountZat: 200 },
    ]),
    left.toString("hex"),
  );
});

test("odd numbers of entries still commit and verify", () => {
  for (const count of [1, 2, 3, 5, 8, 9, 17]) {
    const entries = Array.from({ length: count }, (_, i) => ({
      accountId: `acct_${String(i).padStart(3, "0")}`,
      amountZat: (i + 1) * 1_000,
    }));
    const root = merkleRoot(entries);

    for (const entry of entries) {
      const proof = proofFor(entries, entry.accountId);
      assert.equal(proof.commitment, root, `root mismatch at count ${count}`);
      assert.equal(verifyProof(proof), true, `proof failed at count ${count}`);
    }
  }
});

test("a garbled path is false, not a throw", () => {
  const proof = proofFor(ROUND, "acct_a");
  assert.equal(verifyProof({ ...proof, path: [{ hash: "zz", right: true }] }), false);
  assert.equal(verifyProof({ ...proof, path: [{ hash: "00ff", right: true }] }), false);
});

test("a receipt over nothing is refused", () => {
  assert.throws(() => merkleRoot([]), /commits to nothing/);
});
