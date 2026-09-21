import { TARGET_SECONDS, type Block } from "../lib/chain";

/** One ring per block, and the ring's width is how long that block took.
 *
 * In a trunk a wide ring is a long season. Here it is a long wait, which is
 * exactly the quantity the market is on — so the drawing is not a backdrop
 * borrowed from the brand, it is the data. Blocks that ran past the line are
 * drawn in the lit tone: those are the rounds "over" took. */
export function Rings({ blocks }: { readonly blocks: readonly Block[] }) {
  const ordered = [...blocks].reverse().filter((b) => b.interval !== null);
  if (ordered.length === 0) return null;

  const gaps = ordered.map((b) => b.interval ?? 0);
  const total = gaps.reduce((a, b) => a + b, 0) || 1;

  const HEART = 22;
  const BUDGET = 440;
  const MIN_STEP = 3;
  const spare = Math.max(BUDGET - MIN_STEP * ordered.length, 0);

  let r = HEART;
  const rings = ordered.map((block, i) => {
    r += MIN_STEP + ((gaps[i] ?? 0) / total) * spare;
    return { block, r, past: (block.interval ?? 0) >= TARGET_SECONDS };
  });

  return (
    <svg
      className="rings"
      viewBox="0 0 460 320"
      preserveAspectRatio="xMaxYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="ring-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" />
          <stop offset="0.68" stopColor="#3a3a3a" />
          <stop offset="1" stopColor="#d2d2d2" />
        </linearGradient>
        <mask id="ring-mask">
          <rect width="460" height="320" fill="url(#ring-fade)" />
        </mask>
      </defs>

      <g mask="url(#ring-mask)" fill="none">
        {rings.map(({ block, r: radius, past }) => (
          <circle
            key={block.height}
            cx={520}
            cy={196}
            r={radius}
            stroke={past ? "var(--ring-lit)" : "var(--ring)"}
            strokeWidth={past ? 1.6 : 0.9}
            opacity={past ? 0.44 : 0.24}
          />
        ))}
      </g>
    </svg>
  );
}
