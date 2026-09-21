import { parseArgs } from "node:util";

import { createPayouts, migrate, openDatabase, type PlannedRound } from "@zgrove/db";

import { padLeft, padRight, percent } from "./format.js";
import { formatZec, parseInstant, parseZec } from "./money.js";

/**
 * Computes a payout round and prints it. This command cannot move money: it
 * has no wallet, no key and no RPC client. Recording a round is opt-in and
 * still sends nothing — it only writes down what was decided, so that the
 * sending step later has something it can be checked against.
 */
export function runPayout(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      db: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      total: { type: "string" },
      "fee-bps": { type: "string", default: "100" },
      "min-payout": { type: "string", default: "0.001" },
      record: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const periodStart = parseInstant(required(values.from, "--from"));
  const periodEnd = parseInstant(required(values.to, "--to"));
  const totalZat = parseZec(required(values.total, "--total"));
  const feeBps = Number(values["fee-bps"] ?? "100");
  const minPayoutZat = parseZec(values["min-payout"] ?? "0");

  const databasePath = values.db ?? env["ZGROVE_DB_PATH"] ?? "data/zgrove.sqlite";
  const db = openDatabase(databasePath);

  try {
    migrate(db);
    const payouts = createPayouts(db);
    const round = payouts.plan({
      periodStart,
      periodEnd,
      totalZat,
      feeBps,
      minPayoutZat,
      atSeconds: Math.floor(Date.now() / 1000),
    });

    if (values.json === true) {
      process.stdout.write(`${JSON.stringify(round, null, 2)}\n`);
    } else {
      writeRound(round, feeBps);
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

function writeRound(round: PlannedRound, feeBps: number): void {
  const nameWidth = Math.max(
    7,
    ...round.entries.map((entry) => entry.accountId.length),
  );

  const header =
    padRight("account", nameWidth) +
    padLeft("share", 9) +
    padLeft("carried in", 16) +
    padLeft("pays", 16) +
    padLeft("carried out", 16);

  const lines = [
    `period:       ${new Date(round.periodStart * 1000).toISOString()}`,
    `          ->  ${new Date(round.periodEnd * 1000).toISOString()}`,
    `treasury:     ${formatZec(round.totalZat)} ZEC`,
    `fee:          ${formatZec(round.feeZat)} ZEC  (${feeBps} bps)`,
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
