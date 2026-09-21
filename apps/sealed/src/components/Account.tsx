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
      <h2>you</h2>
      <dl className="meta wide">
        <dt>balance</dt>
        <dd className="bright">{zec(balance)} ZEC</dd>
        <dt>this session</dt>
        <dd className={session >= 0 ? "good" : "bad"}>{signed(session)}</dd>
        <dt>slots taken</dt>
        <dd>
          {slotsWon} of {played}
        </dd>
      </dl>
    </section>
  );
}
