import { outcomeOf, zec } from "../lib/auction";
import type { Round } from "../lib/auction";

export function History({ rounds }: { readonly rounds: readonly Round[] }) {
  return (
    <section className="history">
      <table>
        <thead>
          <tr>
            <th>round</th>
            <th>per slot</th>
            <th>lowest win</th>
            <th>your bid</th>
            <th>result</th>
          </tr>
        </thead>
        <tbody>
          {rounds.map((row, i) => {
            const result = outcomeOf(row);
            return (
              <tr key={row.n} className={i === 0 ? "fresh" : undefined}>
                <td className="dim">{row.n}</td>
                <td className={row.foundBlock ? "good" : undefined}>
                  {zec(row.perSlot)}
                </td>
                <td className="dim">{zec(row.clearing)}</td>
                <td>{row.bid === null ? "—" : zec(row.bid)}</td>
                <td className={result.tone}>{result.label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
