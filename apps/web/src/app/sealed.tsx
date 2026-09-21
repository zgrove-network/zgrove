"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  OPENING,
  ROUND_SECONDS,
  SLOTS,
  WINDOW,
  backtest,
  bars,
  drawClearing,
  drawPot,
  hitRate,
  outcomeOf,
  signed,
  statsOver,
  zec,
  type Round,
} from "../lib/sealed";

/** Real milliseconds per simulated second. A round is one Zcash block, which
 * is 75 seconds; waiting that long to watch the loop once is no way to look at
 * a mechanism, so the clock runs fast and the page says it does. */
const TICK_MS = 200;
const SPEED = Math.round(1000 / TICK_MS);

/** Real time the opened box stays up before the next round. */
const HOLD_TICKS = 22;

/** How many rounds the "would this bid have won" reading looks back over.
 * Short enough to reflect the going rate, long enough not to be noise. */
const LOOKBACK = 20;

function reduced(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Settles a figure left to right out of noise, the way a terminal fills in a
 * value it was waiting on. A fade would say "web page"; this says "readout". */
function useSettling(target: string | null): string {
  const [shown, setShown] = useState("");

  useEffect(() => {
    if (target === null) {
      setShown("");
      return;
    }
    if (reduced()) {
      setShown(target);
      return;
    }

    const began = Date.now();
    const span = 620;
    const id = window.setInterval(() => {
      const through = (Date.now() - began) / span;
      if (through >= 1) {
        setShown(target);
        window.clearInterval(id);
        return;
      }
      const fixed = Math.floor(target.length * through);
      let out = "";
      for (let i = 0; i < target.length; i += 1) {
        const ch = target.charAt(i);
        out += i < fixed || ch === "." ? ch : String(Math.floor(Math.random() * 10));
      }
      setShown(out);
    }, 45);

    return () => window.clearInterval(id);
  }, [target]);

  return shown;
}

interface Live {
  readonly round: number;
  readonly block: number;
  readonly left: number;
  readonly open: boolean;
  readonly hold: number;
  readonly bids: number;
  readonly pot: number | null;
  readonly foundBlock: boolean;
  readonly balance: number;
  readonly session: number;
  readonly slotsWon: number;
  readonly played: number;
  readonly history: readonly Round[];
}

const START: Live = {
  round: 1247,
  block: 2_913_442,
  left: ROUND_SECONDS,
  open: true,
  hold: 0,
  bids: 34,
  pot: null,
  foundBlock: false,
  balance: 1,
  session: 0,
  slotsWon: 0,
  played: 0,
  history: OPENING,
};

export function SealedBox() {
  const [live, setLive] = useState<Live>(START);
  const [running, setRunning] = useState(true);
  const [draft, setDraft] = useState("");
  const [bid, setBid] = useState<number | null>(null);
  const [flash, setFlash] = useState(0);

  const bidRef = useRef<number | null>(null);
  bidRef.current = bid;

  const step = useCallback(() => {
    setLive((now) => {
      if (now.open) {
        if (now.left > 1) {
          return {
            ...now,
            left: now.left - 1,
            bids: now.bids + (Math.random() < 0.2 ? 1 : 0),
          };
        }
        const { pot, foundBlock } = drawPot();
        return { ...now, left: 0, open: false, hold: HOLD_TICKS, pot, foundBlock };
      }

      if (now.hold > 1) return { ...now, hold: now.hold - 1 };

      const mine = bidRef.current;
      const row: Round = {
        round: now.round,
        perSlot: (now.pot ?? 0) / SLOTS,
        clearing: drawClearing(),
        foundBlock: now.foundBlock,
        bid: mine,
      };
      const result = outcomeOf(row);

      setBid(null);
      setDraft("");
      setFlash((n) => n + 1);

      return {
        round: now.round + 1,
        block: now.block + 1,
        left: ROUND_SECONDS,
        open: true,
        hold: 0,
        bids: 28 + Math.floor(Math.random() * 20),
        pot: null,
        foundBlock: false,
        balance: now.balance + result.delta,
        session: now.session + result.delta,
        slotsWon: now.slotsWon + (result.won ? 1 : 0),
        played: now.played + (mine === null ? 0 : 1),
        history: [row, ...now.history].slice(0, WINDOW),
      };
    });
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(step, TICK_MS);
    return () => window.clearInterval(id);
  }, [running, step]);

  const potText = live.pot === null ? null : zec(live.pot);
  const shownPot = useSettling(potText);

  const stats = useMemo(() => statsOver(live.history), [live.history]);
  const chart = useMemo(() => {
    const window = live.history.slice(0, WINDOW);
    const heights = bars(window.map((r) => r.perSlot).reverse());
    const found = window.map((r) => r.foundBlock).reverse();
    return heights.map((height, i) => ({ height, found: found[i] === true }));
  }, [live.history]);

  const typed = Number.parseFloat(draft);
  const valid = Number.isFinite(typed) && typed > 0;
  const odds = valid ? hitRate(typed, live.history, LOOKBACK) : null;
  const backtested = valid ? backtest(typed, live.history, LOOKBACK) : null;

  const mm = String(Math.floor(live.left / 60)).padStart(2, "0");
  const ss = String(live.left % 60).padStart(2, "0");
  const closingSoon = live.open && live.left <= 12;

  function seal() {
    if (!valid) return;
    setBid(typed);
  }

  return (
    <div className="sealed">
      <div className="app">
        <header className="app-head">
          <span className="name">sealed box</span>
          <span>
            <b>simulation</b> — no chain, no pool, no money, nothing here has
            happened
          </span>
          <span className="end">
            clock {SPEED}&times; ·{" "}
            <button type="button" className="linkish" onClick={() => setRunning((r) => !r)}>
              {running ? "pause" : "resume"}
            </button>
          </span>
        </header>

        <main className="app-stage">
          <div className="stage-meta">
            <span>
              round <b>{live.round}</b>
            </span>
            <span>
              block <b>{live.block.toLocaleString("en-US")}</b>
            </span>
          </div>

          <div className="stage-mid">
            <div className="stage-box">
              {live.open ? (
                <>
                  <div className="figure waiting">
                    ???
                    <span className="caret" aria-hidden="true">
                      _
                    </span>
                  </div>
                  <div className="under">in the box — sealed until the block closes</div>
                </>
              ) : (
                <>
                  <div className={live.foundBlock ? "figure hit" : "figure"}>
                    {shownPot} ZEC
                  </div>
                  <div className="under">
                    <b>{zec((live.pot ?? 0) / SLOTS)}</b> per slot —{" "}
                    {live.foundBlock ? "the pool found a block" : "a quiet round"}
                  </div>
                </>
              )}
            </div>

            <div>
              <div className={closingSoon ? "clock soon" : "clock"}>
                {live.open ? `${mm}:${ss}` : "00:00"}
              </div>
              <div className="under right">
                {live.open ? "until it opens" : "opened"}
              </div>
            </div>
          </div>

          <div className="stage-foot">
            <span>
              <b>{SLOTS}</b> slots
            </span>
            <span>
              <b>{live.bids}</b> bids in
            </span>
            <span>amounts hidden from everyone, us included</span>
          </div>
        </main>

        <aside className="app-rail">
          <div className="rail">
            <h3>your bid</h3>

            {live.open && bid === null ? (
              <>
                <div className="amount">
                  <input
                    id="bid"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.0000"
                    aria-label="your bid in ZEC"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") seal();
                    }}
                  />
                  <span>ZEC</span>
                </div>

                <div className="chips">
                  <button type="button" onClick={() => setDraft(zec(stats.avgClearing))}>
                    {zec(stats.avgClearing)} usual
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft(zec(stats.avgClearing * 1.5))}
                  >
                    {zec(stats.avgClearing * 1.5)} safe
                  </button>
                </div>

                <div className="reading">
                  {odds === null || backtested === null ? (
                    <span className="dim">
                      Type an amount and this will say how often it would have
                      taken a slot, and what bidding it every round would have
                      come to.
                    </span>
                  ) : (
                    <>
                      <div>
                        takes a slot in{" "}
                        <b className={odds.hits > odds.of / 2 ? "good" : "bad"}>
                          {odds.hits} of the last {odds.of}
                        </b>{" "}
                        rounds
                      </div>
                      <div className="dim">
                        bidding this every round over those {odds.of} would have
                        come to{" "}
                        <span className={backtested >= 0 ? "good" : "bad"}>
                          {signed(backtested)}
                        </span>{" "}
                        ZEC — which turns almost entirely on whether a block
                        landed in them
                      </div>
                    </>
                  )}
                </div>

                <button type="button" className="seal" onClick={seal} disabled={!valid}>
                  seal and send
                </button>
              </>
            ) : bid === null ? (
              <p className="dim">
                You sat this round out. The next one opens in a moment.
              </p>
            ) : (
              <>
                <div className="amount">
                  <span className="brightish" style={{ fontSize: 26 }}>
                    {zec(bid)}
                  </span>
                  <span>ZEC</span>
                </div>
                <div className="under">
                  {live.open ? "sealed — read when the block closes" : "opened"}
                </div>
                <p className="dim">
                  memo zs1q…8f4c · block {live.block.toLocaleString("en-US")} ·
                  one shielded transaction, encrypted on arrival, no second
                  phase
                </p>
              </>
            )}
          </div>

          <div className="rail">
            <h3>you</h3>
            <div className="ledger">
              <span className="dim">balance</span>
              <span className="brightish">{zec(live.balance)}</span>
              <span className="dim">this session</span>
              <span className={live.session >= 0 ? "good" : "bad"}>
                {signed(live.session)}
              </span>
              <span className="dim">slots taken</span>
              <span>
                {live.slotsWon}/{live.played}
              </span>
            </div>
          </div>
        </aside>

        <section className="app-strip">
          <div>
            <div className="strip-head">
              <span className="name">the last {stats.counted} rounds</span>
              <span>what one slot was worth, oldest to newest</span>
            </div>
            <div className="chart" aria-hidden="true">
              {chart.map((bar, i) => (
                <span
                  key={i}
                  className={bar.found ? "chart-bar found" : "chart-bar"}
                  style={{ height: `${bar.height}%` }}
                />
              ))}
            </div>
            <p className="dim kv-note">
              log scale — a found block is two hundred times a quiet round and
              would flatten everything else. The tall ones are blocks.
            </p>
          </div>

          <div>
            <div className="kv">
              <span className="dim">typical round</span>
              <span>{zec(stats.medPerSlot)}</span>
              <span className="dim">average round</span>
              <span>{zec(stats.avgPerSlot)}</span>
              <span className="dim">cost of a slot</span>
              <span>{zec(stats.avgClearing)}</span>
              <span className="dim">best round</span>
              <span className="good">{zec(stats.best)}</span>
              <span className="dim">near-empty rounds</span>
              <span>
                {stats.empty} of {stats.counted}
              </span>
            </div>
            <p className="dim kv-note">
              The average sits far above the typical round because a handful of
              blocks carry it. Most rounds you pay {zec(stats.avgClearing)} for
              something worth {zec(stats.medPerSlot)}.
            </p>
          </div>
        </section>
      </div>

      <h2>round by round</h2>

      <div className="scroller">
        <table className="wide">
          <thead>
            <tr>
              <th>round</th>
              <th>per slot</th>
              <th>lowest winning bid</th>
              <th>your bid</th>
              <th>result</th>
            </tr>
          </thead>
          <tbody key={flash}>
            {live.history.slice(0, 8).map((row, i) => {
              const result = outcomeOf(row);
              return (
                <tr key={row.round} className={i === 0 ? "fresh" : undefined}>
                  <td>{row.round}</td>
                  <td className={row.foundBlock ? "good" : undefined}>
                    {zec(row.perSlot)}
                  </td>
                  <td className="dim">{zec(row.clearing)}</td>
                  <td>{row.bid === null ? "—" : zec(row.bid)}</td>
                  <td className={result.tone}>{result.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
