import { SLOTS, zec } from "../lib/auction";
import type { Round } from "../lib/auction";
import { useSettle } from "../hooks/useSettle";
import { Rings } from "./Rings";

interface Props {
  readonly rounds: readonly Round[];
  readonly open: boolean;
  readonly left: number;
  readonly bids: number;
  readonly pot: number | null;
  readonly foundBlock: boolean;
}

export function Stage({ rounds, open, left, bids, pot, foundBlock }: Props) {
  const settled = useSettle(pot === null ? null : zec(pot));

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const soon = open && left <= 12;

  // Past twenty envelopes somebody goes home empty handed, which is when the
  // number starts to matter. The notch marks it.
  const fill = Math.min(1, bids / (SLOTS * 2.5));

  return (
    <section className="stage">
      <Rings rounds={rounds} />

      <div className="stage-grid">
        <div className="cell hero">
          <span className="k">in the box</span>
          {open ? (
            <span className="figure waiting">
              ???
              <span className="caret" aria-hidden="true">
                _
              </span>
            </span>
          ) : (
            <span className={foundBlock ? "figure hit" : "figure"}>{settled}</span>
          )}
        </div>

        <div className="cell">
          <span className="k">bids</span>
          <span className="v big">{bids}</span>
        </div>

        <div className="cell">
          <span className="k">slots</span>
          <span className="v big">{SLOTS}</span>
        </div>

        <div className="cell">
          <span className="k">per slot</span>
          <span className="v big">{pot === null ? "—" : zec(pot / SLOTS)}</span>
        </div>

        <div className="cell clock-cell">
          <span className="k">{open ? "closes" : "opened"}</span>
          <span className={soon ? "clock soon" : "clock"}>
            {open ? `${mm}:${ss}` : "00:00"}
          </span>
        </div>
      </div>

      <div className="demand">
        <div className="demand-bar">
          <span style={{ width: `${fill * 100}%` }} />
          <i style={{ left: `${(1 / 2.5) * 100}%` }} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
