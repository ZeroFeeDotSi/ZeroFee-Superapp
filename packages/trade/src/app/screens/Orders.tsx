// T-1 landing 2: price orders on a coin's page ("New price order": a limit buy, a take-profit, a stop-loss), the coin's
// orders with Cancel, and the ask for an order whose price passed while ZeroFee was closed (it never runs without this
// tap). The book is orders.ts, on the phone; nothing is signed until an order runs, through Trade's own trade.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Segmented } from "@zerofee/design/Segmented.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { DAMAGED_LINE, ORDER_MAX_DAYS, ORDER_RUNS_LINE, SELLS_ALL_LINE, type OrderKind, type PriceOrder } from "../../orders.ts";
import type { ChainId } from "../../types.ts";
import { price, usd } from "../format.ts";
import { bookFor } from "../order-book.ts";
import { KIND_LABEL, STEPS, orderLine, stateWord, sym, tapped, triggerFrom } from "../order-words.ts";
import { useTrade } from "../runtime.tsx";
import { Forward } from "../icons.tsx";

/** The book's orders, read again whenever `n` changes and every few seconds while shown. */
export function useOrders(filter: (o: PriceOrder) => boolean, n: number) {
  const rt = useTrade();
  const { bridge } = useShell();
  const book = bookFor(rt, bridge);
  const [list, setList] = useState<PriceOrder[]>([]);
  /** The store couldn't be read at all: said like a damaged one (T-1 safety review M1), never a silent empty list. */
  const [unreadable, setUnreadable] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () => book.list().then((l) => { if (live) { setList(l.filter(filter)); setUnreadable(false); } }, () => { if (live) setUnreadable(true); });
    void read();
    if (!rt.active) return () => { live = false; }; // read once; no polling while Trade isn't on screen (review L8)
    const t = setInterval(read, 3_000);
    return () => { live = false; clearInterval(t); };
  }, [book, n, rt.tick, rt.active]);
  return { book, list, unreadable };
}

/** On a coin's page: "New price order" and this coin's open orders. `holds`: the coin is held (a sell order makes sense). */
export function CoinOrders({ chain, coin, symbol, px, holds }: { chain: ChainId; coin: string; symbol: string; px: number | undefined; holds: boolean }) {
  const [n, setN] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const { book, list } = useOrders((o) => !o.plan && o.chain === chain && o.coin === coin && ["waiting", "missed", "running", "failed", "stopped"].includes(o.status), n);
  const [open, setOpen] = useState(false);
  /** The sheet opens over the whole Trade app (as Buy's does), never inside the coin page's scroll under the app bar. */
  const root = useRef<HTMLDivElement>(null);
  return (
    <div className="tr-kvs tr-orders" data-testid="coin-orders" ref={root}>
      <div className="zf-label tr-sec">Price orders</div>
      {list.map((o) => (
        <div key={o.id} className="tr-order" data-order={o.status}>
          <div className="tr-kv"><span>{orderLine(o)}</span><span>{stateWord(o)}</span></div>
          {o.note && <p className="zf-small tr-mute">{o.note}</p>}
          {o.status === "missed" && <button className="zf-link" onClick={() => void tapped(book.runMissed(o.id), setMsg, () => setN((x) => x + 1))}>{o.kind === "limit-buy" ? "Buy now" : "Sell now"}</button>}
          {(o.status === "waiting" || o.status === "missed") && <button className="zf-link" onClick={() => void tapped(book.cancel(o.id), setMsg, () => setN((x) => x + 1))}>Cancel</button>}
        </div>
      ))}
      {msg && <p className="zf-small tr-why" role="status">{msg}</p>}
      <button className="zf-row tr-order-new" disabled={!px} onClick={() => setOpen(true)}><span className="tr-order-t"><span className="t">New price order</span><span className="d">Buy or sell when the price gets there</span></span><Forward /></button>
      {open && px && createPortal(<OrderSheet chain={chain} coin={coin} symbol={symbol} px={px} holds={holds} onClose={() => setOpen(false)} onMade={() => { setOpen(false); setN((x) => x + 1); }} />, root.current?.closest(".tr-app") ?? document.body)}
    </div>
  );
}

