import type { Coin } from "./profit";

export interface CoinData {
  readonly fetchedAt: string;
  readonly coins: readonly Coin[];
}

/**
 * Read at build time, not in the visitor's browser. The public APIs this
 * needs do not all allow cross-origin requests, and a calculator that fails
 * on a CORS error is worse than one whose difficulty figure is a few hours
 * old. The page says when it was read, so a reader can judge for themselves.
 */
export async function loadCoins(): Promise<CoinData> {
  const [ergoInfo, prices] = await Promise.all([
    fetchJson("https://api.ergoplatform.com/info"),
    fetchJson(
      "https://api.coingecko.com/api/v3/simple/price?ids=ergo&vs_currencies=usd",
    ),
  ]);

  const networkHashrate = numberFrom(ergoInfo?.["hashRate"]);
  const usdPrice = numberFrom(
    (prices?.["ergo"] as Record<string, unknown> | undefined)?.["usd"],
  );

  const coins: Coin[] = [];
  if (networkHashrate !== null && usdPrice !== null) {
    coins.push({
      id: "ergo",
      name: "Ergo",
      algo: "Autolykos2",
      networkHashrate,
      blockSeconds: 120,
      blockReward: 3,
      usd: usdPrice,
      vramGb: 4,
    });
  }

  return { fetchedAt: new Date().toISOString(), coins };
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return (await response.json()) as Record<string, unknown>;
  } catch {
    // A build should not fail because an explorer was briefly unreachable.
    // The page renders with whatever came back and says so.
    return null;
  }
}

function numberFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}
