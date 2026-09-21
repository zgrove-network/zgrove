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
      <div className="status-chart">
        <Sparkline rounds={rounds} />
        <span className="dim">
          last {stats.counted} rounds, log scale — tall ones are blocks
        </span>
      </div>

      <dl className="status-figures">
        <div>
          <dt>typical</dt>
          <dd>{zec(stats.typical)}</dd>
        </div>
        <div>
          <dt>average</dt>
          <dd>{zec(stats.average)}</dd>
        </div>
        <div>
          <dt>cost of a slot</dt>
          <dd>{zec(stats.cost)}</dd>
        </div>
        <div>
          <dt>best</dt>
          <dd className="good">{zec(stats.best)}</dd>
        </div>
        <div>
          <dt>near-empty</dt>
          <dd>
            {stats.empty}/{stats.counted}
          </dd>
        </div>
      </dl>
    </footer>
  );
}
