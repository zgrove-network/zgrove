import { createHash } from "node:crypto";

/**
 * A payout round commits to what it paid without publishing it.
 *
 * Shielded outputs hide amounts, so "this round paid X" is a claim the chain
 * does not confirm. What the chain does confirm is that the transaction
 * exists and how many shielded outputs it has. The rest is closed here: the
 * round commits to a merkle root over its entries, and each contributor is
 * handed the path to their own leaf. They can check their amount is inside
 * what was committed, and nobody learns anyone else's.
 *
 * What this construction does NOT establish is stated in RECEIPT_LIMITS, and
 * it is published with the receipt. A proof that quietly implies more than it
 * shows is worse than no proof.
 */

const LEAF_TAG = Uint8Array.from([0x00]);
const NODE_TAG = Uint8Array.from([0x01]);

export interface ReceiptEntry {
  readonly accountId: string;
  readonly amountZat: number;
}

export interface PayoutReceipt {
  readonly round: number;
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly accountsPaid: number;
  readonly totalZat: number;
  /** The Zcash transaction that carried the payment. */
  readonly txid: string;
  /**
   * How the money left: "wallet" is a send this pool made and watched
   * complete, "external" is one an operator made by hand and then recorded
   * against a transaction checked on chain. Stated because the two are not
   * the same evidence and a reader is entitled to know which one they have.
   */
  readonly settlement: "wallet" | "external";
  /** Merkle root over the paid entries, hex. */
  readonly commitment: string;
  readonly issuedAt: number;
  readonly limits: readonly string[];
  /**
   * Where the commitment was written somewhere public, once it has been. A
   * receipt that later disagrees with its anchor was changed afterwards.
   */
  readonly anchor?: { readonly chain: "solana"; readonly signature: string };
}

export interface EntryProof {
  readonly round: number;
  readonly accountId: string;
  readonly amountZat: number;
  /** Sibling hashes from leaf to root, hex, with the side each sits on. */
  readonly path: readonly { readonly hash: string; readonly right: boolean }[];
  readonly commitment: string;
}

export const RECEIPT_LIMITS: readonly string[] = [
  "The transaction id can be checked on Zcash mainnet, and its shielded output count is public.",
  "Amounts inside a shielded transaction are not public, so the total here is not confirmed by the chain.",
  "A contributor can verify their own entry is inside the commitment; they cannot verify the set is complete.",
];

/**
 * Leaves are tagged differently from internal nodes. Without that an internal
 * node's hash could be presented as a leaf, and a proof could be built for an
 * entry nobody ever recorded.
 */
export function leafHash(entry: ReceiptEntry): Buffer {
  return hashLeafContent(
    Buffer.from(`${entry.accountId}|${entry.amountZat}`, "utf8"),
  );
}

/** Exported so an independent verifier can rebuild a root without this
 * module's entry shape, and so the tagging can be tested as itself. */
export function hashLeafContent(content: Uint8Array): Buffer {
  return createHash("sha256").update(LEAF_TAG).update(content).digest();
}

export function hashNode(left: Buffer, right: Buffer): Buffer {
  return createHash("sha256").update(NODE_TAG).update(left).update(right).digest();
}

/** Sorted by account id, so the same entries always give the same root. */
export function sortEntries(entries: readonly ReceiptEntry[]): ReceiptEntry[] {
  return [...entries].sort((a, b) => a.accountId.localeCompare(b.accountId));
}

export function merkleRoot(entries: readonly ReceiptEntry[]): string {
  const leaves = sortEntries(entries).map(leafHash);
  if (leaves.length === 0) {
    throw new Error("A receipt over no entries commits to nothing");
  }
  return levelUp(leaves).toString("hex");
}

function levelUp(nodes: readonly Buffer[]): Buffer {
  if (nodes.length === 1) {
    return nodes[0] as Buffer;
  }

  const next: Buffer[] = [];
  for (let i = 0; i < nodes.length; i += 2) {
    const left = nodes[i] as Buffer;
    // An odd node is paired with itself, which is the usual convention and
    // safe here because leaves and nodes are tagged apart.
    const right = (nodes[i + 1] ?? left) as Buffer;
    next.push(hashNode(left, right));
  }
  return levelUp(next);
}

export function proofFor(
  entries: readonly ReceiptEntry[],
  accountId: string,
): EntryProof {
  const sorted = sortEntries(entries);
  let index = sorted.findIndex((entry) => entry.accountId === accountId);
  if (index === -1) {
    throw new Error(`No entry for ${accountId} in this round`);
  }

  const entry = sorted[index] as ReceiptEntry;
  const path: { hash: string; right: boolean }[] = [];
  let level = sorted.map(leafHash);

  while (level.length > 1) {
    const isRight = index % 2 === 1;
    const siblingIndex = isRight ? index - 1 : index + 1;
    const sibling = (level[siblingIndex] ?? level[index]) as Buffer;
    path.push({ hash: sibling.toString("hex"), right: !isRight });

    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i] as Buffer;
      next.push(hashNode(left, (level[i + 1] ?? left) as Buffer));
    }
    level = next;
    index = Math.floor(index / 2);
  }

  return {
    round: 0,
    accountId: entry.accountId,
    amountZat: entry.amountZat,
    path,
    commitment: (level[0] as Buffer).toString("hex"),
  };
}

/** True when the entry named in the proof is inside the committed set. */
export function verifyProof(proof: EntryProof): boolean {
  let running = leafHash({ accountId: proof.accountId, amountZat: proof.amountZat });

  for (const step of proof.path) {
    const sibling = Buffer.from(step.hash, "hex");
    if (sibling.length !== 32) {
      return false;
    }
    running = step.right ? hashNode(running, sibling) : hashNode(sibling, running);
  }

  return running.toString("hex") === proof.commitment;
}
