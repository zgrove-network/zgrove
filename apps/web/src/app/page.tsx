export default function Home() {
  return (
    <>
      <header className="hero">
        <div className="hero-inner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mark.svg" alt="zGrove" className="mark" />
          <h1>Mine to a shielded address.</h1>
          <p className="sub">
            The pool never learns who you are. Your earnings never touch a
            public ledger.
          </p>
        </div>
      </header>

      <main>
        <h2>The part nobody hides</h2>

        <p>
          Every other corner of crypto has privacy tools. The part where the
          money actually arrives has none. Your mining payout address sits
          on-chain forever, and anyone who finds it can read the whole history
          off it: how much you make, since when, and roughly how large your rig
          is.
        </p>

        <p>
          That is not a flaw in any one pool. It is how all of them work,
          because a pool has to pay you somewhere and the only somewhere it
          knows is transparent.
        </p>

        <h2>What sits in the middle</h2>

        <p>
          zGrove is a stratum proxy. Your miner connects to it instead of to
          the pool, and it connects to the pool under an account of its own.
          The pool sees one account doing all the work. It never sees yours.
        </p>

        <pre className="terminal">
{`your miner sends
  mining.authorize ["`}<b>{`you`}</b>{`.rig1", "x"]

the pool receives
  mining.authorize ["`}<b>{`the pool's own account`}</b>{`", "x"]

$ grep -c '`}<b>{`you`}</b>{`' everything-the-pool-got.txt
`}<b>{`0`}</b>
        </pre>

        <p>
          Who earned what is worked out here, from what the upstream pool
          accepted — never from what a worker claims. Once a month that ledger
          becomes a payment in shielded ZEC, so the amount each contributor
          received exists in no public record at all.
        </p>

        <h2>How you check it</h2>

        <p>
          Every payout round publishes a receipt: the transaction that carried
          it, the number of accounts paid, and a commitment to the amounts.
          Anyone can confirm the transaction is real. Each contributor can
          confirm their own amount is inside the commitment. Nobody learns
          anyone else&rsquo;s.
        </p>

        <p>
          The receipt also states what it does <em>not</em> establish: shielded
          transactions hide amounts, so the total is a claim the chain cannot
          confirm, and proving your own inclusion is not proof that nobody was
          left out. A receipt that implied more than it shows would be worse
          than none.
        </p>

        <h2>Where this actually is</h2>

        <p>
          The proxy runs against real pools today. Identity, share accounting,
          payout rounds and receipts are built and tested. No money has moved
          through it yet, so there is no receipt to show — and there will not
          be a fabricated one.
        </p>

        <ul className="dim">
          <li>
            Shielded ZEC is awkward to sell: most exchanges accept transparent
            addresses only, so cashing out means un-shielding first.
          </li>
          <li>
            This is worth a great deal to someone who accumulates, and close to
            nothing to someone who sells everything each month.
          </li>
          <li>
            Mining is not always profitable. There is{" "}
            <a href="/calculator/">a calculator</a> that shows power cost
            beside revenue and will tell you when the answer is no.
          </li>
        </ul>
      </main>

      <footer className="foot">
        <span>zgrove.network</span>
        <a href="/calculator/">Calculator</a>
      </footer>
    </>
  );
}
