import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { outcomeOf, zec } from "../lib/auction";
export function History({ rounds }) {
    return (_jsx("section", { className: "history", children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "round" }), _jsx("th", { children: "per slot" }), _jsx("th", { children: "lowest win" }), _jsx("th", { children: "your bid" }), _jsx("th", { children: "result" })] }) }), _jsx("tbody", { children: rounds.map((row, i) => {
                        const result = outcomeOf(row);
                        return (_jsxs("tr", { className: i === 0 ? "fresh" : undefined, children: [_jsx("td", { className: "dim", children: row.n }), _jsx("td", { className: row.foundBlock ? "good" : undefined, children: zec(row.perSlot) }), _jsx("td", { className: "dim", children: zec(row.clearing) }), _jsx("td", { children: row.bid === null ? "—" : zec(row.bid) }), _jsx("td", { className: result.tone, children: result.label })] }, row.n));
                    }) })] }) }));
}
