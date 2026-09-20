import { parseArgs } from "node:util";

import {
  BUCKET_SECONDS,
  bucketStartFor,
  createAccounting,
  openDatabase,
  type WorkerStats,
} from "@zgrove/db";

import {
  agoFrom,
  padLeft,
  padRight,
  parseDuration,
  percent,
  siPrefix,
} from "./format.js";

/**
 * Hashes represented by one unit of share difficulty. 2^32 is the
 * difficulty-1 convention that Bitcoin-descended stratum implementations use,
 * and it is only correct for an algorithm that follows it. Equihash and the
 * memory-hard algorithms scale differently, so an operator running one of
 * those sets the constant to match rather than reading a number that is off
 * by orders of magnitude.
 */
const DEFAULT_WORK_PER_DIFFICULTY = 2 ** 32;

export function runStats(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      db: { type: "string" },
      since: { type: "string", default: "1h" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help === true) {
    process.stdout.write(USAGE);
    return 0;
  }

  const databasePath = values.db ?? env["ZGROVE_DB_PATH"] ?? "data/zgrove.sqlite";
  const windowSeconds = parseDuration(values.since ?? "1h");
  const workPerDifficulty = readWorkConstant(env);

  const nowSeconds = Math.floor(Date.now() / 1000);
  // Floored to a bucket start, or the partial bucket at the near edge would
  // be dropped whole and the newest shares would be missing from the window.
  const fromSeconds = bucketStartFor(nowSeconds - windowSeconds);
  const elapsedSeconds = Math.max(BUCKET_SECONDS, nowSeconds - fromSeconds);

  const rows = readStats(databasePath, fromSeconds, nowSeconds + 1);

  if (values.json === true) {
    process.stdout.write(
      `${JSON.stringify(
        {
          from: fromSeconds,
          to: nowSeconds,
          workers: rows.map((row) => ({
            ...row,
            weightPerSecond: row.acceptedDifficulty / elapsedSeconds,
            estimatedHashrate:
              (row.acceptedDifficulty * workPerDifficulty) / elapsedSeconds,
          })),
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  writeTable(rows, elapsedSeconds, workPerDifficulty, nowSeconds, windowSeconds);
  return 0;
}

function readStats(
  databasePath: string,
  fromSeconds: number,
  toSeconds: number,
): readonly WorkerStats[] {
  // Readonly: the orchestrator is the single writer, and a reporting command
  // has no business holding a write handle on the accounting database.
  let db;
  try {
    db = openDatabase(databasePath, { readonly: true });
  } catch {
    throw new Error(
      `Cannot open ${databasePath}. Has the orchestrator run yet?`,
    );
  }

  try {
    return createAccounting(db).statsBetween(fromSeconds, toSeconds);
  } catch {
    throw new Error(
      `${databasePath} has no accounting tables yet. The orchestrator creates them on first start.`,
    );
  } finally {
    db.close();
  }
}

function writeTable(
  rows: readonly WorkerStats[],
  elapsedSeconds: number,
  workPerDifficulty: number,
  nowSeconds: number,
  windowSeconds: number,
): void {
  if (rows.length === 0) {
    process.stdout.write("No workers have connected yet.\n");
    return;
  }

  const nameWidth = Math.max(6, ...rows.map((row) => row.workerName.length + row.username.length + 1));

  const header =
    padRight("worker", nameWidth) +
    padLeft("accepted", 10) +
    padLeft("rejected", 10) +
    padLeft("unresolved", 12) +
    padLeft("reject", 8) +
    padLeft("weight/s", 12) +
    padLeft("est. hashrate", 16) +
    "  last share";

  const lines = [
    `window: last ${formatWindow(windowSeconds)}`,
    "",
    header,
    "-".repeat(header.length),
  ];

  let accepted = 0;
  let rejected = 0;
  let unresolved = 0;
  let weight = 0;

  for (const row of rows) {
    accepted += row.accepted;
    rejected += row.rejected;
    unresolved += row.unresolved;
    weight += row.acceptedDifficulty;

    lines.push(
      padRight(`${row.username}.${row.workerName}`, nameWidth) +
        padLeft(String(row.accepted), 10) +
        padLeft(String(row.rejected), 10) +
        padLeft(String(row.unresolved), 12) +
        padLeft(percent(row.rejected, row.accepted + row.rejected), 8) +
        padLeft(siPrefix(row.acceptedDifficulty / elapsedSeconds), 12) +
        padLeft(
          `${siPrefix((row.acceptedDifficulty * workPerDifficulty) / elapsedSeconds)}H/s`,
          16,
        ) +
        "  " +
        agoFrom(row.lastBucket, nowSeconds),
    );
  }

  if (rows.length > 1) {
    lines.push("-".repeat(header.length));
    lines.push(
      padRight("total", nameWidth) +
        padLeft(String(accepted), 10) +
        padLeft(String(rejected), 10) +
        padLeft(String(unresolved), 12) +
        padLeft(percent(rejected, accepted + rejected), 8) +
        padLeft(siPrefix(weight / elapsedSeconds), 12) +
        padLeft(`${siPrefix((weight * workPerDifficulty) / elapsedSeconds)}H/s`, 16),
    );
  }

  // Bucket granularity is five minutes, so "last share" is never fresher than
  // the bucket it landed in. Saying so beats letting an operator read it as a
  // live heartbeat.
  lines.push("");
  lines.push(`Hashrate is estimated from accepted share weight. "last share" is bucket-granular (${BUCKET_SECONDS}s).`);
  if (unresolved > 0) {
    // Neither accepted nor rejected: upstream said nothing. A rising count
    // here is a pool problem wearing the costume of a quiet worker.
    lines.push(`${unresolved} submit(s) went unanswered by upstream in this window.`);
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

function formatWindow(seconds: number): string {
  if (seconds % 86400 === 0) {
    return `${seconds / 86400}d`;
  }
  if (seconds % 3600 === 0) {
    return `${seconds / 3600}h`;
  }
  if (seconds % 60 === 0) {
    return `${seconds / 60}m`;
  }
  return `${seconds}s`;
}

function readWorkConstant(env: NodeJS.ProcessEnv): number {
  const raw = env["ZGROVE_WORK_PER_DIFFICULTY"];
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_WORK_PER_DIFFICULTY;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `ZGROVE_WORK_PER_DIFFICULTY must be a positive number, got ${raw}`,
    );
  }
  return value;
}

const USAGE = `zgrove stats — per-worker share accounting

  --db <path>     accounting database (default: $ZGROVE_DB_PATH or data/zgrove.sqlite)
  --since <dur>   window to report over, e.g. 30m, 6h, 1d (default: 1h)
  --json          machine-readable output
  --help          this text

Estimated hashrate assumes one unit of share difficulty is 2^32 hashes, which
holds for difficulty-1 stratum algorithms and not for others. Override with
ZGROVE_WORK_PER_DIFFICULTY.
`;
