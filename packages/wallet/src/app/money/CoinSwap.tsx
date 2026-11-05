// Home's Swap of a coin inside one wallet (bug report, 5 Nov; ruling: it never leaves the wallet, so it is a
// trade, direct, under 2 s): You pay [coin] → You get [coin], the dollars, what arrives from the exchange's own quote,
// and one lit Swap. The tap IS the swap (product decision, 5 Nov: no hold, no confirm): in its frame the sheet becomes the
// job's tracker (away), Home gets its Jobs row naming the exchange ("Jupiter is swapping it"), and the trade runs on
// (spending.swap.go, trade/src/swap-door.ts), landing on the chain's own answer with its proof.
import { useEffect, useRef, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { padBase } from "@zerofee/design/keypad.ts";
import { MoneyAmount, QUOTE_WAIT_MS, quoteWaitLine, useElapsed } from "@zerofee/design/MoneySheet.tsx";
import { mark, tapBurst } from "@zerofee/design/tap.ts";
import type { Tasks } from "@zerofee/shell-api/tasks.ts";
import { trimCents, typedUsd } from "../hub.ts";
import { dollars } from "../format.ts";
import type { PickCoin } from "./coin-pick.ts";
import { SWAP_MIN_USD, SWAP_WORDS } from "./swap-corridor.ts";
import { tradeArrives } from "./swap-coins.ts";
import { NATIVE_SYMBOL, coinAsk, paidLine, priceLate, runTradeJob, trackOf, tradeSteps, type CoinQuote } from "./swap-trade.ts";
import type { LiveTrack } from "./live-steps.ts";

/** The exchange's price for the amount, 0.3 s after it stops changing (Trade's own quote; nothing moves). */
function useCoinQuote(bridge: Bridge, ask: Record<string, unknown> | null): { q: CoinQuote | null; waiting: boolean; waitedMs: number; said: string | null; late: boolean; again: () => void } {
  const [q, setQ] = useState<CoinQuote | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [late, setLate] = useState(false);
  const [tries, setTries] = useState(0);
  const waitedMs = useElapsed(waiting);
  const key = ask ? JSON.stringify(ask) : "";
  useEffect(() => {
    setQ(null); setSaid(null); setLate(false); setWaiting(false);
    if (!ask) return;
    let live = true;
    let slow: ReturnType<typeof setTimeout> | undefined;
    const t = setTimeout(() => {
      setWaiting(true);
      slow = setTimeout(() => { if (live) { setWaiting(false); setLate(true); } }, QUOTE_WAIT_MS);
      void bridge.call<CoinQuote>("spending.swap.quote", ask).then((r) => {
        clearTimeout(slow);
        if (!live) return;
        setWaiting(false);
        if ("ok" in r) setQ(r.ok); else setSaid(r.problem.whatHappened);
      }, () => { clearTimeout(slow); if (live) { setWaiting(false); setLate(true); } });
    }, 300);
    return () => { live = false; clearTimeout(t); clearTimeout(slow); };
  }, [bridge, key, tries]);
  return { q, waiting, waitedMs, said, late, again: () => setTries((n) => n + 1) };
}


export function CoinSwap({ bridge, tasks, pay, get, chain, payAddress, getAddress, most, onPickPay, onPickGet, onTrack }: {
  bridge: Bridge; tasks: Tasks | undefined;
  pay: PickCoin; get: PickCoin; chain: "sol" | "hood"; payAddress: string; getAddress: string;
  /** The most it can swap, in dollars (what the wallet holds of the coin paid). */
  most: number;
  onPickPay: () => void; onPickGet: () => void;
  /** The tap's frame (product decision, 5 Nov: no hold, no confirm; the tap IS the swap): the sheet becomes the job's
   *  tracker, away, and follows it to the chain's answer. */
  onTrack: (next: (t: LiveTrack | null) => LiveTrack) => void;
}) {
  const [usd, setUsd] = useState("");
  const [preset, setPreset] = useState(false);
  const [all, setAll] = useState(false);
  const [tried, setTried] = useState(false);
  const amount = Number(typedUsd(usd) ?? 0);
  const block = !(amount > 0) ? SWAP_WORDS.amount : amount < SWAP_MIN_USD && !all ? SWAP_WORDS.least : amount > most + 0.004 ? SWAP_WORDS.most(dollars(most.toFixed(2))) : null;
  const ask = block ? null : coinAsk(chain, payAddress, getAddress, amount, all);
  const price = useCoinQuote(bridge, ask);
  const went = useRef(false);
  const onUsd = (v: string, max = false) => { setTried(false); setAll(max); setUsd(v); };
  const go = (el: HTMLElement) => {
    const q = price.q;
    if (!q || went.current) return;
    went.current = true;
    tapBurst(el, () => void bridge.call("device.haptic", { kind: "tap" }).catch(() => undefined));
    const at = Date.now();
    const rowId = `swap:${q.id}`;
    const steps = tradeSteps(q, pay.symbol, get.symbol, at);
    // in the tap's frame: the job's row on Home (Jobs, the bell's pulse) and this sheet as its tracker, away
    tasks?.publish({ id: rowId, title: `Swap $${amount.toFixed(2)} of ${pay.symbol} for ${get.symbol}`, usd: amount.toFixed(2), steps, open: { route: "activity" } });
    tasks?.pulse?.();
    const start: LiveTrack = { id: rowId, kind: "swap", title: `Swap $${trimCents(amount.toFixed(2))}`, wallets: [chain], startMs: at, steps: [] };
    onTrack(() => trackOf(start, { steps }, at));
    mark("away");
    void runTradeJob(bridge, tasks, rowId, q, pay.symbol, get.symbol, Date.now, (v) => {
      mark(v.end ? (v.end.ok ? "landed" : "refused") : "checking");
      onTrack((t) => trackOf(t ?? start, v, Date.now()));
    });
  };
  const side = (label: string, c: PickCoin, on: () => void, held?: number) => (
    <button className="wl-swap-pick" onClick={on} aria-label={`${label}: ${c.symbol}`}>
      <span className="zf-small">{label}</span><CoinIcon symbol={c.symbol} {...(c.icon ? { icon: c.icon } : {})} {...(c.logo ? { src: c.logo } : {})} size={28} />
      <span className="zf-body wl-sw-name">{c.symbol}<span className="zf-small wl-sw-where">{c.name}</span></span>
      {held !== undefined && <span className="zf-small">{dollars(held.toFixed(2))}</span>}
      <svg className="wl-sw-chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
    </button>
  );
  return (
    <>
      {side(SWAP_WORDS.pay, pay, onPickPay, most)}
      {side(SWAP_WORDS.get, get, onPickGet)}
      <div className="wl-swap-amount" style={{ ["--w" as string]: `${Math.max(1, (usd || "0").length) + 0.3}ch` }}>
        <MoneyAmount usd={usd} onUsd={(v) => onUsd(v)} label={`Dollars of ${pay.symbol} to swap`} />
      </div>
      <p className="zf-small wl-sw-arrives" data-testid="swap-arrives">{price.q && !block ? tradeArrives(price.q, NATIVE_SYMBOL[chain]) : ""}</p>
      <div className="wl-swap-chips" role="group" aria-label={`Amount, up to $${most.toFixed(2)}`}>
        {["10", "25", "50"].map((d) => <button key={d} type="button" className="zf-chip" onClick={() => { setPreset(true); onUsd(d); }} disabled={Number(d) > most}>{`$${d}`}</button>)}
        <button type="button" className="zf-chip wl-swap-all" onClick={() => { setPreset(true); onUsd(most.toFixed(2), true); }} aria-label={`Max, $${most.toFixed(2)}`}>{SWAP_WORDS.max}</button>
      </div>
      <Keypad value={padBase(usd || "0", preset)} decimals={2} onChange={(v) => { setPreset(false); onUsd(v === "0" ? "" : v); }} />
      {!block && price.waiting && <p className="zf-small wl-sheet-lead" role="status" data-testid="swap-price-wait">{quoteWaitLine(price.waitedMs)}</p>}
      {!block && (price.late || price.said) && <p className="zf-small wl-sheet-lead" role="status" data-testid="swap-price-late">{price.late ? priceLate(null) : price.said} <button className="zf-link" onClick={price.again}>Try again</button></p>}
      {block && (block !== SWAP_WORDS.amount || tried) && <p className="zf-small wl-mv-why" role="status" data-testid="swap-why">{block}</p>}
      <button type="button" className="zf-btn wl-sheet-go" data-testid="swap-go" disabled={block !== SWAP_WORDS.amount && (!!block || !price.q)}
        onClick={(e) => (block === SWAP_WORDS.amount ? setTried(true) : go(e.currentTarget))}>{SWAP_WORDS.title}</button>
      {/* who gets the fee, under the button (product decision, 5 Nov: we are zero fee): the exchange, and the network's figure from the quote */}
      {!block && price.q && <p className="zf-small wl-zerofee" data-testid="swap-paid">{paidLine(price.q)}</p>}
    </>
  );
}
