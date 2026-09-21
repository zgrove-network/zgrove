/** The sealed-box auction, simulated.
 *
 * Nothing here reaches a chain or a pool. It exists so the mechanism can be
 * handled before it is built.
 *
 * The draw is deliberately unkind: most rounds pay almost nothing and the
 * occasional block carries the whole result, because that is what proof of
 * work does. Tuned the other way it would be a lie about the product, and
 * anyone who has run a card would know within ten seconds. */
/** Slots auctioned per round. */
export const SLOTS = 20;
/** One Zcash block. Rounds are paced by the chain, not by us. */
export const ROUND_SECONDS = 75;
/** How often the upstream pool finds a block, per round. The real figure is a
 * function of our share of the network and is unknown until we have one. */
const BLOCK_CHANCE = 0.18;
/** How many settled rounds the statistics look back over. */
export const WINDOW = 40;
/** How many rounds the "would this bid have won" reading uses. Short enough
 * to reflect the going rate, long enough not to be noise. */
export const LOOKBACK = 20;
/** Below this a slot paid so little it may as well have been empty. */
const EMPTY_BELOW = 0.002;
export function zec(value) {
    return value.toFixed(4);
}
export function signed(value) {
    return (value >= 0 ? "+" : "") + value.toFixed(4);
}
export function drawPot(random = Math.random) {
    const foundBlock = random() < BLOCK_CHANCE;
    const pot = foundBlock ? 2.1 + random() * 1.7 : 0.008 + random() * 0.042;
    return { pot, foundBlock };
}
/** Where the twentieth-highest bid lands. Bidders converge on the expected
 * value, so this sits near the long-run average slot value and drifts. */
export function drawClearing(random = Math.random) {
    return 0.0009 + random() * 0.0025;
}
export function outcomeOf(row) {
    if (row.bid === null)
        return { won: false, delta: 0, label: "—", tone: "dim" };
    if (row.bid < row.clearing) {
        return { won: false, delta: 0, label: "no slot", tone: "dim" };
    }
    const delta = row.perSlot - row.bid;
    return { won: true, delta, label: signed(delta), tone: delta >= 0 ? "good" : "bad" };
}
export function statsOver(rounds) {
    const seen = rounds.slice(0, WINDOW);
    if (seen.length === 0) {
        return { typical: 0, average: 0, cost: 0, best: 0, empty: 0, counted: 0 };
    }
    let slot = 0;
    let clear = 0;
    let best = 0;
    let empty = 0;
    for (const r of seen) {
        slot += r.perSlot;
        clear += r.clearing;
        if (r.perSlot > best)
            best = r.perSlot;
        if (r.perSlot < EMPTY_BELOW)
            empty += 1;
    }
    const sorted = seen.map((r) => r.perSlot).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const typical = sorted.length % 2 === 0
        ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
        : (sorted[mid] ?? 0);
    return {
        typical,
        average: slot / seen.length,
        cost: clear / seen.length,
        best,
        empty,
        counted: seen.length,
    };
}
/** How often a bid would have taken a slot lately. This is the only honest
 * answer to "what should I bid", and it is why the lowest winning bid is
 * published at all. */
export function hitRate(bid, rounds) {
    const seen = rounds.slice(0, LOOKBACK);
    let hits = 0;
    for (const r of seen)
        if (bid >= r.clearing)
            hits += 1;
    return { hits, of: seen.length };
}
/** What that bid would have returned over the same stretch. Swings wildly on
 * nothing but whether a block landed inside the window, which the interface
 * has to say out loud. */
export function backtest(bid, rounds) {
    let total = 0;
    for (const r of rounds.slice(0, LOOKBACK)) {
        if (bid >= r.clearing)
            total += r.perSlot - bid;
    }
    return total;
}
/** Bar heights as percentages, log scaled, because one found block is two
 * hundred times a quiet round and a linear chart is thirty-nine flat bars
 * and a spike. */
export function barHeights(values) {
    if (values.length === 0)
        return [];
    const logs = values.map((v) => Math.log10(Math.max(v, 1e-6)));
    const lo = Math.min(...logs);
    const hi = Math.max(...logs);
    const span = hi - lo;
    return logs.map((l) => (span === 0 ? 50 : 6 + ((l - lo) / span) * 94));
}
/** Deterministic, so the opening board is the same every load and the numbers
 * in a screenshot can be talked about. */
function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a += 0x6d2b79f5;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** Newest first. */
export function openingRounds() {
    const random = seeded(20260921);
    const out = [];
    for (let i = 0; i < WINDOW; i += 1) {
        const { pot, foundBlock } = drawPot(random);
        const clearing = drawClearing(random);
        const bid = random() < 0.72 ? clearing * (0.85 + random() * 0.45) : null;
        out.push({ n: 1207 + i, perSlot: pot / SLOTS, clearing, foundBlock, bid });
    }
    return out.reverse();
}
