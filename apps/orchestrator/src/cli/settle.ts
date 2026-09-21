import { parseArgs } from "node:util";

import { createDispatch, migrate, openDatabase } from "@zgrove/db";

import { createChainLookup, DEFAULT_EXPLORER } from "../wallet/chain.js";
import { formatZec } from "./money.js";

/**
 * Records a payment made outside this process — from a light wallet, say,
 * on a machine with no room for a synced node.
 *
 * It does not take the operator's word for the transaction id. A receipt
 * built on an unverified id would be worth exactly what the operator says it
 * is, which is the whole failure mode this project exists not to repeat.
 */
export async function runSettle(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      db: { type: "string" },
      round: { type: "string" },
      txid: { type: "string" },
      confirm: { type: "boolean", default: false },
      explorer: { type: "string" },
    },
    allowPositionals: false,
  });

  const roundId = Number(required(values.round, "--round"));
  const txid = required(values.txid, "--txid").toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(txid)) {
    throw new Error("A Zcash transaction id is 64 hex characters");
  }

  const databasePath = values.db ?? env["ZGROVE_DB_PATH"] ?? "data/zgrove.sqlite";
  const db = openDatabase(databasePath);

  try {
    migrate(db);
    const dispatch = createDispatch(db);
    const round = dispatch.load(roundId);

    if (round === null) {
      throw new Error(`No round ${roundId}.`);
    }
    if (round.dispatchState !== "planned") {
      throw new Error(
        `Round ${roundId} is ${round.dispatchState}, not planned. It has already been dealt with.`,
      );
    }

    const paid = round.entries.reduce((sum, entry) => sum + entry.amountZat, 0);
    const accounts = round.entries.filter((entry) => entry.amountZat > 0).length;

    const facts = await createChainLookup({
      explorerUrl: values.explorer ?? env["ZGROVE_EXPLORER_URL"] ?? DEFAULT_EXPLORER,
      timeoutMs: 20_000,
    }).transaction(txid);

    if (!facts.exists) {
      throw new Error(`No transaction ${txid} on Zcash mainnet. Nothing recorded.`);
    }
    if (!facts.shielded) {
      // The amounts in a shielded payment are hidden, so this is the one
      // property of the transaction that can be checked at all. A
      // transparent-only transaction is not this payout.
      throw new Error(
        `Transaction ${txid} has no shielded components, so it is not a shielded payout. Nothing recorded.`,
      );
    }

    process.stdout.write(
      `round ${roundId}: ${accounts} account(s), ${formatZec(paid)} ZEC\n` +
        `txid ${txid}\n` +
        `on chain: yes${facts.blockHeight === null ? ", unconfirmed" : `, block ${facts.blockHeight}`}\n` +
        `shielded: yes\n`,
    );

    if (values.confirm !== true) {
      process.stdout.write(
        `\nNothing recorded. Add --confirm once you have checked the amounts went where this says.\n`,
      );
      return 0;
    }

    if (!dispatch.settleExternally(roundId, txid, Math.floor(Date.now() / 1000))) {
      throw new Error(`Round ${roundId} was not planned when settling. Nothing recorded.`);
    }

    process.stdout.write(`\nrecorded as settled externally.\n`);
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

export const SETTLE_USAGE = `zgrove settle — record a payment made by hand

  --round <id>      the round that was paid (required)
  --txid <hex>      the Zcash transaction that paid it (required)
  --confirm         record it; without this the checks run and nothing is written
  --explorer <url>  transaction lookup (or ZGROVE_EXPLORER_URL)
  --db <path>       accounting database

For paying a round from a light wallet, on a machine with no room for a synced
node. The transaction id is checked against the chain and refused if it does
not exist or carries nothing shielded, because a receipt resting on an
unverified id is worth only what the operator says it is.

The receipt records that the round was settled by hand rather than by this
process, since the two are not the same evidence.
`;
