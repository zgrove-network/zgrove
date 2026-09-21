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
      <span className="wordmark">grain</span>

      <span className="tb">
        <span className="k">round</span>
        <span className="v">{round}</span>
      </span>
      <span className="tb">
        <span className="k">block</span>
        <span className="v">{block.toLocaleString("en-US")}</span>
      </span>

      <span className="grow" />

      <span className="badge">sim</span>
      <span className="tb">
        <span className="k">speed</span>
        <span className="v">{speed}&times;</span>
      </span>
      <button type="button" className="ghost" onClick={onToggle}>
        {running ? "pause" : "run"}
      </button>
    </header>
  );
}
