import { Account } from "./components/Account";
import { History } from "./components/History";
import { SidePanel } from "./components/SidePanel";
import { Stage } from "./components/Stage";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { useMarket } from "./hooks/useMarket";

export default function App() {
  const { state, stats, pools, take } = useMarket();
  const tip = state.blocks[0]?.height ?? null;

  return (
    <div className="app">
      <TopBar height={tip} source={state.source} />

      <main className="body">
        <div className="main-col">
          <Stage
            blocks={state.blocks}
            elapsed={state.elapsed}
            poolTotal={pools.under + pools.over}
          />
          <History rounds={state.rounds} />
          <StatusBar blocks={state.blocks} stats={stats} />
        </div>

        <aside className="rail">
          <SidePanel
            position={state.position}
            nextHeight={tip}
            rounds={state.rounds}
            onTake={take}
          />
          <Account
            balance={state.balance}
            session={state.session}
            hits={state.hits}
            staked={state.staked}
          />
        </aside>
      </main>
    </div>
  );
}
