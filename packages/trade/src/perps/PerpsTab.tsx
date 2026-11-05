// D119 perps: Trade's Perps tab (Hyperliquid's TEST network only), loaded lazily and only when PERPS_ON is on.
// Summary first: the test balance in dollars, then your trades (P&L and liquidation price, Close, Close all), then the
// markets; a market opens the order sheet (Long/Short, your dollars, leverage within Hyperliquid's own limit, Market or
// Limit, optional take profit and stop loss). Every refusal is the core's Problem on the shell's Problem screen: it names
// Hyperliquid and says where the money is. Test network only, and no hop of any kind: the money stays on Hyperliquid.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mark } from "@zerofee/design/Mark.tsx";
import { Segmented } from "@zerofee/design/Segmented.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import type { Problem } from "@zerofee/core/problem";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { sayWent } from "@zerofee/shell-api/money.ts";
import { useTrade } from "../app/runtime.tsx";
import { problemOf, runStep } from "./run.ts";
import { DONE_LINE, perpsSteps, perpsTask, type PerpsJob } from "./perps-tasks.ts";
import { bridgeSource, type OrderAsk, type PerpsMarket, type PerpsSource, type PerpsState } from "./source.ts";
import { OFF_LINE, REAL_OFF_LINE, SIDE_HINT, arrivedLine, firstMarkets, freeLine, leverageChoices, pnl, positionLine, positionTitle, price, riskLine, sizeLine, usd } from "./words.ts";
import "./perps.css";

/** A typed dollar or price amount, or undefined when empty or not a number. */
const amount = (s: string) => { const n = Number(s.replace(/[$,\s]/g, "")); return s.trim() && Number.isFinite(n) && n > 0 ? n : undefined; };

/** D145 (speed): the tab's source and its last read (the balance, the trades, the markets) by the shell's bridge, kept in
 *  memory only: the tab shown again paints them at once (it waited on Hyperliquid's answer behind a spinner each time),
 *  then reads again at once and every 10 s, as before. */
const kept = new WeakMap<object, { source: PerpsSource; state?: PerpsState; markets?: PerpsMarket[] }>();

