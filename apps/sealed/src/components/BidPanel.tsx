import { useState } from "react";

import { LOOKBACK, backtest, blocksWithin, hitRate, signed, zec } from "../lib/auction";
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
        <h2>bid</h2>
        <div className="box sealed-box">
          <span className="figure mid">{zec(myBid)}</span>
          <span className="unit">ZEC</span>
        </div>
        <dl className="rows">
          <dt>state</dt>
          <dd className={open ? "live" : undefined}>{open ? "sealed" : "opened"}</dd>
          <dt>memo</dt>
          <dd>zs1q…8f4c</dd>
          <dt>block</dt>
          <dd>{block.toLocaleString("en-US")}</dd>
        </dl>
      </section>
    );
  }

  if (!open) {
    return (
      <section className="panel">
        <h2>bid</h2>
        <div className="box empty">
          <span className="figure mid faint">—</span>
        </div>
        <dl className="rows">
          <dt>state</dt>
          <dd>stood out</dd>
        </dl>
      </section>
    );
  }

  const odds = valid ? hitRate(typed, history) : null;
  const projected = valid ? backtest(typed, history) : null;
  const blocks = blocksWithin(history);

  return (
    <section className="panel">
      <h2>bid</h2>

      <div className="box">
        <input
          id="bid"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.0000"
          aria-label="bid, in ZEC"
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
          <span className="k">usual</span>
          <span className="v">{zec(stats.cost)}</span>
        </button>
        <button type="button" onClick={() => setDraft(zec(stats.cost * 1.5))}>
          <span className="k">safer</span>
          <span className="v">{zec(stats.cost * 1.5)}</span>
        </button>
      </div>

      <dl className="rows">
        <dt>fills, last {LOOKBACK}</dt>
        <dd className={odds === null ? "faint" : odds.hits > odds.of / 2 ? "good" : "bad"}>
          {odds === null ? "—" : `${odds.hits}/${odds.of}`}
        </dd>

        <dt>p&amp;l over them</dt>
        <dd className={projected === null ? "faint" : projected >= 0 ? "good" : "bad"}>
          {projected === null ? "—" : signed(projected)}
        </dd>

        {/* The p&l above swings from a loss to a fortune on this line alone. */}
        <dt>blocks in them</dt>
        <dd className={blocks > 0 ? "good" : undefined}>{blocks}</dd>
      </dl>

      <button
        type="button"
        className="primary"
        disabled={!valid}
        onClick={() => onSeal(typed)}
      >
        seal
      </button>
    </section>
  );
}
