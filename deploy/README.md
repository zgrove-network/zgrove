# Deploying the orchestrator

From a fresh Linux server to a running pool. Any provider; the only
requirements are Docker and a hostname pointing at the machine.

## Once

```sh
# Docker, on Debian or Ubuntu.
curl -fsSL https://get.docker.com | sh

git clone git@github.com:quietmint-tech/zgrove.git
cd zgrove/deploy
cp .env.example .env
$EDITOR .env
```

In `.env`, at minimum: `ZGROVE_DOMAIN`, `ZGROVE_ADVERTISED_STRATUM_HOST`,
`ZGROVE_UPSTREAM_LOGIN` and `ZGROVE_TREASURY_ADDRESS`. The domain's DNS has to
resolve to this machine before the first start, because Caddy requests its
certificate for that name on boot.

Open three ports and nothing else:

| port | what | reaches |
|---|---|---|
| 3333 | stratum, plain TCP | the orchestrator |
| 443 | control plane over TLS | Caddy, then the orchestrator |
| 80 | certificate issuance and the redirect to 443 | Caddy |

3334, the control plane itself, is never published. It hands out bearer
tokens and speaks plain HTTP, so the only thing that can reach it is Caddy on
the compose network.

## Start

```sh
docker compose --env-file .env up -d --build
docker compose logs -f orchestrator
```

A healthy start logs `control.listening` and `stratum.listening`, the second
naming the upstream it relays to.

## The CLI

Everything that plans and records money runs inside the same container, against
the same database:

```sh
alias zgrove='docker compose exec orchestrator node dist/cli/main.js'

zgrove init
zgrove account --payout <shielded address>
zgrove enroll --account <id> --worker <name> --key <public key>
zgrove stats
zgrove payout --help
```

## Workers

A contributor's rig points at this deployment with:

```sh
ZGROVE_CONTROL_URL=https://pool.example.org
ZGROVE_ACCOUNT_ID=<their account>
```

The worker attests over TLS, receives a token, and runs its miner through a
relay on its own machine, which keeps the rig's own record of every share in
`~/.zgrove/shares.jsonl`.

## What to back up

The `zgrove-data` volume. It is the payout ledger, and it is the one thing here
that cannot be rebuilt from the chain.

```sh
zgrove backup --to /data/backup.sqlite
docker compose cp orchestrator:/data/backup.sqlite ./zgrove-$(date +%F).sqlite
docker compose exec orchestrator rm /data/backup.sqlite
```

Use that command and nothing else. The database runs in WAL mode, so recent
commits sit in a separate log until a checkpoint folds them in, and a plain
copy of the file taken before then is missing them. Measured on a young
database: a raw copy had no tables at all, while `zgrove backup` had every
table and every row.

## Anchoring

After a round is paid, its commitment can be written into a Solana memo, which
gives it a timestamp nobody here controls. A receipt that later disagrees with
its memo was changed afterwards.

The keypair lives outside the repository, in `deploy/secrets/` (ignored by git
and by the image build), and should hold only fee money:

```sh
mkdir -p secrets
solana-keygen new --no-bip39-passphrase -o secrets/solana.json
chmod 600 secrets/solana.json
# The container runs as uid 10001. A 0600 file owned by root is one it cannot
# read, and loosening the mode instead is refused on purpose.
chown 10001 secrets/solana.json
```

Then uncomment the `./secrets:/secrets:ro` line in `compose.yaml`, set
`ZGROVE_SOLANA_KEYPAIR=/secrets/solana.json`, and send a few thousand lamports
to the address it prints.

```sh
zgrove anchor --round 1             # dry run: signs, simulates, sends nothing
zgrove anchor --round 1 --confirm   # writes it
zgrove receipt --round 1            # now carries the anchor
```

The signature is printed the moment it is sent, before confirmation. If the
process stops in between, the memo may still land; record it with
`zgrove anchor --round 1 --signature <sig>`, which believes it only once the
chain shows that transaction carrying this round's memo.

## Stratum is plain TCP

As every pool's is. Someone positioned between a contributor and this server
could rewrite a stratum login and redirect that rig's work. TLS on stratum
(`stratum+ssl`) closes that and is not done yet; the control plane, where
tokens are issued, is already behind TLS.

## Verified

Built and run locally before this was written: the image loads better-sqlite3
natively, applies every migration, runs as a non-root user, and with
`ZGROVE_DOMAIN=localhost` the full stack served the control plane over TLS,
kept 3334 unreachable from the host, redirected plain HTTP to HTTPS, and
relayed stratum through to 2Miners, receiving a live Ergo job.
