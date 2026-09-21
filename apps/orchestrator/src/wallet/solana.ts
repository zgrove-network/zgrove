export interface SolanaOptions {
  readonly rpcUrl: string;
  /** The stake token's mint address. */
  readonly mint: string;
  readonly timeoutMs: number;
}

export interface SolanaReader {
  /** Base units held by an owner, summed across their token accounts. */
  tokenBalance(owner: string): Promise<number>;
}

/**
 * Reads a wallet's balance of one token. Nothing is written and no key is
 * held: a fee tier is a fact about a public balance, and this side of it
 * needs no more authority than any block explorer has.
 */
export function createSolanaReader(options: SolanaOptions): SolanaReader {
  return {
    async tokenBalance(owner) {
      const response = await fetch(options.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenAccountsByOwner",
          params: [
            owner,
            { mint: options.mint },
            { encoding: "jsonParsed", commitment: "confirmed" },
          ],
        }),
        signal: AbortSignal.timeout(options.timeoutMs),
      });

      const body = (await response.json().catch(() => null)) as {
        result?: { value?: unknown[] };
        error?: { message?: string };
      } | null;

      if (body === null) {
        throw new Error("Solana RPC returned no JSON");
      }
      if (body.error !== undefined) {
        throw new Error(`Solana RPC: ${body.error.message ?? "unknown"}`);
      }

      // A wallet can hold several token accounts for one mint, and a tier has
      // to reflect what the owner holds rather than what sits in whichever
      // account happened to be first.
      let total = 0;
      for (const entry of body.result?.value ?? []) {
        const amount = readAmount(entry);
        if (amount !== null) {
          total += amount;
        }
      }
      return total;
    },
  };
}

function readAmount(entry: unknown): number | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const account = (entry as Record<string, unknown>)["account"];
  const data = (account as Record<string, unknown> | undefined)?.["data"];
  const parsed = (data as Record<string, unknown> | undefined)?.["parsed"];
  const info = (parsed as Record<string, unknown> | undefined)?.["info"];
  const tokenAmount = (info as Record<string, unknown> | undefined)?.["tokenAmount"];
  const amount = (tokenAmount as Record<string, unknown> | undefined)?.["amount"];

  if (typeof amount !== "string") {
    return null;
  }

  const value = Number(amount);
  return Number.isSafeInteger(value) ? value : null;
}
