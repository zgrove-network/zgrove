import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { SLOTS, zec } from "../lib/auction";
import { useSettle } from "../hooks/useSettle";
export function Stage({ open, left, bids, pot, foundBlock }) {
    const settled = useSettle(pot === null ? null : zec(pot));
    const mm = String(Math.floor(left / 60)).padStart(2, "0");
    const ss = String(left % 60).padStart(2, "0");
    const soon = open && left <= 12;
    // How full the round is. Past twenty envelopes somebody is going home empty
    // handed, which is the moment the number starts to matter.
    const fill = Math.min(1, bids / (SLOTS * 2.5));
    return (_jsxs("section", { className: "stage", children: [_jsxs("div", { className: "stage-core", children: [open ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "figure waiting", children: ["???", _jsx("span", { className: "caret", "aria-hidden": "true", children: "_" })] }), _jsx("p", { className: "figure-label", children: "in the box \u00B7 sealed until the block closes" })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: foundBlock ? "figure hit" : "figure", children: [settled, " ZEC"] }), _jsxs("p", { className: "figure-label", children: [_jsx("strong", { children: zec((pot ?? 0) / SLOTS) }), " per slot \u00B7", " ", foundBlock ? "the pool found a block" : "a quiet round"] })] })), _jsxs("div", { className: soon ? "clock soon" : "clock", children: [open ? `${mm}:${ss}` : "00:00", _jsx("span", { className: "clock-label", children: open ? "until it opens" : "opened" })] })] }), _jsxs("div", { className: "demand", children: [_jsxs("div", { className: "demand-bar", children: [_jsx("span", { style: { width: `${fill * 100}%` } }), _jsx("i", { style: { left: `${(SLOTS / (SLOTS * 2.5)) * 100}%` }, "aria-hidden": "true" })] }), _jsxs("p", { className: "demand-label", children: [_jsx("strong", { children: bids }), " bids for ", _jsx("strong", { children: SLOTS }), " slots \u00B7 amounts hidden from everyone, us included"] })] })] }));
}
