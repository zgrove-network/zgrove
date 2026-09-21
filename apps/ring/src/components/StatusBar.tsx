import { TARGET_SECONDS, type Block } from "../lib/chain";
import type { Stats } from "../lib/market";

interface Props {
  readonly blocks: readonly Block[];
  readonly stats: Stats;
}

export function StatusBar({ blocks, stats }: Props) {
  const gaps = [...blocks]
    .reverse()
    .map((b) => b.interval)
    .filter((v): v is number => v !== null);

  const tallest = Math.max(TARGET_SECONDS, ...gaps, 1);
  const line = (TARGET_SECONDS / tallest) * 100;
  const share = stats.counted === 0 ? 0 : (stats.under / stats.counted) * 100;

  return (
    <footer className="statusbar">
      <div className="chart-cell">
        <span className="k">
          how long each of the last {stats.counted} blocks took
        </span>
        <div className="spark" aria-hidden="true">
          <i className="spark-line" style={{ bottom: `${line}%` }} />
          {gaps.map((gap, i) => (
            <span
              key={i}
              className={gap >= TARGET_SECONDS ? "spark-bar over" : "spark-bar"}
              style={{ height: `${(gap / tallest) * 100}%` }}
            />
          ))}
        </div>
      </div>

      <dl className="figures">
        <div>
          <dt>median</dt>
          <dd>{stats.median}s</dd>
        </div>
        <div>
          <dt>mean</dt>
          <dd>{stats.mean.toFixed(1)}s</dd>
        </div>
        <div>
          <dt>came in under</dt>
          <dd className="under">{share.toFixed(0)}%</dd>
        </div>
        <div>
          <dt>longest</dt>
          <dd className="over">{stats.longest}s</dd>
        </div>
      </dl>
    </footer>
  );
}
