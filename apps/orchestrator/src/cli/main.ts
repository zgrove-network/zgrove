#!/usr/bin/env node
import { runStats } from "./stats.js";

const USAGE = `zgrove — operator commands for the orchestrator

  zgrove stats [options]   per-worker share accounting

Run a command with --help for its options.
`;

function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;

  switch (command) {
    case "stats":
      return runStats(rest, process.env);
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
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  // An operator at a terminal wants the sentence, not the stack.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
