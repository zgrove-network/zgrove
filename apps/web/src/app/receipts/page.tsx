import { loadReceipts, loadUpstream, type Receipt } from "../../lib/receipts";

export const metadata = {
  title: "zGrove — receipts",
  description:
    "Every round that paid anyone, and what can be checked about it without taking the operator's word.",
};

/** Integer zatoshi to ZEC without passing through a float. */
function zec(zat: number): string {
  const whole = Math.floor(zat / 100_000_000);
  const frac = String(zat % 100_000_000).padStart(8, "0");
  return `${whole}.${frac}`;
}

function day(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function Round({ r }: { r: Receipt }) {
  const settled =
    r.settlement === "wallet"
      ? "sent from a wallet this pool runs, and watched to completion"
      : "paid by hand, then recorded against a transaction checked on chain";

  return (
    <>
      <pre>
{`round ${r.round}   ${day(r.periodStart)} → ${day(r.periodEnd)}

  paid          ${r.accountsPaid} account${r.accountsPaid === 1 ? "" : "s"}, ${zec(r.totalZat)} ZEC
  transaction   `}<a href={`https://blockchair.com/zcash/transaction/${r.txid}`}>{r.txid}</a>{`
  settled       ${settled}
  commitment    ${r.commitment}
  anchored      `}{r.anchor === undefined ? (
          "not yet"
        ) : (
          <a href={`https://solscan.io/tx/${r.anchor.signature}`}>solana {r.anchor.signature.slice(0, 16)}…</a>
        )}
      </pre>

      <p className="i dim">What this receipt does not establish:</p>
      <ul className="i dim">
        {r.limits.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </>
  );
}

export default function ReceiptsPage() {
  const receipts = loadReceipts();
  const upstream = loadUpstream();

  return (
    <div className="page">
      <p className="bar">
        <b>zgrove</b> — <a href="/">back</a> · zgrove.network
      </p>

      <h1>Receipts.</h1>

      <p className="i dim">
        Every round that paid anyone, and what can be checked about it without
        taking our word for it.
      </p>

      <h2>rounds</h2>

      {receipts.length === 0 ? (
        <>
          <p>No round has paid anyone yet.</p>
          <p className="dim">
            There is no receipt to show until there is. There will not be an
            invented one.
          </p>
        </>
      ) : (
        receipts.map((r) => <Round key={r.round} r={r} />)
      )}

      <h2>the upstream account</h2>

      {upstream === null ? (
        <p className="dim">
          Not published yet. Once it is, the upstream pool&rsquo;s own page for
          it shows everything this pool earned, and anyone can set that total
          beside what was paid out.
        </p>
      ) : (
        <>
          <pre>
{`pool      ${upstream.pool}  (${upstream.algo})
account   ${upstream.account}
totals    `}<a href={upstream.dashboard}>{upstream.dashboard}</a>
          </pre>
          <p>
            Every contributor&rsquo;s work reaches the upstream pool under this
            one account, so its page there is the pool&rsquo;s own record of
            what zGrove earned — kept by someone with no stake in this. What
            was earned there should equal what was paid here, plus the fee.
            It shows the total and nothing about any contributor.
          </p>
        </>
      )}

      <h2>check your own share</h2>

      <p>
        The receipt proves money moved and fixes the round&rsquo;s entries under
        one commitment. Whether your entry is right is checked from your side:
      </p>

      <pre>
{`# what your own rig was told was accepted
zgrove-worker ledger

# your entry and its path to the commitment, from the operator
zgrove receipt --round <n> --proof <your account>`}
      </pre>

      <p className="dim">
        The ledger is kept on your machine by the worker, which sits between
        your miner and this pool and records every share and every answer. It
        cannot raise a payout — those come from what the upstream pool
        accepted — so it is safe to trust a file you control. If it shows more
        accepted shares than your payout was computed from, the records
        disagree, and the shares themselves are in the file to be checked.
      </p>
    </div>
  );
}
