import { Mark } from "./Mark";

interface Props {
  readonly round: number;
  readonly block: number;
  readonly speed: number;
  readonly running: boolean;
  readonly onToggle: () => void;
}

export function TopBar({ round, block, speed, running, onToggle }: Props) {
  return (
    <header className="topbar">
      <Mark />
      <span className="wordmark">sealed box</span>

      <span className="topbar-round">
        <span className="dim">round</span> {round}
        <span className="sep">·</span>
        <span className="dim">block</span> {block.toLocaleString("en-US")}
      </span>

      <span className="grow" />

      <span className="badge" title="nothing on this screen has happened">
        <span className="dot" aria-hidden="true" />
        simulation
      </span>
      <span className="dim">{speed}&times;</span>
      <button type="button" className="ghost" onClick={onToggle}>
        {running ? "pause" : "resume"}
      </button>
    </header>
  );
}
