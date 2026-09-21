import { parseArgs } from "node:util";

import { createDispatch, migrate, openDatabase } from "@zgrove/db";
import {
  RECEIPT_LIMITS,
  merkleRoot,
  proofFor,
  type PayoutReceipt,
  type ReceiptEntry,
} from "@zgrove/protocol";

/**
 * Turns a sent round into the artifact anyone can check, and into the
 * per-account proofs that let a contributor check their own share of it.
 *
 * Only a sent round has one. A receipt for a round that has not moved money
 * would assert the one thing the whole document exists to evidence.
 */
export function runReceipt(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      db: { type: "string" },
      round: { type: "string" },
      proof: { type: "string" },
    },
    allowPositionals: false,
  });

  const roundId = Number(required(values.round, "--round"));
  const databasePath = values.db ?? env["ZGROVE_DB_PATH"] ?? "data/zgrove.sqlite";
  const db = openDatabase(databasePath);

  try {
    migrate(db);
    const round = createDispatch(db).load(roundId);
    if (round === null) {
      throw new Error(`No round ${roundId}.`);
    }
    if (round.dispatchState !== "sent" || round.txid === null) {
      throw new Error(
        `Round ${roundId} is ${round.dispatchState}. A receipt is only issued for a round that was sent.`,
      );
    }

    const entries: ReceiptEntry[] = round.entries
      .filter((entry) => entry.amountZat > 0)
      .map((entry) => ({ accountId: entry.accountId, amountZat: entry.amountZat }));

    if (values.proof !== undefined) {
      const proof = { ...proofFor(entries, values.proof), round: round.id };
      process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
      return 0;
    }

    const receipt: PayoutReceipt = {
      round: round.id,
      periodStart: round.periodStart,
      periodEnd: round.periodEnd,
      accountsPaid: entries.length,
      totalZat: entries.reduce((sum, entry) => sum + entry.amountZat, 0),
      txid: round.txid,
      commitment: merkleRoot(entries),
      issuedAt: Math.floor(Date.now() / 1000),
      limits: RECEIPT_LIMITS,
    };

    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return 0;
  } finally {
    db.close();
  }
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

export const RECEIPT_USAGE = `zgrove receipt — the artifact for a round that was paid

  --round <id>       the round (required; must have been sent)
  --proof <account>  that account's merkle proof instead of the public receipt
  --db <path>        accounting database

The receipt carries the transaction id, the number of accounts paid and a
merkle commitment over the entries. A contributor checks their own amount
against the commitment with --proof; nobody learns anyone else's.

What it does not establish is printed inside it, because a proof that implies
more than it shows is worse than none.
`;
