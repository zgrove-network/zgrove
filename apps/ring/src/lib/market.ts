/** A pari-mutuel market on how long the next Zcash block takes.
 *
 * Everyone who took the winning side splits the losing side's stakes in
 * proportion to what they put in, less the house's cut. Nobody is trading
 * against the house, which is why the house cannot want a particular
 * outcome — and could not reach it if it did.
 *
 * Positions ride in shielded memos, so until a round settles nobody can see
 * which way the money went. On an open book the crowd is visible and people
 * follow it; here they have to decide from the chain's own history, which is
 * printed on the screen. */

import { TARGET_SECONDS, type Block } from "./chain";

export type Side = "under" | "over";

/** The house's cut of the losing pool. */
export const RAKE = 0.03;

export function winningSide(interval: number): Side {
  return interval < TARGET_SECONDS ? "under" : "over";
}

export interface Pools {
  readonly under: number;
  readonly over: number;
}

export interface Position {
  readonly height: number;
  readonly side: Side;
  readonly stake: number;
}

export interface Round {
  readonly block: Block;
  readonly interval: number;
  readonly won: Side;
  readonly pools: Pools;
  /** What one unit staked on the winning side returned, gross. */
  readonly payout: number;
  readonly position: Position | null;
  readonly delta: number;
}

/** What a unit on `side` pays if that side wins, given the pools. */
export function payoutFor(pools: Pools, side: Side): number {
  const mine = side === "under" ? pools.under : pools.over;
  const theirs = side === "under" ? pools.over : pools.under;
  if (mine <= 0) return 0;
  return 1 + (theirs / mine) * (1 - RAKE);
}

export function settle(
  block: Block,
  interval: number,
  pools: Pools,
  position: Position | null,
): Round {
  const won = winningSide(interval);
  const payout = payoutFor(pools, won);

  let delta = 0;
  if (position !== null) {
    delta = position.side === won ? position.stake * (payout - 1) : -position.stake;
  }

  return { block, interval, won, pools, payout, position, delta };
}

export interface Stats {
  readonly counted: number;
  readonly under: number;
  readonly median: number;
  readonly mean: number;
  readonly longest: number;
}

export function statsOver(blocks: readonly Block[]): Stats {
  const gaps = blocks
    .map((b) => b.interval)
    .filter((v): v is number => v !== null);

  if (gaps.length === 0) {
    return { counted: 0, under: 0, median: 0, mean: 0, longest: 0 };
  }

  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);

  return {
    counted: gaps.length,
    under: gaps.filter((v) => v < TARGET_SECONDS).length,
    median,
    mean: gaps.reduce((a, b) => a + b, 0) / gaps.length,
    longest: sorted[sorted.length - 1] ?? 0,
  };
}

/** How a side would have done over the recent run, staking one unit every
 * block at the pools each round actually cleared at. */
export function backtest(side: Side, rounds: readonly Round[], over = 20): number {
  let total = 0;
  for (const r of rounds.slice(0, over)) {
    total += r.won === side ? payoutFor(r.pools, side) - 1 : -1;
  }
  return total;
}

export function zec(value: number): string {
  return value.toFixed(4);
}

export function signed(value: number): string {
  return (value >= 0 ? "+" : "") + value.toFixed(4);
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
