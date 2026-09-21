import { verify } from "node:crypto";

import { decodeBase58 } from "./base58.js";
import { decodePublicKey } from "./attestation.js";

/**
 * Binds a zGrove account to a Solana wallet, so the wallet's token balance
 * can decide the account's fee tier.
 *
 * A binding nobody signs is a discount anyone can take by typing somebody
 * else's address. A Solana address is a base58 Ed25519 public key, the same
 * curve the worker keys use, so the proof is the same shape: sign a challenge
 * the orchestrator chose, under a domain of its own.
 */
export const SOLANA_BINDING_DOMAIN = "zgrove-solana-binding";
export const SOLANA_BINDING_VERSION = "v1";

const SAFE_FIELD = /^[A-Za-z0-9._:-]{1,128}$/;
const SOLANA_KEY_BYTES = 32;

export interface SolanaBinding {
  readonly nonce: string;
  readonly accountId: string;
  /** Base58, as Solana writes it. */
  readonly solanaAddress: string;
  readonly issuedAt: number;
}

export function encodeSolanaBinding(binding: SolanaBinding): Buffer {
  const fields = [
    SOLANA_BINDING_DOMAIN,
    SOLANA_BINDING_VERSION,
    binding.nonce,
    binding.accountId,
    binding.solanaAddress,
    String(binding.issuedAt),
  ];

  for (const field of fields) {
    if (!SAFE_FIELD.test(field)) {
      throw new Error(`Binding field is not safe to encode: ${field}`);
    }
  }

  return Buffer.from(fields.join("\n"), "utf8");
}

/** False for every failure, including a malformed address or signature. */
export function verifySolanaBinding(
  binding: SolanaBinding,
  signature: string,
): boolean {
  try {
    const raw = decodeBase58(binding.solanaAddress);
    if (raw.length !== SOLANA_KEY_BYTES) {
      return false;
    }

    return verify(
      null,
      encodeSolanaBinding(binding),
      decodePublicKey(Buffer.from(raw).toString("base64url")),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

/** True when the text is a well-formed Solana address. */
export function isSolanaAddress(text: string): boolean {
  try {
    return decodeBase58(text).length === SOLANA_KEY_BYTES;
  } catch {
    return false;
  }
}
