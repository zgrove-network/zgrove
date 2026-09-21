# ring

A market on how long the next Zcash block takes, where nobody can see which
way the money went until it settles.

One ring per block, and a ring's width is how long that block took — which is
also the quantity being traded. Zcash aims for a block every 75 seconds, but
the intervals are exponential around that: the median sits near 52 seconds and
about 63% land inside 75. Most people guess that as a coin flip.

```
pnpm --filter @zgrove/ring dev
```

## What is real and what is not

**Real:** every block, every interval, every settlement. Blocks come from a
public explorer and the whole table is Zcash mainnet history. The chain decides
who won, and no operator can reach it.

**Not real:** the counterparties. The other side of each pool is simulated, and
the interface says so in the top bar rather than implying a crowd that is not
there.

## Why it needs Zcash

An open order book tells everyone where the money is, and people follow it. A
sealed one has to be built out of commit-reveal everywhere else: publish a hash
now, publish the number later, and live with a reveal window where losers
simply never come back.

A shielded memo is private when it lands. There is no second phase because
there is nothing left to reveal. That is the whole product: **the pool's size
is public, the way it leans is not.**

## What is worth arguing with

- **Pari-mutuel, not a book.** Winners split the losing side less the rake, so
  the house is not the counterparty and cannot want an outcome.
- **The line sits at 75, not at the median.** That makes the sides lopsided on
  purpose. The distribution is printed along the bottom of the screen, so the
  edge is available to anyone who reads it.
- **This is a betting venue.** Money comes from other players, not from
  anything produced. It is not mining, it does not claim to be, and the word
  does not appear anywhere in the interface.
