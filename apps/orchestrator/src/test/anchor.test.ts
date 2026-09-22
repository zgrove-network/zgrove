import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  createAccounting,
  createDispatch,
  createPayouts,
  createRegistry,
  migrate,
  openDatabase,
} from "@zgrove/db";
import { encodeBase58 } from "@zgrove/protocol";

import { runAnchor } from "../cli/anchor.js";
import type { Simulation, SolanaRpc } from "../wallet/solana-memo.js";

const DAY = Math.floor(Date.UTC(2026, 8, 20) / 1000);
const TXID = "c".repeat(64);
const BLOCKHASH = encodeBase58(Uint8Array.from({ length: 32 }, (_, i) => i + 1));

/** A database on disk holding one round, paid or not. */
function seeded(paid: boolean): { path: string; roundId: number } {
  const path = join(mkdtempSync(join(tmpdir(), "zgrove-anchor-")), "zgrove.sqlite");
  const db = openDatabase(path);
  migrate(db);
  const registry = createRegistry(db);
  const accounting = createAccounting(db);

  for (const [id, weight] of [["acct_a", 300], ["acct_b", 100]] as const) {
    registry.createAccount({ id, payoutAddress: `u1${id}` }, DAY);
    const binding = registry.registerWorkerKey({
      publicKey: `k-${id}`, accountId: id, workerName: "rig1", atSeconds: DAY,
    });
    accounting.recordShare({
      workerId: binding.workerId, algo: "equihash", outcome: "accepted",
      difficulty: weight, atSeconds: DAY + 60,
    });
  }

  const payouts = createPayouts(db);
  const roundId = payouts.record(
    payouts.plan({
      periodStart: DAY, periodEnd: DAY + 86_400, totalZat: 400_000_000,
      feeBpsFor: () => 0, minPayoutZat: 0, atSeconds: DAY + 86_400,
    }),
    DAY + 86_400,
  );
  if (paid) createDispatch(db).settleExternally(roundId, TXID, DAY + 90_000);
  db.close();
  return { path, roundId };
}

function keypair(): string {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = Buffer.from(privateKey.export({ format: "jwk" }).d ?? "", "base64url");
  const pub = Buffer.from(publicKey.export({ format: "jwk" }).x ?? "", "base64url");
  const path = join(mkdtempSync(join(tmpdir(), "zgrove-sol-")), "id.json");
  writeFileSync(path, JSON.stringify([...seed, ...pub]), { mode: 0o600 });
  return path;
}

interface FakeRpc extends SolanaRpc {
  sent: Uint8Array[];
}

function fakeRpc(opts: {
  lamports?: number;
  simulation?: Simulation["error"];
  landedLogs?: readonly string[] | null;
} = {}): FakeRpc {
  const sent: Uint8Array[] = [];
  return {
    sent,
    latestBlockhash: async () => BLOCKHASH,
    balance: async () => opts.lamports ?? 1_000_000,
    simulate: async () => ({ error: opts.simulation ?? null, logs: [] }),
    send: async (wire) => {
      sent.push(wire);
      return "SIG_THAT_LANDED";
    },
    status: async () => "confirmed",
    logs: async () => (opts.landedLogs === undefined ? null : opts.landedLogs),
  };
}

function anchorOf(path: string, roundId: number): string | null {
  const db = openDatabase(path, { readonly: true });
  try {
    return createDispatch(db).load(roundId)?.anchorSignature ?? null;
  } finally {
    db.close();
  }
}

async function quietly<T>(run: () => Promise<T>): Promise<{ result: T; out: string }> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((c: string) => (chunks.push(String(c)), true)) as typeof process.stdout.write;
  try {
    return { result: await run(), out: chunks.join("") };
  } finally {
    process.stdout.write = original;
  }
}

