# receipts

One file per round that paid anyone, named `round-<n>.json`, exactly as
`zgrove receipt` prints it:

```sh
zgrove receipt --round 1 > apps/web/receipts/round-1.json
```

Commit it and rebuild the site. The page reads this directory at build time.

A file that does not parse, or is missing a field, stops the build rather than
being skipped — leaving a malformed receipt out would publish an incomplete
record of payments that looks complete. So does a round published twice.

`upstream.json` names the account every contributor's work reaches the
upstream pool under, so anyone can compare its totals there with what was
paid out here:

```json
{
  "pool": "2Miners",
  "algo": "autolykos2",
  "account": "<the address in ZGROVE_UPSTREAM_LOGIN>",
  "dashboard": "https://erg.2miners.com/account/<that address>"
}
```

Leave it out until it is real. The page says it is not published yet, which is
true; a placeholder would not be.
