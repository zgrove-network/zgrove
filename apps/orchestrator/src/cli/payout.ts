import { parseArgs } from "node:util";

import {
  createPayouts,
  createRegistry,
  migrate,
  openDatabase,
  type PlannedRound,
} from "@zgrove/db";

import { DEFAULT_FEE_TIERS, feeBpsForBalance, parseFeeTiers } from "../tiers.js";
import { createSolanaReader } from "../wallet/solana.js";

import { padLeft, padRight, percent } from "./format.js";
import { formatZec, parseInstant, parseZec } from "./money.js";

/**
 * Computes a payout round and prints it. This command cannot move money: it
 * has no wallet, no key and no RPC client. Recording a round is opt-in and
 * still sends nothing — it only writes down what was decided, so that the
 * sending step later has something it can be checked against.
 */
export async function runPayout(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      db: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      total: { type: "string" },
      "fee-bps": { type: "string" },
      "min-payout": { type: "string", default: "0.001" },
      record: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const periodStart = parseInstant(required(values.from, "--from"));
  const periodEnd = parseInstant(required(values.to, "--to"));
  const totalZat = parseZec(required(values.total, "--total"));
  const flatFeeBps = values["fee-bps"] === undefined ? null : Number(values["fee-bps"]);
  const minPayoutZat = parseZec(values["min-payout"] ?? "0");

  const databasePath = values.db ?? env["ZGROVE_DB_PATH"] ?? "data/zgrove.sqlite";
  const db = openDatabase(databasePath);

  try {
    migrate(db);
    const payouts = createPayouts(db);
    const feeBpsFor = await resolveFees(db, env, flatFeeBps);
    const round = payouts.plan({
      periodStart,
      periodEnd,
      totalZat,
      feeBpsFor,
      minPayoutZat,
      atSeconds: Math.floor(Date.now() / 1000),
    });

    if (values.json === true) {
      process.stdout.write(`${JSON.stringify(round, null, 2)}\n`);
    } else {
      writeRound(round);
    }

    if (values.record === true) {
      const id = payouts.record(round, Math.floor(Date.now() / 1000));
      process.stdout.write(`\nrecorded as round ${id}, state planned. Nothing was sent.\n`);
    } else {
      process.stdout.write(`\nDry run. Nothing was written and nothing was sent.\n`);
      process.stdout.write(`Add --record to write this round down.\n`);
    }

    return 0;
  } finally {
    db.close();
  }
}

function writeRound(round: PlannedRound): void {
  const nameWidth = Math.max(
    7,
    ...round.entries.map((entry) => entry.accountId.length),
  );

  const header =
    padRight("account", nameWidth) +
    padLeft("share", 9) +
    padLeft("fee", 7) +
    padLeft("carried in", 16) +
    padLeft("pays", 16) +
    padLeft("carried out", 16);

  const lines = [
    `period:       ${new Date(round.periodStart * 1000).toISOString()}`,
    `          ->  ${new Date(round.periodEnd * 1000).toISOString()}`,
    `treasury:     ${formatZec(round.totalZat)} ZEC`,
    `fee:          ${formatZec(round.feeZat)} ZEC  (${round.totalZat === 0 ? 0 : Math.round((round.feeZat / round.totalZat) * 10_000)} bps effective)`,
    `distributable:${formatZec(round.distributableZat).padStart(14)} ZEC`,
    "",
    header,
    "-".repeat(header.length),
  ];

  let paid = 0;
  let carriedOut = 0;
  let carriedIn = 0;

  for (const entry of round.entries) {
    paid += entry.amountZat;
    carriedOut += entry.carriedOutZat;
    carriedIn += entry.carriedInZat;

    lines.push(
      padRight(entry.accountId, nameWidth) +
        padLeft(percent(entry.weight, round.totalWeight), 9) +
        padLeft(`${entry.feeBps}bp`, 7) +
        padLeft(formatZec(entry.carriedInZat), 16) +
        padLeft(entry.amountZat === 0 ? "-" : formatZec(entry.amountZat), 16) +
        padLeft(entry.carriedOutZat === 0 ? "-" : formatZec(entry.carriedOutZat), 16),
    );
  }

  if (round.entries.length === 0) {
    lines.push("  no account earned or is owed anything in this window");
  }

  // Printed rather than asserted quietly: an operator about to move money
  // should be able to see that the parts add up before they approve it.
  lines.push("-".repeat(header.length));
  lines.push(
    padRight("total", nameWidth) +
      padLeft("", 9) +
      padLeft("", 7) +
      padLeft(formatZec(carriedIn), 16) +
      padLeft(formatZec(paid), 16) +
      padLeft(formatZec(carriedOut), 16),
  );
  lines.push("");
  lines.push(
    `check: paid + carried out = ${formatZec(paid + carriedOut)}` +
      `   distributable + carried in = ${formatZec(round.distributableZat + carriedIn)}` +
      `   ${paid + carriedOut === round.distributableZat + carriedIn ? "OK" : "MISMATCH"}`,
  );

  process.stdout.write(`${lines.join("\n")}\n`);
}

/**
 * A flat rate when one is given, otherwise the tier each account's proven
 * wallet reaches.
 *
 * Every balance is read before anything is computed, so a round cannot be
 * priced against a balance that moved partway through it, and two accounts in
 * the same round are never quoted against different moments.
 */
async function resolveFees(
  db: ReturnType<typeof openDatabase>,
  env: NodeJS.ProcessEnv,
  flatFeeBps: number | null,
): Promise<(accountId: string) => number> {
  if (flatFeeBps !== null) {
    return () => flatFeeBps;
  }

  const tiers = parseFeeTiers(env["ZGROVE_FEE_TIERS"] ?? DEFAULT_FEE_TIERS);
  const mint = env["ZGROVE_STAKE_MINT"]?.trim();

  // No token yet, or nobody has proven a wallet: everyone is on the bottom
  // rung, which is what the ladder already says rather than a special case.
  if (mint === undefined || mint === "") {
    return () => feeBpsForBalance(tiers, 0);
  }

  const reader = createSolanaReader({
    rpcUrl: env["ZGROVE_SOLANA_RPC"] ?? "https://api.mainnet-beta.solana.com",
    mint,
    timeoutMs: 20_000,
  });

  const balances = new Map<string, number>();
  for (const { accountId, solanaAddress } of createRegistry(db).accountsWithWallets()) {
    // A wallet that cannot be read is charged the bottom rung rather than
    // given a discount nobody could verify.
    balances.set(accountId, await reader.tokenBalance(solanaAddress).catch(() => 0));
  }

  return (accountId) => feeBpsForBalance(tiers, balances.get(accountId) ?? 0);
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${flag} is required`);
  }
  return value.trim();
}

export const PAYOUT_USAGE = `zgrove payout — work out what each account is owed

  --from <when>        window start, unix seconds or YYYY-MM-DD (required)
  --to <when>          window end, exclusive (required)
  --total <ZEC>        what the treasury holds for this window (required)
  --fee-bps <n>        pool fee in basis points (default 100 = 1%)
  --min-payout <ZEC>   below this an account is carried forward (default 0.001)
  --record             write the round down as planned
  --json               machine-readable output
  --db <path>          accounting database

This command has no wallet and no RPC client. It cannot send anything, with or
without --record. The window must fall on five-minute bucket boundaries, which
any YYYY-MM-DD date does.
`;
