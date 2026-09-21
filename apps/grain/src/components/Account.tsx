import { signed, zec } from "../lib/auction";

interface Props {
  readonly balance: number;
  readonly session: number;
  readonly slotsWon: number;
  readonly played: number;
}

export function Account({ balance, session, slotsWon, played }: Props) {
  return (
    <section className="panel account">
      <h2>account</h2>
      <dl className="rows">
        <dt>balance</dt>
        <dd className="bright">{zec(balance)}</dd>
        <dt>session</dt>
        <dd className={session === 0 ? undefined : session > 0 ? "good" : "bad"}>
          {signed(session)}
        </dd>
        <dt>slots</dt>
        <dd>
          {slotsWon}/{played}
        </dd>
      </dl>
    </section>
  );
}
