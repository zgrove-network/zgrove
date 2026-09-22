import { sign, type KeyObject } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

import { decodeBase58, encodeBase58, privateKeyFromSeed } from "@zgrove/protocol";

/**
 * Writes a round's commitment into a Solana memo.
 *
 * A receipt is a file the operator publishes, and a file can be replaced. A
 * memo gives the commitment a timestamp nobody here controls: if a receipt
 * ever disagrees with the memo written when the round was paid, the receipt
 * was changed afterwards. It costs one signature's fee and reveals nothing the
 * receipt does not already show.
 *
 * Built by hand rather than through @solana/web3.js. One legacy transaction
 * with one instruction is a few dozen bytes of well-specified layout, and
 * pulling a large dependency into the process that also holds payout records
 * to produce them is a poor trade. The layout is checked against a live node
 * by simulation, which costs nothing.
 */

/** The SPL Memo program, v2. */
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** Solana's base fee is per signature, and this transaction carries one. */
export const LAMPORTS_PER_SIGNATURE = 5_000;

export interface SolanaKey {
  readonly address: string;
  readonly publicKey: Uint8Array;
  readonly privateKey: KeyObject;
}

/**
 * Reads a keypair in the Solana CLI's format: a JSON array of 64 bytes, the
 * secret seed followed by the public key. Refused if other accounts on the
 * machine can read it, for the same reason the worker refuses a loose key: a
 * key that has been readable may already have been copied, and tightening it
 * quietly would hide that.
 */
export function loadSolanaKeypair(path: string): SolanaKey {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `${path} is readable by others (mode ${mode.toString(8)}). ` +
        "Assume it may have been copied; use a fresh keypair and chmod 600 it.",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} is not a Solana keypair file`);
  }
  if (
    !Array.isArray(raw) ||
    raw.length !== 64 ||
    raw.some((b) => !Number.isInteger(b) || b < 0 || b > 255)
  ) {
    throw new Error(`${path} is not a Solana keypair file (expected 64 bytes)`);
  }

  const bytes = Uint8Array.from(raw as number[]);
  const seed = bytes.subarray(0, 32);
  const claimed = bytes.subarray(32, 64);
  const privateKey = privateKeyFromSeed(seed);

  // The public half is stored, not derived, so a file can be corrupted into a
  // pair that does not match. Signing with one key while believing it is
  // another would anchor under an address nobody expects.
  const derived = Buffer.from(
    privateKey.export({ format: "jwk" }).x ?? "",
    "base64url",
  );
  if (!derived.equals(Buffer.from(claimed))) {
    throw new Error(`${path}: the public key does not match the secret`);
  }

  return { address: encodeBase58(claimed), publicKey: Uint8Array.from(claimed), privateKey };
}

/** Self-describing, so anyone reading it on an explorer knows what it is. */
export function memoFor(round: number, commitment: string, zcashTxid: string): string {
  return `zgrove round ${round} commitment ${commitment} zcash ${zcashTxid}`;
}

/** Solana's compact-u16: seven bits a byte, high bit set while more follow. */
export function shortvec(n: number): number[] {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
    throw new Error(`shortvec takes 0..65535, got ${n}`);
  }
  const out: number[] = [];
  let rest = n;
  for (;;) {
    const low = rest & 0x7f;
    rest >>= 7;
    if (rest === 0) {
      out.push(low);
      return out;
    }
    out.push(low | 0x80);
  }
}

export interface SignedTransaction {
  /** The whole transaction, ready to send. */
  readonly wire: Uint8Array;
  /** The part that was signed. */
  readonly message: Uint8Array;
  /** Base58 of the signature, which on Solana is the transaction's id. */
  readonly signature: string;
}

/**
 * One legacy transaction, one instruction.
 *
 *   accounts   [fee payer — writable signer, memo program — readonly]
 *   header     [1 signature, 0 readonly signed, 1 readonly unsigned]
 *   memo       program index 1, account list [0], data = the memo bytes
 *
 * The payer is listed on the instruction too. Memo v2 checks that every
 * account it is given signed, so the memo is recorded as signed by the pool's
 * key rather than merely paid for by it.
 */
export function buildMemoTransaction(
  key: SolanaKey,
  memo: string,
  recentBlockhash: string,
): SignedTransaction {
  const blockhash = decodeBase58(recentBlockhash);
  if (blockhash.length !== 32) {
    throw new Error("a recent blockhash is 32 bytes");
  }
  const program = decodeBase58(MEMO_PROGRAM);
  const data = Buffer.from(memo, "utf8");

  const message = Uint8Array.from([
    1, 0, 1,
    ...shortvec(2),
    ...key.publicKey,
    ...program,
    ...blockhash,
    ...shortvec(1),
    1,
    ...shortvec(1),
    0,
    ...shortvec(data.length),
    ...data,
  ]);

  const signature = sign(null, message, key.privateKey);
  const wire = Uint8Array.from([...shortvec(1), ...signature, ...message]);

  // Legacy transactions are capped at one packet.
  if (wire.length > 1232) {
    throw new Error(`transaction is ${wire.length} bytes; the limit is 1232`);
  }

  return { wire, message, signature: encodeBase58(signature) };
}

export interface Simulation {
  /** Null when the node accepted it; otherwise what it objected to. */
  readonly error: unknown;
  readonly logs: readonly string[];
}

export interface SolanaRpc {
  latestBlockhash(): Promise<string>;
  balance(address: string): Promise<number>;
  simulate(wire: Uint8Array): Promise<Simulation>;
  send(wire: Uint8Array): Promise<string>;
  /** Null until the node has seen it; then its confirmation level. */
  status(signature: string): Promise<string | null>;
  /** The program logs of a landed transaction, or null if there is none. */
  logs(signature: string): Promise<readonly string[] | null>;
}

export function createSolanaRpc(
  url: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): SolanaRpc {
  let id = 0;

  async function call<T>(method: string, params: unknown[]): Promise<T> {
    id += 1;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
    const body = (await response.json()) as { result?: T; error?: { message?: string } };
    if (body.error !== undefined) {
      throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
    }
    return body.result as T;
  }

  const b64 = (wire: Uint8Array) => Buffer.from(wire).toString("base64");

  return {
    async latestBlockhash() {
      const r = await call<{ value: { blockhash: string } }>("getLatestBlockhash", [
        { commitment: "finalized" },
      ]);
      return r.value.blockhash;
    },
    async balance(address) {
      const r = await call<{ value: number }>("getBalance", [address, { commitment: "confirmed" }]);
      return r.value;
    },
    async simulate(wire) {
      const r = await call<{ value: { err: unknown; logs: string[] | null } }>(
        "simulateTransaction",
        [b64(wire), { encoding: "base64", sigVerify: true, commitment: "confirmed" }],
      );
      return { error: r.value.err, logs: r.value.logs ?? [] };
    },
    async send(wire) {
      return call<string>("sendTransaction", [
        b64(wire),
        { encoding: "base64", preflightCommitment: "confirmed" },
      ]);
    },
    async logs(signature) {
      const r = await call<{ meta: { logMessages: string[] | null; err: unknown } | null } | null>(
        "getTransaction",
        [signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }],
      );
      if (r === null || r.meta === null || r.meta.err !== null) return null;
      return r.meta.logMessages ?? [];
    },
    async status(signature) {
      const r = await call<{ value: ({ confirmationStatus?: string } | null)[] }>(
        "getSignatureStatuses",
        [[signature], { searchTransactionHistory: true }],
      );
      return r.value[0]?.confirmationStatus ?? null;
    },
  };
}
