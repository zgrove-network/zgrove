# zGrove

Distributed mining pool for Zcash. Contributors mine on their own hardware and
are paid in ZEC to shielded addresses, so no participant's earnings are visible
on-chain.

[docs/OVERVIEW.md](docs/OVERVIEW.md) has the architecture, the topology
decision behind v1, and the ground rules that govern share accounting and
payouts. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the decisions made
under those rules: how a worker proves who it is, what stake does and does not
buy, and what a fake looks like.

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

## Development

    pnpm install
    pnpm build
    pnpm test

`pnpm test` builds every package and runs the suites, including an end-to-end
one that puts a fake pool and a fake miner either side of the proxy.

## Running a worker

On the orchestrator, create an account and enrol the rig:

    zgrove account --payout <shielded address>
    zgrove enroll --account <id> --worker rig1 --key <public key>

On the contributor's machine:

    zgrove-worker init        # prints the public key to enrol
    ZGROVE_ACCOUNT_ID=<id> zgrove-worker run

With no miner configured, `run` prints the stratum address and the session
token to point a miner at. Set `ZGROVE_MINER_COMMAND` and `ZGROVE_MINER_ARGS`
(a JSON array, where `{host}`, `{port}` and `{token}` are filled in) to have
the agent launch the miner itself.

## Status

One worker mines a single algorithm through the proxy to one upstream pool,
and every accepted share lands in the database attributed to that worker. The
pool is told the account the proxy relays under and never the contributor's
own login. Nothing in this repo moves funds yet.

Known limits: no real pool has been on the other end of this yet, only a fake
one; the hashrate estimate assumes a difficulty-1 algorithm and needs
calibrating for Equihash; an upstream that drops is not reconnected to, by
design, and the miner is dropped with it.
