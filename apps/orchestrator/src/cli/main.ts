#!/usr/bin/env node
import { ACCOUNT_USAGE, ENROLL_USAGE, runAccount, runEnroll } from "./enroll.js";
import { PROBE_USAGE, runProbe } from "./probe.js";
import { runStats } from "./stats.js";

const USAGE = `zgrove — operator commands for the orchestrator

  zgrove stats [options]     per-worker share accounting
  zgrove account [options]   create a contributor account
  zgrove enroll [options]    bind a rig's key to an account
  zgrove probe [options]     learn a real pool's dialect without mining

Run a command with --help for its options.
`;

/** Returns 0 when the command was only asked for its usage. */
function help(argv: readonly string[], usage: string): number | null {
  if (!argv.includes("--help") && !argv.includes("-h")) {
    return null;
  }
  process.stdout.write(usage);
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case "stats":
      return runStats(rest, process.env);
    case "account":
      return help(rest, ACCOUNT_USAGE) ?? runAccount(rest, process.env);
    case "enroll":
      return help(rest, ENROLL_USAGE) ?? runEnroll(rest, process.env);
    case "probe":
      return help(rest, PROBE_USAGE) ?? runProbe(rest);
    case undefined:
    case "--help":
    case "-h":
    case "help":
      process.stdout.write(USAGE);
      return 0;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      return 2;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  // An operator at a terminal wants the sentence, not the stack.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
