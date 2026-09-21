import { parseArgs } from "node:util";

import { createDispatch, migrate, openDatabase } from "@zgrove/db";

import { planSend, resume, send } from "../wallet/dispatch.js";
import { createZcashd } from "../wallet/zcashd.js";
import { formatZec } from "./money.js";

/**
 * Sends a round that was already computed and recorded. It never computes
 * amounts: what goes out is what was written down and reviewed.
 *
 * Sending requires --confirm. Without it this prints the exact RPC call and
 * stops, which is the dry run the ground rules require of anything that can
 * move funds.
 */
export async function runSend(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      db: { type: "string" },
      round: { type: "string" },
      from: { type: "string" },
      confirm: { type: "boolean", default: false },
      resume: { type: "boolean", default: false },
      "min-conf": { type: "string", default: "10" },
      fee: { type: "string" },
    },
    allowPositionals: false,
  });

  const roundId = Number(required(values.round, "--round"));
  const databasePath = values.db ?? env["ZGROVE_DB_PATH"] ?? "data/zgrove.sqlite";
  const db = openDatabase(databasePath);

  try {
    migrate(db);
    const dispatch = createDispatch(db);

    const round = dispatch.load(roundId);
    if (round === null) {
      throw new Error(`No round ${roundId}. Run "zgrove payout --record" first.`);
    }

    if (values.resume === true) {
      const result = await resume(round, dispatch, zcashdFrom(env));
      process.stdout.write(
        `round ${roundId}: ${result.status}${result.txid === null ? "" : `, txid ${result.txid}`}\n`,
      );
      return 0;
    }

    const from = values.from ?? required(env["ZGROVE_TREASURY_ADDRESS"], "--from or ZGROVE_TREASURY_ADDRESS");
    const plan = planSend(round, from);

    process.stdout.write(
      `round ${plan.round.id}  ${new Date(plan.round.periodStart * 1000).toISOString().slice(0, 10)}` +
        ` -> ${new Date(plan.round.periodEnd * 1000).toISOString().slice(0, 10)}\n` +
        `from ${plan.from}\n` +
        `paying ${plan.recipients.length} account(s), ${formatZec(plan.totalZat)} ZEC total\n\n` +
        `z_sendmany ${JSON.stringify([plan.from, plan.recipients, Number(values["min-conf"] ?? "10")], null, 2)}\n`,
    );

    if (values.confirm !== true) {
      process.stdout.write(
        `\nDry run. Nothing was sent. Add --confirm to send this, which cannot be undone.\n`,
      );
      return 0;
    }

    const result = await send(
      plan,
      dispatch,
      zcashdFrom(env),
      {
        minConf: Number(values["min-conf"] ?? "10"),
        fee: values.fee ?? null,
        waitMs: 120_000,
        pollMs: 2_000,
      },
      Math.floor(Date.now() / 1000),
    );

    if (result.txid === null) {
      process.stdout.write(
        `\noperation ${result.operationId} is still ${result.status}.\n` +
          `The round stays in sending. Finish it with: zgrove send --round ${roundId} --resume\n`,
      );
    } else {
      process.stdout.write(`\nsent. txid ${result.txid}\n`);
    }
    return 0;
  } finally {
    db.close();
  }
}

function zcashdFrom(env: NodeJS.ProcessEnv) {
  return createZcashd({
    url: required(env["ZGROVE_ZCASHD_URL"], "ZGROVE_ZCASHD_URL"),
    user: required(env["ZGROVE_ZCASHD_USER"], "ZGROVE_ZCASHD_USER"),
    password: required(env["ZGROVE_ZCASHD_PASSWORD"], "ZGROVE_ZCASHD_PASSWORD"),
    timeoutMs: 30_000,
  });
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

export const SEND_USAGE = `zgrove send — pay a recorded round

  --round <id>     the round to send (required)
  --from <addr>    treasury address to send from (or ZGROVE_TREASURY_ADDRESS)
  --confirm        actually send; without this it is a dry run
  --resume         finish a round whose operation was still running
  --min-conf <n>   minimum confirmations on the inputs (default 10)
  --fee <ZEC>      explicit fee; omitted lets zcashd choose
  --db <path>      accounting database

Needs ZGROVE_ZCASHD_URL, ZGROVE_ZCASHD_USER and ZGROVE_ZCASHD_PASSWORD.

The amounts are whatever "zgrove payout --record" wrote down. This command
never recomputes them, so what goes out is what was reviewed. A send cannot be
undone and shielded ZEC cannot be recalled.
`;
