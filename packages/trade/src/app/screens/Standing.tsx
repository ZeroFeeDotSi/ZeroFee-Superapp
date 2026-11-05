// T-2 landing 2: standing buys on a coin's page ("New repeat buy": dollars a run, every day or week, the most a week, how
// long), the coin's plans with Pause / Turn on / Cancel, and the one ask for a run missed while ZeroFee was closed (it
// never buys without this tap, and never catches up). The book is standing.ts, on the phone.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { ALL_CAP_LINE, PLAN_MAX_DAYS, PLAN_RUNS_LINE, PLANS_DAMAGED_LINE, RUN_MAX_USD, RUN_MIN_USD, missedLine, planRefusal, type Every, type StandingPlan } from "../../standing.ts";
import type { ChainId } from "../../types.ts";
import { usd } from "../format.ts";
import { standingFor } from "../order-book.ts";
import { nextWhen, sym } from "../order-words.ts";
import { useTrade } from "../runtime.tsx";
import { Forward } from "../icons.tsx";

const EVERY_WORD: Record<Every, string> = { day: "every day", week: "every week" };
/** "$5.00 every day · next Tue 9:05 AM" */
export const planLine = (p: Pick<StandingPlan, "usd" | "every" | "nextAt" | "status">) => `${usd(p.usd)} ${EVERY_WORD[p.every]}${p.status === "on" ? ` · next ${nextWhen(p.nextAt)}` : ""}`;

function usePlans(filter: (p: StandingPlan) => boolean, n: number) {
  const rt = useTrade();
  const { bridge } = useShell();
  const book = standingFor(rt, bridge);
  const [list, setList] = useState<StandingPlan[]>([]);
  const [unreadable, setUnreadable] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () => book.list().then((l) => { if (live) { setList(l.filter(filter)); setUnreadable(false); } }, () => { if (live) setUnreadable(true); });
    void read();
    if (!rt.active) return () => { live = false; };
    const t = setInterval(read, 3_000);
    return () => { live = false; clearInterval(t); };
  }, [book, n, rt.tick, rt.active, filter.toString()]);
  return { book, list, unreadable };
}

export function CoinStanding({ chain, coin, symbol }: { chain: ChainId; coin: string; symbol: string }) {
  const [n, setN] = useState(0);
  const { book, list } = usePlans((p) => p.chain === chain && p.coin === coin && (p.status === "on" || p.status === "paused"), n);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const again = () => setN((x) => x + 1);
  /** A Pause, Turn on or Cancel that didn't save says so (review M), never a silent "On". */
  const act = (f: Promise<unknown>) => void f.then((ok) => setMsg(ok === false ? "That didn't change. Try again." : null), () => setMsg("That didn't save. Try again.")).finally(again);
  return (
    <div className="tr-kvs tr-orders" data-testid="coin-standing" ref={root}>
      <div className="zf-label tr-sec">Repeat buys</div>
      {list.map((p) => (
        <div key={p.id} className="tr-order" data-plan={p.status}>
          <div className="tr-kv"><span>{planLine(p)}</span><span>{p.status === "on" ? "On" : "Paused"}</span></div>
          {p.note && <p className="zf-small tr-mute">{p.note}</p>}
          {p.status === "on" ? <button className="zf-link" onClick={() => act(book.setStatus(p.id, "paused"))}>Pause</button> : <button className="zf-link" onClick={() => act(book.setStatus(p.id, "on"))}>Turn on</button>}
          <button className="zf-link" onClick={() => act(book.setStatus(p.id, "cancelled"))}>Cancel</button>
        </div>
      ))}
      {msg && <p className="zf-small tr-why" role="status">{msg}</p>}
      <button className="zf-row tr-order-new" onClick={() => setOpen(true)}><span className="tr-order-t"><span className="t">New repeat buy</span><span className="d">Buy a set amount on a schedule</span></span><Forward /></button>
      {open && createPortal(<PlanSheet chain={chain} coin={coin} symbol={symbol} onClose={() => setOpen(false)} onMade={() => { setOpen(false); again(); }} />, root.current?.closest(".tr-app") ?? document.body)}
    </div>
  );
}

