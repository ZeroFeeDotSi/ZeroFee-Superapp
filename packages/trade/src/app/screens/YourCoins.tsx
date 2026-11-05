// T-5 landing 1: "Your coins" on a chain's market (opened from a Home row), under its row line: each coin held, its value
// now and its result since bought (your-coins.ts). Tapping one opens its coin page. Nothing shows when nothing is held.
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import type { CoinRow } from "../../market/types.ts";
import type { ChainId } from "../../types.ts";
import { CHAIN_NAME, useLive, useTrade } from "../runtime.tsx";
import { chainTotalLine, coinRowWords, heldOn } from "../your-coins.ts";

export function YourCoins({ chain, onCoin }: { chain: ChainId; onCoin: (seed: CoinRow) => void }) {
  const { svc } = useTrade();
  const held = useLive(() => svc.positions().then((ps) => heldOn(chain, ps)), [chain]);
  if (!held.value?.length) return null;
  return (
    <div className="tr-yours" data-testid="your-coins">
      <div className="zf-label tr-head">Your coins</div>
      {/* T-5 landing 2: the chain's total and its result since bought, one line */}
      {(() => { const line = chainTotalLine(CHAIN_NAME[chain], held.value); return line && <p className="zf-small tr-yours-total" data-testid="your-coins-total">{line}</p>; })()}
      {held.value.map((p) => {
        const w = coinRowWords(p);
        return (
          <button key={p.coin} className="zf-row tr-row" onClick={() => onCoin({ chain: p.chain, address: p.coin, symbol: p.symbol, name: p.symbol })}>
            <CoinIcon symbol={p.symbol} size={30} />
            <span><span className="t">{p.symbol}</span><span className="d">{w.since}</span></span>
            <span className="tr-right"><span className="tr-v">{w.value}</span></span>
          </button>
        );
      })}
    </div>
  );
}
