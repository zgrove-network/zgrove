import { useState } from "react";

import { TARGET_SECONDS } from "../lib/chain";
import { backtest, signed, zec, type Position, type Round, type Side } from "../lib/market";

interface Props {
  readonly position: Position | null;
  readonly nextHeight: number | null;
  readonly rounds: readonly Round[];
  readonly onTake: (side: Side, stake: number) => void;
}

export function SidePanel({ position, nextHeight, rounds, onTake }: Props) {
  const [side, setSide] = useState<Side>("under");
  const [draft, setDraft] = useState("");

  const typed = Number.parseFloat(draft);
  const valid = Number.isFinite(typed) && typed > 0;

  if (position !== null) {
    return (
      <section className="panel">
        <h2>position</h2>
        <div className="box sealed-box">
          <span className={position.side === "under" ? "figure mid under" : "figure mid over"}>
            {position.side}
          </span>
          <span className="unit">{TARGET_SECONDS}s</span>
        </div>
        <dl className="rows">
          <dt>stake</dt>
          <dd className="bright">{zec(position.stake)}</dd>
          <dt>on block</dt>
          <dd>{position.height.toLocaleString("en-US")}</dd>
          <dt>state</dt>
          <dd className="live">sealed</dd>
          <dt>memo</dt>
          <dd>zs1q…8f4c</dd>
        </dl>
      </section>
    );
  }

  const settled = rounds.filter((r) => r.interval !== null);
  const hits = settled.slice(0, 20).filter((r) => r.won === side).length;
  const of = Math.min(20, settled.length);
  const projected = backtest(side, rounds);

  return (
    <section className="panel">
      <h2>position</h2>

      <div className="sides">
        <button
          type="button"
          className={side === "under" ? "side picked under" : "side"}
          onClick={() => setSide("under")}
        >
          <span className="k">under</span>
          <span className="v">{TARGET_SECONDS}s</span>
        </button>
        <button
          type="button"
          className={side === "over" ? "side picked over" : "side"}
          onClick={() => setSide("over")}
        >
          <span className="k">over</span>
          <span className="v">{TARGET_SECONDS}s</span>
        </button>
      </div>

      <div className="box">
        <input
          id="stake"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.0000"
          aria-label="stake, in ZEC"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid) onTake(side, typed);
          }}
        />
        <span className="unit">ZEC</span>
      </div>

      <dl className="rows">
        <dt>{side} won, last {of}</dt>
        <dd className={of === 0 ? "faint" : hits > of / 2 ? "good" : "bad"}>
          {of === 0 ? "—" : `${hits}/${of}`}
        </dd>
        <dt>always {side}, last {of}</dt>
        <dd className={of === 0 ? "faint" : projected >= 0 ? "good" : "bad"}>
          {of === 0 ? "—" : signed(projected)}
        </dd>
        <dt>what it pays</dt>
        <dd className="faint">sealed</dd>
      </dl>

      <button
        type="button"
        className="primary"
        disabled={!valid || nextHeight === null}
        onClick={() => onTake(side, typed)}
      >
        seal
      </button>
    </section>
  );
}
