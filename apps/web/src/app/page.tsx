import { Mark } from "./mark";
import { PoolStatus } from "./pool-status";

export default function Home() {
  return (
    <div className="page">
      <p className="bar">
        <Mark />
        <span>
          <b>zgrove</b> — a mining pool that cannot see you · zgrove.network
        </span>
      </p>

      <h1>Mine to a shielded address.</h1>

      <p className="i dim">
        The pool is told an account that is not yours.
        <br />
        You are paid in shielded ZEC.
        <br />
        Neither step leaves a public record of what you earned.
      </p>

      <div className="hero" role="presentation" />

      <h2>live</h2>

      <PoolStatus />

      <h2>the problem</h2>

      <p>
        A mining payout address is on-chain forever. Anyone who finds it reads
        the whole history off it: how much you make, since when, roughly how
        large the rig is.
      </p>

      <p>
        No pool chose this. A pool has to pay you somewhere and the only
        somewhere it knows is transparent.
      </p>

      <h2>what sits in the middle</h2>

      <p>
        A stratum proxy. Your miner connects to it, it connects onward under an
        account of its own.
      </p>

      <pre>
{`your miner sends
  mining.authorize ["`}<b>you</b>{`.rig1", "x"]

the pool receives
  mining.authorize ["`}<b>pool-account</b>{`", "x"]

$ grep -c '`}<b>you</b>{`' everything-the-pool-received.txt
`}<b className="good">0</b>
      </pre>

      <p>
        Who earned what is settled here, from what the upstream pool accepted.
        Never from what a worker claims. Once a month that becomes one shielded
        payment.
      </p>

      <h2>how you check it</h2>

      <p>
        Every round publishes its transaction, the number of accounts paid, and
        a commitment to the amounts. Anyone confirms the transaction is real.
        You confirm your own amount is inside the commitment. Nobody sees
        anyone else&apos;s.
      </p>

      <p>
        The receipt prints what it does <em>not</em> establish. Shielded
        transactions hide amounts, so the total is not confirmed by the chain,
        and your own inclusion is not proof that nobody was left out.
      </p>

      <h2>what is built</h2>

      <pre>
{`proxy against real pools    `}<b className="good">working</b>{`
identity, accounting        `}<b className="good">working</b>{`
payout rounds, receipts     `}<b className="good">built, tested</b>{`
money actually moved        `}<b className="bad">not yet</b>
      </pre>

      <p className="dim">
        Read that as what it is: not a measurement, but the operator&apos;s own
        account of the code. The block above it is the pool answering for
        itself; this one is us saying so. The last line is the only one that
        matters yet, and it stays red until a payment has moved and can be
        checked on <a href="/receipts/">the receipts page</a>. There is no
        receipt to show until there is, and there will not be an invented one.
      </p>

      <hr />

      <p className="dim">
        Shielded ZEC is awkward to sell — most exchanges take transparent
        addresses only — so this is worth a lot if you accumulate and little if
        you sell every month. Mining is also not always worth doing:{" "}
        <a href="/calculator/">the calculator</a> puts power cost beside revenue
        and will say so.
      </p>
    </div>
  );
}
