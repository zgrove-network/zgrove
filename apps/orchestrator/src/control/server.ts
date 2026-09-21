import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { Registry } from "@zgrove/db";
import {
  ATTESTATION_MAX_AGE_SECONDS,
  isSolanaAddress,
  verifyAttestation,
  verifySolanaBinding,
  type Attestation,
  type OrchestratorMessage,
  type RejectReason,
  type SolanaBinding,
} from "@zgrove/protocol";

import { log } from "../log.js";
import type { ChallengeStore } from "./challenges.js";
import type { SessionStore } from "./sessions.js";

export interface ControlServerOptions {
  readonly host: string;
  readonly port: number;
  readonly maxBodyBytes: number;
  /** Where a worker should point its miner once it holds a token. */
  readonly stratumHost: string;
  readonly stratumPort: number;
}

export interface ControlServerDeps {
  readonly challenges: ChallengeStore;
  readonly sessions: SessionStore;
  readonly registry: Registry;
  readonly now: () => number;
}

/**
 * The attestation exchange is strictly request and response, so it is HTTP
 * rather than a socket. The persistent control-plane connection belongs with
 * assignment and heartbeat, which do push, and neither exists yet.
 *
 * This carries a bearer token in its responses, so it belongs behind TLS
 * anywhere real. It binds loopback by default so putting it in front of the
 * internet is a step somebody takes on purpose.
 */
