import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { decodeBase58, encodeBase58 } from "@zgrove/protocol";

import {
  MEMO_PROGRAM,
  buildMemoTransaction,
  loadSolanaKeypair,
  memoFor,
  shortvec,
  type SolanaKey,
} from "../wallet/solana-memo.js";

/** A keypair file in the Solana CLI's own layout: seed then public key. */
function keypairFile(mode = 0o600, corrupt = false): string {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = Buffer.from(privateKey.export({ format: "jwk" }).d ?? "", "base64url");
  const pub = Buffer.from(publicKey.export({ format: "jwk" }).x ?? "", "base64url");
  if (corrupt) pub[0] = (pub[0] ?? 0) ^ 0xff;
  const path = join(mkdtempSync(join(tmpdir(), "zgrove-sol-")), "id.json");
  writeFileSync(path, JSON.stringify([...seed, ...pub]), { mode });
  return path;
}

const BLOCKHASH = encodeBase58(Uint8Array.from({ length: 32 }, (_, i) => i + 1));

/** Reads a legacy transaction back into its parts. */
function decode(wire: Uint8Array) {
  let at = 0;
  const vec = () => {
    let n = 0;
    let shift = 0;
    for (;;) {
      const b = wire[at++] ?? 0;
      n |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return n;
      shift += 7;
    }
  };
  const take = (n: number) => wire.slice(at, (at += n));

  const sigCount = vec();
  const signatures = Array.from({ length: sigCount }, () => take(64));
  const messageStart = at;
  const header = [...take(3)];
  const keys = Array.from({ length: vec() }, () => take(32));
  const blockhash = take(32);
  const instructions = Array.from({ length: vec() }, () => {
    const program = wire[at++] ?? 0;
    const accounts = [...take(vec())];
    const data = take(vec());
    return { program, accounts, data };
  });
  return { signatures, message: wire.slice(messageStart), header, keys, blockhash, instructions, rest: wire.length - at };
}

test("compact-u16 lengths encode the way Solana reads them", () => {
  assert.deepEqual(shortvec(0), [0x00]);
  assert.deepEqual(shortvec(0x7f), [0x7f]);
  assert.deepEqual(shortvec(0x80), [0x80, 0x01]);
  assert.deepEqual(shortvec(0x3fff), [0xff, 0x7f]);
  assert.deepEqual(shortvec(0x4000), [0x80, 0x80, 0x01]);
  assert.throws(() => shortvec(-1));
});

test("the transaction is one memo, signed by the pool's key, laid out as the node expects", () => {
  const key: SolanaKey = loadSolanaKeypair(keypairFile());
  const memo = memoFor(7, "ab".repeat(32), "cd".repeat(32));
  const tx = buildMemoTransaction(key, memo, BLOCKHASH);
  const d = decode(tx.wire);

  assert.equal(d.rest, 0, "no trailing bytes");
  assert.equal(d.signatures.length, 1);

  // One required signature, nothing readonly-signed, one readonly unsigned
  // account: the memo program.
  assert.deepEqual(d.header, [1, 0, 1]);
  assert.deepEqual(Buffer.from(d.keys[0] ?? []), Buffer.from(key.publicKey), "payer first");
  assert.deepEqual(Buffer.from(d.keys[1] ?? []), Buffer.from(decodeBase58(MEMO_PROGRAM)));
  assert.deepEqual(Buffer.from(d.blockhash), Buffer.from(decodeBase58(BLOCKHASH)));

  assert.equal(d.instructions.length, 1);
  const [ix] = d.instructions;
  assert.equal(ix?.program, 1, "calls the memo program");
  assert.deepEqual(ix?.accounts, [0], "and names the payer as a signer of it");
  assert.equal(Buffer.from(ix?.data ?? []).toString("utf8"), memo);

  // The signature covers exactly the message, and is the transaction's id.
  const pub = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(key.publicKey).toString("base64url") },
    format: "jwk",
  });
  assert.ok(verify(null, d.message, pub, Buffer.from(d.signatures[0] ?? [])));
  assert.equal(tx.signature, encodeBase58(d.signatures[0] ?? new Uint8Array()));
});

test("a keypair whose two halves do not match is refused", () => {
  // Signing with one key while believing it is another would anchor under an
  // address nobody is watching.
  assert.throws(() => loadSolanaKeypair(keypairFile(0o600, true)), /does not match/);
});

test("a keypair other accounts can read is refused, not quietly tightened", () => {
  assert.throws(() => loadSolanaKeypair(keypairFile(0o644)), /readable by others/);
});

test("a memo too large for one packet is refused before anything is sent", () => {
  const key = loadSolanaKeypair(keypairFile());
  assert.throws(() => buildMemoTransaction(key, "x".repeat(1200), BLOCKHASH), /limit is 1232/);
});