function OrderSheet({ chain, coin, symbol, px: livePx, holds, onClose, onMade }: { chain: ChainId; coin: string; symbol: string; px: number; holds: boolean; onClose: () => void; onMade: () => void }) {
  const rt = useTrade();
  // the price when the sheet opened: the trigger and its words don't move under the person's tap (review L5)
  const [px] = useState(livePx);
  const { bridge } = useShell();
  const kinds: OrderKind[] = holds ? ["limit-buy", "take-profit", "stop-loss"] : ["limit-buy"];
  const [kind, setKind] = useState<OrderKind>(holds ? "stop-loss" : "limit-buy");
  const [step, setStep] = useState(STEPS[kind][1]!);
  // the coin sold while the sheet is open: only a buy is left (review L4)
  useEffect(() => { if (!holds && kind !== "limit-buy") { setKind("limit-buy"); setStep(STEPS["limit-buy"][1]!); } }, [holds, kind]);
  const [dollars, setDollars] = useState("");
  const [days, setDays] = useState(ORDER_MAX_DAYS);
  const [why, setWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trigger = triggerFrom(px, step);
  const usdIn = Number(dollars.replace(/[$,\s]/g, ""));
  const ready = kind !== "limit-buy" || (dollars.trim() !== "" && Number.isFinite(usdIn) && usdIn > 0);
  const name = sym(symbol);
  const keep = async () => {
    setBusy(true);
    setWhy(null);
    try {
      await bookFor(rt, bridge).add({ chain, coin, symbol: name, kind, triggerPx: trigger, ...(kind === "limit-buy" ? { usd: Math.round(usdIn * 100) / 100 } : {}) }, days, px);
      onMade();
    } catch (e) {
      setWhy(String((e as Error)?.message ?? "The order wasn't made.").slice(0, 160));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={`${name} · ${price(px)}`} onClose={onClose}>
      <div className="tr-order-sheet" data-testid="order-sheet">
        {kinds.length > 1 && <Segmented label="Kind of order" items={kinds.map((k) => ({ id: k, label: KIND_LABEL[k] }))} value={kind} onChange={(k) => { setKind(k); setStep(STEPS[k][1]!); }} />}
        <div className="zf-label">{kind === "take-profit" ? "When it rises" : "When it falls"}</div>
        <div className="tr-chips" role="radiogroup" aria-label="Price">
          {STEPS[kind].map((s) => <button key={s} role="radio" aria-checked={s === step} className={`tr-chip${s === step ? " on" : ""}`} onClick={() => setStep(s)}>{s > 0 ? "+" : "−"}{Math.abs(s)}%</button>)}
        </div>
        <p className="zf-body">{kind === "limit-buy" ? `Buy when ${name} is at ${price(trigger)}.` : `Sell when ${name} is at ${price(trigger)}.`}</p>
        {kind === "limit-buy" && <label className="tr-field"><span>$</span><input inputMode="decimal" placeholder="How much to buy" aria-label="Dollars to buy" value={dollars} onChange={(e) => setDollars(e.target.value)} /></label>}
        {kind !== "limit-buy" && <p className="zf-small">{SELLS_ALL_LINE(name)}</p>}
        <div className="zf-label">Lasts</div>
        <div className="tr-chips" role="radiogroup" aria-label="Lasts">
          {[1, 3, ORDER_MAX_DAYS].map((d) => <button key={d} role="radio" aria-checked={d === days} className={`tr-chip${d === days ? " on" : ""}`} onClick={() => setDays(d)}>{d === 1 ? "1 day" : `${d} days`}</button>)}
        </div>
        <p className="zf-small">{ORDER_RUNS_LINE}</p>
        {why && <p className="zf-small tr-why" role="status">{why}</p>}
        <button className="zf-btn" disabled={!ready || busy} onClick={() => void keep()}>{kind === "limit-buy" && ready ? `Keep: buy ${usd(usdIn)} at ${price(trigger)}` : "Keep this order"}</button>
      </div>
    </Sheet>
  );
}

/** At the top of Trade: every order whose price passed while ZeroFee was closed asks here, once per order, and runs only
 *  on the person's tap. */
export function MissedOrders() {
  const [n, setN] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const { book, list, unreadable } = useOrders((o) => o.status === "missed", n);
  const damaged = book.damaged() || unreadable;
  if (!list.length && !damaged && !msg) return null;
  return (
    <div className="tr-missed" data-testid="missed-orders" role="status">
      {damaged && <div className="zf-note tr-missed-one" data-testid="orders-damaged"><p className="zf-body">{DAMAGED_LINE}</p></div>}
      {list.map((o) => (
        <div key={o.id} className="zf-note tr-missed-one">
          <p className="zf-body">{sym(o.symbol)}: {o.note}</p>
          <div className="tr-missed-acts">
            <button className="zf-link" onClick={() => void tapped(book.runMissed(o.id), setMsg, () => setN((x) => x + 1))}>{o.kind === "limit-buy" ? "Buy now" : "Sell now"}</button>
            <button className="zf-link" onClick={() => void tapped(book.cancel(o.id), setMsg, () => setN((x) => x + 1))}>Cancel it</button>
          </div>
        </div>
      ))}
      {msg && <p className="zf-small tr-why">{msg}</p>}
    </div>
  );
}
