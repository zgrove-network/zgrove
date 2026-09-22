import type { WorkerStats } from "@zgrove/db";

/**
 * What the pool says about itself in public.
 *
 * Totals only. Never a worker name, an account, or a single contributor's
 * share count — the whole claim of this pool is that what any one person
 * contributed and earned is not visible, and a status page that quietly
 * undoes that is worse than no status page, because it looks like proof of
 * the opposite.
 *
 * The hashrate is derived from accepted shares and is a number for people to
 * look at. It is never what anybody is paid on; payouts come from what the
 * upstream pool accepted.
 */
export interface PoolSummary {
  readonly algo: string;
  readonly upstream: string;
  readonly stratum: string;
  /** How many distinct rigs sent an accepted share inside the window. */
  readonly contributors: number;
  readonly accepted: number;
  readonly rejected: number;
  /** Submits upstream never answered. Neither accepted nor rejected. */
  readonly unresolved: number;
  readonly windowSeconds: number;
  /** Hashes per second, estimated. A number to look at, not to be paid on. */
  readonly hashrate: number;
  readonly asOf: number;
}

export interface PoolSummaryOptions {
  readonly algo: string;
  readonly upstream: string;
  readonly stratum: string;
  readonly windowSeconds: number;
  readonly workPerDifficulty: number;
  readonly asOf: number;
}

export function summarisePool(
  stats: readonly WorkerStats[],
  options: PoolSummaryOptions,
): PoolSummary {
  let accepted = 0;
  let rejected = 0;
  let unresolved = 0;
  let difficulty = 0;
  let contributors = 0;

  for (const worker of stats) {
    accepted += worker.accepted;
    rejected += worker.rejected;
    unresolved += worker.unresolved;
    difficulty += worker.acceptedDifficulty;
    if (worker.accepted > 0) contributors += 1;
  }

  const hashrate =
    options.windowSeconds > 0
      ? Math.round((difficulty * options.workPerDifficulty) / options.windowSeconds)
      : 0;

  return {
    algo: options.algo,
    upstream: options.upstream,
    stratum: options.stratum,
    contributors,
    accepted,
    rejected,
    unresolved,
    windowSeconds: options.windowSeconds,
    hashrate,
    asOf: options.asOf,
  };
}
