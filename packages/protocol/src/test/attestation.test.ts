import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ATTESTATION_DOMAIN,
  decodePublicKey,
  encodeAttestation,
  encodePublicKey,
  generateWorkerKeyPair,
  signAttestation,
  verifyAttestation,
  type Attestation,
} from "../attestation.js";
import {
  SESSION_TOKEN_PREFIX,
  isSessionToken,
  issueChallengeNonce,
  issueSessionToken,
} from "../control.js";
import { parseWorkerLogin } from "../identity.js";

function attestationFor(publicKey: string, nonce = issueChallengeNonce()): Attestation {
  return {
    nonce,
    accountId: "acct_01HZX",
    publicKey,
    issuedAt: 1_758_400_000,
  };
}

test("a worker's own signature verifies", () => {
  const keys = generateWorkerKeyPair();
  const attestation = attestationFor(keys.publicKey);

  const signature = signAttestation(attestation, keys.privateKeyPem);
  assert.equal(verifyAttestation(attestation, signature), true);
});

test("another key's signature does not", () => {
  const worker = generateWorkerKeyPair();
  const impostor = generateWorkerKeyPair();

  // Signed by the impostor, but claiming the worker's key.
  const attestation = attestationFor(worker.publicKey);
  const signature = signAttestation(attestation, impostor.privateKeyPem);

  assert.equal(verifyAttestation(attestation, signature), false);
});

test("a signature is bound to the challenge it answered", () => {
  const keys = generateWorkerKeyPair();
  const signature = signAttestation(
    attestationFor(keys.publicKey, "first-nonce"),
    keys.privateKeyPem,
  );

  // Replaying it against a later challenge is the whole attack this prevents.
  assert.equal(
    verifyAttestation(attestationFor(keys.publicKey, "second-nonce"), signature),
    false,
  );
});

test("changing any signed field breaks the signature", () => {
  const keys = generateWorkerKeyPair();
  const attestation = attestationFor(keys.publicKey);
  const signature = signAttestation(attestation, keys.privateKeyPem);

  assert.equal(
    verifyAttestation({ ...attestation, accountId: "acct_other" }, signature),
    false,
  );
  assert.equal(
    verifyAttestation({ ...attestation, issuedAt: attestation.issuedAt + 1 }, signature),
    false,
  );
});

test("the encoding carries its domain and cannot be split by a field", () => {
  const keys = generateWorkerKeyPair();
  const encoded = encodeAttestation(attestationFor(keys.publicKey)).toString("utf8");
  assert.ok(encoded.startsWith(`${ATTESTATION_DOMAIN}\n`));

  // A field holding the separator could shift the boundary between two fields
  // and make two different attestations encode to the same bytes.
  assert.throws(
    () =>
      encodeAttestation({
        ...attestationFor(keys.publicKey),
        accountId: "acct\nzgrove-worker-attest",
      }),
    /not safe to encode/,
  );
});

test("a garbled signature or key is a false, not a throw", () => {
  const keys = generateWorkerKeyPair();
  const attestation = attestationFor(keys.publicKey);

  // A verifier that throws on malformed input invites a caller to treat the
  // throw as something other than a failed check.
  assert.equal(verifyAttestation(attestation, "not-a-signature"), false);
  assert.equal(
    verifyAttestation({ ...attestation, publicKey: "short" }, "AAAA"),
    false,
  );
});

test("a public key survives the round trip to text", () => {
  const keys = generateWorkerKeyPair();
  assert.equal(encodePublicKey(decodePublicKey(keys.publicKey)), keys.publicKey);
  assert.throws(() => decodePublicKey("AAAA"), /32 bytes/);
});

test("a session token is legal in a stratum login and is not a name", () => {
  const token = issueSessionToken();
  assert.ok(isSessionToken(token));

  // It has to survive the login path unchanged, or the proxy never sees the
  // token it was told to expect.
  const parsed = parseWorkerLogin(token);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.identity.username, token);

  // No dot, so it can never be read as a user.worker pair.
  assert.equal(token.includes("."), false);
  assert.ok(token.startsWith(SESSION_TOKEN_PREFIX));

  assert.notEqual(issueSessionToken(), issueSessionToken());
});
