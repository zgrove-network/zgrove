import { useState } from "react";

import { LOOKBACK, backtest, hitRate, signed, zec } from "../lib/auction";
import type { Round, Stats } from "../lib/auction";

interface Props {
  readonly open: boolean;
  readonly myBid: number | null;
  readonly block: number;
  readonly history: readonly Round[];
  readonly stats: Stats;
  readonly onSeal: (amount: number) => void;
}

export function BidPanel({ open, myBid, block, history, stats, onSeal }: Props) {
  const [draft, setDraft] = useState("");

  const typed = Number.parseFloat(draft);
  const valid = Number.isFinite(typed) && typed > 0;

  if (myBid !== null) {
    return (
      <section className="panel">
        <h2>your bid</h2>
        <div className="sealed-bid">
          <span className="amount-big">{zec(myBid)}</span>
          <span className="unit">ZEC</span>
        </div>
        <p className={open ? "state sealed" : "state"}>
          {open ? "sealed — read when the block closes" : "opened"}
        </p>
        <dl className="meta">
          <dt>memo</dt>
          <dd>zs1q…8f4c</dd>
          <dt>block</dt>
          <dd>{block.toLocaleString("en-US")}</dd>
        </dl>
        <p className="note">
          One shielded transaction, encrypted the moment it lands. No hash to
          publish now and reveal later — there is nothing left to reveal.
        </p>
      </section>
    );
  }

  if (!open) {
    return (
      <section className="panel">
        <h2>your bid</h2>
        <p className="note">You sat this round out. The next opens in a moment.</p>
      </section>
    );
  }

  const odds = valid ? hitRate(typed, history) : null;
  const projected = valid ? backtest(typed, history) : null;

  return (
    <section className="panel">
      <h2>your bid</h2>

      <div className="field">
        <input
          id="bid"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.0000"
          aria-label="your bid, in ZEC"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid) onSeal(typed);
          }}
        />
        <span className="unit">ZEC</span>
      </div>

      <div className="quick">
        <button type="button" onClick={() => setDraft(zec(stats.cost))}>
          {zec(stats.cost)}
          <small>usual</small>
        </button>
        <button type="button" onClick={() => setDraft(zec(stats.cost * 1.5))}>
          {zec(stats.cost * 1.5)}
          <small>safer</small>
        </button>
      </div>

      <div className="readout">
        {odds === null || projected === null ? (
          <p className="note">
            Put an amount in and this says how often it would have taken a slot,
            and what bidding it every round would have come to.
          </p>
        ) : (
          <>
            <p className="odds">
              takes a slot in{" "}
              <strong className={odds.hits > odds.of / 2 ? "good" : "bad"}>
                {odds.hits} of {odds.of}
              </strong>{" "}
              recent rounds
            </p>
            <p className="note">
              bidding it every round over those {LOOKBACK} would have come to{" "}
              <strong className={projected >= 0 ? "good" : "bad"}>
                {signed(projected)}
              </strong>{" "}
              ZEC — which turns almost entirely on whether a block landed inside
              them
            </p>
          </>
        )}
      </div>

      <button
        type="button"
        className="primary"
        disabled={!valid}
        onClick={() => onSeal(typed)}
      >
        seal and send
      </button>
    </section>
  );
}
