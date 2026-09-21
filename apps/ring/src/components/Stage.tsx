import { TARGET_SECONDS } from "../lib/chain";
import { clock } from "../lib/market";
import type { Block } from "../lib/chain";
import { Rings } from "./Rings";

interface Props {
  readonly blocks: readonly Block[];
  readonly elapsed: number;
  readonly poolTotal: number;
}

export function Stage({ blocks, elapsed, poolTotal }: Props) {
  const past = elapsed >= TARGET_SECONDS;
  // How far the clock has run toward the line, and a little beyond it, so
  // crossing is something you watch happen rather than a state change.
  const fill = Math.min(1, elapsed / (TARGET_SECONDS * 1.6));
  const notch = (TARGET_SECONDS / (TARGET_SECONDS * 1.6)) * 100;

  return (
    <section className="stage">
      <Rings blocks={blocks} />

      <div className="stage-grid">
        <div className="cell hero">
          <span className="k">since last block</span>
          <span className={past ? "figure over" : "figure"}>{clock(elapsed)}</span>
        </div>

        <div className="cell">
          <span className="k">line</span>
          <span className="v big">{TARGET_SECONDS}s</span>
        </div>

        <div className="cell">
          <span className="k">staked</span>
          <span className="v big">{poolTotal.toFixed(1)}</span>
        </div>

        {/* The size of the pool is public; which way it leans is not. That
            split is the only thing being kept back, and it is the thing an
            open order book would give away. */}
        <div className="cell">
          <span className="k">split</span>
          <span className="v big sealed">
            ???
            <span className="caret" aria-hidden="true">
              _
            </span>
          </span>
        </div>

        <div className="cell clock-cell">
          <span className="k">winning now</span>
          <span className={past ? "clock over" : "clock under"}>
            {past ? "over" : "under"}
          </span>
        </div>
      </div>

      <div className="demand">
        <div className="demand-bar">
          <span className={past ? "over" : undefined} style={{ width: `${fill * 100}%` }} />
          <i style={{ left: `${notch}%` }} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
