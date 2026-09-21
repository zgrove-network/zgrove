import { Calculator } from "./calculator";
import { loadCoins } from "../lib/coins";

export default async function Home() {
  const { coins, fetchedAt } = await loadCoins();

  return (
    <main>
      <h1>
        Every other part of crypto has privacy tools.
        <br />
        The part where you actually earn has none.
      </h1>

      <p className="lead">
        Your mining payout address sits on-chain forever. Anyone who finds it can
        read the whole history off it: how much you make, since when, and roughly
        how big your rig is.
      </p>

      <p>
        zGrove sits between your miner and the pool. The pool is told the pool&rsquo;s
        own account and never yours. What you earned is worked out here, and it is
        paid in shielded ZEC — so neither the pool nor the chain carries a record
        of what any one contributor made.
      </p>

      <h2>Should you even be mining?</h2>

      <p>
        Most calculators show what a card earns and stop there. That number is
        half the arithmetic, and it is the half that flatters. Here is both
        halves.
      </p>

      <Calculator coins={coins} />

      <p className="dim small" style={{ marginTop: 14 }}>
        Network figures read {new Date(fetchedAt).toISOString().replace("T", " ").slice(0, 16)} UTC,
        when this page was built. Card presets are rough starting points, not
        benchmarks — your miner&rsquo;s own reading is better than any table.
      </p>

      <h2>What is actually built</h2>

      <p>
        The proxy runs against real pools today: a miner logs in as itself, the
        pool receives the pool account, and the contributor&rsquo;s login appears
        in none of the bytes the pool got. Share accounting is derived from what
        the upstream pool accepted, never from what a worker claims.
      </p>

      <p>
        Shielded payouts and their receipts are written and tested. No money has
        moved through this yet, and there is no receipt to show until it has.
      </p>

      <h2>Honest limits</h2>

      <ul className="dim">
        <li>No real payout has been made, so nothing here is proven with money.</li>
        <li>
          Shielded ZEC is awkward to sell: most exchanges take transparent
          addresses only, so cashing out means un-shielding first.
        </li>
        <li>
          This is worth most to someone who accumulates, and close to nothing to
          someone who sells every month.
        </li>
      </ul>
    </main>
  );
}
