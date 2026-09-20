import assert from "node:assert/strict";
import type { Server } from "node:http";
import { test } from "node:test";

import { createRegistry, migrate, openDatabase } from "@zgrove/db";
import {
  SESSION_TOKEN_PREFIX,
  generateWorkerKeyPair,
  signAttestation,
  type Attestation,
} from "@zgrove/protocol";

import { createChallengeStore } from "../control/challenges.js";
import { createControlServer } from "../control/server.js";
import { createSessionStore } from "../control/sessions.js";

const ACCOUNT = "acct_contributor";
const NOW = 1_758_400_000;

interface Harness {
  readonly url: string;
  readonly keys: ReturnType<typeof generateWorkerKeyPair>;
  setNow(seconds: number): void;
  stop(): Promise<void>;
}

async function startControl(register = true): Promise<Harness> {
  const db = openDatabase(":memory:");
  migrate(db);
  const registry = createRegistry(db);
  registry.createAccount(
    { id: ACCOUNT, payoutAddress: "u1exampleshielded" },
    NOW,
  );

  const keys = generateWorkerKeyPair();
  if (register) {
    registry.registerWorkerKey({
      publicKey: keys.publicKey,
      accountId: ACCOUNT,
      workerName: "rig1",
      atSeconds: NOW,
    });
  }

  let now = NOW;
  const server: Server = createControlServer(
    {
      host: "127.0.0.1",
      port: 0,
      maxBodyBytes: 8 * 1024,
      stratumHost: "stratum.example",
      stratumPort: 3333,
    },
    {
      challenges: createChallengeStore({ ttlSeconds: 60, maxOutstanding: 16 }),
      sessions: createSessionStore({ ttlSeconds: 3600, maxSessions: 16 }),
      registry,
      now: () => now,
    },
  );

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("control server is not on a port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    keys,
    setNow(seconds) {
      now = seconds;
    },
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}

async function post(
  url: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function challengeFor(harness: Harness): Promise<string> {
  const { body } = await post(harness.url, "/v1/challenge", {
    publicKey: harness.keys.publicKey,
  });
  return body["nonce"] as string;
}

function attestationFor(harness: Harness, nonce: string, issuedAt = NOW): Attestation {
  return {
    nonce,
    accountId: ACCOUNT,
    publicKey: harness.keys.publicKey,
    issuedAt,
  };
}

test("a registered worker that signs the challenge gets a token", async () => {
  const harness = await startControl();
  try {
    const attestation = attestationFor(harness, await challengeFor(harness));
    const { status, body } = await post(harness.url, "/v1/attest", {
      attestation,
      signature: signAttestation(attestation, harness.keys.privateKeyPem),
    });

    assert.equal(status, 200);
    assert.equal(body["type"], "session");
    assert.ok((body["token"] as string).startsWith(SESSION_TOKEN_PREFIX));
    assert.equal(body["stratumPort"], 3333);
  } finally {
    await harness.stop();
  }
});

test("a challenge is spent by the first attempt, win or lose", async () => {
  const harness = await startControl();
  try {
    const nonce = await challengeFor(harness);
    const attestation = attestationFor(harness, nonce);
    const signature = signAttestation(attestation, harness.keys.privateKeyPem);

    assert.equal((await post(harness.url, "/v1/attest", { attestation, signature })).status, 200);

    // Replaying the same signed attestation is the attack this closes.
    const replay = await post(harness.url, "/v1/attest", { attestation, signature });
    assert.equal(replay.status, 401);
    assert.equal(replay.body["reason"], "unknown-challenge");
  } finally {
    await harness.stop();
  }
});

test("a challenge cannot be spent by a different key", async () => {
  const harness = await startControl();
  try {
    const stranger = generateWorkerKeyPair();
    const nonce = await challengeFor(harness);

    const attestation: Attestation = {
      nonce,
      accountId: ACCOUNT,
      publicKey: stranger.publicKey,
      issuedAt: NOW,
    };
    const { status, body } = await post(harness.url, "/v1/attest", {
      attestation,
      signature: signAttestation(attestation, stranger.privateKeyPem),
    });

    assert.equal(status, 401);
    assert.equal(body["reason"], "unknown-challenge");
  } finally {
    await harness.stop();
  }
});

test("a signature from the wrong key is refused", async () => {
  const harness = await startControl();
  try {
    const impostor = generateWorkerKeyPair();
    const attestation = attestationFor(harness, await challengeFor(harness));

    const { status, body } = await post(harness.url, "/v1/attest", {
      attestation,
      signature: signAttestation(attestation, impostor.privateKeyPem),
    });

    assert.equal(status, 401);
    assert.equal(body["reason"], "bad-signature");
  } finally {
    await harness.stop();
  }
});

test("a valid signature from an unregistered key gets no token", async () => {
  const harness = await startControl(false);
  try {
    const attestation = attestationFor(harness, await challengeFor(harness));

    // Holding a key proves only that; enrolment is a separate decision.
    const { status, body } = await post(harness.url, "/v1/attest", {
      attestation,
      signature: signAttestation(attestation, harness.keys.privateKeyPem),
    });

    assert.equal(status, 401);
    assert.equal(body["reason"], "unknown-key");
  } finally {
    await harness.stop();
  }
});

test("a worker cannot claim an account its key is not bound to", async () => {
  const harness = await startControl();
  try {
    const attestation: Attestation = {
      ...attestationFor(harness, await challengeFor(harness)),
      accountId: "acct_somebody_else",
    };

    // The signature is honest; the claim inside it is not.
    const { status, body } = await post(harness.url, "/v1/attest", {
      attestation,
      signature: signAttestation(attestation, harness.keys.privateKeyPem),
    });

    assert.equal(status, 401);
    assert.equal(body["reason"], "unknown-account");
  } finally {
    await harness.stop();
  }
});

test("an attestation from far outside the clock window is refused", async () => {
  const harness = await startControl();
  try {
    const attestation = attestationFor(harness, await challengeFor(harness), NOW - 10_000);

    const { status, body } = await post(harness.url, "/v1/attest", {
      attestation,
      signature: signAttestation(attestation, harness.keys.privateKeyPem),
    });

    assert.equal(status, 401);
    assert.equal(body["reason"], "stale-attestation");
  } finally {
    await harness.stop();
  }
});

test("a body past the ceiling and a junk body are both refused", async () => {
  const harness = await startControl();
  try {
    const huge = JSON.stringify({ publicKey: "x".repeat(16 * 1024) });
    const oversized = await fetch(`${harness.url}/v1/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: huge,
    }).catch(() => null);

    // Either the server answers 400 or it has already cut the socket; both
    // are the ceiling doing its job, and neither is the body being accepted.
    assert.ok(oversized === null || oversized.status === 400);

    const junk = await post(harness.url, "/v1/challenge", "not json");
    assert.equal(junk.status, 400);

    const wrongPath = await post(harness.url, "/v1/nope", {});
    assert.equal(wrongPath.status, 404);
  } finally {
    await harness.stop();
  }
});
