import { SealedBox } from "../sealed";

export const metadata = {
  title: "zGrove — bid on a block you cannot see",
  description:
    "Twenty slots in every block. Bids arrive as shielded memos, so nobody can read them — not the other bidders, not the pool. A sketch of a mechanism, not a running product.",
};

export default function SealedPage() {
  return (
    <div className="page wide">
      <p className="bar">
        <b>zgrove</b> — <a href="/">back</a> · zgrove.network
      </p>

      <h1>Bid on a block you cannot see.</h1>

      <p className="i dim narrow">
        Twenty slots in every block.
        <br />
        You bid in a shielded memo, so nobody reads it — not the other bidders,
        not us.
        <br />
        When the block closes, the box opens.
      </p>

      <SealedBox />

      <hr />

      <div className="narrow">

      <h2>why the bid has to be secret</h2>

      <p>
        An auction where the bids are visible is not an auction for long.
        Everyone waits, watches the top, and puts a tick above it in the last
        second. The price stops being anyone&rsquo;s honest number.
      </p>

      <p>
        Every other chain fixes this with commit-reveal: publish a hash now,
        publish the number later. Two phases, a window where losers simply never
        come back, and timing that leaks what the hash was supposed to hide.
      </p>

      <p>
        On Zcash the bid is private to begin with. The memo field of a shielded
        transaction is 512 bytes encrypted to one reader, sitting on a chain
        that timestamps it. There is no second phase because there is nothing
        left to reveal. This is the one thing here that could not be built
        anywhere else.
      </p>

      <h2>what is actually in the box</h2>

      <p>
        Whatever the pool mined during that block. Not a pot the players paid
        into — a real output, from real hardware, which is why the number swings
        the way it does. Most rounds are nearly empty. Occasionally a block
        lands and carries the whole result.
      </p>

      <p>
        That shape is the product, so it does not get smoothed. A version of
        this where every box holds about the same amount is a hashrate shop with
        a countdown on it.
      </p>

      <h2>where the money goes</h2>

      <pre>
{`contributors  mine        -> hand over a swinging output
              are paid    <- the bids, steady, known in advance

bidders       pay         -> a fixed amount they chose
              receive     <- whatever the block held

zgrove        matches the two, takes a cut, sits on neither side`}
      </pre>

      <p>
        Contributors sell the variance; bidders buy it. That is what a miner has
        always wanted — pay me the same whether or not today was lucky — except
        the party absorbing the luck is a market rather than our balance sheet.
      </p>

      <p>
        If a round draws no bids there is no auction, and the contributor is
        paid the raw output, as any pool would. The auction is an upper storey,
        never a promise.
      </p>

      <h2>what this does not fix</h2>

      <p>
        The bids are encrypted to us, so <em>we</em> can read them. A sealed
        auction run by someone who sees every envelope is not trustless, and no
        amount of cryptography here changes that.
      </p>

      <p>
        What it changes is whether reading them pays. The winner pays their own
        bid, not the runner-up&rsquo;s. Under second-price rules, inventing a
        bid just below the top is free money and undetectable; under these
        rules, a fake bid that wins buys our own mining output back from
        ourselves, and a fake bid that loses does nothing at all. The hole is
        real. It is just not worth climbing through.
      </p>

      <p>
        Each bidder holds their own transaction and can prove what they sent, so
        a bid reported wrongly can be shown to have been reported wrongly. As
        with the payout receipts, that establishes your own bid and nothing
        about whether the set was complete.
      </p>

      <h2>status</h2>

      <pre>
{`the mechanism      `}<b className="dim">a sketch, on this page</b>{`
sealed bids        `}<b className="dim">not built</b>{`
rounds, settlement `}<b className="dim">not built</b>{`
anything real      `}<b className="bad">no</b>
      </pre>

      <p className="dim">
        The proxy and the accounting underneath this are real and are described
        on <a href="/">the front page</a>. This is not. It is here to be argued
        with before it is written.
      </p>
      </div>
    </div>
  );
}
