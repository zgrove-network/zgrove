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

  // How full the round is. Past twenty envelopes somebody is going home empty
  // handed, which is the moment the number starts to matter.
  const fill = Math.min(1, bids / (SLOTS * 2.5));

  return (
    <section className="stage">
      <Rings rounds={rounds} />

      <div className="stage-core">
        {open ? (
          <>
            <div className="figure waiting">
              ???
              <span className="caret" aria-hidden="true">
                _
              </span>
            </div>
            <p className="figure-label">in the box · sealed until the block closes</p>
          </>
        ) : (
          <>
            <div className={foundBlock ? "figure hit" : "figure"}>{settled} ZEC</div>
            <p className="figure-label">
              <strong>{zec((pot ?? 0) / SLOTS)}</strong> per slot ·{" "}
              {foundBlock ? "the pool found a block" : "a quiet round"}
            </p>
          </>
        )}

        <div className={soon ? "clock soon" : "clock"}>
          {open ? `${mm}:${ss}` : "00:00"}
          <span className="clock-label">{open ? "until it opens" : "opened"}</span>
        </div>
      </div>

      <div className="demand">
        <div className="demand-bar">
          <span style={{ width: `${fill * 100}%` }} />
          <i style={{ left: `${(SLOTS / (SLOTS * 2.5)) * 100}%` }} aria-hidden="true" />
        </div>
        <p className="demand-label">
          <strong>{bids}</strong> bids for <strong>{SLOTS}</strong> slots ·
          amounts hidden from everyone, us included
        </p>
      </div>
    </section>
  );
}
