# zGrove

Distributed mining pool for Zcash. Contributors mine on their own hardware and
are paid in ZEC to shielded addresses, so no participant's earnings are visible
on-chain.

See `CLAUDE.md` for the architecture, the topology decision behind v1, and the
ground rules that govern share accounting and payouts.

## Layout

    apps/
      orchestrator/   stratum proxy + control plane + accounting
      worker/         the contributor agent
    packages/
      protocol/       shared types: stratum messages, control-plane messages
      db/             schema + migrations + query helpers

## Requirements

- Node 20+
- pnpm 9

## Status

Milestone 1: one worker mines a single algorithm through the proxy to one
upstream pool, and every accepted share lands in the database attributed to
that worker. Nothing in this repo moves funds yet.
