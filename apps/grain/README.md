# grain

A sealed-bid auction over each block's mining output.

Twenty slots per round, one round per block. Bids arrive as shielded memos, so
nobody reads them — not the other bidders, not an observer, and after the block
closes it is too late for anybody to move. When the block closes, the box opens
and the twenty highest bids take a slot at the price they each named.

The name is the product. A grain forward is a price agreed for a harvest that
does not exist yet, which is exactly what a slot is, and it is also what you
see when you cut a tree — which is what the rounds are drawn as. "A sealed box"
is how to explain it in one sentence; it is not what it is called.

**Nothing here is real.** No chain, no pool, no money. The numbers are drawn
from a distribution picked to be honest about mining rather than flattering:
most rounds pay almost nothing and the occasional block carries the whole
result. A demo tuned the other way would be a lie about the product, and anyone
who has run a card would know within ten seconds.

```
pnpm --filter @zgrove/grain dev
```

## What is worth arguing with

- **First price, not second.** Bids are encrypted to the operator, so the
  operator reads every envelope. Under second-price rules, inventing a bid
  just under the top is free money and undetectable. Under first price a fake
  bid that wins buys the operator's own output back from itself, and one that
  loses does nothing. The hole is real; it is just not worth climbing through.
- **The lowest winning bid is published, the bids are not.** Without it nobody
  can price the next round; with it the interface can say how often a given
  amount would have taken a slot, which is the only honest answer to "what
  should I bid".
- **The variance is the product.** Smoothed into a steady payout, this is a
  hashrate shop with a countdown on it.
