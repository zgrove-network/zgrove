import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeBase58, encodeBase58 } from "../base58.js";
import { generateWorkerKeyPair, signAttestation } from "../attestation.js";
import {
  SOLANA_BINDING_DOMAIN,
  encodeSolanaBinding,
  isSolanaAddress,
  verifySolanaBinding,
  type SolanaBinding,
} from "../solana-binding.js";
import { sign } from "node:crypto";

/** Solana addresses are base58 ed25519 public keys, so a worker keypair
 * stands in for a wallet in these tests. */
function walletFrom(keys: ReturnType<typeof generateWorkerKeyPair>): string {
  return encodeBase58(Buffer.from(keys.publicKey, "base64url"));
}

function bindingFor(address: string, nonce = "nonce-1"): SolanaBinding {
  return {
    nonce,
    accountId: "acct_contributor",
    solanaAddress: address,
    issuedAt: 1_758_400_000,
  };
}

test("base58 round-trips, including leading zeroes", () => {
  for (const hex of ["00", "0000ff", "deadbeef", "00".repeat(32), "ff".repeat(32)]) {
    const bytes = Buffer.from(hex, "hex");
    assert.equal(
      Buffer.from(decodeBase58(encodeBase58(bytes))).toString("hex"),
      hex,
    );
  }

  // A known Solana address: the USDC mint. 32 bytes when decoded.
  assert.equal(decodeBase58("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v").length, 32);
  assert.throws(() => decodeBase58("0OIl"), /Not base58/);
});

test("a wallet that signs the challenge is bound", () => {
  const keys = generateWorkerKeyPair();
  const binding = bindingFor(walletFrom(keys));

  const signature = sign(
    null,
    encodeSolanaBinding(binding),
    keys.privateKeyPem,
  ).toString("base64url");

  assert.equal(verifySolanaBinding(binding, signature), true);
});

test("claiming somebody else's wallet fails", () => {
  const mine = generateWorkerKeyPair();
  const theirs = generateWorkerKeyPair();

  // The address of a wallet I do not hold, signed with the one I do. This is
  // the whole attack: a fee tier taken by typing a richer address.
  const binding = bindingFor(walletFrom(theirs));
  const signature = sign(null, encodeSolanaBinding(binding), mine.privateKeyPem).toString(
    "base64url",
  );

  assert.equal(verifySolanaBinding(binding, signature), false);
});

test("a binding is tied to its challenge and its account", () => {
  const keys = generateWorkerKeyPair();
  const address = walletFrom(keys);
  const binding = bindingFor(address);
  const signature = sign(null, encodeSolanaBinding(binding), keys.privateKeyPem).toString(
    "base64url",
  );

  assert.equal(verifySolanaBinding(bindingFor(address, "other-nonce"), signature), false);
  assert.equal(
    verifySolanaBinding({ ...binding, accountId: "acct_someone_else" }, signature),
    false,
  );
});

test("a worker attestation does not verify as a wallet binding", () => {
  const keys = generateWorkerKeyPair();
  const address = walletFrom(keys);

  // Different domains, so a signature gathered for one purpose cannot be
  // replayed into the other even though the key and curve are the same.
  const attestation = {
    nonce: "nonce-1",
    accountId: "acct_contributor",
    publicKey: keys.publicKey,
    issuedAt: 1_758_400_000,
  };
  const signature = signAttestation(attestation, keys.privateKeyPem);

  assert.equal(verifySolanaBinding(bindingFor(address), signature), false);
  assert.ok(
    encodeSolanaBinding(bindingFor(address)).toString("utf8").startsWith(SOLANA_BINDING_DOMAIN),
  );
});

test("garbled input is false, and a non-address is recognised", () => {
  const keys = generateWorkerKeyPair();
  assert.equal(verifySolanaBinding(bindingFor(walletFrom(keys)), "nope"), false);
  assert.equal(verifySolanaBinding(bindingFor("not-an-address"), "AAAA"), false);

  assert.equal(isSolanaAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), true);
  assert.equal(isSolanaAddress("too-short"), false);
});
