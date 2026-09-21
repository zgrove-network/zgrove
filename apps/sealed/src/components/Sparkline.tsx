import { barHeights } from "../lib/auction";
import type { Round } from "../lib/auction";

interface Props {
  readonly rounds: readonly Round[];
  readonly field: "perSlot" | "clearing";
}

export function Sparkline({ rounds, field }: Props) {
  const ordered = [...rounds].reverse();
  const heights = barHeights(ordered.map((r) => r[field]));

  return (
    <div className="spark" aria-hidden="true">
      {heights.map((height, i) => {
        const round = ordered[i];
        const lit = field === "perSlot" && round?.foundBlock === true;
        return (
          <span
            key={round?.n ?? i}
            className={lit ? "spark-bar block" : "spark-bar"}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}
