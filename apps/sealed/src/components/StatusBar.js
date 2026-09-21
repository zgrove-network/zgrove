import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { zec } from "../lib/auction";
import { Sparkline } from "./Sparkline";
export function StatusBar({ rounds, stats }) {
    return (_jsxs("footer", { className: "statusbar", children: [_jsxs("div", { className: "status-chart", children: [_jsx(Sparkline, { rounds: rounds }), _jsxs("span", { className: "dim", children: ["last ", stats.counted, " rounds, log scale \u2014 tall ones are blocks"] })] }), _jsxs("dl", { className: "status-figures", children: [_jsxs("div", { children: [_jsx("dt", { children: "typical" }), _jsx("dd", { children: zec(stats.typical) })] }), _jsxs("div", { children: [_jsx("dt", { children: "average" }), _jsx("dd", { children: zec(stats.average) })] }), _jsxs("div", { children: [_jsx("dt", { children: "cost of a slot" }), _jsx("dd", { children: zec(stats.cost) })] }), _jsxs("div", { children: [_jsx("dt", { children: "best" }), _jsx("dd", { className: "good", children: zec(stats.best) })] }), _jsxs("div", { children: [_jsx("dt", { children: "near-empty" }), _jsxs("dd", { children: [stats.empty, "/", stats.counted] })] })] })] }));
}
