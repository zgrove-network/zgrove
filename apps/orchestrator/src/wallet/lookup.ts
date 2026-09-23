import { createChainLookup, type TransactionFacts } from "./chain.js";
import { DEFAULT_LIGHTWALLETD, createLightwalletdLookup, type GrpcCall } from "./lightwalletd.js";

/**
 * Picks the service that answers "is this transaction on the chain, and did it
 * spend from a shielded pool".
 *
 * lightwalletd is the default because it returns the raw transaction, so
 * "was this shielded" is read from the transaction rather than inferred from
 * what an explorer left out of its JSON. No explorer decodes Orchard, and that
 * inference refused real payments until it was caught.
 *
 * An explorer stays reachable on purpose, for a day when the light wallet
 * servers are the ones that are down. Two ways to ask is the point: the cost
 * of getting no answer at all is an operator who believes a payout never
 * landed.
 */
export interface LookupChoice {
  /** An HTTP explorer, which replaces lightwalletd when it is set. */
  readonly explorerUrl?: string | undefined;
  readonly lightwalletd?: string | undefined;
  readonly timeoutMs: number;
}

export interface TransactionLookup {
  transaction(txid: string): Promise<TransactionFacts>;
  /** Who answered, for the operator to read next to the verdict. */
  readonly source: string;
}

export function createTransactionLookup(
  choice: LookupChoice,
  call?: GrpcCall,
): TransactionLookup {
  const explorer = choice.explorerUrl?.trim();

  if (explorer !== undefined && explorer !== "") {
    const lookup = createChainLookup({ explorerUrl: explorer, timeoutMs: choice.timeoutMs });
    return { transaction: (txid) => lookup.transaction(txid), source: explorer };
  }

  const endpoint = choice.lightwalletd?.trim() || DEFAULT_LIGHTWALLETD;
  const lookup = createLightwalletdLookup({ endpoint, timeoutMs: choice.timeoutMs }, call);
  return { transaction: (txid) => lookup.transaction(txid), source: `lightwalletd ${endpoint}` };
}
