export interface ChainLookupOptions {
  /** A Zcash transaction lookup that returns JSON. */
  readonly explorerUrl: string;
  readonly timeoutMs: number;
}

export interface TransactionFacts {
  readonly exists: boolean;
  readonly blockHeight: number | null;
  /** True when the transaction has shielded components. */
  readonly shielded: boolean;
}

export class NotOnChain extends Error {
  constructor(txid: string) {
    super(`No transaction ${txid} on Zcash mainnet`);
    this.name = "NotOnChain";
  }
}

/**
 * Checks a transaction id against the chain before it is accepted as evidence
 * of a payment.
 *
 * Taking an operator's word for a txid would make the receipt worth exactly
 * what the operator says it is, which is the failure this project spent a day
 * finding in somebody else's certificate.
 */
export function createChainLookup(options: ChainLookupOptions) {
  return {
    async transaction(txid: string): Promise<TransactionFacts> {
      const response = await fetch(`${options.explorerUrl}${txid}`, {
        signal: AbortSignal.timeout(options.timeoutMs),
      });

      const body = (await response.json().catch(() => null)) as {
        data?: Record<string, unknown>;
      } | null;

      const entry = body?.data?.[txid] as Record<string, unknown> | undefined;
      const transaction = entry?.["transaction"] as Record<string, unknown> | undefined;

      if (transaction === undefined) {
        return { exists: false, blockHeight: null, shielded: false };
      }

      const height = transaction["block_id"];
      const delta = transaction["shielded_value_delta"];
      const outputs = transaction["shielded_output_raw"];
      const joins = transaction["join_split_raw"];

      return {
        exists: true,
        blockHeight: typeof height === "number" && height > 0 ? height : null,
        // A payout to shielded addresses has shielded components. A
        // transparent-only transaction is not the payment it claims to be,
        // whatever its id.
        shielded:
          (typeof delta === "number" && delta !== 0) ||
          (Array.isArray(outputs) && outputs.length > 0) ||
          (Array.isArray(joins) && joins.length > 0),
      };
    },
  };
}

export const DEFAULT_EXPLORER =
  "https://api.blockchair.com/zcash/dashboards/transaction/";
