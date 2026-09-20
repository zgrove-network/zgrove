import { createPrivateKey, createPublicKey } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  encodePublicKey,
  generateWorkerKeyPair,
  type WorkerKeyPair,
} from "@zgrove/protocol";

/** Owner read/write only. The private key is the rig's whole identity. */
const KEY_FILE_MODE = 0o600;

export function defaultKeyPath(): string {
  return join(homedir(), ".zgrove", "worker.key");
}

export function loadKeyPair(path: string): WorkerKeyPair | null {
  let pem: string;
  try {
    pem = readFileSync(path, "utf8");
  } catch {
    return null;
  }

  // Refused rather than repaired, the way ssh refuses a loose key file. A
  // private key other accounts on the box can read is one they can mine under,
  // and silently tightening the mode would hide that it had been readable.
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `${path} is readable by others (mode ${mode.toString(8)}). Run: chmod 600 ${path}`,
    );
  }

  return {
    publicKey: publicKeyFromPrivate(pem),
    privateKeyPem: pem,
  };
}

/** Creates the key on first run and never overwrites an existing one. */
export function loadOrCreateKeyPair(path: string): WorkerKeyPair {
  const existing = loadKeyPair(path);
  if (existing !== null) {
    return existing;
  }

  const keys = generateWorkerKeyPair();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  // Written with the mode in place, not tightened afterwards: between a
  // default-mode create and a chmod there is a window where the key is
  // readable, and it only has to be lost once.
  writeFileSync(path, keys.privateKeyPem, { mode: KEY_FILE_MODE, flag: "wx" });
  chmodSync(path, KEY_FILE_MODE);

  return keys;
}

/** Derived from the private key rather than stored beside it, so the two can
 * never disagree about which rig this is. */
function publicKeyFromPrivate(privateKeyPem: string): string {
  return encodePublicKey(createPublicKey(createPrivateKey(privateKeyPem)));
}
