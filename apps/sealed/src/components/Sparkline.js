import { jsx as _jsx } from "react/jsx-runtime";
import { barHeights } from "../lib/auction";
export function Sparkline({ rounds }) {
    const ordered = [...rounds].reverse();
    const heights = barHeights(ordered.map((r) => r.perSlot));
    return (_jsx("div", { className: "spark", "aria-hidden": "true", children: heights.map((height, i) => (_jsx("span", { className: ordered[i]?.foundBlock === true ? "spark-bar block" : "spark-bar", style: { height: `${height}%` } }, ordered[i]?.n ?? i))) }));
}