function PlanSheet({ chain, coin, symbol, onClose, onMade }: { chain: ChainId; coin: string; symbol: string; onClose: () => void; onMade: () => void }) {
  const rt = useTrade();
  const { bridge } = useShell();
  const name = sym(symbol);
  const [dollars, setDollars] = useState("5");
  const [every, setEvery] = useState<Every>("day");
  const [cap, setCap] = useState(35);
  const [days, setDays] = useState(PLAN_MAX_DAYS);
  const [why, setWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // plain dollars only ("5", "5.50"): never "0x10" or "1e1" (review L)
  const typed = dollars.replace(/[$,\s]/g, "");
  const run = /^\d+(\.\d{1,2})?$/.test(typed) ? Number(typed) : NaN;
  const caps = [20, 35, 50, 100].filter((c) => !(run > 0) || c >= run);
  // the most a week follows the run: never a chip that's gone, never stale (review M)
  const weekCap = caps.includes(cap) ? cap : caps[0] ?? cap;
  const refusal = Number.isFinite(run) ? planRefusal({ usd: run, weekCapUsd: weekCap, every }, days) : typed ? `Each buy is $${RUN_MIN_USD} to $${RUN_MAX_USD}.` : null;
  const ready = Number.isFinite(run) && refusal === null;
  const taps = useRef(false);
  const keep = async () => {
    if (taps.current) return; // a double tap makes one plan (review L)
    taps.current = true;
    setBusy(true); setWhy(null);
    try { await standingFor(rt, bridge).add({ chain, coin, symbol: name, usd: run, every, weekCapUsd: weekCap }, days); onMade(); }
    catch (e) { setWhy(String((e as Error)?.message ?? "The plan wasn't made.").slice(0, 160)); }
    finally { setBusy(false); taps.current = false; }
  };
  return (
    <Sheet title={`Buy ${name} every…`} onClose={onClose}>
      <div className="tr-order-sheet" data-testid="plan-sheet">
        <label className="tr-field"><span>$</span><input inputMode="decimal" placeholder="Each time" aria-label="Dollars each time" value={dollars} onChange={(e) => setDollars(e.target.value)} /></label>
        <div className="tr-chips" role="radiogroup" aria-label="How often">
          {(["day", "week"] as const).map((e) => <button key={e} role="radio" aria-checked={e === every} className={`tr-chip${e === every ? " on" : ""}`} onClick={() => setEvery(e)}>{e === "day" ? "Every day" : "Every week"}</button>)}
        </div>
        <div className="zf-label">The most a week</div>
        <div className="tr-chips" role="radiogroup" aria-label="The most a week">
          {caps.map((c) => <button key={c} role="radio" aria-checked={c === weekCap} className={`tr-chip${c === weekCap ? " on" : ""}`} onClick={() => setCap(c)}>{usd(c)}</button>)}
        </div>
        <div className="zf-label">Lasts</div>
        <div className="tr-chips" role="radiogroup" aria-label="Lasts">
          {[7, 14, PLAN_MAX_DAYS].map((d) => <button key={d} role="radio" aria-checked={d === days} className={`tr-chip${d === days ? " on" : ""}`} onClick={() => setDays(d)}>{d} days</button>)}
        </div>
        <p className="zf-small">{ALL_CAP_LINE}</p>
        <p className="zf-small">{PLAN_RUNS_LINE} If ZeroFee is closed at a buy time, it asks you once. It never buys late by itself.</p>
        {(why ?? refusal) && <p className="zf-small tr-why" role="status">{why ?? refusal}</p>}
        <button className="zf-btn" disabled={!ready || busy} onClick={() => void keep()}>{ready ? `Keep: ${usd(run)} of ${name} ${EVERY_WORD[every]}` : "Keep this plan"}</button>
      </div>
    </Sheet>
  );
}

/** At the top of Trade: each plan's one ask for a run missed while ZeroFee was closed (Buy now / Skip), and the line for a
 *  store that couldn't be read. */
export function MissedStanding() {
  const [n, setN] = useState(0);
  const { book, list, unreadable } = usePlans((p) => !!p.missed && p.status === "on", n);
  const damaged = book.damaged() || unreadable;
  if (!list.length && !damaged) return null;
  return (
    <div className="tr-missed" data-testid="missed-standing" role="status">
      {damaged && <div className="zf-note tr-missed-one"><p className="zf-body">{PLANS_DAMAGED_LINE}</p></div>}
      {list.map((p) => (
        <div key={p.id} className="zf-note tr-missed-one">
          <p className="zf-body">{missedLine(p)}</p>
          <div className="tr-missed-acts">
            <button className="zf-link" onClick={() => void book.runMissed(p.id).catch(() => undefined).finally(() => setN((x) => x + 1))}>Buy now</button>
            <button className="zf-link" onClick={() => void book.skipMissed(p.id).catch(() => undefined).finally(() => setN((x) => x + 1))}>Skip</button>
          </div>
        </div>
      ))}
    </div>
  );
}
