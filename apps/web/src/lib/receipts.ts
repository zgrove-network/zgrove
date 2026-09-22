import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Receipts are files. `zgrove receipt --round N` prints one, the operator
 * commits it to apps/web/receipts/, and the site is rebuilt. Read at build
 * time, so the page is static and serves exactly what was committed.
 *
 * A receipt that does not parse, or is missing a field, stops the build. It is
 * not skipped. Silently leaving out a malformed one would publish an incomplete
 * record of payments while looking complete, which is the failure this whole
 * page exists to rule out.
 */

const DIR = join(process.cwd(), "receipts");
const HEX64 = /^[0-9a-f]{64}$/;

export interface Receipt {
  readonly round: number;
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly accountsPaid: number;
  readonly totalZat: number;
  readonly txid: string;
  readonly settlement: "wallet" | "external";
  readonly commitment: string;
  readonly issuedAt: number;
  readonly limits: readonly string[];
  /** Where the commitment was written somewhere public, if it has been. */
  readonly anchor?: { readonly chain: "solana"; readonly signature: string };
}

export interface Upstream {
  readonly pool: string;
  readonly algo: string;
  readonly account: string;
  /** The pool's own public page for the account, where its totals are shown. */
  readonly dashboard: string;
}

function fail(file: string, why: string): never {
  throw new Error(`receipts/${file}: ${why}. Fix the file or remove it; it is not skipped.`);
}

function integer(file: string, value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(file, `${name} must be a non-negative integer`);
  }
  return value;
}

function parseReceipt(file: string, raw: string): Receipt {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    fail(file, "not valid JSON");
  }

  const txid = data["txid"];
  if (typeof txid !== "string" || !HEX64.test(txid)) fail(file, "txid must be 64 hex characters");

  const commitment = data["commitment"];
  if (typeof commitment !== "string" || !HEX64.test(commitment)) {
    fail(file, "commitment must be 64 hex characters");
  }

  const settlement = data["settlement"];
  if (settlement !== "wallet" && settlement !== "external") {
    fail(file, 'settlement must be "wallet" or "external"');
  }

  const limits = data["limits"];
  if (!Array.isArray(limits) || limits.length === 0 || limits.some((l) => typeof l !== "string")) {
    // A receipt without its own statement of what it does not prove claims
    // more than it shows.
    fail(file, "limits must be a non-empty list of strings");
  }

  const periodStart = integer(file, data["periodStart"], "periodStart");
  const periodEnd = integer(file, data["periodEnd"], "periodEnd");
  if (periodEnd <= periodStart) fail(file, "periodEnd must come after periodStart");

  let anchor: Receipt["anchor"];
  const rawAnchor = data["anchor"];
  if (rawAnchor !== undefined) {
    const a = rawAnchor as Record<string, unknown>;
    if (a["chain"] !== "solana" || typeof a["signature"] !== "string" || a["signature"] === "") {
      fail(file, "anchor must be { chain: \"solana\", signature }");
    }
    anchor = { chain: "solana", signature: a["signature"] as string };
  }

  return {
    round: integer(file, data["round"], "round"),
    periodStart,
    periodEnd,
    accountsPaid: integer(file, data["accountsPaid"], "accountsPaid"),
    totalZat: integer(file, data["totalZat"], "totalZat"),
    txid,
    settlement,
    commitment,
    issuedAt: integer(file, data["issuedAt"], "issuedAt"),
    limits: limits as string[],
    ...(anchor === undefined ? {} : { anchor }),
  };
}

export function loadReceipts(): readonly Receipt[] {
  if (!existsSync(DIR)) return [];

  const receipts = readdirSync(DIR)
    .filter((f) => /^round-\d+\.json$/.test(f))
    .map((f) => parseReceipt(f, readFileSync(join(DIR, f), "utf8")));

  const seen = new Set<number>();
  for (const r of receipts) {
    if (seen.has(r.round)) throw new Error(`receipts/: round ${r.round} is published twice`);
    seen.add(r.round);
  }

  return receipts.sort((a, b) => b.round - a.round);
}

export function loadUpstream(): Upstream | null {
  const path = join(DIR, "upstream.json");
  if (!existsSync(path)) return null;

  const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  for (const key of ["pool", "algo", "account", "dashboard"] as const) {
    if (typeof data[key] !== "string" || data[key] === "") {
      throw new Error(`receipts/upstream.json: ${key} must be a non-empty string`);
    }
  }
  const dashboard = data["dashboard"] as string;
  if (!dashboard.startsWith("https://")) {
    throw new Error("receipts/upstream.json: dashboard must be an https link");
  }
  return data as unknown as Upstream;
}
