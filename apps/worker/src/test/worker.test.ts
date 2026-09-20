import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { chmodSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { generateWorkerKeyPair, verifyAttestation, type Attestation } from "@zgrove/protocol";

import { attest, AttestationRefused } from "../client.js";
import { loadWorkerConfig } from "../config.js";
import { loadKeyPair, loadOrCreateKeyPair } from "../keystore.js";
import { fillArgs } from "../miner.js";

function scratchKeyPath(): string {
  return join(mkdtempSync(join(tmpdir(), "zgrove-worker-")), "worker.key");
}

test("a key is created once, kept private, and read back", () => {
  const path = scratchKeyPath();

  const created = loadOrCreateKeyPair(path);
  assert.equal(statSync(path).mode & 0o777, 0o600);

  // A second run is the same rig, not a new one: a regenerated key is a rig
  // that has to be enrolled again and loses the work recorded under the old.
  assert.equal(loadOrCreateKeyPair(path).publicKey, created.publicKey);
  assert.equal(loadKeyPair(path)?.publicKey, created.publicKey);
});

test("a key other accounts can read is refused, not quietly tightened", () => {
  const path = scratchKeyPath();
  loadOrCreateKeyPair(path);
  chmodSync(path, 0o644);

  // Tightening it here would hide that it had been readable, and anyone who
  // already copied it can mine as this rig.
  assert.throws(() => loadKeyPair(path), /readable by others/);
});

test("a key file that is not a key fails loudly", () => {
  const path = scratchKeyPath();
  writeFileSync(path, "not a pem", { mode: 0o600 });
  assert.throws(() => loadKeyPair(path));
});

test("miner arguments are filled without a shell ever seeing them", () => {
  const filled = fillArgs(
    ["--pool", "stratum+tcp://{host}:{port}", "--user", "{token}", "--pass", "x"],
    { host: "pool.example", port: 3333, token: "zgt_abc" },
  );

  assert.deepEqual(filled, [
    "--pool",
    "stratum+tcp://pool.example:3333",
    "--user",
    "zgt_abc",
    "--pass",
    "x",
  ]);

  // Substitution is on the argument vector, so a value that looks like shell
  // syntax stays one argument and is never interpreted.
  assert.deepEqual(fillArgs(["{token}"], { host: "h", port: 1, token: "a; rm -rf /" }), [
    "a; rm -rf /",
  ]);
});

test("no miner configured means print the target rather than guess at one", () => {
  const config = loadWorkerConfig({ ZGROVE_ACCOUNT_ID: "acct_x" });
  assert.equal(config.miner, null);

  assert.throws(
    () =>
      loadWorkerConfig({
        ZGROVE_ACCOUNT_ID: "acct_x",
        ZGROVE_MINER_COMMAND: "lolMiner",
        ZGROVE_MINER_ARGS: "--pool x",
      }),
    /JSON array/,
  );

  assert.throws(() => loadWorkerConfig({}), /ZGROVE_ACCOUNT_ID/);
});

test("the agent signs the challenge it was given and gets a token", async () => {
  const keys = generateWorkerKeyPair();
  let signedNonce: string | null = null;

  const server = await fakeControl((path, body) => {
    if (path === "/v1/challenge") {
      return { status: 200, body: { type: "challenge", nonce: "nonce-1", expiresAt: 0 } };
    }

    const attestation = body["attestation"] as Attestation;
    // Checked with the real verifier: the point of the test is that what the
    // agent sends satisfies the orchestrator, not that it sent something.
    assert.equal(verifyAttestation(attestation, body["signature"] as string), true);
    signedNonce = attestation.nonce;

    return {
      status: 200,
      body: {
        type: "session",
        token: "zgt_issued",
        expiresAt: 99,
        stratumHost: "pool.example",
        stratumPort: 3333,
      },
    };
  });

  try {
    const session = await attest(
      { baseUrl: server.url, accountId: "acct_x", requestTimeoutMs: 2_000 },
      keys,
    );

    assert.equal(signedNonce, "nonce-1");
    assert.equal(session.token, "zgt_issued");
    assert.equal(session.stratumHost, "pool.example");
  } finally {
    await server.stop();
  }
});

test("a refusal reaches the contributor with the reason attached", async () => {
  const keys = generateWorkerKeyPair();
  const server = await fakeControl((path) =>
    path === "/v1/challenge"
      ? { status: 200, body: { type: "challenge", nonce: "n", expiresAt: 0 } }
      : { status: 401, body: { type: "reject", reason: "unknown-key" } },
  );

  try {
    await assert.rejects(
      attest({ baseUrl: server.url, accountId: "acct_x", requestTimeoutMs: 2_000 }, keys),
      (error: unknown) =>
        error instanceof AttestationRefused && error.reason === "unknown-key",
    );
  } finally {
    await server.stop();
  }
});

interface FakeControl {
  readonly url: string;
  stop(): Promise<void>;
}

async function fakeControl(
  handler: (
    path: string,
    body: Record<string, unknown>,
  ) => { status: number; body: unknown },
): Promise<FakeControl> {
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
        string,
        unknown
      >;
      const answer = handler(request.url ?? "", body);
      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(JSON.stringify(answer.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fake control server is not on a port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