export default function PerpsTab() {
  const shell = useShell();
  const { sample, active } = useTrade();
  const [source, setSource] = useState<PerpsSource | null>(() => kept.get(shell.bridge)?.source ?? null);
  useEffect(() => {
    if (kept.get(shell.bridge)?.source === source && source) return;
    let live = true;
    void sample.then(async (yes) => {
      // D157: the Chrome extension has no Sim at all (read inline, so the sample perps don't ship there)
      const s = yes && !((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_ZEROFEE_TARGET === "extension" && (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_ZEROFEE_EXTENSION_CHECK !== "1") ? (await import("./sample.ts")).sampleSource() : bridgeSource(shell.bridge);
      kept.set(shell.bridge, { source: s });
      if (live) setSource(s);
    });
    return () => { live = false; };
  }, [sample, shell.bridge]); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState<PerpsState | null>(() => kept.get(shell.bridge)?.state ?? null);
  const [markets, setMarkets] = useState<PerpsMarket[] | null>(() => kept.get(shell.bridge)?.markets ?? null);
  const [failed, setFailed] = useState<Problem | null>(null);
  const [n, setN] = useState(0);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<PerpsMarket | null>(null);
  const [more, setMore] = useState(false);
  const [move, setMove] = useState<"in" | "out" | null>(null);
  const reload = () => setN((x) => x + 1);
  /** The order sheet opens over the whole Trade app (as Trade's own Buy sheet does), never inside the tab's scroll. */
  const root = useRef<HTMLDivElement>(null);
  // read on show, then every 10 s while Perps is on screen (prices and P&L move)
  useEffect(() => {
    if (!source || !active) return;
    let live = true;
    const read = () => Promise.all([source.state(), source.markets()]).then(([s, m]) => {
      const k = kept.get(shell.bridge);
      if (k?.source === source) Object.assign(k, { state: s, markets: m });
      if (live) { setState(s); setMarkets(m); setFailed(null); }
    }, (e) => { if (live) setFailed(problemOf(e)); });
    void read();
    const t = setInterval(read, 10_000);
    return () => { live = false; clearInterval(t); };
  }, [source, active, n, shell.bridge]);

  /** Run one step (run.ts): its line only from the source's own accepted outcome, else its Problem on the shell's screen. */
  const run = async <T,>(step: () => Promise<T>, line?: (r: T) => string, job?: PerpsJob, jobUsd?: number): Promise<T | undefined> => {
    if (busy) return;
    setBusy(true);
    // D144: a money move or a turn on/off is a task in the Activity centre, ended by the source's own outcome
    const task = job ? perpsTask(job, Date.now(), jobUsd) : null;
    if (task) shell.tasks?.publish(task);
    let said: string | undefined;
    try {
      const r = await runStep(step, line, { say: (text) => sayWent(text), showProblem: (p) => { said = p.whatHappened; return shell.showProblem(p); } });
      if (task && job) {
        const ok = r.outcome !== undefined;
        shell.tasks?.update(task.id, { steps: perpsSteps(job, ok, Date.now()) });
        shell.tasks?.end(task.id, ok ? "done" : "failed", ok ? DONE_LINE[job] : (said ?? "It didn't go. Nothing moved."));
      }
      return r.outcome;
    } finally {
      setBusy(false);
      reload();
    }
  };

  if (failed && !state) {
    return (
      <div className="pp zf-enter">
        <div className="tr-inline"><p className="zf-body">{failed.whatHappened}</p><button className="zf-link" onClick={reload}>{failed.next.label}</button></div>
      </div>
    );
  }
  if (!source || !state || !markets) return <div className="tr-center tr-tall"><Mark size={56} mode="loading" /></div>;
  const shown = firstMarkets(markets);
  const rest = markets.filter((m) => !shown.includes(m));
  return (
    <div className="pp zf-enter" data-perps="tab" ref={root}>
      <div className="pp-top">
        <p className="zf-display pp-balance">{state.balanceUsd === null ? "—" : usd(state.balanceUsd)}</p>
        <p className="zf-small">{freeLine(state.freeUsd, state.testNetwork !== false)}</p>
      </div>
      {/* landing 3: money in and out, Hyperliquid's main network only (the core refuses on the test one) */}
      {state.testNetwork === false && (
        <div className="pp-money">
          <button className="zf-btn pp-btn" disabled={busy} onClick={() => setMove("in")}>Put money in</button>
          <button className="zf-btn zf-btn--quiet pp-btn" disabled={busy || !((state.freeUsd ?? 0) + (state.spotUsd ?? 0) > 0)} onClick={() => setMove("out")}>Take out</button>
        </div>
      )}
      {state.testNetwork === false && (state.spotUsd ?? 0) > 0 && (
        <div className="zf-note pp-note"><p className="zf-body">{arrivedLine(state.spotUsd!)}</p><button className="zf-link" disabled={busy} onClick={() => void run(() => source.useArrived(), () => "It's ready for trades.", "use")}>Use it for trades</button></div>
      )}
      {failed && <p className="zf-small pp-warn" role="status">{failed.whatHappened}</p>}
      {state.offPending && (
        <div className="zf-note pp-note"><p className="zf-body">Hyperliquid didn't confirm perps are off.</p><button className="zf-link" disabled={busy} onClick={() => void run(() => source.off(), () => "Perps are off on Hyperliquid.", "off")}>Turn off again</button></div>
      )}
      {!state.on && (
        <div className="zf-note pp-note">
          <p className="zf-body">{state.testNetwork === false ? REAL_OFF_LINE : OFF_LINE}</p>
          <button className="zf-btn pp-btn" disabled={busy} onClick={() => void run(() => source.setup(), () => "Perps are on.", "on")}>Turn on perps</button>
        </div>
      )}
      {state.positions.length > 0 && (
        <>
          <div className="zf-label tr-head">Your trades</div>
          {state.positions.map((p) => (
            <div key={p.coin} className="pp-row" data-position={p.coin}>
              <span className="pp-main"><span className="t">{positionTitle(p)}</span><span className="d">{positionLine(p)}</span></span>
              <span className={`pp-pnl ${p.pnlUsd >= 0 ? "up" : "down"}`}>{pnl(p.pnlUsd)}</span>
              <button className="pp-close" disabled={busy || !state.on} onClick={() => void run(() => source.close(p.coin), (r) => r.line)}>Close</button>
            </div>
          ))}
          {state.positions.length > 1 && <button className="zf-link pp-all" disabled={busy || !state.on} onClick={() => void run(() => source.closeAll(), (r) => r.line)}>Close all</button>}
        </>
      )}
      <div className="zf-label tr-head">Markets</div>
      {[...shown, ...(more ? rest : [])].map((m) => (
        <button key={m.coin} className="pp-row pp-market" disabled={!state.on} onClick={() => setOpen(m)}>
          <span className="pp-main"><span className="t">{m.coin}</span><span className="d">Up to {m.maxLeverage}×</span></span>
          <span className="pp-price">{price(m.price)}</span>
        </button>
      ))}
      {rest.length > 0 && !more && <button className="zf-link pp-all" onClick={() => setMore(true)}>More markets</button>}
      {state.on && <button className="zf-link pp-offlink" disabled={busy} onClick={() => void run(() => source.off(), () => "Perps are off on Hyperliquid.", "off")}>Turn off perps</button>}
      {move && createPortal(<MoveSheet way={move} most={move === "out" ? (state.freeUsd ?? 0) + (state.spotUsd ?? 0) : null} busy={busy} onClose={() => setMove(null)} onSubmit={(n) => void run(() => (move === "in" ? source.fund(n, moveKey()) : source.takeOut(n, moveKey())), () => (move === "in" ? "On its way to Hyperliquid." : "On its way to Trading."), move, n).then((r) => { if (r) setMove(null); })} />, root.current?.closest(".tr-app") ?? document.body)}
      {open && createPortal(<OrderSheet market={open} free={state.freeUsd} busy={busy} onClose={() => setOpen(null)} onSubmit={(ask) => void run(() => source.order(ask), (r) => r.line).then((r) => { if (r) setOpen(null); })} />, root.current?.closest(".tr-app") ?? document.body)}
    </div>
  );
}

/** One move's own key (the core makes asking again with it safe). */
const moveKey = () => `perps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Put money in (Trading → Perps) or Take out (Perps → Trading): dollars only; the core's sheet says the rest. */
function MoveSheet({ way, most, busy, onClose, onSubmit }: { way: "in" | "out"; most: number | null; busy: boolean; onClose: () => void; onSubmit: (usd: number) => void }) {
  const [money, setMoney] = useState("");
  const n = amount(money);
  return (
    <Sheet title={way === "in" ? "Put money in" : "Take out"} onClose={onClose}>
      <div className="pp-sheet" data-perps={way === "in" ? "fund" : "take-out"}>
        <p className="zf-small pp-hint">{way === "in" ? "From Trading to your Perps account on Hyperliquid. At least $5." : "From your Perps account to Trading. At least $5."}</p>
        <label className="tr-field"><span>$</span><input inputMode="decimal" placeholder="Dollars" aria-label="Dollars" value={money} onChange={(e) => setMoney(e.target.value)} /></label>
        {most !== null && <p className="zf-small pp-hint">Up to {usd(most)}</p>}
        <button className="zf-btn" disabled={n === undefined || busy} onClick={() => n !== undefined && onSubmit(Math.round(n * 100) / 100)}>{way === "in" ? "Put it in" : "Take it out"}</button>
      </div>
    </Sheet>
  );
}

function OrderSheet({ market, free, busy, onClose, onSubmit }: { market: PerpsMarket; free: number | null; busy: boolean; onClose: () => void; onSubmit: (ask: OrderAsk) => void }) {
  const [side, setSide] = useState<"long" | "short">("long");
  const [kind, setKind] = useState<"market" | "limit">("market");
  const [money, setMoney] = useState("");
  const levels = useMemo(() => leverageChoices(market), [market]);
  const [lev, setLev] = useState(Math.min(2, market.maxLeverage));
  const [limit, setLimit] = useState("");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const usdIn = amount(money), limitPx = amount(limit), tpPx = amount(tp), slPx = amount(sl);
  const ready = usdIn !== undefined && (kind === "market" || limitPx !== undefined) && (!tp.trim() || tpPx !== undefined) && (!sl.trim() || slPx !== undefined);
  const ask: OrderAsk = { coin: market.coin, side, usd: usdIn ?? 0, leverage: lev, kind, ...(kind === "limit" && limitPx ? { limitPx } : {}), ...(tpPx ? { tp: tpPx } : {}), ...(slPx ? { sl: slPx } : {}) };
  return (
    <Sheet title={`${market.coin} · ${price(market.price)}`} onClose={onClose}>
      <div className="pp-sheet" data-perps="order">
        <Segmented label="Long or short" items={[{ id: "long", label: "Long" }, { id: "short", label: "Short" }]} value={side} onChange={setSide} />
        <p className="zf-small pp-hint">{SIDE_HINT[side]}</p>
        <label className="tr-field"><span>$</span><input inputMode="decimal" placeholder="Your money" aria-label="Your money in dollars" value={money} onChange={(e) => setMoney(e.target.value)} /></label>
        {free !== null && <p className="zf-small pp-hint">{usd(free)} free</p>}
        <div className="zf-label pp-sub">Leverage</div>
        <div className="pp-chips" role="radiogroup" aria-label="Leverage">
          {levels.map((x) => <button key={x} role="radio" aria-checked={x === lev} className={x === lev ? "on" : ""} onClick={() => setLev(x)}>{x}×</button>)}
        </div>
        <Segmented label="Market or limit" items={[{ id: "market", label: "Now" }, { id: "limit", label: "At a price" }]} value={kind} onChange={setKind} className="pp-kind" />
        {kind === "limit" && <label className="tr-field"><span>$</span><input inputMode="decimal" placeholder={`Price, now ${price(market.price)}`} aria-label="Price to trade at" value={limit} onChange={(e) => setLimit(e.target.value)} /></label>}
        <div className="pp-two">
          <label className="pp-field"><span className="zf-small">Take profit at</span><span className="tr-field"><span>$</span><input inputMode="decimal" placeholder="Optional" aria-label="Take profit at, in dollars" value={tp} onChange={(e) => setTp(e.target.value)} /></span></label>
          <label className="pp-field"><span className="zf-small">Stop loss at</span><span className="tr-field"><span>$</span><input inputMode="decimal" placeholder="Optional" aria-label="Stop loss at, in dollars" value={sl} onChange={(e) => setSl(e.target.value)} /></span></label>
        </div>
        {usdIn !== undefined && <p className="zf-body pp-size">{sizeLine(usdIn, lev)}</p>}
        {usdIn !== undefined && lev > 1 && <p className="zf-small pp-risk">{riskLine(market.coin, usdIn, lev)}</p>}
        <button className="zf-btn" disabled={!ready || busy} onClick={() => onSubmit(ask)}>{side === "long" ? "Open long" : "Open short"}</button>
      </div>
    </Sheet>
  );
}