test("a dry run signs and simulates, and sends and records nothing", async () => {
  const { path, roundId } = seeded(true);
  const rpc = fakeRpc();
  const { result, out } = await quietly(() =>
    runAnchor(["--round", String(roundId), "--keypair", keypair(), "--db", path], {}, () => rpc),
  );

  assert.equal(result, 0);
  assert.equal(rpc.sent.length, 0, "nothing left");
  assert.equal(anchorOf(path, roundId), null, "nothing recorded");
  assert.match(out, /zgrove round \d+ commitment [0-9a-f]{64} zcash c{64}/);
  assert.match(out, /Dry run\. Nothing was sent\./);
});

test("--confirm sends once and records the signature", async () => {
  const { path, roundId } = seeded(true);
  const rpc = fakeRpc();
  await quietly(() =>
    runAnchor(["--round", String(roundId), "--keypair", keypair(), "--db", path, "--confirm"], {}, () => rpc),
  );

  assert.equal(rpc.sent.length, 1);
  assert.equal(anchorOf(path, roundId), "SIG_THAT_LANDED");
});

test("an unpaid round is refused before a keypair is even read", async () => {
  const { path, roundId } = seeded(false);
  const rpc = fakeRpc();
  await assert.rejects(
    runAnchor(["--round", String(roundId), "--keypair", "/nonexistent", "--db", path, "--confirm"], {}, () => rpc),
    /Only a paid round is anchored/,
  );
  assert.equal(rpc.sent.length, 0);
});

test("a payer that cannot cover the fee is refused, not sent", async () => {
  const { path, roundId } = seeded(true);
  const rpc = fakeRpc({ lamports: 4_999 });
  await assert.rejects(
    quietly(() =>
      runAnchor(["--round", String(roundId), "--keypair", keypair(), "--db", path, "--confirm"], {}, () => rpc),
    ),
    /the fee is 5000/,
  );
  assert.equal(rpc.sent.length, 0);
});

test("a transaction the node would reject is not sent", async () => {
  const { path, roundId } = seeded(true);
  const rpc = fakeRpc({ simulation: "AccountNotFound" });
  await assert.rejects(
    quietly(() =>
      runAnchor(["--round", String(roundId), "--keypair", keypair(), "--db", path, "--confirm"], {}, () => rpc),
    ),
    /would reject this/,
  );
  assert.equal(rpc.sent.length, 0);
});

test("a round already anchored is not anchored again", async () => {
  const { path, roundId } = seeded(true);
  await quietly(() =>
    runAnchor(["--round", String(roundId), "--keypair", keypair(), "--db", path, "--confirm"], {}, () => fakeRpc()),
  );

  const second = fakeRpc();
  await assert.rejects(
    runAnchor(["--round", String(roundId), "--keypair", keypair(), "--db", path, "--confirm"], {}, () => second),
    /already anchored/,
  );
  assert.equal(second.sent.length, 0);
});

test("recovery records a sent memo only once the chain shows this round's memo", async () => {
  const { path, roundId } = seeded(true);

  // The chain has a transaction, but it carries some other round's memo.
  await assert.rejects(
    runAnchor(
      ["--round", String(roundId), "--signature", "OTHER", "--db", path],
      {},
      () => fakeRpc({ landedLogs: ['Program log: Memo (len 10): "zgrove round 999"'] }),
    ),
    /does not carry round/,
  );
  assert.equal(anchorOf(path, roundId), null);

  // Nothing landed at all.
  await assert.rejects(
    runAnchor(["--round", String(roundId), "--signature", "GONE", "--db", path], {}, () => fakeRpc()),
    /has not landed/,
  );

  // The right memo, found on chain: now it is recorded.
  const { out: dry } = await quietly(() =>
    runAnchor(["--round", String(roundId), "--keypair", keypair(), "--db", path], {}, () => fakeRpc()),
  );
  const memo = /memo\s+(zgrove round .*)/.exec(dry)?.[1] ?? "";
  await quietly(() =>
    runAnchor(
      ["--round", String(roundId), "--signature", "RECOVERED", "--db", path],
      {},
      () => fakeRpc({ landedLogs: [`Program log: Memo (len ${memo.length}): "${memo}"`] }),
    ),
  );
  assert.equal(anchorOf(path, roundId), "RECOVERED");
});
