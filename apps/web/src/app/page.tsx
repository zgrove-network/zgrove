export default function Home() {
  return (
    <div className="page">
      <div className="head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mark.svg" alt="" />
        <span>zgrove.network</span>
      </div>

      <h1>Mine to a shielded address.</h1>

      <p className="stand">
        The pool is told an account that is not yours, and you are paid in
        shielded ZEC. Neither step leaves a public record of what you earned.
      </p>

      <p>
        Every other corner of crypto has privacy tools. The part where the money
        arrives has none. A mining payout address sits on-chain forever, and
        anyone who finds it reads the whole history off it — how much, since
        when, and roughly how large the rig is. That is not one pool&rsquo;s
        flaw. A pool has to pay you somewhere, and the only somewhere it knows
        is transparent.
      </p>

      <h2>What sits in the middle</h2>

      <p>
        A stratum proxy. Your miner connects to it rather than to the pool, and
        it connects onward under an account of its own. The pool sees one
        account doing all the work and never learns there was anyone behind it.
      </p>

      <pre className="out">
{`miner sends      mining.authorize ["`}<b>{`you`}</b>{`.rig1", "x"]
pool receives    mining.authorize ["`}<b>{`the pool's own account`}</b>{`", "x"]

$ grep -c '`}<b>{`you`}</b>{`' everything-the-pool-received.txt
`}<span className="zero">0</span>
      </pre>

      <p>
        Who earned what is settled here, from what the upstream pool accepted
        and never from what a worker claims. Once a month that ledger becomes
        one shielded payment, so the amount any single contributor received
        exists in no public record at all.
      </p>

      <h2>How you check it</h2>

      <p>
        Each payout round publishes the transaction that carried it, the number
        of accounts paid, and a commitment to the amounts. Anyone can confirm
        the transaction is real. Each contributor can confirm their own amount
        is inside the commitment. Nobody learns anyone else&rsquo;s.
      </p>

      <p>
        The receipt also prints what it does <em>not</em> establish. Shielded
        transactions hide amounts, so the stated total is not something the
        chain confirms, and proving your own inclusion is not proof that nobody
        was left out. A receipt that implied more than it shows would be worth
        less than none.
      </p>

      <h2>Where this is</h2>

      <p>
        The proxy runs against real pools today; identity, accounting, payout
        rounds and receipts are built and tested. No money has moved through it
        yet, so there is no receipt to show — and there will not be an invented
        one.
      </p>

      <p className="dim">
        Shielded ZEC is awkward to sell, because most exchanges take transparent
        addresses only and cashing out means un-shielding first. So this is
        worth a great deal to someone who accumulates and close to nothing to
        someone who sells each month. Mining is also not always worth doing at
        all; <a href="/calculator/">the calculator</a> puts power cost beside
        revenue and will say so.
      </p>

      <div className="foot">
        <span>zgrove.network</span>
        <a href="/calculator/">calculator</a>
      </div>
    </div>
  );
}
