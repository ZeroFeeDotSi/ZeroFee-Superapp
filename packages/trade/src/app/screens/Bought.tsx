// After a trade: what really arrived, read from the chain, and how fast it filled.
import { Mark } from "@zerofee/design/Mark.tsx";
import { CHAINS, type TradeRecord } from "../../service.ts";
import { amount, price, routeName, tookWords, usd } from "../format.ts";
import { useLive, useTrade } from "../runtime.tsx";

export function Bought({ rec, onDone, onPosition }: { rec: TradeRecord; onDone: () => void; onPosition: () => void }) {
  const { market } = useTrade();
  const nativeUsd = useLive(() => market.nativeUsd(rec.chain), [rec.chain]).value;
  const q = rec.quote!, c = CHAINS[rec.chain];
  const got = rec.fill?.got ?? q.getRaw;
  const coins = Number(rec.kind === "buy" ? got : rec.fill?.spent ?? q.payRaw) / 10 ** q.decimals;
  // the chain's own fee at the coin's price; until that price is in (or if it can't be had), the quote's fee, never $0
  const fee = rec.costs?.feeUsd ?? (rec.fill && nativeUsd && nativeUsd > 0 ? (Number(rec.fill.fee) / 10 ** c.decimals) * nativeUsd : q.feeUsd);
  // the coin's own part of the figure (its price per coin), never the deposit or the one-time account
  const coinUsd = rec.costs?.coinUsd ?? rec.amountUsd;
  const pump = /pump/i.test(q.route ?? "");
  return (
    <div className="tr-done">
      {/* filled: the mark whole at once (drawing it read as a spinner still going) */}
      <div className="tr-done-mark"><Mark size={64} mode="still" /></div>
      <div className="zf-label">{rec.kind === "buy" ? "Bought" : "Sold for"}</div>
      {/* the chain's own figure, or "about" when it couldn't be read (the quote, or a capped estimate). A sale leads with the
          dollars it brought; what arrived and what went are the line under it */}
      <div className="tr-price tr-done-n">{!rec.fill || rec.fill.estimated ? "about " : ""}{rec.kind === "buy" ? `${amount(got, q.decimals)} ${rec.symbol}` : usd(rec.amountUsd)}</div>
      <p className="zf-small">{rec.kind === "buy" ? `${usd(rec.amountUsd)} in all` : `${amount(got, c.decimals)} ${c.symbol} · ${amount(rec.fill?.spent ?? q.payRaw, q.decimals)} ${rec.symbol}`}{rec.filledInMs !== undefined ? ` · ${tookWords(rec.filledInMs)}` : ""}</p>
      <div className="tr-kvs">
        {coins > 0 && <div className="tr-kv"><span>Price {rec.kind === "buy" ? "you paid" : "you got"}</span><span>{price(coinUsd / coins)}</span></div>}
        {/* what the figure is made of, each part the chain's (product decision, 4 Nov: show the fees exactly and what each is for) */}
        {rec.kind === "buy" && rec.costs && <div className="tr-kv"><span>The coin{pump && <small className="zf-small">pump.fun's fee is in this</small>}</span><span>{usd(rec.costs.coinUsd)}</span></div>}
        {rec.kind === "buy" && rec.costs?.depositUsd !== undefined && <div className="tr-kv"><span>Coin deposit to Solana<small className="zf-small">Back when you sell all of it</small></span><span>{usd(rec.costs.depositUsd)}</span></div>}
        {rec.kind === "buy" && rec.costs?.setupUsd !== undefined && <div className="tr-kv"><span>PumpSwap setup<small className="zf-small">Your first PumpSwap buy only</small></span><span>{usd(rec.costs.setupUsd)}</span></div>}
        {rec.kind === "sell" && rec.costs?.depositUsd !== undefined && <p className="zf-small">{`${usd(rec.costs.depositUsd)} of it is your coin deposit, back`}</p>}
        <div className="tr-kv"><span>Network fee to Solana</span><span>{usd(fee)}</span></div>
        <div className="tr-kv"><span>ZeroFee's fee</span><span>$0</span></div>
        {q.route && <div className="tr-kv"><span>Trades on</span><span>{routeName(q.route)}</span></div>}
      </div>
      <div className="tr-floor">
        <button className="zf-btn" onClick={onDone}>Done</button>
        {/* nothing left of the coin after a sale of all of it: no position to see */}
        {!(rec.kind === "sell" && rec.fill?.coinAfter !== undefined && BigInt(rec.fill.coinAfter) === 0n) && <button className="zf-link" onClick={onPosition}>See my position</button>}
      </div>
    </div>
  );
}
