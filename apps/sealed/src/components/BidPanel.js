import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { LOOKBACK, backtest, hitRate, signed, zec } from "../lib/auction";
export function BidPanel({ open, myBid, block, history, stats, onSeal }) {
    const [draft, setDraft] = useState("");
    const typed = Number.parseFloat(draft);
    const valid = Number.isFinite(typed) && typed > 0;
    if (myBid !== null) {
        return (_jsxs("section", { className: "panel", children: [_jsx("h2", { children: "your bid" }), _jsxs("div", { className: "sealed-bid", children: [_jsx("span", { className: "amount-big", children: zec(myBid) }), _jsx("span", { className: "unit", children: "ZEC" })] }), _jsx("p", { className: open ? "state sealed" : "state", children: open ? "sealed — read when the block closes" : "opened" }), _jsxs("dl", { className: "meta", children: [_jsx("dt", { children: "memo" }), _jsx("dd", { children: "zs1q\u20268f4c" }), _jsx("dt", { children: "block" }), _jsx("dd", { children: block.toLocaleString("en-US") })] }), _jsx("p", { className: "note", children: "One shielded transaction, encrypted the moment it lands. No hash to publish now and reveal later \u2014 there is nothing left to reveal." })] }));
    }
    if (!open) {
        return (_jsxs("section", { className: "panel", children: [_jsx("h2", { children: "your bid" }), _jsx("p", { className: "note", children: "You sat this round out. The next opens in a moment." })] }));
    }
    const odds = valid ? hitRate(typed, history) : null;
    const projected = valid ? backtest(typed, history) : null;
    return (_jsxs("section", { className: "panel", children: [_jsx("h2", { children: "your bid" }), _jsxs("div", { className: "field", children: [_jsx("input", { id: "bid", type: "text", inputMode: "decimal", autoComplete: "off", placeholder: "0.0000", "aria-label": "your bid, in ZEC", value: draft, onChange: (e) => setDraft(e.target.value), onKeyDown: (e) => {
                            if (e.key === "Enter" && valid)
                                onSeal(typed);
                        } }), _jsx("span", { className: "unit", children: "ZEC" })] }), _jsxs("div", { className: "quick", children: [_jsxs("button", { type: "button", onClick: () => setDraft(zec(stats.cost)), children: [zec(stats.cost), _jsx("small", { children: "usual" })] }), _jsxs("button", { type: "button", onClick: () => setDraft(zec(stats.cost * 1.5)), children: [zec(stats.cost * 1.5), _jsx("small", { children: "safer" })] })] }), _jsx("div", { className: "readout", children: odds === null || projected === null ? (_jsx("p", { className: "note", children: "Put an amount in and this says how often it would have taken a slot, and what bidding it every round would have come to." })) : (_jsxs(_Fragment, { children: [_jsxs("p", { className: "odds", children: ["takes a slot in", " ", _jsxs("strong", { className: odds.hits > odds.of / 2 ? "good" : "bad", children: [odds.hits, " of ", odds.of] }), " ", "recent rounds"] }), _jsxs("p", { className: "note", children: ["bidding it every round over those ", LOOKBACK, " would have come to", " ", _jsx("strong", { className: projected >= 0 ? "good" : "bad", children: signed(projected) }), " ", "ZEC \u2014 which turns almost entirely on whether a block landed inside them"] })] })) }), _jsx("button", { type: "button", className: "primary", disabled: !valid, onClick: () => onSeal(typed), children: "seal and send" })] }));
}
