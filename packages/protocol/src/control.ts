import { randomBytes } from "node:crypto";

import type { Attestation } from "./attestation.js";

/**
 * The control plane is where a worker proves who it is and is told what to
 * mine. Stratum carries only work, because it has no room for either.
 */

/**
 * Stratum logins are a flat namespace, so the token says what it is. The
 * alphabet is base64url, which is already legal in a login, and the prefix
 * carries no dot so a token can never be mistaken for a user.worker pair.
 */
export const SESSION_TOKEN_PREFIX = "zgt_";

const SESSION_TOKEN_BYTES = 32;

export function issueSessionToken(): string {
  return SESSION_TOKEN_PREFIX + randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function isSessionToken(login: string): boolean {
  return login.startsWith(SESSION_TOKEN_PREFIX);
}

export const CHALLENGE_BYTES = 32;

export function issueChallengeNonce(): string {
  return randomBytes(CHALLENGE_BYTES).toString("base64url");
}

/* Worker -> orchestrator */

export interface HelloMessage {
  readonly type: "hello";
  readonly publicKey: string;
  readonly accountId: string;
  readonly agentVersion: string;
}

export interface AttestMessage {
  readonly type: "attest";
  readonly attestation: Attestation;
  readonly signature: string;
}

export interface HeartbeatMessage {
  readonly type: "heartbeat";
  /** The worker's own view of its rate. A UX number, never a payout input. */
  readonly reportedHashrate: number;
}

export type WorkerMessage = HelloMessage | AttestMessage | HeartbeatMessage;

/* Orchestrator -> worker */

export interface ChallengeMessage {
  readonly type: "challenge";
  readonly nonce: string;
  /** Unix seconds. The nonce is single-use and dies at this point regardless. */
  readonly expiresAt: number;
}

export interface SessionMessage {
  readonly type: "session";
  /** What the worker authorizes with over stratum, in place of a name. */
  readonly token: string;
  readonly expiresAt: number;
  /** Where to point the miner. */
  readonly stratumHost: string;
  readonly stratumPort: number;
}

export interface RejectMessage {
  readonly type: "reject";
  readonly reason: RejectReason;
}

export type RejectReason =
  | "unknown-account"
  | "unknown-key"
  | "bad-signature"
  | "stale-attestation"
  | "unknown-challenge"
  | "malformed";

export type OrchestratorMessage =
  | ChallengeMessage
  | SessionMessage
  | RejectMessage;

/**
 * How far an attestation's own timestamp may sit from the orchestrator's
 * clock. The nonce already makes a replay useless; this bounds how long a
 * signature captured off a compromised machine stays spendable, and leaves
 * room for the clock skew a home machine actually has.
 */
export const ATTESTATION_MAX_AGE_SECONDS = 120;
