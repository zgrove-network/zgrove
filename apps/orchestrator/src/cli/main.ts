#!/usr/bin/env node
import { ANCHOR_USAGE, runAnchor } from "./anchor.js";
import { BACKUP_USAGE, runBackup } from "./backup.js";
import { ACCOUNT_USAGE, ENROLL_USAGE, runAccount, runEnroll } from "./enroll.js";
import { BIND_USAGE, runBindWallet } from "./bind.js";
import { INIT_USAGE, runInit } from "./init.js";
import { PAYOUT_USAGE, runPayout } from "./payout.js";
import { PROBE_USAGE, runProbe } from "./probe.js";
import { RECEIPT_USAGE, runReceipt } from "./receipt.js";
import { SEND_USAGE, runSend } from "./send.js";
import { SETTLE_USAGE, runSettle } from "./settle.js";
import { runStats } from "./stats.js";

const USAGE = `zgrove — operator commands for the orchestrator

  zgrove init [options]      prepare a checkout to be started
  zgrove stats [options]     per-worker share accounting
  zgrove account [options]   create a contributor account
  zgrove enroll [options]    bind a rig's key to an account
  zgrove bind-wallet [opts]  prove a Solana wallet for an account's fee tier
  zgrove probe [options]     learn a real pool's dialect without mining
  zgrove payout [options]    work out what each account is owed (sends nothing)
  zgrove send [options]      pay a recorded round (dry run unless --confirm)
  zgrove settle [options]    record a round paid by hand, after checking the chain
  zgrove receipt [options]   the verifiable artifact for a round that was paid
  zgrove anchor [options]    write a paid round's commitment into a Solana memo
  zgrove backup --to <path>  a consistent copy of the database, while it runs

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
    case "init":
      return help(rest, INIT_USAGE) ?? runInit(rest, process.env);
    case "stats":
      return runStats(rest, process.env);
    case "account":
      return help(rest, ACCOUNT_USAGE) ?? runAccount(rest, process.env);
    case "enroll":
      return help(rest, ENROLL_USAGE) ?? runEnroll(rest, process.env);
    case "bind-wallet":
      return help(rest, BIND_USAGE) ?? runBindWallet(rest, process.env);
    case "probe":
      return help(rest, PROBE_USAGE) ?? runProbe(rest);
    case "payout":
      return help(rest, PAYOUT_USAGE) ?? runPayout(rest, process.env);
    case "send":
      return help(rest, SEND_USAGE) ?? runSend(rest, process.env);
    case "settle":
      return help(rest, SETTLE_USAGE) ?? runSettle(rest, process.env);
    case "receipt":
      return help(rest, RECEIPT_USAGE) ?? runReceipt(rest, process.env);
    case "anchor":
      return help(rest, ANCHOR_USAGE) ?? runAnchor(rest, process.env);
    case "backup":
      return help(rest, BACKUP_USAGE) ?? runBackup(rest, process.env);
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
