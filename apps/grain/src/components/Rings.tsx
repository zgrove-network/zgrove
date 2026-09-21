import type { Round } from "../lib/auction";

/** The brand's key visual is a cross-section of a trunk. Rings are not
 * decoration here: one ring is one settled round, oldest at the heart and the
 * newest at the bark, the way a trunk actually grows.
 *
 * Two things the first version got wrong. It drew perfect concentric circles
 * at even spacing, which is a radar sweep rather than wood. And it marked the
 * rounds that found a block in green — no trunk has a green ring, and the
 * colour read as an interface accent sitting on a texture.
 *
 * Both are fixed by being literal about dendrology. A good year is a WIDE
 * ring, so the gap to the next ring is proportional to what that round paid;
 * lean rounds crowd together and a block pushes the next ring out. That says
 * everything the green was saying, in the language the picture is already
 * speaking, and the whole thing goes back to one colour. */

const POINTS = 72;

/** A ring that is not a circle. Three harmonics at seeded phases, a couple of
 * percent each, plus a slight oval — a cut trunk is never round. */
function ringPath(cx: number, cy: number, r: number, seed: number): string {
  let d = "";
  for (let i = 0; i <= POINTS; i += 1) {
    const a = (i / POINTS) * Math.PI * 2;
    const wobble =
      1 +
      0.026 * Math.sin(a * 3 + seed) +
      0.015 * Math.sin(a * 5 + seed * 1.7) +
      0.009 * Math.sin(a * 9 + seed * 2.6);
    const rr = r * wobble;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.93;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return `${d}Z`;
}

const CX = 520;
const CY = 196;
const HEART = 22;
const BUDGET = 440;
const MIN_STEP = 4;

export function Rings({ rounds }: { readonly rounds: readonly Round[] }) {
  // Oldest first: index order runs heartwood to bark.
  const ordered = [...rounds].reverse();
  if (ordered.length === 0) return null;

  const logs = ordered.map((r) => Math.log10(Math.max(r.perSlot, 1e-6)));
  const lo = Math.min(...logs);
  const hi = Math.max(...logs);
  const span = hi - lo || 1;
  const share = logs.map((l) => (l - lo) / span);
  const shareTotal = share.reduce((a, b) => a + b, 0) || 1;
  const spare = Math.max(BUDGET - MIN_STEP * ordered.length, 0);

  let r = HEART;
  const rings = ordered.map((round, i) => {
    r += MIN_STEP + ((share[i] ?? 0) / shareTotal) * spare;
    return { round, r, seed: (round.n % 97) * 0.37 };
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

      <g mask="url(#ring-mask)" fill="none" stroke="var(--ring)">
        {rings.map(({ round, r: radius, seed }, i) => (
          <path
            key={round.n}
            d={ringPath(CX, CY, radius, seed)}
            strokeWidth={0.7 + (share[i] ?? 0) * 1.9}
            opacity={0.16 + (share[i] ?? 0) * 0.2}
          />
        ))}
      </g>
    </svg>
  );
}
