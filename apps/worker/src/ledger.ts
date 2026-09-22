import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The contributor's own record of every share this rig submitted and what the
 * proxy said about it, written on the contributor's machine where the operator
 * cannot reach it.
 *
 * It is an alarm, not a claim. Payouts are computed from what the upstream pool
 * accepted and never from anything a worker reports, so inflating this file
 * earns nothing. What it does is let a contributor see, without trusting
 * anybody, whether the number they were paid for matches the number their own
 * rig was told was accepted.
 *
 * It keeps the shares themselves rather than a count. A count can be typed;
 * a share cannot. Each one is proof of work against a job carrying this
 * session's extranonce, so a disputed share can be checked on its own merits
 * rather than argued about.
 */

export type LedgerOutcome = "accepted" | "rejected" | "unanswered";

export interface JobRecord {
  readonly kind: "job";
  readonly at: number;
  readonly jobId: string;
  /** mining.notify params, verbatim. What a share is verified against. */
  readonly params: readonly unknown[];
}

export interface ShareRecord {
  readonly kind: "share";
  readonly at: number;
  readonly id: string;
  readonly jobId: string;
  /**
   * mining.submit params with the first one removed. The first is the login,
   * which is a session token, and a credential does not belong in a log a
   * contributor may paste into a dispute.
   */
  readonly params: readonly unknown[];
  readonly extranonce1: string | null;
  /** From mining.set_difficulty, as it stood when the share was sent. */
  readonly difficulty: number | null;
  /** From mining.set_target, which Equihash pools send instead. */
  readonly target: string | null;
  readonly outcome: LedgerOutcome;
  readonly error?: string;
}

export type LedgerRecord = JobRecord | ShareRecord;

export interface Ledger {
  append(record: LedgerRecord): void;
}

/** One JSON object per line, appended and never rewritten. */
export function openLedger(path: string): Ledger {
  // Private like the key beside it: it holds this rig's whole work history.
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  return {
    append(record) {
      appendFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    },
  };
}

export interface LedgerSummary {
  readonly accepted: number;
  readonly rejected: number;
  readonly unanswered: number;
  /** Sum of difficulty over accepted shares — the figure a payout weighs. */
  readonly acceptedDifficulty: number;
  readonly firstAt: number | null;
  readonly lastAt: number | null;
}

/**
 * Totals over a window. A line that does not parse is skipped rather than
 * fatal: a rig that lost power mid-write leaves a torn last line, and that
 * should not stop a contributor reading the rest of their own history.
 */
export function summarise(
  path: string,
  fromSeconds = 0,
  toSeconds = Number.POSITIVE_INFINITY,
): LedgerSummary {
  let accepted = 0;
  let rejected = 0;
  let unanswered = 0;
  let acceptedDifficulty = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;

  if (!existsSync(path)) {
    return { accepted, rejected, unanswered, acceptedDifficulty, firstAt, lastAt };
  }

  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line === "") continue;
    let record: LedgerRecord;
    try {
      record = JSON.parse(line) as LedgerRecord;
    } catch {
      continue;
    }
    if (record.kind !== "share") continue;
    if (record.at < fromSeconds || record.at >= toSeconds) continue;

    if (record.outcome === "accepted") {
      accepted += 1;
      acceptedDifficulty += record.difficulty ?? 0;
    } else if (record.outcome === "rejected") {
      rejected += 1;
    } else {
      unanswered += 1;
    }
    firstAt = firstAt === null ? record.at : Math.min(firstAt, record.at);
    lastAt = lastAt === null ? record.at : Math.max(lastAt, record.at);
  }

  return { accepted, rejected, unanswered, acceptedDifficulty, firstAt, lastAt };
}
