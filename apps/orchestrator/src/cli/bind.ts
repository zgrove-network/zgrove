import { createPublicKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  encodeBase58,
  encodePublicKey,
  encodeSolanaBinding,
  privateKeyFromSeed,
  type SolanaBinding,
} from "@zgrove/protocol";

/**
 * Binds a Solana wallet to an account by signing a challenge with it.
 *
 * This reads a Solana CLI keypair file, which is a key the operator already
 * holds on disk. It deliberately does not ask anyone to export a key out of a
 * browser wallet: the contributor-facing version of this is a page where
 * Phantom signs the same bytes and nothing leaves the extension.
 */
export async function runBindWallet(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      account: { type: "string" },
      keypair: { type: "string" },
      url: { type: "string" },
    },
    allowPositionals: false,
  });

  const accountId = required(values.account, "--account");
  const keypairPath = required(values.keypair, "--keypair");
  const baseUrl = (values.url ?? env["ZGROVE_CONTROL_URL"] ?? "http://127.0.0.1:3334")
    .replace(/\/+$/, "");

  const { privateKey, address } = readSolanaKeypair(keypairPath);

  const challenge = await post(baseUrl, "/v1/challenge", { publicKey: address });
  const nonce = challenge["nonce"];
  if (typeof nonce !== "string") {
    throw new Error("The control plane returned no challenge");
  }

  const binding: SolanaBinding = {
    nonce,
    accountId,
    solanaAddress: address,
    issuedAt: Math.floor(Date.now() / 1000),
  };

  const bound = await post(baseUrl, "/v1/bind-wallet", {
    binding,
    signature: sign(null, encodeSolanaBinding(binding), privateKey).toString("base64url"),
  });

  process.stdout.write(`${bound["accountId"]} -> ${bound["solanaAddress"]}\n`);
  return 0;
}

/** The Solana CLI stores a keypair as 64 bytes of JSON: seed, then public key. */
function readSolanaKeypair(path: string): {
  privateKey: ReturnType<typeof privateKeyFromSeed>;
  address: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} is not a Solana keypair file`);
  }

  if (!Array.isArray(parsed) || parsed.length !== 64) {
    throw new Error(`${path} should be a JSON array of 64 bytes`);
  }

  const bytes = Uint8Array.from(parsed as number[]);
  const privateKey = privateKeyFromSeed(bytes.subarray(0, 32));

  // Derived from the seed rather than read from the file's second half, so a
  // keypair whose two halves disagree cannot bind an address it cannot sign
  // for.
  return {
    privateKey,
    address: encodeBase58(
      Buffer.from(encodePublicKey(createPublicKey(privateKey)), "base64url"),
    ),
  };
}

async function post(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  const parsed = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  if (!response.ok) {
    const reason = parsed?.["reason"];
    throw new Error(
      `The orchestrator refused the binding: ${typeof reason === "string" ? reason : response.status}`,
    );
  }
  if (parsed === null) {
    throw new Error("The control plane returned something that is not JSON");
  }
  return parsed;
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${flag} is required`);
  }
  return value.trim();
}

export const BIND_USAGE = `zgrove bind-wallet — prove a Solana wallet for an account's fee tier

  --account <id>     the account to bind (required)
  --keypair <path>   a Solana CLI keypair JSON file (required)
  --url <url>        control plane (or ZGROVE_CONTROL_URL)

Signs a challenge with the wallet's own key, which is what stops a fee tier
from being claimed by typing somebody else's address. Nothing here asks for a
key exported from a browser wallet; that flow signs the same bytes in Phantom.
`;
