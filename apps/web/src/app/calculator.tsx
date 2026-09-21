"use client";

import { useMemo, useState } from "react";

import { rank, usd, type Coin } from "../lib/profit";

/** Rough starting points, not benchmarks. A miner's own reading is better
 * than any table, so these are a nudge rather than an answer. */
const PRESETS: readonly { label: string; hashrate: number; watts: number; vram: number }[] = [
  { label: "RTX 4060 (approx.)", hashrate: 65_000_000, watts: 115, vram: 8 },
  { label: "RTX 3060 12GB (approx.)", hashrate: 60_000_000, watts: 170, vram: 12 },
  { label: "RTX 4090 (approx.)", hashrate: 250_000_000, watts: 450, vram: 24 },
];

export function Calculator({ coins }: { coins: readonly Coin[] }) {
  const [preset, setPreset] = useState(0);
  const [hashrate, setHashrate] = useState(PRESETS[0]!.hashrate / 1e6);
  const [watts, setWatts] = useState(PRESETS[0]!.watts);
  const [vram, setVram] = useState(PRESETS[0]!.vram);
  const [price, setPrice] = useState(0.1);

  const results = useMemo(
    () => rank(coins, hashrate * 1e6, watts, price, vram),
    [coins, hashrate, watts, price, vram],
  );

  const best = results.find((r) => r.fits) ?? null;
  const worthIt = best !== null && best.netUsd > 0;

  function applyPreset(index: number) {
    const chosen = PRESETS[index];
    if (chosen === undefined) return;
    setPreset(index);
    setHashrate(chosen.hashrate / 1e6);
    setWatts(chosen.watts);
    setVram(chosen.vram);
  }

  return (
    <div>
      <div className="grid">
        <div>
          <label htmlFor="card">Card</label>
          <select
            id="card"
            value={preset}
            onChange={(e) => applyPreset(Number(e.target.value))}
          >
            {PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="hashrate">Hashrate (MH/s)</label>
          <input
            id="hashrate"
            type="number"
            value={hashrate}
            min={0}
            onChange={(e) => setHashrate(Number(e.target.value))}
          />
        </div>
        <div>
          <label htmlFor="watts">Power draw (W)</label>
          <input
            id="watts"
            type="number"
            value={watts}
            min={0}
            onChange={(e) => setWatts(Number(e.target.value))}
          />
        </div>
        <div>
          <label htmlFor="vram">VRAM (GB)</label>
          <input
            id="vram"
            type="number"
            value={vram}
            min={0}
            onChange={(e) => setVram(Number(e.target.value))}
          />
        </div>
        <div>
          <label htmlFor="price">Electricity ($/kWh)</label>
          <input
            id="price"
            type="number"
            step="0.01"
            value={price}
            min={0}
            onChange={(e) => setPrice(Number(e.target.value))}
          />
        </div>
      </div>

      {coins.length === 0 ? (
        <p className="dim small" style={{ marginTop: 18 }}>
          Network figures could not be read when this page was built.
        </p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Coin</th>
                <th>Revenue / day</th>
                <th>Power / day</th>
                <th>Net / day</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.coin.id}>
                  <td>
                    {r.coin.name}
                    {r.fits ? "" : ` — needs ${r.coin.vramGb}GB`}
                  </td>
                  <td>{r.fits ? usd(r.revenueUsd) : "—"}</td>
                  <td>{r.fits ? usd(r.powerUsd) : "—"}</td>
                  <td className={!r.fits ? "dim" : r.netUsd > 0 ? "good" : "bad"}>
                    {r.fits ? usd(r.netUsd) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {best !== null && (
            <div className={`verdict ${worthIt ? "yes" : "no"}`}>
              {worthIt ? (
                <>
                  <strong className="good">Worth mining.</strong> {best.coin.name} nets{" "}
                  {usd(best.netUsd)} a day after power.
                </>
              ) : (
                <>
                  <strong className="bad">Not worth mining right now.</strong> The best
                  coin for this card earns {usd(best.revenueUsd)} a day and burns{" "}
                  {usd(best.powerUsd)} in electricity. You would be paying{" "}
                  {usd(-best.netUsd)} a day to mine.
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
