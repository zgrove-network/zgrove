"use client";

import { useEffect, useState } from "react";

/**
 * What the pool is doing right now, read from its own public summary.
 *
 * The endpoint returns totals and nothing else — no worker, no account, no
 * single contributor's share count — so this page cannot show them either.
 *
 * A pool that cannot be reached and a pool with nothing in it produce the
 * same zeroes, and printing zeroes for both would say "nobody is mining" when
 * the truth is "we do not know". They are kept apart here for the same reason
 * they are kept apart in the payout code.
 */

interface Summary {
  readonly algo: string;
  readonly upstream: string;
  readonly stratum: string;
  readonly contributors: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly unresolved: number;
  readonly windowSeconds: number;
  readonly hashrate: number;
  readonly asOf: number;
}

type State =
  | { readonly kind: "asking" }
  | { readonly kind: "answered"; readonly summary: Summary; readonly at: number }
  | { readonly kind: "silent"; readonly why: string };

const ENDPOINT =
  process.env["NEXT_PUBLIC_ZGROVE_POOL_URL"] ?? "https://pool.zgrove.network/v1/pool";

function rate(hashes: number): string {
  const units = ["H/s", "kH/s", "MH/s", "GH/s", "TH/s"];
  let value = hashes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const shown = unit === 0 ? Math.round(value) : value.toFixed(value < 10 ? 2 : 1);
  return `${shown} ${units[unit]}`;
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}

function window(seconds: number): string {
  if (seconds % 3600 === 0) return `last ${seconds / 3600}h`;
  if (seconds % 60 === 0) return `last ${seconds / 60}m`;
  return `last ${seconds}s`;
}

function ago(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

function Copy({ text }: { text: string }) {
  const [took, setTook] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setTook(true);
            setTimeout(() => setTook(false), 1500);
          },
          () => undefined,
        );
      }}
    >
      {took ? "copied" : "copy"}
    </button>
  );
}

export function PoolStatus() {
  const [state, setState] = useState<State>({ kind: "asking" });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;

    const ask = async () => {
      try {
        const response = await fetch(ENDPOINT, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const summary = (await response.json()) as Summary;
        if (live) setState({ kind: "answered", summary, at: Date.now() });
      } catch (cause) {
        if (live) {
          setState({ kind: "silent", why: cause instanceof Error ? cause.message : "unreachable" });
        }
      }
    };

    void ask();
    const poll = setInterval(() => void ask(), 20_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      live = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  if (state.kind === "asking") {
    return <pre>{"asking the pool…"}</pre>;
  }

  if (state.kind === "silent") {
    // Not "nobody is mining". Nobody knows.
    return (
      <>
        <pre>
{`the pool did not answer   `}<b className="bad">{state.why}</b>
        </pre>
        <p className="dim i">
          This says nothing about whether the pool is running — only that this
          page could not reach it just now. It tries again every twenty seconds.
        </p>
      </>
    );
  }

  const { summary } = state;
  const idle = summary.contributors === 0;

  return (
    <>
      <div className="panel">
        <div className="label">point a miner at</div>
        <div className="addr">
          <span>{summary.stratum}</span>
          <Copy text={summary.stratum} />
        </div>
        <pre>
{`mining       `}<b>{summary.algo}</b>{` through `}<b>{summary.upstream}</b>{`
`}{idle ? (
  <>{`rigs         `}<b className="bad">none yet</b></>
) : (
  <>{`rigs         `}<b className="good">{count(summary.contributors)}</b>{`
accepted     `}<b>{count(summary.accepted)}</b>{`   ${window(summary.windowSeconds)}
rejected     `}<b>{count(summary.rejected)}</b>{`
hashrate     `}<b>{rate(summary.hashrate)}</b>{`   estimated, never paid on`}</>
)}
        </pre>
      </div>

      <p className="dim i">
        Totals only. What any one rig contributed is not on this page, because
        it is not in the answer — checked {ago((now - state.at) / 1000)}.
      </p>
    </>
  );
}
