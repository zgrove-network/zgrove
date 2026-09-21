# zGrove

A distributed mining pool for Zcash. Contributors run an agent on their own
hardware; the network routes work to them and pays out in ZEC to **shielded
addresses**, so no participant's earnings are visible on-chain.

That last part is the product. Everything else is table stakes.

## Architecture (target)

```
 contributor machine
 ┌──────────────────────┐
 │ zgrove-worker        │  benchmark -> capability report
 │ lolMiner / SRBMiner  │ <--- algo assignment (ws control plane)
 └──────────┬───────────┘
            │ stratum (tcp)
            v
 ┌────────────────────────────────────────┐
 │ zgrove-orchestrator                    │
 │  - stratum proxy   (share accounting)  │  <- source of truth
 │  - control plane   (attestation, hb)   │
 │  - switcher        (profitability)     │
 │  - anti-cheat      (withholding, fake hashrate)
 └──────────┬─────────────────────────────┘
            │ upstream stratum
            v
   upstream pools (2Miners / ViaBTC / NiceHash)
            │ coin payouts
            v
 ┌────────────────────────────────────────┐
 │ treasury: coin -> ZEC, monthly         │
 │ shielded payout via zallet z_sendmany  │
 └────────────────────────────────────────┘
```

## The topology decision

v1 does **not** run coin nodes or build block templates. It is a stratum proxy
plus an accounting layer in front of existing upstream pools. We own
attribution; upstream owns consensus.

Running our own pool — own nodes, own templates, orphan risk, variance — is a
later phase and is out of scope until volume justifies it. The reasoning, and
what would have to change to revisit it, is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Stack

- TypeScript, Node 20+
- Orchestrator: plain TCP server (`node:net`) for stratum; HTTP for the
  attestation handshake, with a persistent control-plane connection to follow
  when assignment and heartbeat need one
- DB: SQLite via `better-sqlite3` (single writer, WAL). Postgres later if needed.
- Web: Next.js (App Router), exported static. It holds no secrets and
  reaches nothing private, so it can sit anywhere and stay up when the pool
  does not.
- Payouts: `zebrad` for the chain and `zallet` for the wallet, `z_sendmany`
  to Orchard/Sapling addresses. `zcashd` reached its end-of-support halt on
  2026-07-18 and refuses to start.

## Ground rules

These are not style preferences. Each one exists because breaking it costs a
contributor money or privacy.

- Share accounting is the source of truth for payouts. It must be derived from
  what the **upstream pool accepted**, never from what a worker claims.
- Never trust worker-reported hashrate for money. It is a UX number only.
- Store rolled-up shares (5-minute buckets), not raw shares. Raw share volume
  will destroy the DB.
- Credit each share at its USD value **at submit time**, so multi-algo
  contributions are comparable and later price moves don't retroactively change
  what someone earned.
- No secrets in the repo. Wallet keys live outside version control, always.
- Every payout path gets a dry-run mode. We do not ship code that moves funds
  without one.

## Repo layout

```
apps/
  orchestrator/     stratum proxy + control plane + accounting + CLI
  worker/           the contributor agent
  web/              the public site: landing, calculator, receipts
packages/
  protocol/         shared types: stratum, attestation, control plane
  db/               schema + migrations + query helpers
docs/
  OVERVIEW.md       this file
  ARCHITECTURE.md   the decisions made under these rules, and why
```
