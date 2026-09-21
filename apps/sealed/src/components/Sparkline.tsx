import { barHeights } from "../lib/auction";
import type { Round } from "../lib/auction";

export function Sparkline({ rounds }: { readonly rounds: readonly Round[] }) {
  const ordered = [...rounds].reverse();
  const heights = barHeights(ordered.map((r) => r.perSlot));

  return (
    <div className="spark" aria-hidden="true">
      {heights.map((height, i) => (
        <span
          key={ordered[i]?.n ?? i}
          className={ordered[i]?.foundBlock === true ? "spark-bar block" : "spark-bar"}
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}
