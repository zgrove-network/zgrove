import { spawn, type ChildProcess } from "node:child_process";

export interface MinerCommand {
  readonly command: string;
  /** Placeholders {host} {port} {token} are filled from the session. */
  readonly args: readonly string[];
}

export interface MinerTarget {
  readonly host: string;
  readonly port: number;
  readonly token: string;
}

/**
 * Substitution happens on the argument vector, never on a shell string. The
 * miner is launched without a shell, so nothing in a token or a hostname can
 * be read as a shell operator no matter what it contains.
 */
export function fillArgs(
  args: readonly string[],
  target: MinerTarget,
): string[] {
  return args.map((arg) =>
    arg
      .replaceAll("{host}", target.host)
      .replaceAll("{port}", String(target.port))
      .replaceAll("{token}", target.token),
  );
}

export interface RunningMiner {
  readonly process: ChildProcess;
  /** Resolves with the exit code, or null when a signal ended it. */
  readonly exited: Promise<number | null>;
  stop(): void;
}

export function startMiner(
  miner: MinerCommand,
  target: MinerTarget,
): RunningMiner {
  const child = spawn(miner.command, fillArgs(miner.args, target), {
    // The miner's own output is what a contributor watches to know it works,
    // so it goes to the same terminal rather than into a buffer nobody reads.
    stdio: "inherit",
    shell: false,
  });

  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
    child.once("error", () => resolve(null));
  });

  return {
    process: child,
    exited,
    stop() {
      // Asked to stop first. A miner killed outright abandons whatever shares
      // it had in flight, and those are a contributor's earnings.
      child.kill("SIGTERM");
    },
  };
}
