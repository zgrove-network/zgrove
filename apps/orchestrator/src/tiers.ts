export interface FeeTier {
  /** Token balance, in the mint's base units, that this tier begins at. */
  readonly atLeast: number;
  readonly feeBps: number;
}

/**
 * Fee tiers, cheapest at the top of the ladder. Staking does not increase a
 * contributor's share of a round — every share is still split by accepted
 * work — it lowers what the pool keeps from theirs. A large balance on a weak
 * card still earns little, because it still does little.
 */
export function parseFeeTiers(text: string): FeeTier[] {
  const tiers = text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const [balance = "", bps = ""] = part.split(":");
      const atLeast = Number(balance);
      const feeBps = Number(bps);

      if (!Number.isInteger(atLeast) || atLeast < 0) {
        throw new Error(`Tier threshold must be a whole number: ${part}`);
      }
      if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
        throw new Error(`Tier fee must be 0-10000 basis points: ${part}`);
      }
      return { atLeast, feeBps };
    })
    .sort((a, b) => b.atLeast - a.atLeast);

  if (tiers.length === 0) {
    throw new Error("No fee tiers configured");
  }

  // Without a tier at zero there is no rate for someone holding nothing, and
  // the alternative is inventing one at the moment of paying them.
  if ((tiers.at(-1) as FeeTier).atLeast !== 0) {
    throw new Error("Fee tiers must include a tier at 0");
  }

  return tiers;
}

/** The rate for a balance: the best tier it reaches. */
export function feeBpsForBalance(tiers: readonly FeeTier[], balance: number): number {
  for (const tier of tiers) {
    if (balance >= tier.atLeast) {
      return tier.feeBps;
    }
  }
  // Unreachable while a zero tier is required, and cheaper to state than to
  // rely on that invariant holding forever.
  return (tiers.at(-1) as FeeTier).feeBps;
}

export const DEFAULT_FEE_TIERS = "0:200";
