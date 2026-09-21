import type { Round } from "../lib/auction";

/** The brand's key visual is a cross-section of a trunk: rings crowding the
 * right edge and thinning away to the left. A ring is a year — a record of
 * time a tree keeps whether or not anybody reads it.
 *
 * So these are not decoration. One ring is one settled round, oldest at the
 * heart and the most recent on the outside, the way a trunk actually grows.
 * Rounds where the pool found a block are drawn wider and brighter. The
 * colour is the banner's own: its rings are a warm bone grey, sampled at
 * #807c74 through the strokes with the lit edges around #b1aa9f, and there is
 * no hue in them anywhere. A green ring read as an interface accent laid over
 * a texture, because no trunk has ever had one.
 *
 * It sits behind the clock rather than behind the figure, so the thing you
 * are meant to read stays on clean ground. */
export function Rings({ rounds }: { readonly rounds: readonly Round[] }) {
  // Oldest first, so index order runs heartwood to bark.
  const ordered = [...rounds].reverse();
  const count = Math.max(ordered.length, 1);

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
          <stop offset="1" stopColor="#c8c8c8" />
        </linearGradient>
        <mask id="ring-mask">
          <rect width="460" height="320" fill="url(#ring-fade)" />
        </mask>
      </defs>

      <g mask="url(#ring-mask)" fill="none">
        {ordered.map((round, i) => {
          const r = 26 + (i / count) * 420;
          // Rings crowd where growth was slow. A block year is a wide one.
          const width = round.foundBlock ? 2.4 : 1;
          return (
            <circle
              key={round.n}
              cx={520}
              cy={196}
              r={r}
              stroke={round.foundBlock ? "var(--ring-lit)" : "var(--ring)"}
              strokeWidth={width}
              opacity={round.foundBlock ? 0.5 : 0.26}
            />
          );
        })}
      </g>
    </svg>
  );
}
