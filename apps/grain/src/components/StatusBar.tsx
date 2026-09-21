import { zec } from "../lib/auction";
import type { Round, Stats } from "../lib/auction";
import { Sparkline } from "./Sparkline";

interface Props {
  readonly rounds: readonly Round[];
  readonly stats: Stats;
}

export function StatusBar({ rounds, stats }: Props) {
  return (
    <footer className="statusbar">
      <div className="chart-cell">
        <span className="k">slot value, {stats.counted} rounds, log</span>
        <Sparkline rounds={rounds} field="perSlot" />
      </div>

      <div className="chart-cell">
        <span className="k">cost to win</span>
        <Sparkline rounds={rounds} field="clearing" />
      </div>

      <dl className="figures">
        <div>
          <dt>typical</dt>
          <dd>{zec(stats.typical)}</dd>
        </div>
        <div>
          <dt>average</dt>
          <dd>{zec(stats.average)}</dd>
        </div>
        <div>
          <dt>cost</dt>
          <dd>{zec(stats.cost)}</dd>
        </div>
        <div>
          <dt>best</dt>
          <dd className="good">{zec(stats.best)}</dd>
        </div>
        <div>
          <dt>empty</dt>
          <dd>
            {stats.empty}/{stats.counted}
          </dd>
        </div>
      </dl>
    </footer>
  );
}
