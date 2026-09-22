# The first payout

The one line on the front page still reading `not yet` is `money actually
moved`. This is the whole sequence that changes it, in order. Every step below
has been run except the ones that need the things in the first section.

## What has to be bought first

| what | roughly | why |
|---|---|---|
| a Linux VPS | $5–10 a month | the orchestrator has to be reachable from the internet |
| a domain name | $10 a year | Caddy needs a name to get a TLS certificate for |
| BTC or LTC | $10–40 | a day of rented Ergo hashrate on MiningRigRentals, no KYC |
| ZEC, in Zashi | 0.05 ZEC | pays the round; the round from one day will be well under this |
| SOL | 0.01 SOL | the fee to anchor the round's commitment; optional |
| an Ergo address | free | the upstream account the work is relayed under |

Why not ZEC alone: a round can only be planned from accepted work. `zgrove
payout` refuses a total with nothing behind it, on purpose, so there is no
honest first payout without mining first. Forcing one out of invented shares
would produce a receipt that looks exactly like a real payment, and the
receipts page exists to never show one of those.

## 1. Deploy

Follow `deploy/README.md`. In `deploy/.env`, `ZGROVE_UPSTREAM_LOGIN` is the
Ergo address, `ZGROVE_UPSTREAM_HOST` is `erg.2miners.com`, port `8888`,
`ZGROVE_ALGO` is `autolykos2`. Then:

```sh
docker compose --env-file .env up -d --build
alias zgrove='docker compose exec orchestrator node dist/cli/main.js'
zgrove init
```

## 2. An account to pay

The first round pays whoever did the work, which is the rented rig, which is
you. Use a Zashi address that is not the one you pay from:

```sh
zgrove account --payout <a u1… or zs… address>
```

It prints the account id.

## 3. Mine

Rent an Ergo (Autolykos) rig on MiningRigRentals for a day and point it at:

```
stratum+tcp://<your domain>:3333
```

A rented rig has no worker agent, so for this first round it logs in by name.
Turn that on for the duration and off again afterwards — while it is on,
anyone who types an account's name can mine as that account:

```sh
# in deploy/.env, then restart
ZGROVE_ALLOW_LEGACY_LOGIN=true
```

The login is `<account id>.<any rig name>`. Watch it arrive:

```sh
zgrove stats
```

Shares should be accepted. If they are all rejected, stop the rental and
check the upstream address before paying for more.

When the day is over, set `ZGROVE_ALLOW_LEGACY_LOGIN=false` and restart.

## 4. Plan the round

```sh
zgrove payout --from 2026-10-01 --to 2026-10-02 --total 0.03 --fee-bps 0 --record
```

`--total` is in **ZEC**, not zatoshi: what the upstream pool credited for that
window, converted. `--fee-bps 0` because this round pays yourself; the default
is 1%. `--record` is what writes the round down as planned — without it the
command only prints, and there is no round for the next step to settle.

It sends nothing either way. It prints each account and its amount, and a
check line that must read `OK`.

One thing to watch: an account owed less than `--min-payout` (default 0.001
ZEC) is carried forward to the next round instead of being paid. A very short
rental can land under that.

## 5. Pay it

From Zashi, send each amount the plan printed to each address it printed —
for the first round, one amount to one address. Copy the transaction id.

## 6. Record it

```sh
zgrove settle --round 1 --txid <txid>            # checks the chain, records nothing
zgrove settle --round 1 --txid <txid> --confirm  # records it
```

It looks the transaction up on chain and refuses one that is not there or not
shielded. A payment from Zashi goes through Orchard, which the explorer does
not decode; settle recognises it because it spent nothing transparent. This
was broken until it was checked against live Orchard transactions, and fixed
before anything was paid.

**If it says the explorer did not answer, do not send the payment again.** The
message names the reason — a rate limit, a timeout, an unreachable host. It is
about the explorer, not about your transaction, and it appears when nothing is
known either way. Blockchair's free tier is easy to exhaust and answers with
an HTTP 430; wait, or point `ZGROVE_EXPLORER_URL` at another explorer, and run
the same command again. Settling twice is refused, but a second *payment*
cannot be recalled.

## 7. Publish

```sh
zgrove receipt --round 1 > apps/web/receipts/round-1.json
```

Optionally anchor it first, so the receipt carries a timestamp nobody here
controls — see "Anchoring" in `deploy/README.md`:

```sh
zgrove anchor --round 1            # dry run
zgrove anchor --round 1 --confirm
zgrove receipt --round 1 > apps/web/receipts/round-1.json
```

Add `apps/web/receipts/upstream.json` with the Ergo address and its 2Miners
page, commit both, and rebuild the site. The front page's `not yet` becomes a
link to a receipt.

## 8. Check it the way a stranger would

- The transaction is on an explorer, and settle's note says how it was paid.
- The upstream account's 2Miners page shows what was earned.
- `zgrove receipt --round 1 --proof <account>` gives the entry's path to the
  commitment printed on the receipt.
- If anchored, the Solana memo names the same commitment and the same
  transaction.

If any of those disagree, the receipt is wrong, and that is what all of this
was built to make visible.
