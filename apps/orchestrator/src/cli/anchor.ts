import { parseArgs } from "node:util";

import { createDispatch, migrate, openDatabase } from "@zgrove/db";
import { merkleRoot, type ReceiptEntry } from "@zgrove/protocol";

import {
  LAMPORTS_PER_SIGNATURE,
  buildMemoTransaction,
  createSolanaRpc,
  loadSolanaKeypair,
  memoFor,
  type SolanaRpc,
} from "../wallet/solana-memo.js";

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

export const ANCHOR_USAGE = `zgrove anchor — write a paid round's commitment into a Solana memo

  --round <id>         the round (required; must have been sent)
  --keypair <path>     Solana CLI keypair file (default $ZGROVE_SOLANA_KEYPAIR)
  --rpc <url>          Solana RPC (default $ZGROVE_SOLANA_RPC, then mainnet)
  --confirm            actually send it; without this, nothing leaves
  --signature <sig>    record an anchor that was already sent, after checking
                       on chain that it carries this round's memo
  --db <path>          accounting database

A dry run builds and signs the transaction, has the node simulate it, and
prints what would be written and what it would cost. Nothing is sent and
nothing is recorded until --confirm.

The memo names the round, its commitment and the Zcash transaction. If a
receipt ever disagrees with the memo written when the round was paid, the
receipt was changed afterwards.
`;

export async function runAnchor(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  rpcFor: (url: string) => SolanaRpc = createSolanaRpc,
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      round: { type: "string" },
      keypair: { type: "string" },
      rpc: { type: "string" },
      confirm: { type: "boolean", default: false },
      signature: { type: "string" },
      db: { type: "string" },
    },
    allowPositionals: false,
  });

  const roundId = Number(values.round);
  if (!Number.isInteger(roundId) || roundId <= 0) throw new Error("--round <id> is required");

  const db = openDatabase(values.db ?? env["ZGROVE_DB_PATH"] ?? "data/zgrove.sqlite");
  try {
    migrate(db);
    const dispatch = createDispatch(db);
    const round = dispatch.load(roundId);
    if (round === null) throw new Error(`No round ${roundId}.`);
    if (round.dispatchState !== "sent" || round.txid === null) {
      throw new Error(`Round ${roundId} is ${round.dispatchState}. Only a paid round is anchored.`);
    }
    if (round.anchorSignature !== null) {
      throw new Error(`Round ${roundId} is already anchored in ${round.anchorSignature}.`);
    }

    // The same entries and the same root the receipt is built from, so the
    // memo and the receipt cannot be about different things.
    const entries: ReceiptEntry[] = round.entries
      .filter((e) => e.amountZat > 0)
      .map((e) => ({ accountId: e.accountId, amountZat: e.amountZat }));
    const memo = memoFor(roundId, merkleRoot(entries), round.txid);

    const rpc = rpcFor(values.rpc ?? env["ZGROVE_SOLANA_RPC"] ?? DEFAULT_RPC);
    const now = Math.floor(Date.now() / 1000);

    // Recovery: a memo that went out but never got recorded, because the
    // process stopped in between. Believed only once the chain shows it.
    if (values.signature !== undefined) {
      const logs = await rpc.logs(values.signature);
      if (logs === null) throw new Error(`${values.signature} has not landed, or it failed.`);
      if (!logs.some((line) => line.includes(memo))) {
        throw new Error(`${values.signature} does not carry round ${roundId}'s memo.`);
      }
      if (!dispatch.recordAnchor(roundId, values.signature, now)) {
        throw new Error(`Round ${roundId} could not be recorded; it may have been anchored meanwhile.`);
      }
      process.stdout.write(`round ${roundId} anchored in ${values.signature}\n`);
      return 0;
    }

    const keypairPath = values.keypair ?? env["ZGROVE_SOLANA_KEYPAIR"];
    if (keypairPath === undefined || keypairPath === "") {
      throw new Error("--keypair <path> or $ZGROVE_SOLANA_KEYPAIR is required");
    }
    const key = loadSolanaKeypair(keypairPath);

    const [blockhash, lamports] = await Promise.all([rpc.latestBlockhash(), rpc.balance(key.address)]);
    const tx = buildMemoTransaction(key, memo, blockhash);
    const simulated = await rpc.simulate(tx.wire);

    process.stdout.write(
      `round        ${roundId}\n` +
        `memo         ${memo}\n` +
        `payer        ${key.address}  (${lamports} lamports)\n` +
        `fee          ${LAMPORTS_PER_SIGNATURE} lamports\n` +
        `simulation   ${simulated.error === null ? "accepted" : JSON.stringify(simulated.error)}\n`,
    );

    if (!values.confirm) {
      process.stdout.write("\nDry run. Nothing was sent. Add --confirm to write it.\n");
      return 0;
    }

    if (lamports < LAMPORTS_PER_SIGNATURE) {
      throw new Error(`${key.address} holds ${lamports} lamports; the fee is ${LAMPORTS_PER_SIGNATURE}.`);
    }
    if (simulated.error !== null) {
      throw new Error(`The node would reject this (${JSON.stringify(simulated.error)}). Not sent.`);
    }

    const signature = await rpc.send(tx.wire);
    // Printed before waiting. If this process stops now, the memo may still
    // land, and this line is how it gets recorded rather than lost.
    process.stdout.write(`\nsent         ${signature}\n`);

    const deadline = Date.now() + 90_000;
    let level: string | null = null;
    while (Date.now() < deadline) {
      level = await rpc.status(signature);
      if (level === "confirmed" || level === "finalized") break;
      await new Promise((r) => setTimeout(r, 2_000));
    }
    if (level !== "confirmed" && level !== "finalized") {
      throw new Error(
        `Not confirmed within 90s. If it lands, record it with:\n` +
          `  zgrove anchor --round ${roundId} --signature ${signature}`,
      );
    }

    if (!dispatch.recordAnchor(roundId, signature, now)) {
      throw new Error(`Sent as ${signature} but not recorded; the round may have been anchored meanwhile.`);
    }
    process.stdout.write(`anchored     ${level}\n`);
    return 0;
  } finally {
    db.close();
  }
}
