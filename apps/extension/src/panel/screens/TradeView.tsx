// The coin on this page, and Buy and Sell right under it (the board's "Panel · Buy"). The coin's name, logo and price come
// from market data, never from the page. As in Trade's Buy sheet, the quote is prepared again on every change (after a short
// pause) and every 8 s, so the swap is already built and checked when the pill wakes: the tap only signs and sends.
import { useEffect, useRef, useState } from "react";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Mark } from "@zerofee/design/Mark.tsx";
import { ProblemError, type Problem } from "@zerofee/core/problem";
import { amount, change, price, usd } from "@zerofee/trade/app/format.ts";
import type { CoinDetail } from "@zerofee/trade/market/types.ts";
import { CHAINS, type TradeRecord } from "@zerofee/trade/service.ts";
import type { Amount, Prepared, Side } from "@zerofee/trade/types.ts";
import { extProblems } from "../../problems.ts";
import { usePanel, useLive } from "../runtime.tsx";

const BUY = ["10", "25", "50", "100"], SELL = ["25", "50", "75", "100"];
const REFRESH_MS = 8_000;

export function TradeView({ mint, limitUsd, onDone, onProblem }: { mint: string; limitUsd: number; onDone: (r: TradeRecord) => void; onProblem: (p: Problem, retry?: (passcode: string) => void) => void }) {
  const { svc, market, bridge } = usePanel();
  const [side, setSide] = useState<Side>("buy");
  const [value, setValue] = useState("25");
  const [live, setLive] = useState<number>();
  const [quote, setQuote] = useState<{ p?: Prepared; problem?: Problem; checked?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const coin = useLive<CoinDetail>(() => market.coin("sol", mint), [mint]);
  const held = useLive(() => svc.held("sol", mint).catch(() => "0"), [mint]);
  const wallet = useLive(() => svc.wallets().then((ws) => ws.find((w) => w.chain === "sol")), []);
  useEffect(() => market.livePrice("sol", mint, (p) => setLive(p)), [market, mint]);
  useEffect(() => { setValue(side === "buy" ? "25" : "50"); }, [side]);

  const positive = Number(value) > 0 && Number.isFinite(Number(value));
  const amt: Amount = side === "buy" ? { usd: Number(value) } : Number(value) >= 100 ? { fraction: 1 } : { fraction: Number(value) / 100 };
  useEffect(() => {
    if (!positive) { setQuote({}); return; }
    const n = ++seq.current;
    const run = async () => {
      try {
        const p = await svc.quote(side, "sol", mint, amt);
        if (n !== seq.current) return;
        setQuote((q) => ({ p, checked: q.p?.key === p.key && q.checked }));
        await p.ready();
        if (n === seq.current) setQuote({ p, checked: true });
      } catch (e) {
        // a coin nothing can be bought for says why in one line, never a greyed button that loads for ever
        if (n === seq.current) setQuote({ problem: e instanceof ProblemError ? e.problem : extProblems.noQuote() });
      }
    };
    const first = setTimeout(run, 250), again = setInterval(run, REFRESH_MS);
    return () => { clearTimeout(first); clearInterval(again); };
  }, [value, side, mint, svc]);

  const tap = async (p: Prepared) => {
    setBusy(true);
    try {
      const rec = await svc.trade(p);
      if (rec.status === "done") onDone(rec);
    } catch (e) {
      if (!(e instanceof ProblemError)) return;
      // over the one-tap limit: the person types the passcode once, for this same trade
      onProblem(e.problem, e.problem.code === "extension.trade.over-limit" ? (passcode) => { bridge.passcodeOnce(passcode); void tap(p); } : undefined);
    } finally { setBusy(false); }
  };

  const d = coin.value, symbol = d?.symbol ?? "this coin", q = quote.p?.quote, c = CHAINS.sol;
  const px = live ?? d?.priceUsd, ch = d?.change24hPct;
  const dayUsd = px !== undefined && ch !== undefined ? px - px / (1 + ch / 100) : undefined;
  const holds = held.value !== undefined && BigInt(held.value) > 0n;
  const share = Math.min(1, Number(value) / 100);
  const label = side === "buy" ? `Buy $${value} of ${symbol}` : share >= 1 ? `Sell all of my ${symbol}` : share === 0.5 ? `Sell half of my ${symbol}` : `Sell ${value}% of my ${symbol}`;

  if (coin.error && !d) return <div className="tr-inline"><p className="zf-small">Solana didn't answer for {mint.slice(0, 4)}…{mint.slice(-4)}.</p><button className="zf-link" onClick={coin.reload}>Try again</button></div>;
  if (!d) return <div className="tr-center tr-tall"><Mark size={48} mode="loading" /></div>;
  return (
    <div className="p-trade zf-enter">
      <div className="tr-coin-head">
        <CoinIcon symbol={symbol} src={d.logoUrl} size={36} />
        <div><div className="tr-sym">{symbol}</div><div className="zf-small">Solana{q ? ` · ${q.route}` : ""}</div></div>
        <span className="zf-small p-here">On this page</span>
      </div>
      <div className="tr-price p-price">{px !== undefined ? price(px) : "—"}</div>
      <div className="zf-small tr-change">{dayUsd !== undefined ? <>{change(dayUsd, ch)} <span className="tr-mute">today</span></> : " "}</div>
      <div className="tr-tabs p-sides" role="tablist">
        {(["buy", "sell"] as const).map((s) => <button key={s} role="tab" aria-selected={side === s} className={side === s ? "on" : ""} onClick={() => setSide(s)}>{s === "buy" ? "Buy" : "Sell"}</button>)}
      </div>
      {side === "sell" && !holds ? (
        <p className="zf-small tr-none">You don't hold any {symbol} in this wallet.</p>
      ) : (<>
        <label className="tr-big">
          <input className="tr-big-n p-amount" inputMode="decimal" aria-label={side === "buy" ? "Dollars to spend" : "Percent to sell"}
            value={side === "buy" ? `$${value}` : `${value}%`} onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ""); setValue(side === "sell" && Number(v) > 100 ? "100" : v); }} />
          <span className="zf-small">{side === "sell" && holds ? `${amount(BigInt(held.value!) * BigInt(Math.round(share * 1e6)) / 1_000_000n, d.decimals ?? 6)} ${symbol}${q ? ` · about ${usd(q.getUsd)}` : ""}` : "Tap to type an amount"}</span>
        </label>
        <div className="tr-presets">
          {(side === "buy" ? BUY : SELL).map((v) => <button key={v} className={v === value ? "on" : ""} onClick={() => setValue(v)}>{side === "buy" ? `$${v}` : v === "100" ? "All" : `${v}%`}</button>)}
        </div>
        {quote.problem ? (
          <div className="tr-inline">
            <p className="zf-body">{quote.problem.whatHappened}</p>
            <button className="zf-link" onClick={() => onProblem(quote.problem!)}>{quote.problem.next.label}</button>
          </div>
        ) : (
          <div className="tr-kvs tr-kvs--sheet">
            <div className="tr-kv"><span>You get</span><span className="tr-kv-r">{q ? (side === "buy" ? `about ${amount(q.getRaw, q.decimals)} ${symbol}` : `about ${amount(q.getRaw, c.decimals)} SOL`) : positive ? <Mark size={18} mode="loading" /> : ""}{q && <small>at least {side === "buy" ? amount(q.getMinRaw, q.decimals) : `${amount(q.getMinRaw, c.decimals)} SOL`}</small>}</span></div>
            <div className="tr-kv"><span>Fee</span><span>{q ? usd(q.feeUsd) : ""}</span></div>
            <div className="tr-kv"><span>From</span><span>Trading wallet{wallet.value ? ` · ${usd(wallet.value.nativeUsd)}` : ""}</span></div>
          </div>
        )}
      </>)}
      <div className="zf-fill" />
      {!(side === "sell" && !holds) && !quote.problem && (
        <div className="tr-sheet-floor p-floor">
          <button className="zf-btn" disabled={!q || !quote.checked || busy} onClick={() => quote.p && void tap(quote.p)}>
            {busy ? "Sending…" : !q || quote.checked ? label : side === "buy" ? "Checking it can be sold back…" : "Checking the sale…"}
          </button>
          <p className="zf-small">One tap up to ${limitUsd} a trade</p>
        </div>
      )}
    </div>
  );
}
