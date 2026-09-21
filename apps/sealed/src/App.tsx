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

  return (
    <div className="app">
      <TopBar
        round={state.round}
        block={state.block}
        speed={SPEED}
        running={running}
        onToggle={() => setRunning((r) => !r)}
      />

      <main className="body">
        <div className="main-col">
          <Stage
            rounds={state.history}
            open={state.phase === "open"}
            left={state.left}
            bids={state.bids}
            pot={state.pot}
            foundBlock={state.foundBlock}
          />
          <History rounds={state.history} />
          <StatusBar rounds={state.history} stats={stats} />
        </div>

        <aside className="rail">
          <BidPanel
            open={state.phase === "open"}
            myBid={state.myBid}
            block={state.block}
            history={state.history}
            stats={stats}
            onSeal={seal}
          />
          <Account
            balance={state.balance}
            session={state.session}
            slotsWon={state.slotsWon}
            played={state.played}
          />
        </aside>
      </main>
    </div>
  );
}
