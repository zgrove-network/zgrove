"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  OPENING,
  ROUND_SECONDS,
  SLOTS,
  drawClearing,
  drawPot,
  settle,
  zec,
  type Settled,
} from "../lib/sealed";

/** Real milliseconds per simulated second. A round is one Zcash block, which
 * is 75 seconds; waiting that long to watch the loop once is no way to look at
 * a mechanism, so the clock runs fast and the page says it does. */
const TICK_MS = 200;
const SPEED = Math.round(1000 / TICK_MS);

/** Real time the opened box stays on screen before the next round. */
const HOLD_TICKS = 20;

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
    const span = 560;
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
  readonly history: readonly Settled[];
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

      const pot = now.pot ?? 0;
      const { row, delta } = settle(now.round, pot, drawClearing(), bidRef.current);
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
        balance: now.balance + delta,
        history: [row, ...now.history].slice(0, 6),
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
  const shareText = live.pot === null ? "" : zec(live.pot / SLOTS);

  const mm = String(Math.floor(live.left / 60)).padStart(2, "0");
  const ss = String(live.left % 60).padStart(2, "0");

  function seal() {
    const value = Number.parseFloat(draft);
    if (!Number.isFinite(value) || value <= 0) return;
    setBid(value);
  }

  return (
    <div className="sealed">
      <p className="sim">
        <b>simulation.</b> No chain, no pool, no money. Invented numbers, drawn
        from a distribution picked to be honest about mining rather than
        flattering. Nothing on this page has happened. The clock runs at{" "}
        {SPEED}&times; so a round fits in a glance — a real round is one Zcash
        block, {ROUND_SECONDS} seconds.
      </p>

      <div className="round">
        <span className="dim">round</span>
        <span>{live.round}</span>
        <span className="dim">block</span>
        <span>{live.block.toLocaleString("en-US")}</span>
        <span className="dim">closes</span>
        <span className={live.open && live.left <= 10 ? "bad" : undefined}>
          {live.open ? `${mm}:${ss}` : "closed"}
        </span>
        <span className="dim">slots</span>
        <span>{SLOTS}</span>
        <span className="dim">bids in</span>
        <span>
          {live.bids} <span className="dim">— amounts not shown, to anyone</span>
        </span>
      </div>

      <div className="box">
        <div className="dim">in the box</div>
        {live.open ? (
          <>
            <div className="figure sealed-figure">
              ???<span className="caret" aria-hidden="true">
                _
              </span>
            </div>
            <div className="dim">
              Sealed until the block closes. We cannot see it either — it has
              not been mined yet.
            </div>
          </>
        ) : (
          <>
            <div className={live.foundBlock ? "figure good" : "figure"}>
              {shownPot} ZEC
            </div>
            <div className="dim">
              <span className="brightish">{shareText}</span> per slot —{" "}
              {live.foundBlock ? "the pool found a block" : "a quiet round"}
            </div>
          </>
        )}
      </div>

      <h2>your bid</h2>

      {live.open && bid === null ? (
        <div className="bidrow">
          <div>
            <label htmlFor="bid">&nbsp;&nbsp;amount (ZEC)</label>
            <input
              id="bid"
              type="text"
              inputMode="decimal"
              placeholder="0.0000"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") seal();
              }}
            />
          </div>
          <button type="button" onClick={seal}>
            seal and send
          </button>
        </div>
      ) : (
        <div className="round">
          <span className="dim">amount</span>
          <span className="brightish">{bid === null ? "—" : zec(bid)} ZEC</span>
          <span className="dim">state</span>
          <span>
            {bid === null
              ? "you sat this one out"
              : live.open
                ? "sealed — read when the block closes"
                : "opened"}
          </span>
          <span className="dim">memo</span>
          <span className="dim">
            zs1q…8f4c · block {live.block.toLocaleString("en-US")}
          </span>
        </div>
      )}

      <p className="i dim">
        A bid rides in the memo field of a shielded transaction. It is on the
        chain and it is timestamped, and it is encrypted to one reader. No
        commit-reveal, no second phase, nothing to walk back.
      </p>

      <h2>last rounds</h2>

      <table>
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
          {live.history.map((row, i) => (
            <tr key={row.round} className={i === 0 ? "fresh" : undefined}>
              <td>{row.round}</td>
              <td>{row.share}</td>
              <td className="dim">{row.clearing}</td>
              <td>{row.mine}</td>
              <td className={row.tone}>{row.outcome}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="foot dim">
        balance <span className="brightish">{zec(live.balance)}</span> ZEC ·{" "}
        <button type="button" className="linkish" onClick={() => setRunning((r) => !r)}>
          {running ? "pause" : "resume"}
        </button>
      </p>
    </div>
  );
}