export function createControlServer(
  options: ControlServerOptions,
  deps: ControlServerDeps,
): Server {
  return createServer((request, response) => {
    handle(request, response, options, deps).catch((error: unknown) => {
      log("error", "control.handler_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      send(response, 500, { type: "reject", reason: "malformed" });
    });
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: ControlServerOptions,
  deps: ControlServerDeps,
): Promise<void> {
  if (request.method !== "POST") {
    send(response, 405, { type: "reject", reason: "malformed" });
    return;
  }

  const body = await readJsonBody(request, options.maxBodyBytes);
  if (body === null) {
    send(response, 400, { type: "reject", reason: "malformed" });
    return;
  }

  switch (request.url) {
    case "/v1/challenge":
      handleChallenge(body, response, deps);
      return;
    case "/v1/attest":
      handleAttest(body, response, options, deps);
      return;
    case "/v1/bind-wallet":
      handleBindWallet(body, response, deps);
      return;
    default:
      send(response, 404, { type: "reject", reason: "malformed" });
  }
}

function handleChallenge(
  body: Record<string, unknown>,
  response: ServerResponse,
  deps: ControlServerDeps,
): void {
  const publicKey = body["publicKey"];
  if (typeof publicKey !== "string" || publicKey.length === 0) {
    send(response, 400, { type: "reject", reason: "malformed" });
    return;
  }

  // Issued to anyone who asks. A challenge grants nothing on its own, and
  // refusing unknown keys here would turn this into an oracle for which keys
  // are registered.
  const challenge = deps.challenges.issue(publicKey, deps.now());
  send(response, 200, {
    type: "challenge",
    nonce: challenge.nonce,
    expiresAt: challenge.expiresAt,
  });
}

function handleAttest(
  body: Record<string, unknown>,
  response: ServerResponse,
  options: ControlServerOptions,
  deps: ControlServerDeps,
): void {
  const attestation = readAttestation(body["attestation"]);
  const signature = body["signature"];

  if (attestation === null || typeof signature !== "string") {
    send(response, 400, { type: "reject", reason: "malformed" });
    return;
  }

  const now = deps.now();

  // Spent first, so a failure below costs the caller a fresh round trip
  // rather than another attempt against the same nonce.
  if (!deps.challenges.consume(attestation.nonce, attestation.publicKey, now)) {
    reject(response, "unknown-challenge", attestation);
    return;
  }

  if (Math.abs(now - attestation.issuedAt) > ATTESTATION_MAX_AGE_SECONDS) {
    reject(response, "stale-attestation", attestation);
    return;
  }

  if (!verifyAttestation(attestation, signature)) {
    reject(response, "bad-signature", attestation);
    return;
  }

  const binding = deps.registry.findWorkerKey(attestation.publicKey);
  if (binding === null) {
    reject(response, "unknown-key", attestation);
    return;
  }

  // The signature proves the key. It does not prove the account the message
  // claims, so the binding on record decides, and a mismatch is refused
  // rather than silently resolved in the record's favour.
  if (binding.accountId !== attestation.accountId) {
    reject(response, "unknown-account", attestation);
    return;
  }

  deps.registry.touchWorkerKey(attestation.publicKey, now);
  const session = deps.sessions.issue(binding, now);

  log("info", "control.session_issued", {
    account: binding.accountId,
    worker: binding.workerId,
  });

  send(response, 200, {
    type: "session",
    token: session.token,
    expiresAt: session.expiresAt,
    stratumHost: options.stratumHost,
    stratumPort: options.stratumPort,
  });
}

/**
 * Binds a Solana wallet to an account, so the wallet's balance can decide the
 * account's fee tier. Same shape as a worker attestation and the same reason
 * for it: a wallet nobody signs for is a discount anyone can take by typing a
 * richer address.
 */
function handleBindWallet(
  body: Record<string, unknown>,
  response: ServerResponse,
  deps: ControlServerDeps,
): void {
  const binding = readBinding(body["binding"]);
  const signature = body["signature"];

  if (binding === null || typeof signature !== "string") {
    send(response, 400, { type: "reject", reason: "malformed" });
    return;
  }

  const now = deps.now();

  // Spent first, as with an attestation: a nonce that survives a failed
  // attempt can be attacked repeatedly.
  if (!deps.challenges.consume(binding.nonce, binding.solanaAddress, now)) {
    send(response, 401, { type: "reject", reason: "unknown-challenge" });
    return;
  }

  if (Math.abs(now - binding.issuedAt) > ATTESTATION_MAX_AGE_SECONDS) {
    send(response, 401, { type: "reject", reason: "stale-attestation" });
    return;
  }

  if (!isSolanaAddress(binding.solanaAddress)) {
    send(response, 400, { type: "reject", reason: "malformed" });
    return;
  }

  if (!verifySolanaBinding(binding, signature)) {
    send(response, 401, { type: "reject", reason: "bad-signature" });
    return;
  }

  if (deps.registry.findAccount(binding.accountId) === null) {
    send(response, 401, { type: "reject", reason: "unknown-account" });
    return;
  }

  deps.registry.bindSolanaAddress(binding.accountId, binding.solanaAddress, now);
  log("info", "control.wallet_bound", { account: binding.accountId });

  send(response, 200, {
    type: "bound",
    accountId: binding.accountId,
    solanaAddress: binding.solanaAddress,
  });
}

function readBinding(value: unknown): SolanaBinding | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const nonce = record["nonce"];
  const accountId = record["accountId"];
  const solanaAddress = record["solanaAddress"];
  const issuedAt = record["issuedAt"];

  if (
    typeof nonce !== "string" ||
    typeof accountId !== "string" ||
    typeof solanaAddress !== "string" ||
    typeof issuedAt !== "number" ||
    !Number.isFinite(issuedAt)
  ) {
    return null;
  }

  return { nonce, accountId, solanaAddress, issuedAt };
}

/**
 * Reasons are specific rather than collapsed into one. Public keys and
 * account ids are not secrets, so nothing is revealed by saying which check
 * failed, and a worker that cannot be told why it was refused is a worker
 * whose owner opens an issue instead of fixing their setup.
 */
function reject(
  response: ServerResponse,
  reason: RejectReason,
  attestation: Attestation,
): void {
  log("warn", "control.attestation_rejected", {
    reason,
    account: attestation.accountId,
  });
  send(response, 401, { type: "reject", reason });
}

function readAttestation(value: unknown): Attestation | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const nonce = record["nonce"];
  const accountId = record["accountId"];
  const publicKey = record["publicKey"];
  const issuedAt = record["issuedAt"];

  if (
    typeof nonce !== "string" ||
    typeof accountId !== "string" ||
    typeof publicKey !== "string" ||
    typeof issuedAt !== "number" ||
    !Number.isFinite(issuedAt)
  ) {
    return null;
  }

  return { nonce, accountId, publicKey, issuedAt };
}

/** Null for anything unusable, including a body that runs past the ceiling. */
async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown> | null> {
  let size = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > maxBytes) {
      // Stop reading rather than finish and then complain: the point of the
      // ceiling is not to hold the whole body in the first place.
      request.destroy();
      return null;
    }
    chunks.push(buffer);
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function send(
  response: ServerResponse,
  status: number,
  message: OrchestratorMessage,
): void {
  const body = JSON.stringify(message);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    // Nothing here is cacheable and one of them is a bearer token.
    "cache-control": "no-store",
  });
  response.end(body);
}
