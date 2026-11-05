// ST-B: the exit plan on a held coin's page: sell all if it rises to +X %, if it falls to −Y %, or after a time; any of
// the three, at least one. One plan per coin (a new one replaces it). Kept in T-1's order book (orders.ts addPlan): the
// first exit to go ends the others; a price or time that passed while ZeroFee was closed asks at the top of Trade and
// never sells by itself. Nothing is signed until an exit runs, through Trade's own trade.
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { ORDER_RUNS_LINE, SELLS_ALL_LINE, type Exit, type PriceOrder } from "../../orders.ts";
import type { ChainId } from "../../types.ts";
import { price } from "../format.ts";
import { bookFor } from "../order-book.ts";
import { FALL_STEPS, PLAN_LINE, REPLACES_LINE, RISE_STEPS, TIME_STEPS, baseLine, exitLine } from "../exit-words.ts";
import { stateWord, sym, tapped, triggerFrom } from "../order-words.ts";
import { useTrade } from "../runtime.tsx";
import { useOrders } from "./Orders.tsx";

const SHOWN = ["waiting", "missed", "running", "failed", "stopped"];

/** On a coin's page: its exit plan (the latest one), and "New sell plan" when the coin is held. `paid`: what one unit cost
 *  on average (Trade's record), undefined when there is none, "loading" until Trade has answered (never a false "no
 *  record"). */
export function CoinExitPlan({ chain, coin, symbol, px, paid, holds }: { chain: ChainId; coin: string; symbol: string; px: number | undefined; paid: number | undefined | "loading"; holds: boolean }) {
  const [n, setN] = useState(0);
  const { book, list } = useOrders((o) => !!o.plan && o.chain === chain && o.coin === coin, n);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // the latest plan (list is newest first); its exits still to say
  const plan = list[0]?.plan;
  const exits = list.filter((o) => o.plan === plan && SHOWN.includes(o.status));
  const live = exits.some((o) => o.status === "waiting" || o.status === "missed");
  if (!holds && !exits.length) return null;
  const again = () => setN((x) => x + 1);
  return (
    <div className="tr-kvs tr-orders" data-testid="coin-exit-plan" ref={root}>
      <div className="zf-label tr-sec">Sell plan</div>
      {exits.map((o) => (
        <div key={o.id} className="tr-order" data-order={o.status}>
          <div className="tr-kv"><span>{exitLine(o)}</span><span>{stateWord(o)}</span></div>
          {o.note && <p className="zf-small tr-mute">{o.note}</p>}
          {o.status === "missed" && <button className="zf-link" onClick={() => void tapped(book.runMissed(o.id), setMsg, again)}>Sell now</button>}
        </div>
      ))}
      {live && plan && <button className="zf-link" onClick={() => void book.cancelPlan(plan).then((ok) => setMsg(ok ? null : "That didn't change. Try again."), () => setMsg("That didn't save. Try again.")).finally(again)}>Cancel the plan</button>}
      {msg && <p className="zf-small tr-why" role="status">{msg}</p>}
      {holds && <button className="zf-link tr-order-new" disabled={!px || paid === "loading"} onClick={() => setOpen(true)}><span className="tr-order-t"><span className="t">{live ? "Another sell plan" : "New sell plan"}</span><span className="d">Sell when it rises, falls or a time comes</span></span></button>}
      {open && px && createPortal(<ExitSheet chain={chain} coin={coin} symbol={symbol} px={px} paid={paid === "loading" ? undefined : paid} replaces={live} onClose={() => setOpen(false)} onMade={() => { setOpen(false); setMsg(null); again(); }} />, root.current?.closest(".tr-app") ?? document.body)}
    </div>
  );
}

function Chips<T extends number>({ label, items, value, onPick }: { label: string; items: readonly (readonly [T, string])[]; value: T | null; onPick: (v: T | null) => void }) {
  return (
    <div className="tr-chips" role="radiogroup" aria-label={label}>
      {[[null, "Off"] as const, ...items].map(([v, w]) => <button key={String(v)} role="radio" aria-checked={v === value} className={`tr-chip${v === value ? " on" : ""}`} onClick={() => onPick(v)}>{w}</button>)}
    </div>
  );
}
const pct = (s: number) => `${s > 0 ? "+" : "−"}${Math.abs(s)}%`;

function ExitSheet({ chain, coin, symbol, px: livePx, paid, replaces, onClose, onMade }: { chain: ChainId; coin: string; symbol: string; px: number; paid: number | undefined; replaces: boolean; onClose: () => void; onMade: () => void }) {
  const rt = useTrade();
  const { bridge } = useShell();
  // the price when the sheet opened: the plan is checked against it (as T-1's sheet)
  const [px] = useState(livePx);
  const base = paid ?? px;
  const [rise, setRise] = useState<number | null>(50);
  const [fall, setFall] = useState<number | null>(-30);
  const [hours, setHours] = useState<number | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = sym(symbol);
  const exits: Exit[] = [
    ...(rise !== null ? [{ kind: "take-profit" as const, triggerPx: triggerFrom(base, rise) }] : []),
    ...(fall !== null ? [{ kind: "stop-loss" as const, triggerPx: triggerFrom(base, fall) }] : []),
    ...(hours !== null ? [{ kind: "sell-after" as const, hours }] : []),
  ];
  const keep = async () => {
    setBusy(true);
    setWhy(null);
    try { await bookFor(rt, bridge).addPlan({ chain, coin, symbol: name }, exits, px); onMade(); }
    catch (e) { setWhy(String((e as Error)?.message ?? "The plan wasn't made.").slice(0, 160)); }
    finally { setBusy(false); }
  };
  return (
    <Sheet title={`${name} · ${price(px)}`} onClose={onClose}>
      <div className="tr-order-sheet" data-testid="exit-sheet">
        <p className="zf-small">{baseLine(paid, px)}</p>
        <div className="zf-label">If it rises</div>
        <Chips label="If it rises" items={RISE_STEPS.map((s) => [s, pct(s)] as const)} value={rise} onPick={setRise} />
        <div className="zf-label">If it falls</div>
        <Chips label="If it falls" items={FALL_STEPS.map((s) => [s, pct(s)] as const)} value={fall} onPick={setFall} />
        <div className="zf-label">After a time</div>
        <Chips label="After a time" items={TIME_STEPS} value={hours} onPick={setHours} />
        {exits.length > 0 && (
          <div className="tr-exit-sum">
            {exits.map((e) => <p key={e.kind} className="zf-body">{e.kind === "sell-after" ? `Sell all in ${TIME_STEPS.find(([h]) => h === e.hours)?.[1] ?? `${e.hours} hours`}` : exitLine(e)}</p>)}
          </div>
        )}
        <p className="zf-small">{SELLS_ALL_LINE(name)}{exits.length > 1 ? " The first one to happen ends the others." : ""}</p>
        <p className="zf-small">{ORDER_RUNS_LINE} {PLAN_LINE}</p>
        {replaces && <p className="zf-small" data-testid="exit-replaces">{REPLACES_LINE(name)}</p>}
        {why && <p className="zf-small tr-why" role="status">{why}</p>}
        <button className="zf-btn" disabled={!exits.length || busy} onClick={() => void keep()}>{exits.length ? "Keep this sell plan" : "Pick at least one"}</button>
      </div>
    </Sheet>
  );
}
