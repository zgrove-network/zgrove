export interface Coin {
  readonly id: string;
  readonly name: string;
  readonly algo: string;
  /** Hashes per second across the whole network. */
  readonly networkHashrate: number;
  readonly blockSeconds: number;
  readonly blockReward: number;
  readonly usd: number;
  /** Rough VRAM floor in GB; below it the card cannot mine this at all. */
  readonly vramGb: number;
}

export interface Estimate {
  readonly coin: Coin;
  readonly dailyCoin: number;
  readonly revenueUsd: number;
  readonly powerUsd: number;
  readonly netUsd: number;
  readonly fits: boolean;
}

/**
 * What a card earns in a day, and what its electricity costs over the same
 * day. Both halves, always — a revenue figure on its own is the number every
 * other calculator shows and it is the one that misleads.
 */
export function estimate(
  coin: Coin,
  hashrate: number,
  watts: number,
  usdPerKwh: number,
  vramGb: number,
): Estimate {
  const blocksPerDay = 86_400 / coin.blockSeconds;
  const share = coin.networkHashrate > 0 ? hashrate / coin.networkHashrate : 0;
  const dailyCoin = share * blocksPerDay * coin.blockReward;

  const revenueUsd = dailyCoin * coin.usd;
  const powerUsd = (watts / 1000) * 24 * usdPerKwh;

  return {
    coin,
    dailyCoin,
    revenueUsd,
    powerUsd,
    netUsd: revenueUsd - powerUsd,
    // A dataset that does not fit in VRAM is not slow mining, it is no
    // mining, so this is a wall rather than a penalty.
    fits: vramGb >= coin.vramGb,
  };
}

export function rank(
  coins: readonly Coin[],
  hashrate: number,
  watts: number,
  usdPerKwh: number,
  vramGb: number,
): Estimate[] {
  return coins
    .map((coin) => estimate(coin, hashrate, watts, usdPerKwh, vramGb))
    .sort((a, b) => Number(b.fits) - Number(a.fits) || b.netUsd - a.netUsd);
}

export function usd(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}
