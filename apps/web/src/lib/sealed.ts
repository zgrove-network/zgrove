/** The sealed-box auction, as a simulation.
 *
 * Nothing here talks to a chain or a pool. It exists so the shape of the
 * mechanism can be handled before any of it is built.
 *
 * The draw is deliberately unkind. Most rounds pay almost nothing and the
 * occasional block carries the entire result, because that is what proof of
 * work does. A demo tuned the other way would be a lie about the product. */

export const SLOTS = 20;

/** One Zcash block. Rounds are paced by the chain, not by us. */
export const ROUND_SECONDS = 75;

/** How often the upstream pool finds a block, per round. The real figure is a
 * function of our share of the network and is not known until we have one. */
const BLOCK_CHANCE = 0.18;

/** How many settled rounds the statistics look back over. */
export const WINDOW = 40;

/** Below this, a slot paid so little it may as well have been empty. */
const EMPTY_BELOW = 0.002;

export type Tone = "good" | "bad" | "dim";

export interface Round {
  readonly round: number;
  /** What one slot was worth, in ZEC. */
  readonly perSlot: number;
  /** The lowest bid that still took a slot. Published so bidders can price
   * the next round; the individual bids are not. */
  readonly clearing: number;
  readonly foundBlock: boolean;
  /** What this viewer bid, if they bid at all. */
  readonly bid: number | null;
}

export interface Draw {
  readonly pot: number;
  readonly foundBlock: boolean;
}

export function drawPot(random: () => number = Math.random): Draw {
  const foundBlock = random() < BLOCK_CHANCE;
  const pot = foundBlock ? 2.1 + random() * 1.7 : 0.008 + random() * 0.042;
  return { pot, foundBlock };
}

/** Where the twentieth-highest bid lands. Bidders converge on the expected
 * value, so this sits near the long-run average slot value and drifts. */
export function drawClearing(random: () => number = Math.random): number {
  return 0.0009 + random() * 0.0025;
}

export function zec(value: number): string {
  return value.toFixed(4);
}

export function signed(value: number): string {
  return (value >= 0 ? "+" : "") + value.toFixed(4);
}

/** Small deterministic generator, so the opening board is identical on the
 * server and in the browser and React has nothing to complain about. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildOpening(): readonly Round[] {
  const random = seeded(20260921);
  const out: Round[] = [];
  for (let i = 0; i < WINDOW; i += 1) {
    const { pot, foundBlock } = drawPot(random);
    const clearing = drawClearing(random);
    // The viewer has been playing a while, at roughly the going rate.
    const bid = random() < 0.72 ? clearing * (0.85 + random() * 0.45) : null;
    out.push({ round: 1207 + i, perSlot: pot / SLOTS, clearing, foundBlock, bid });
  }
  return out.reverse();
}

/** Newest first. */
export const OPENING: readonly Round[] = buildOpening();

export interface Outcome {
  readonly won: boolean;
  readonly delta: number;
  readonly label: string;
  readonly tone: Tone;
}

export function outcomeOf(row: Round): Outcome {
  if (row.bid === null) {
    return { won: false, delta: 0, label: "—", tone: "dim" };
  }
  if (row.bid < row.clearing) {
    return { won: false, delta: 0, label: "no slot", tone: "dim" };
  }
  const delta = row.perSlot - row.bid;
  return {
    won: true,
    delta,
    label: signed(delta),
    tone: delta >= 0 ? "good" : "bad",
  };
}

export interface Stats {
  readonly avgPerSlot: number;
  /** The middle round. Shown beside the average because the average is pulled
   * upward by the rare found block, and a bidder who reads only the average
   * concludes the going rate is free money. The gap between these two numbers
   * is the whole risk of the thing. */
  readonly medPerSlot: number;
  readonly avgClearing: number;
  readonly best: number;
  readonly empty: number;
  readonly counted: number;
}

export function statsOver(rounds: readonly Round[]): Stats {
  const seen = rounds.slice(0, WINDOW);
  if (seen.length === 0) {
    return { avgPerSlot: 0, medPerSlot: 0, avgClearing: 0, best: 0, empty: 0, counted: 0 };
  }
  let slot = 0;
  let clear = 0;
  let best = 0;
  let empty = 0;
  for (const r of seen) {
    slot += r.perSlot;
    clear += r.clearing;
    if (r.perSlot > best) best = r.perSlot;
    if (r.perSlot < EMPTY_BELOW) empty += 1;
  }
  const sorted = seen.map((r) => r.perSlot).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);

  return {
    avgPerSlot: slot / seen.length,
    medPerSlot: median,
    avgClearing: clear / seen.length,
    best,
    empty,
    counted: seen.length,
  };
}

/** How often a given bid would have taken a slot lately. This is the only
 * honest answer to "what should I bid", and it is the reason the lowest
 * winning bid is published at all. */
export function hitRate(
  bid: number,
  rounds: readonly Round[],
  over = 20,
): { hits: number; of: number } {
  const seen = rounds.slice(0, over);
  let hits = 0;
  for (const r of seen) if (bid >= r.clearing) hits += 1;
  return { hits, of: seen.length };
}

/** What that bid would have returned over the same stretch: the sum of the
 * slots it would have taken, less what it would have paid for them. */
export function backtest(
  bid: number,
  rounds: readonly Round[],
  over = 20,
): number {
  let total = 0;
  for (const r of rounds.slice(0, over)) {
    if (bid >= r.clearing) total += r.perSlot - bid;
  }
  return total;
}

/** Bar heights as percentages, on a log scale, because one found block is two
 * hundred times a quiet round and a linear chart would be thirty-nine flat
 * bars and a spike. */
export function bars(values: readonly number[]): readonly number[] {
  if (values.length === 0) return [];
  const logs = values.map((v) => Math.log10(Math.max(v, 1e-6)));
  const lo = Math.min(...logs);
  const hi = Math.max(...logs);
  const span = hi - lo;
  return logs.map((l) => (span === 0 ? 50 : 8 + ((l - lo) / span) * 92));
}
