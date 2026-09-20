import {
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

/**
 * A worker proves it holds the key its account was registered with by signing
 * a challenge the orchestrator chose. Ed25519 because it is in node:crypto,
 * needs no parameters to get wrong, and produces a 64-byte signature.
 */

/** The fixed DER header on an Ed25519 SPKI key; the 32 raw bytes follow it. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const RAW_PUBLIC_KEY_BYTES = 32;

/**
 * Prefixed so a signature made for one purpose can never verify for another.
 * Anything else this project signs later gets its own domain, and the version
 * is here so a change to the field list is a different message rather than an
 * ambiguous one.
 */
export const ATTESTATION_DOMAIN = "zgrove-worker-attest";
export const ATTESTATION_VERSION = "v1";

/** Signing material has to be unambiguous, so every field is charset-limited
 * and no field can contain the separator. */
const SAFE_FIELD = /^[A-Za-z0-9._:-]{1,256}$/;

export interface Attestation {
  /** The orchestrator's single-use challenge. */
  readonly nonce: string;
  readonly accountId: string;
  /** The worker's public key, as text, bound into what it signs. */
  readonly publicKey: string;
  /** Unix seconds, so a captured attestation stops being useful. */
  readonly issuedAt: number;
}

export interface WorkerKeyPair {
  /** Identity. Safe to log, safe to put in a stratum login. */
  readonly publicKey: string;
  /** PKCS#8 PEM, for a file the contributor's machine keeps to itself. */
  readonly privateKeyPem: string;
}

export function generateWorkerKeyPair(): WorkerKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: encodePublicKey(publicKey),
    privateKeyPem: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  };
}

/** Raw 32 bytes in base64url: short, and legal in a stratum login. */
export function encodePublicKey(key: KeyObject): string {
  const der = key.export({ type: "spki", format: "der" });
  return der.subarray(SPKI_PREFIX.length).toString("base64url");
}

export function decodePublicKey(text: string): KeyObject {
  const raw = Buffer.from(text, "base64url");
  if (raw.length !== RAW_PUBLIC_KEY_BYTES) {
    throw new Error(
      `Public key must be ${RAW_PUBLIC_KEY_BYTES} bytes, got ${raw.length}`,
    );
  }
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

/**
 * The exact bytes both sides sign and check. Built in one place because a
 * verifier that encodes even slightly differently from the signer rejects
 * every honest worker, and one that is laxer than the signer accepts a
 * forgery.
 */
export function encodeAttestation(attestation: Attestation): Buffer {
  const fields = [
    ATTESTATION_DOMAIN,
    ATTESTATION_VERSION,
    attestation.nonce,
    attestation.accountId,
    attestation.publicKey,
    String(attestation.issuedAt),
  ];

  for (const field of fields) {
    if (!SAFE_FIELD.test(field)) {
      // A field carrying the separator could move the boundary between two
      // fields and make one attestation encode identically to another.
      throw new Error(`Attestation field is not safe to encode: ${field}`);
    }
  }

  return Buffer.from(fields.join("\n"), "utf8");
}

export function signAttestation(
  attestation: Attestation,
  privateKeyPem: string,
): string {
  return sign(null, encodeAttestation(attestation), privateKeyPem).toString(
    "base64url",
  );
}

/** False for every failure, so a caller cannot mistake a thrown error for a
 * pass or have to tell the failures apart to stay safe. */
export function verifyAttestation(
  attestation: Attestation,
  signature: string,
): boolean {
  try {
    return verify(
      null,
      encodeAttestation(attestation),
      decodePublicKey(attestation.publicKey),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}
