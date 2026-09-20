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
 │  - control plane   (ws: assign, hb)    │
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
 │ shielded payout via z_sendmany         │
 └────────────────────────────────────────┘
```

**Topology decision:** v1 does NOT run coin nodes or build block templates.
It is a stratum proxy plus an accounting layer in front of existing upstream
pools. We own attribution; upstream owns consensus. Running our own pool
(own nodes, own templates, orphan risk, variance) is a later phase and is
explicitly out of scope until volume justifies it.

## Stack

- TypeScript, Node 20+
- Orchestrator: plain TCP server (`node:net`) for stratum, `socket.io` for the
  control plane
- DB: SQLite via `better-sqlite3` (single writer, WAL). Postgres later if needed.
- Web/dashboard: Next.js (App Router) — **not in milestone 1**
- Payouts: `zcashd` RPC, `z_sendmany` to Orchard/Sapling addresses

## Ground rules

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
  orchestrator/     stratum proxy + control plane + accounting
  worker/           the contributor agent
packages/
  protocol/         shared types: stratum messages, control-plane messages
  db/               schema + migrations + query helpers
```

## Milestone 1 — the only thing that matters right now

One worker connects, mines a single algorithm through the proxy to one upstream
pool, and every accepted share lands in the database attributed to that worker.

Done means:
- `apps/orchestrator` accepts stratum TCP connections
- worker identity is parsed from the stratum login (`user.workerName`)
- the proxy maintains an upstream connection and relays both directions
- `mining.submit` responses from upstream are matched to the submitting worker
  and recorded as accepted or rejected
- shares are rolled into 5-minute buckets in SQLite
- a `zgrove stats` CLI prints per-worker accepted/rejected counts and est. hashrate
- integration test: a fake upstream pool + a fake miner, asserting the accounting

Not in milestone 1: multi-algo, switching, benchmarking, anti-cheat, payouts,
web UI, tokens, auth.
