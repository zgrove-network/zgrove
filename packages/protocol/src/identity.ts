/**
 * The stratum login is the only worker identity the proxy ever receives.
 * Miners send it once in mining.authorize and repeat it on every submit, and
 * it is the key every accepted share is attributed to — which makes it the
 * key that eventually decides who gets paid. It has to be canonical: one
 * worker, one spelling, one row.
 */

export interface WorkerIdentity {
  /** Everything before the first dot. In practice an upstream pool account. */
  readonly username: string;
  readonly workerName: string;
  /** Canonical `username.workerName`, the form accounting stores. */
  readonly login: string;
}

export type IdentityRejection =
  | "not-a-string"
  | "empty"
  | "too-long"
  | "illegal-character"
  | "empty-username"
  | "empty-worker-name"
  /** The login was a session token, and it is not live. */
  | "unknown-token"
  /** A plain name was sent and this deployment does not accept them. */
  | "legacy-login-disabled"
  /** The account has enrolled keys, so its name alone no longer claims it. */
  | "account-requires-attestation";

export type ParsedLogin =
  | { readonly ok: true; readonly identity: WorkerIdentity }
  | { readonly ok: false; readonly reason: IdentityRejection };

/** Miners that omit the worker half still need somewhere to be counted. */
export const DEFAULT_WORKER_NAME = "default";

export const MAX_LOGIN_LENGTH = 256;
export const MAX_USERNAME_LENGTH = 128;
export const MAX_WORKER_NAME_LENGTH = 64;

/**
 * Deliberately narrow. The login is attacker-controlled and every distinct
 * one becomes a row, so anything outside this set is rejected rather than
 * stripped: sanitising would map two different logins onto one identity.
 */
const LEGAL_LOGIN = /^[A-Za-z0-9._-]+$/;

/**
 * Rejects instead of repairing, and says why, so the caller can answer a real
 * stratum error rather than silently inventing an identity to credit.
 */
export function parseWorkerLogin(raw: unknown): ParsedLogin {
  if (typeof raw !== "string") {
    return { ok: false, reason: "not-a-string" };
  }

  const login = raw.trim();
  if (login.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (login.length > MAX_LOGIN_LENGTH) {
    return { ok: false, reason: "too-long" };
  }
  if (!LEGAL_LOGIN.test(login)) {
    return { ok: false, reason: "illegal-character" };
  }

  // First dot, not last: wallet addresses carry no dot, while rig names
  // sometimes do ("addr.rig.gpu0" is one worker called "rig.gpu0").
  const separator = login.indexOf(".");
  const username = separator === -1 ? login : login.slice(0, separator);
  const workerName =
    separator === -1 ? DEFAULT_WORKER_NAME : login.slice(separator + 1);

  if (username.length === 0) {
    return { ok: false, reason: "empty-username" };
  }
  if (workerName.length === 0) {
    return { ok: false, reason: "empty-worker-name" };
  }
  if (username.length > MAX_USERNAME_LENGTH) {
    return { ok: false, reason: "too-long" };
  }
  if (workerName.length > MAX_WORKER_NAME_LENGTH) {
    return { ok: false, reason: "too-long" };
  }

  return {
    ok: true,
    identity: { username, workerName, login: `${username}.${workerName}` },
  };
}

/** True when two logins name the same worker. Case is significant. */
export function sameWorker(a: WorkerIdentity, b: WorkerIdentity): boolean {
  return a.username === b.username && a.workerName === b.workerName;
}
