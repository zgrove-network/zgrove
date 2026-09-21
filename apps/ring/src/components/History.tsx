import { TARGET_SECONDS } from "../lib/chain";
import { signed, type Round } from "../lib/market";

export function History({ rounds }: { readonly rounds: readonly Round[] }) {
  if (rounds.length === 0) {
    return (
      <section className="history">
        <p className="empty">
          Waiting for the next Zcash block. Rounds settle as they land.
        </p>
      </section>
    );
  }

  return (
    <section className="history">
      <table>
        <thead>
          <tr>
            <th>block</th>
            <th>took</th>
            <th>won</th>
            <th>paid</th>
            <th>you</th>
            <th>result</th>
          </tr>
        </thead>
        <tbody>
          {rounds.map((r, i) => (
            <tr key={r.block.height} className={i === 0 ? "fresh" : undefined}>
              <td className="dim">{r.block.height.toLocaleString("en-US")}</td>
              <td className={r.interval >= TARGET_SECONDS ? "over" : "under"}>
                {r.interval}s
              </td>
              <td className={r.won === "over" ? "over" : "under"}>{r.won}</td>
              <td className="dim">{r.payout.toFixed(2)}&times;</td>
              <td>{r.position === null ? "—" : r.position.side}</td>
              <td className={r.position === null ? "dim" : r.delta >= 0 ? "good" : "bad"}>
                {r.position === null ? "—" : signed(r.delta)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
