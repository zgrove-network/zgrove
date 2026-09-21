/** Zcash blocks, read from a public explorer.
 *
 * The blocks are real. Nothing about when they arrive, how far apart they
 * fall, or what they carry is ours to decide, which is the entire reason this
 * is worth betting on: the draw belongs to the chain and no operator can
 * reach it. */

const SOURCE = "https://api.blockchair.com/zcash/blocks";

/** Zcash aims for a block every 75 seconds. Actual intervals are exponential
 * around that, so the median sits at 75 × ln2 ≈ 52s and about 63% of blocks
 * land inside 75 — a fact most people guess as a coin flip. */
export const TARGET_SECONDS = 75;

export interface Block {
  readonly height: number;
  /** Epoch milliseconds. */
  readonly at: number;
  /** Seconds since the previous block. Null for the oldest one we hold. */
  readonly interval: number | null;
  readonly txCount: number;
}

interface Raw {
  readonly id: number;
  readonly time: string;
  readonly transaction_count: number;
}

function parse(rows: readonly Raw[]): readonly Block[] {
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  const out: Block[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const row = sorted[i];
    if (row === undefined) continue;
    // Blockchair reports UTC without a zone marker.
    const at = Date.parse(`${row.time.replace(" ", "T")}Z`);
    const before = sorted[i - 1];
    const interval =
      before === undefined
        ? null
        : Math.round((at - Date.parse(`${before.time.replace(" ", "T")}Z`)) / 1000);
    out.push({ height: row.id, at, interval, txCount: row.transaction_count });
  }

  // Newest first.
  return out.reverse();
}

export async function recentBlocks(limit = 40): Promise<readonly Block[]> {
  const url = `${SOURCE}?limit=${limit}&fields=id,time,transaction_count`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`explorer returned ${response.status}`);
  const body: unknown = await response.json();
  const data = (body as { data?: readonly Raw[] }).data;
  if (data === undefined) throw new Error("explorer returned no blocks");
  return parse(data);
}
