import type { WorkerIdentity } from "@zgrove/protocol";

import { bucketStartFor } from "./buckets.js";
import type { Db } from "./database.js";

/**
 * What became of a submit. Three outcomes, not two: upstream can also say
 * nothing at all, and that is not a rejection.
 */
export type ShareOutcome = "accepted" | "rejected" | "unresolved";

export interface ShareRecord {
  readonly workerId: number;
  readonly algo: string;
  /** What upstream answered. Never what the worker claimed. */
  readonly outcome: ShareOutcome;
  /** The share's weight at the difficulty upstream had set. */
  readonly difficulty: number;
  /** Submit-time value in millionths of a dollar. Zero until pricing lands. */
  readonly usdMicros?: number;
  readonly atSeconds: number;
}

export interface WorkerStats {
  readonly workerId: number;
  readonly username: string;
  readonly workerName: string;
  readonly accepted: number;
  readonly rejected: number;
  /** Submits upstream never answered. Not counted as either of the above. */
  readonly unresolved: number;
  readonly acceptedDifficulty: number;
  readonly acceptedUsdMicros: number;
  readonly lastBucket: number | null;
}

export interface Accounting {
  /** Resolves a login to its worker row, creating it on first sight. */
  touchWorker(identity: WorkerIdentity, nowSeconds: number): number;
  recordShare(record: ShareRecord): void;
  /** Rolled-up stats per worker over [fromSeconds, toSeconds). */
  statsBetween(fromSeconds: number, toSeconds: number): readonly WorkerStats[];
}

interface WorkerRow {
  readonly id: number;
}

interface StatsRow {
  readonly worker_id: number;
  readonly username: string;
  readonly worker_name: string;
  readonly accepted: number;
  readonly rejected: number;
  readonly unresolved: number;
  readonly accepted_difficulty: number;
  readonly accepted_usd_micros: number;
  readonly last_bucket: number | null;
}

/**
 * Prepares the accounting statements once and reuses them. Every accepted
 * share on a busy proxy goes through recordShare, so re-preparing SQL per
 * share would put the parser on the hot path.
 */
export function createAccounting(db: Db): Accounting {
  const touch = db.prepare<
    [string, string, number, number],
    WorkerRow
  >(`
    INSERT INTO workers (username, worker_name, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (username, worker_name)
      DO UPDATE SET last_seen_at = excluded.last_seen_at
    RETURNING id
  `);

  // Qualified on both sides: the bare name in a DO UPDATE would read as the
  // stored column in one place and the proposed row in the other.
  const record = db.prepare(`
    INSERT INTO share_buckets (
      worker_id, bucket_start, algo,
      accepted, rejected, unresolved, accepted_difficulty, accepted_usd_micros
    )
    VALUES (
      @workerId, @bucketStart, @algo,
      @accepted, @rejected, @unresolved, @difficulty, @usdMicros
    )
    ON CONFLICT (worker_id, bucket_start, algo) DO UPDATE SET
      accepted            = share_buckets.accepted            + excluded.accepted,
      rejected            = share_buckets.rejected            + excluded.rejected,
      unresolved          = share_buckets.unresolved          + excluded.unresolved,
      accepted_difficulty = share_buckets.accepted_difficulty + excluded.accepted_difficulty,
      accepted_usd_micros = share_buckets.accepted_usd_micros + excluded.accepted_usd_micros
  `);

  // LEFT JOIN so a worker that is connected but submitting nothing still
  // appears, with zeroes. A silent rig is the thing an operator looks for.
  const stats = db.prepare<[number, number], StatsRow>(`
    SELECT
      w.id                                      AS worker_id,
      w.username                                AS username,
      w.worker_name                             AS worker_name,
      COALESCE(SUM(b.accepted), 0)              AS accepted,
      COALESCE(SUM(b.rejected), 0)              AS rejected,
      COALESCE(SUM(b.unresolved), 0)            AS unresolved,
      COALESCE(SUM(b.accepted_difficulty), 0)   AS accepted_difficulty,
      COALESCE(SUM(b.accepted_usd_micros), 0)   AS accepted_usd_micros,
      MAX(b.bucket_start)                       AS last_bucket
    FROM workers w
    LEFT JOIN share_buckets b
      ON b.worker_id = w.id
     AND b.bucket_start >= ?
     AND b.bucket_start <  ?
    GROUP BY w.id
    ORDER BY w.username, w.worker_name
  `);

  return {
    touchWorker(identity, nowSeconds) {
      const row = touch.get(
        identity.username,
        identity.workerName,
        nowSeconds,
        nowSeconds,
      );
      if (row === undefined) {
        throw new Error(`Worker upsert returned no row for ${identity.login}`);
      }
      return row.id;
    },

    recordShare(share) {
      // Weight and value attach to accepted shares only. Summing a rejected
      // or unanswered share's difficulty would let a worker inflate its own
      // estimated hashrate with shares nobody agreed to.
      const accepted = share.outcome === "accepted";
      record.run({
        workerId: share.workerId,
        bucketStart: bucketStartFor(share.atSeconds),
        algo: share.algo,
        accepted: accepted ? 1 : 0,
        rejected: share.outcome === "rejected" ? 1 : 0,
        unresolved: share.outcome === "unresolved" ? 1 : 0,
        difficulty: accepted ? share.difficulty : 0,
        usdMicros: accepted ? Math.round(share.usdMicros ?? 0) : 0,
      });
    },

    statsBetween(fromSeconds, toSeconds) {
      return stats.all(fromSeconds, toSeconds).map((row) => ({
        workerId: row.worker_id,
        username: row.username,
        workerName: row.worker_name,
        accepted: row.accepted,
        rejected: row.rejected,
        unresolved: row.unresolved,
        acceptedDifficulty: row.accepted_difficulty,
        acceptedUsdMicros: row.accepted_usd_micros,
        lastBucket: row.last_bucket,
      }));
    },
  };
}
