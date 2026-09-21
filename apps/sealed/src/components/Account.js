import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { signed, zec } from "../lib/auction";
export function Account({ balance, session, slotsWon, played }) {
    return (_jsxs("section", { className: "panel account", children: [_jsx("h2", { children: "you" }), _jsxs("dl", { className: "meta wide", children: [_jsx("dt", { children: "balance" }), _jsxs("dd", { className: "bright", children: [zec(balance), " ZEC"] }), _jsx("dt", { children: "this session" }), _jsx("dd", { className: session >= 0 ? "good" : "bad", children: signed(session) }), _jsx("dt", { children: "slots taken" }), _jsxs("dd", { children: [slotsWon, " of ", played] })] })] }));
}
