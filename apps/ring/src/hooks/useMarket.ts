import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { recentBlocks, type Block } from "../lib/chain";
import { settle, statsOver, type Pools, type Position, type Round, type Side } from "../lib/market";

/** How often the explorer is asked whether a block has landed. Zcash aims for
 * one every 75 seconds, so this is frequent enough to feel live without
 * hammering a service we do not own. */
const POLL_MS = 12_000;

export type Source = "chain" | "offline";

export interface MarketState {
  readonly source: Source;
  readonly blocks: readonly Block[];
  readonly rounds: readonly Round[];
  readonly position: Position | null;
  readonly balance: number;
  readonly session: number;
  readonly staked: number;
  readonly hits: number;
  /** Seconds since the last block landed. Counts up; the whole question is
   * whether it crosses the line before the next one arrives. */
  readonly elapsed: number;
  readonly error: string | null;
}

/** The other side of the market is not real. Blocks are; counterparties are
 * simulated, and the interface says so rather than implying a crowd that is
 * not there. Pools drift so the odds move between rounds. */
function drawPools(): Pools {
  const total = 4 + Math.random() * 9;
  const share = 0.42 + Math.random() * 0.24;
  return { under: total * share, over: total * (1 - share) };
}

export function useMarket() {
  const [blocks, setBlocks] = useState<readonly Block[]>([]);
  const [rounds, setRounds] = useState<readonly Round[]>([]);
  const [position, setPosition] = useState<Position | null>(null);
  const [pools, setPools] = useState<Pools>(drawPools);
  const [balance, setBalance] = useState(1);
  const [session, setSession] = useState(0);
  const [staked, setStaked] = useState(0);
  const [hits, setHits] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [source, setSource] = useState<Source>("offline");
  const [error, setError] = useState<string | null>(null);

  const positionRef = useRef<Position | null>(null);
  positionRef.current = position;
  const poolsRef = useRef<Pools>(pools);
  poolsRef.current = pools;
  const tipRef = useRef<number>(0);

  const absorb = useCallback((fresh: readonly Block[]) => {
    if (fresh.length === 0) return;
    const newest = fresh[0];
    if (newest === undefined) return;

    setBlocks(fresh);

    // Everything above the height we had last time has settled since.
    const landed = fresh
      .filter((b) => b.height > tipRef.current && b.interval !== null)
      .sort((a, b) => a.height - b.height);

    // First load: everything we fetched is history. It has already happened,
    // nobody had a position on it, and showing it beats an empty table.
    if (tipRef.current === 0) {
      const seeded = fresh
        .filter((b) => b.interval !== null)
        .map((b) => settle(b, b.interval ?? 0, drawPools(), null));
      setRounds(seeded.slice(0, 40));
    }

    if (tipRef.current !== 0 && landed.length > 0) {
      for (const block of landed) {
        const interval = block.interval;
        if (interval === null) continue;
        const mine =
          positionRef.current?.height === block.height ? positionRef.current : null;
        const round = settle(block, interval, poolsRef.current, mine);

        setRounds((prev) => [round, ...prev].slice(0, 40));
        if (mine !== null) {
          setBalance((b) => b + round.delta);
          setSession((s) => s + round.delta);
          setStaked((n) => n + 1);
          if (round.delta > 0) setHits((n) => n + 1);
          setPosition(null);
          positionRef.current = null;
        }
        const next = drawPools();
        setPools(next);
        poolsRef.current = next;
      }
    }

    tipRef.current = newest.height;
  }, []);

  useEffect(() => {
    let alive = true;

    async function pull() {
      try {
        const fresh = await recentBlocks(40);
        if (!alive) return;
        absorb(fresh);
        setSource("chain");
        setError(null);
      } catch (cause) {
        if (!alive) return;
        setSource("offline");
        setError(cause instanceof Error ? cause.message : "explorer unreachable");
      }
    }

    void pull();
    const id = window.setInterval(() => void pull(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [absorb]);

  // The clock counts up from the newest block we know about.
  useEffect(() => {
    const tick = () => {
      const newest = blocks[0];
      if (newest === undefined) {
        setElapsed(0);
        return;
      }
      setElapsed(Math.max(0, (Date.now() - newest.at) / 1000));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [blocks]);

  const stats = useMemo(() => statsOver(blocks), [blocks]);

  const take = useCallback(
    (side: Side, stake: number) => {
      const newest = blocks[0];
      if (newest === undefined) return;
      setPosition({ height: newest.height + 1, side, stake });
    },
    [blocks],
  );

  const state: MarketState = {
    source,
    blocks,
    rounds,
    position,
    balance,
    session,
    staked,
    hits,
    elapsed,
    error,
  };

  return { state, stats, pools, take };
}
