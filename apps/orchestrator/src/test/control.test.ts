import assert from "node:assert/strict";
import type { Server } from "node:http";
import { test } from "node:test";

import { createRegistry, migrate, openDatabase } from "@zgrove/db";
import { sign } from "node:crypto";

import {
  SESSION_TOKEN_PREFIX,
  encodeBase58,
  encodeSolanaBinding,
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
      algo: "autolykos2",
      upstream: "upstream.example",
      poolWindowSeconds: 3600,
      workPerDifficulty: 2 ** 32,
    },
    {
      challenges: createChallengeStore({ ttlSeconds: 60, maxOutstanding: 16 }),
      sessions: createSessionStore({ ttlSeconds: 3600, maxSessions: 16 }),
      registry,
      statsBetween: () => [],
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

test("a wallet that signs the challenge is bound to the account", async () => {
  const harness = await startControl();
  try {
    // A Solana address is a base58 ed25519 key, so a keypair stands in for a
    // wallet: the signature is what is being tested, not the wallet software.
    const wallet = generateWorkerKeyPair();
    const address = encodeBase58(Buffer.from(wallet.publicKey, "base64url"));

    const { body: challenge } = await post(harness.url, "/v1/challenge", {
      publicKey: address,
    });

    const binding = {
      nonce: challenge["nonce"] as string,
      accountId: ACCOUNT,
      solanaAddress: address,
      issuedAt: NOW,
    };

    const { status, body } = await post(harness.url, "/v1/bind-wallet", {
      binding,
      signature: sign(null, encodeSolanaBinding(binding), wallet.privateKeyPem).toString(
        "base64url",
      ),
    });

    assert.equal(status, 200);
    assert.equal(body["type"], "bound");
    assert.equal(body["solanaAddress"], address);
  } finally {
    await harness.stop();
  }
});

test("a wallet nobody holds cannot be bound", async () => {
  const harness = await startControl();
  try {
    const mine = generateWorkerKeyPair();
    const theirs = generateWorkerKeyPair();
    const richAddress = encodeBase58(Buffer.from(theirs.publicKey, "base64url"));

    const { body: challenge } = await post(harness.url, "/v1/challenge", {
      publicKey: richAddress,
    });

    // Claiming a wallet with a balance, signing with one without. This is the
    // whole attack a fee tier invites.
    const binding = {
      nonce: challenge["nonce"] as string,
      accountId: ACCOUNT,
      solanaAddress: richAddress,
      issuedAt: NOW,
    };

    const { status, body } = await post(harness.url, "/v1/bind-wallet", {
      binding,
      signature: sign(null, encodeSolanaBinding(binding), mine.privateKeyPem).toString(
        "base64url",
      ),
    });

    assert.equal(status, 401);
    assert.equal(body["reason"], "bad-signature");
  } finally {
    await harness.stop();
  }
});

test("a wallet cannot be bound to an account that does not exist", async () => {
  const harness = await startControl();
  try {
    const wallet = generateWorkerKeyPair();
    const address = encodeBase58(Buffer.from(wallet.publicKey, "base64url"));
    const { body: challenge } = await post(harness.url, "/v1/challenge", {
      publicKey: address,
    });

    const binding = {
      nonce: challenge["nonce"] as string,
      accountId: "acct_does_not_exist",
      solanaAddress: address,
      issuedAt: NOW,
    };

    const { status, body } = await post(harness.url, "/v1/bind-wallet", {
      binding,
      signature: sign(null, encodeSolanaBinding(binding), wallet.privateKeyPem).toString(
        "base64url",
      ),
    });

    assert.equal(status, 401);
    assert.equal(body["reason"], "unknown-account");
  } finally {
    await harness.stop();
  }
});

test("the public summary is readable by anyone, with no token and no names", async (t) => {
  // It sits on the same server as the attestation exchange, which hands out
  // bearer tokens. Confusing the two would either lock the public page or
  // open the private one.
  const control = await startControl();
  t.after(() => control.stop());
  const response = await fetch(`${control.url}/v1/pool`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("cache-control"), "public, max-age=15");

  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body["algo"], "autolykos2");
  assert.equal(body["stratum"], "stratum.example:3333");
  assert.equal(body["contributors"], 0);

  // A POST to it is refused; it is not an endpoint anyone writes to.
  const written = await fetch(`${control.url}/v1/pool`, { method: "POST", body: "{}" });
  assert.equal(written.status, 405);
});
