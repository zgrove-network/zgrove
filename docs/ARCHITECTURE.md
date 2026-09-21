# Architecture beyond the proxy

The accounting path works: a worker mines through the proxy, upstream decides
what it accepts, and every accepted share lands in the database against the
worker that made it. This document is about what has to be true before that
record can carry money, reputation or a stake.

## The gap

The attribution key is a string typed into the stratum login. Nobody signs it.
Any peer that opens a socket can claim any worker name, and no contributor can
prove that a rig is theirs.

Today that is close to harmless: the login is the contributor's own payout
address, so a false claim gives work away rather than taking it. It stops being
harmless the moment anything reads those rows — a payout, a reputation score, a
stake tier. Every one of those rests on a name nobody vouched for.

Identity is therefore the next thing built, and it is built before the rows
start mattering rather than retrofitted under rows that already do.

## 1. Identity: a key on the machine, an account on the network

The worker generates a keypair on first run. The public key is the worker's
identity, and it never leaves the machine in any other form. Binding that key
to a contributor account happens once, by signing a challenge.

The signature cannot ride in the stratum login. That field is one string, sent
once, with no round trip available for a challenge, no room for a signature
beside the name, and no way to rotate anything afterwards. Stratum has no
extension point for authentication and inventing one would break the miners
that have to speak it.

So authentication happens on the control plane the architecture already calls
for, and stratum carries only work:

**Control plane (WSS)**

1. The worker connects and presents its public key.
2. The orchestrator answers with a random, single-use challenge.
3. The worker signs the challenge together with its account id and a
   timestamp; the orchestrator verifies it against the key registered to that
   account.
4. The orchestrator issues a short-lived session token bound to the worker row
   and an expiry.

**Stratum (TCP)**

5. The worker authorizes with that session token as its login.
6. The proxy resolves the token to the worker row. A token that is unknown,
   expired or already bound to another live session is refused with error 24,
   the same path an unparseable login takes today.

What this buys: a contributor can prove a rig is theirs; a login string lifted
off the wire is worthless once it expires; the payout address stops travelling
as an identity claim; and every row in the accounting tables has a signature
behind the name on it.

The string-login path stays until workers are on the control plane, behind a
flag, and the two are never enabled for the same account at once — an account
that can still be claimed by typing its name gains nothing from also being able
to prove itself.

## 2. What none of this changes

Work decides pay. Upstream acceptance remains the only thing recorded as
accepted, and share weight remains the only basis for a payout. Everything in
this document sits around that rule and nothing in it moves the rule.

## 3. Capability: an input to assignment, never to payment

A worker measures what it can do and reports it. That report decides which
algorithm it is assigned, and nothing else. It never reaches the payout
calculation.

This keeps a lie cheap to ignore. A worker that overstates itself is assigned
work it runs badly, which arrives as a low accepted-share rate against a high
claimed capability — the lie costs the liar and needs no separate enforcement.

Assignment is a function of measured capability, not a list of approved
hardware. A list needs someone to maintain it, which is a gatekeeper in a
network whose premise is that anyone can plug in a card. A weaker card is given
less work, not turned away.

## 4. Rewards: work, gated by stake, never scaled by it

A contributor's share of a payout is their accepted share weight, valued in USD
at the moment each share was submitted, over the total. Fee comes off the top.

Stake does not multiply that. It buys a fee tier: what the pool keeps from an
account's own share, and nothing else. The fee comes out of each account's
share rather than off the top, so a staker's discount lands on the pool's cut
and never on another contributor's payout — equal work is an equal gross share
whatever either party holds.

Priority is deliberately not on the list. Mining has no queue: every
contributor can mine the same coin at the same time, so there is no scarce
slot to hand out, and promising one would be promising something with nothing
behind it.

The wallet a tier is read from is bound by signature. A binding nobody signs
is a discount anyone can take by typing a richer address. It binds to the
account id rather than to the payout address, so what a public stake lets an
observer infer is "this person mines here" and not "this person earned that".

Two properties follow from stake buying a rate rather than a share, and they
are the point:

- No work is no payout, whatever the stake. A multiplier applied to zero is
  zero.
- No amount of stake reorders two contributors who did different amounts of
  work. A large stake on an old card cannot overtake a strong card, because
  stake is not on the same axis as work at all.

A standing rule falls out of this: nothing is ever paid per worker, only per
unit of work. The moment a worker is worth something by existing, one rig
becomes ten worker names.

## 5. What a fake looks like, and what kills it

| Fake | What kills it |
|---|---|
| A worker reports hashrate it does not have | Reported hashrate is never an input to payment. Only upstream-accepted share weight is, and that is enforced where the share is written, not where it is read. |
| A peer mines under someone else's worker name | The session token of §1. A login that is not a live token is refused. |
| One rig split into many worker names | Nothing is paid per worker. Splitting divides the same work across more rows and earns the same total. |
| A large stake with little work | Stake gates eligibility and never scales payout. |
| An accepted share replayed for a second credit | A duplicate id still in flight is refused locally; a replay under a fresh id reaches upstream, which rejects it as a duplicate, and a rejection carries no weight. The replay costs the replayer. |
| Upstream goes quiet and a worker looks idle | Unanswered submits are counted in their own column, so a silent pool and a stopped rig no longer look alike. |
| **Block withholding** — a worker submits ordinary shares but suppresses one that would be a block | Structurally not ours to lose. This proxy builds no templates and finds no blocks; upstream validates the work and bears the loss of a withheld one, while our accounting credits only what upstream accepted. Worth writing down because it is a real property of the proxy topology and it disappears on the day we run our own pool. |

The last row is the honest shape of the whole table: several of these are
answered by where this system sits rather than by anything it does, and that
stops being true if the topology changes.

## 6. The payout receipt

A round publishes the window, the number of accounts paid, the transaction id
that carried the payment, and a merkle commitment over the entries. Each
contributor is given the path to their own leaf.

That split is forced by what a shielded transaction actually reveals. The
transaction exists and its shielded output count is public; the **amounts are
not**. So "this round paid X" is a claim the chain does not confirm, and a
receipt that leans on it would be asserting exactly the part nobody can check.

What the construction does establish: the transaction is real and can be
looked up; it has at least as many shielded outputs as the round claims
accounts; and a contributor can verify their own amount is inside what was
committed to, without learning anyone else's and without the operator being
able to edit it afterwards.

What it does not establish, and the receipt says so in its own body: that the
stated total is correct, and that the set of entries is complete. A
contributor proves their own inclusion, not the absence of omissions. Saying
that inside the artifact is the point — a proof that implies more than it
shows is worse than no proof, and it is the specific failure this project
watched somebody else ship.

It does not go on Solana. Publishing a record of Zcash payout activity next to
a Solana token identity links the two, which is the same leak as letting stake
influence payout share, arriving through a different door.

## 7. Where the cut is, if we ever run our own pool

`createSession` reaches for `dialUpstream` directly. Running our own pool
replaces exactly that: a block template source and a share validator in place
of an upstream socket, with the stratum server, the framing, the session
handling, the attribution and the accounting all unchanged.

Making the upstream a parameter of the session rather than an import is a small
change and the right one to make before it is needed, because it is also what
lets the integration tests drive a session without a socket at all. It is
recorded here rather than done here so that the change arrives with the thing
that needs it.
