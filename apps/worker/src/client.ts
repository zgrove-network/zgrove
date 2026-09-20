import {
  ATTESTATION_MAX_AGE_SECONDS,
  signAttestation,
  type Attestation,
  type SessionMessage,
  type WorkerKeyPair,
} from "@zgrove/protocol";

export interface ControlClientOptions {
  /** Base URL of the orchestrator's control plane. */
  readonly baseUrl: string;
  readonly accountId: string;
  readonly requestTimeoutMs: number;
}

export class AttestationRefused extends Error {
  constructor(readonly reason: string) {
    super(`The orchestrator refused this worker: ${reason}`);
    this.name = "AttestationRefused";
  }
}

/**
 * Asks for a challenge, signs it, and comes back with the session token the
 * miner will log in with. Two round trips and no persistent connection,
 * because that is all the handshake is.
 */
export async function attest(
  options: ControlClientOptions,
  keys: WorkerKeyPair,
): Promise<SessionMessage> {
  const challenge = await post(options, "/v1/challenge", {
    publicKey: keys.publicKey,
  });

  const nonce = challenge["nonce"];
  if (typeof nonce !== "string") {
    throw new Error("The control plane returned no challenge");
  }

  const attestation: Attestation = {
    nonce,
    accountId: options.accountId,
    publicKey: keys.publicKey,
    // The orchestrator checks this against its own clock, so a machine whose
    // time is badly wrong is refused here rather than mining unattributed.
    issuedAt: Math.floor(Date.now() / 1000),
  };

  const session = await post(options, "/v1/attest", {
    attestation,
    signature: signAttestation(attestation, keys.privateKeyPem),
  });

  const token = session["token"];
  const stratumHost = session["stratumHost"];
  const stratumPort = session["stratumPort"];

  if (
    typeof token !== "string" ||
    typeof stratumHost !== "string" ||
    typeof stratumPort !== "number"
  ) {
    throw new Error("The control plane returned an unusable session");
  }

  return {
    type: "session",
    token,
    stratumHost,
    stratumPort,
    expiresAt: typeof session["expiresAt"] === "number" ? session["expiresAt"] : 0,
  };
}

async function post(
  options: ControlClientOptions,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${options.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.requestTimeoutMs),
  });

  const parsed = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  if (!response.ok) {
    const reason = parsed?.["reason"];
    // The orchestrator names the check that failed, and passing that through
    // is the difference between a contributor fixing their setup and a
    // contributor filing an issue.
    throw new AttestationRefused(
      typeof reason === "string" ? reason : `http ${response.status}`,
    );
  }

  if (parsed === null) {
    throw new Error("The control plane returned something that is not JSON");
  }
  return parsed;
}

/** Re-attest before the token dies, with room for a slow round trip. */
export function refreshDelayMs(session: SessionMessage, nowSeconds: number): number {
  const remaining = session.expiresAt - nowSeconds - ATTESTATION_MAX_AGE_SECONDS;
  return Math.max(30, remaining) * 1000;
}
