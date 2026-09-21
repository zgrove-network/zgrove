/** The sealed-box auction, as a simulation.
 *
 * Nothing here talks to a chain or a pool. It exists so the shape of the
 * mechanism can be looked at before any of it is built: how a round opens,
 * what a bidder can and cannot see while it is open, and what the payout
 * distribution actually looks like over many rounds.
 *
 * The numbers are drawn from a distribution chosen to be honest about mining
 * rather than flattering: most rounds pay almost nothing, and the occasional
 * block carries the whole result. A demo tuned the other way would be a lie
 * about the product. */

export const SLOTS = 20;

/** One Zcash block, near enough. Rounds are paced by the chain, not by us. */
export const ROUND_SECONDS = 75;

/** How often the pool's upstream finds a block, per round. The real figure is
 * a function of our share of the network and is not known until we have one. */
const BLOCK_CHANCE = 0.18;

export type Tone = "good" | "bad" | "dim";

export interface Settled {
  readonly round: number;
  /** What one slot was worth, in ZEC. */
  readonly share: string;
  /** The lowest bid that still took a slot. Published so bidders can price
   * the next round; individual bids are not. */
  readonly clearing: string;
  readonly mine: string;
  readonly outcome: string;
  readonly tone: Tone;
}

export interface Draw {
  readonly pot: number;
  readonly foundBlock: boolean;
}

/** What the box holds this round. */
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

export function settle(
  round: number,
  pot: number,
  clearing: number,
  bid: number | null,
): { row: Settled; delta: number } {
  const share = pot / SLOTS;

  if (bid === null) {
    return {
      row: {
        round,
        share: zec(share),
        clearing: zec(clearing),
        mine: "—",
        outcome: "—",
        tone: "dim",
      },
      delta: 0,
    };
  }

  if (bid < clearing) {
    return {
      row: {
        round,
        share: zec(share),
        clearing: zec(clearing),
        mine: zec(bid),
        outcome: "no slot",
        tone: "dim",
      },
      delta: 0,
    };
  }

  const delta = share - bid;
  return {
    row: {
      round,
      share: zec(share),
      clearing: zec(clearing),
      mine: zec(bid),
      outcome: (delta >= 0 ? "+" : "") + zec(delta),
      tone: delta >= 0 ? "good" : "bad",
    },
    delta,
  };
}

/** A fixed opening board, so the first paint is the same on the server and in
 * the browser. Everything after this is drawn in an effect. */
export const OPENING: readonly Settled[] = [
  { round: 1246, share: "0.0011", clearing: "0.0009", mine: "—", outcome: "—", tone: "dim" },
  { round: 1245, share: "0.1487", clearing: "0.0031", mine: "0.0030", outcome: "+0.1457", tone: "good" },
  { round: 1244, share: "0.0009", clearing: "0.0012", mine: "0.0012", outcome: "no slot", tone: "dim" },
  { round: 1243, share: "0.0014", clearing: "0.0010", mine: "0.0010", outcome: "+0.0004", tone: "good" },
  { round: 1242, share: "0.0008", clearing: "0.0011", mine: "0.0011", outcome: "-0.0003", tone: "bad" },
  { round: 1241, share: "0.0012", clearing: "0.0009", mine: "—", outcome: "—", tone: "dim" },
];
