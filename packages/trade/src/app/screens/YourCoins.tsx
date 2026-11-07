// T-5 landing 1: "Your coins" on a chain's market (opened from a Home row), under its row line: each coin held, its value
// now and its result since bought (your-coins.ts). Tapping one opens its coin page. Nothing shows when nothing is held.
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import type { CoinRow } from "../../market/types.ts";
import type { ChainId } from "../../types.ts";
import { CHAIN_NAME, useLive, useTrade } from "../runtime.tsx";
import { atSale, chainTotalLine, coinRowWords, heldOn } from "../your-coins.ts";
import { heldNetOf, IF_SOLD } from "../held-net.ts";

export function YourCoins({ chain, onCoin }: { chain: ChainId; onCoin: (seed: CoinRow) => void }) {
  const { svc } = useTrade();
  const held = useLive(() => svc.positions().then((ps) => heldOn(chain, ps)), [chain]);
  // the audit's T6: each holding's one figure, what selling it now gets (held-net.ts), the receipt's and the coin page's own
  const key = (held.value ?? []).map((p) => `${p.coin}:${p.raw}`).join(",");
  const nets = useLive(() => Promise.all((held.value ?? []).map((p) => heldNetOf(svc.quote, p.chain, p.coin, p.raw))), [key]);
  if (!held.value?.length) return null;
  const shown = held.value.map((p, i) => atSale(p, nets.value?.[i]));
  return (
    <div className="tr-yours" data-testid="your-coins">
      <div className="zf-label tr-head">Your coins</div>
      {/* T-5 landing 2: the chain's total and its result since bought, one line */}
      {(() => { const line = chainTotalLine(CHAIN_NAME[chain], shown); return line && <p className="zf-small tr-yours-total" data-testid="your-coins-total">{line}</p>; })()}
      {shown.map((p) => {
        // still asked: no figure and no words yet (never the market price, never a dash)
        const w = nets.value ? coinRowWords(p) : { value: "", since: "" };
        return (
          <button key={p.coin} className="zf-row tr-row" onClick={() => onCoin({ chain: p.chain, address: p.coin, symbol: p.symbol, name: p.symbol })}>
            <CoinIcon symbol={p.symbol} size={30} />
            <span><span className="t">{p.symbol}</span><span className="d">{w.since}</span></span>
            <span className="tr-right"><span className="tr-v">{w.value}</span>{p.valueUsd !== undefined && <span className="zf-small tr-mute">{IF_SOLD}</span>}</span>
          </button>
        );
      })}
    </div>
  );
}
