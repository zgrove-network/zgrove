import type { Registry } from "@zgrove/db";
import {
  isSessionToken,
  parseWorkerLogin,
  type ParsedLogin,
} from "@zgrove/protocol";

import type { SessionStore } from "./control/sessions.js";

export interface LoginResolverDeps {
  readonly sessions: SessionStore;
  readonly registry: Registry;
  /**
   * Whether a plain `user.worker` name still authorizes. Off by default. It
   * exists so a deployment already carrying workers can migrate them, and it
   * is expected to be turned off again once they are all attesting.
   */
  readonly allowLegacyLogin: boolean;
  readonly now: () => number;
}

/**
 * A login is either a live session token, which names a worker that proved
 * itself, or a plain name, which names one that merely claimed to be.
 */
export function createLoginResolver(
  deps: LoginResolverDeps,
): (raw: unknown) => ParsedLogin {
  return (raw) => {
    if (typeof raw === "string" && isSessionToken(raw)) {
      const session = deps.sessions.resolve(raw, deps.now());
      if (session === null) {
        return { ok: false, reason: "unknown-token" };
      }
      return {
        ok: true,
        identity: {
          username: session.accountId,
          workerName: session.workerName,
          login: `${session.accountId}.${session.workerName}`,
        },
      };
    }

    if (!deps.allowLegacyLogin) {
      return { ok: false, reason: "legacy-login-disabled" };
    }

    const parsed = parseWorkerLogin(raw);
    if (!parsed.ok) {
      return parsed;
    }

    // The rule the identity work exists for: an account that can still be
    // claimed by typing its name gains nothing from also being able to prove
    // itself. Once a rig is enrolled under an account, the account's name
    // stops being a credential — even while the legacy path is open for
    // accounts still migrating.
    if (deps.registry.hasEnrolledKeys(parsed.identity.username)) {
      return { ok: false, reason: "account-requires-attestation" };
    }

    return parsed;
  };
}
