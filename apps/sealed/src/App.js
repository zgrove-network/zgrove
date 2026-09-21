import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Account } from "./components/Account";
import { BidPanel } from "./components/BidPanel";
import { History } from "./components/History";
import { Stage } from "./components/Stage";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { SPEED, useAuction } from "./hooks/useAuction";
export default function App() {
    const [running, setRunning] = useState(true);
    const { state, stats, seal } = useAuction(running);
    return (_jsxs("div", { className: "app", children: [_jsx(TopBar, { round: state.round, block: state.block, speed: SPEED, running: running, onToggle: () => setRunning((r) => !r) }), _jsxs("main", { className: "body", children: [_jsxs("div", { className: "main-col", children: [_jsx(Stage, { open: state.phase === "open", left: state.left, bids: state.bids, pot: state.pot, foundBlock: state.foundBlock }), _jsx(History, { rounds: state.history.slice(0, 12) })] }), _jsxs("aside", { className: "rail", children: [_jsx(BidPanel, { open: state.phase === "open", myBid: state.myBid, block: state.block, history: state.history, stats: stats, onSeal: seal }), _jsx(Account, { balance: state.balance, session: state.session, slotsWon: state.slotsWon, played: state.played })] })] }), _jsx(StatusBar, { rounds: state.history, stats: stats })] }));
}
