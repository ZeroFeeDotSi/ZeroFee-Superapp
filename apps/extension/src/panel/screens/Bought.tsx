// After a trade (the board's "Panel · Bought"): what really arrived, read from the chain, and how fast it filled. The same
// rows as Trade's own result screen, on the panel's runtime, so Trade's screens stay free to change.
import { Mark } from "@zerofee/design/Mark.tsx";
import { amount, price, seconds, usd } from "@zerofee/trade/app/format.ts";
import { CHAINS, type TradeRecord } from "@zerofee/trade/service.ts";
import { useLive, usePanel } from "../runtime.tsx";

export function Bought({ rec, onDone, onPosition }: { rec: TradeRecord; onDone: () => void; onPosition: () => void }) {
  const { market } = usePanel();
  const nativeUsd = useLive(() => market.nativeUsd(rec.chain), [rec.chain]).value ?? 0;
  const q = rec.quote!, c = CHAINS[rec.chain];
  const got = rec.fill?.got ?? q.getRaw;
  const coins = Number(rec.kind === "buy" ? got : rec.fill?.spent ?? q.payRaw) / 10 ** q.decimals;
  const fee = rec.fill ? (Number(rec.fill.fee) / 10 ** c.decimals) * nativeUsd : q.feeUsd;
  return (
    <div className="tr-done">
      <div className="tr-done-mark"><Mark size={64} mode="once" /></div>
      <div className="zf-label">{rec.kind === "buy" ? "Bought" : "Sold"}</div>
      <div className="tr-price tr-done-n">{rec.kind === "buy" ? `${amount(got, q.decimals)} ${rec.symbol}` : `${amount(got, c.decimals)} ${c.symbol}`}</div>
      <p className="zf-small">{rec.kind === "buy" ? `for ${usd(rec.amountUsd)}` : `${amount(rec.fill?.spent ?? q.payRaw, q.decimals)} ${rec.symbol} · ${usd(rec.amountUsd)}`}{rec.filledInMs !== undefined ? ` · filled in ${seconds(rec.filledInMs)}` : ""}</p>
      <div className="tr-kvs">
        {coins > 0 && <div className="tr-kv"><span>Price {rec.kind === "buy" ? "paid" : "got"}</span><span>{price(rec.amountUsd / coins)}</span></div>}
        <div className="tr-kv"><span>Network fee</span><span>{usd(fee)}</span></div>
        <div className="tr-kv"><span>Trades on</span><span>{q.route}</span></div>
      </div>
      <div className="tr-floor">
        <button className="zf-btn" onClick={onDone}>Done</button>
        <button className="zf-link" onClick={onPosition}>See my position</button>
      </div>
    </div>
  );
}
