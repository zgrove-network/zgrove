import { Calculator } from "../calculator";
import { loadCoins } from "../../lib/coins";

export const metadata = {
  title: "zGrove — should you even be mining?",
  description:
    "Revenue beside power cost, both halves of the arithmetic, for your card and your electricity price.",
};

export default async function CalculatorPage() {
  const { coins, fetchedAt } = await loadCoins();

  return (
    <main style={{ paddingTop: 80 }}>
      <h1 style={{ fontSize: "2.2rem", marginBottom: 18 }}>
        Should you even be mining?
      </h1>

      <p>
        Most calculators show what a card earns and stop there. That is half the
        arithmetic and it is the half that flatters. Here is both halves, for
        your card and your electricity.
      </p>

      <Calculator coins={coins} />

      <p className="dim small" style={{ marginTop: 16 }}>
        Network figures read{" "}
        {new Date(fetchedAt).toISOString().replace("T", " ").slice(0, 16)} UTC,
        when this page was built. Card presets are rough starting points, not
        benchmarks — your miner&rsquo;s own reading beats any table.
      </p>

      <p style={{ marginTop: 40 }}>
        <a href="/">Back</a>
      </p>
    </main>
  );
}
