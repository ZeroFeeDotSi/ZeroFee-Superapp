// Home's Swap in place (product decision, 5 Nov): the NEAR wallet's cash and a NEAR coin, swapped inside NEAR Intents
// in one signed intent (swap-inplace.ts). The CoinSwap shape: You pay, You get, the dollars, what arrives from the
// quote, who prices it with its fee and own time, and one lit Swap. The tap IS the swap: the sheet becomes the job's
// tracker, Home gets its Jobs row ("NEAR Intents is swapping it"), and the job ends on the core's read of the move.
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
import { SWAP_MIN_USD, SWAP_WORDS, swapKey } from "./swap-corridor.ts";
import { INPLACE_WORDS, inplaceArrives, inplaceLine, inplaceTrack, inplaceUnits, runInplaceJob, tapDetail, type InplaceHeld, type InplaceQuote, type InplaceRoute } from "./swap-inplace.ts";
import type { LiveTrack } from "./live-steps.ts";

/** The core's dry quote for the amount, 0.3 s after it stops changing (nothing moves). */
function useInplaceQuote(bridge: Bridge, ask: { side: string; coin: string; amount: string } | null) {
  const [q, setQ] = useState<InplaceQuote | null>(null);
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
      void bridge.call<InplaceQuote>("subwallet.float.swapQuote", ask).then((r) => {
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

export function InplaceSwap({ bridge, tasks, pay, get, route, most, held, onPickPay, onPickGet, onTrack }: {
  bridge: Bridge; tasks: Tasks | undefined; pay: PickCoin; get: PickCoin; route: InplaceRoute;
  /** The most it can swap, in dollars: the cash (a buy), or what the coin held is worth (a sale). */
  most: number;
  /** A sale: the coin held, in raw units and dollars. */
  held?: InplaceHeld;
  onPickPay: () => void; onPickGet: () => void;
  onTrack: (next: (t: LiveTrack | null) => LiveTrack) => void;
}) {
  const [usd, setUsd] = useState("");
  const [preset, setPreset] = useState(false);
  const [all, setAll] = useState(false);
  const [tried, setTried] = useState(false);
  const amount = Number(typedUsd(usd) ?? 0);
  const block = !(amount > 0) ? SWAP_WORDS.amount : amount < SWAP_MIN_USD && !all ? SWAP_WORDS.least : amount > most + 0.004 ? SWAP_WORDS.most(dollars(most.toFixed(2))) : null;
  const units = block ? null : inplaceUnits(route.side, amount, all, held);
  const price = useInplaceQuote(bridge, units ? { side: route.side, coin: route.coin, amount: units } : null);
  const went = useRef(false);
  const onUsd = (v: string, max = false) => { setTried(false); setAll(max); setUsd(v); };
  const go = (el: HTMLElement) => {
    const q = price.q;
    if (!q || !units || went.current) return;
    went.current = true;
    mark("tap");
    tapBurst(el, () => void bridge.call("device.haptic", { kind: "tap" }).catch(() => undefined));
    const at = Date.now();
    const key = swapKey();
    const rowId = `swap:${key}`;
    // in the tap's frame: the job's row on Home (the protocol named, the quoter's own time) and this sheet as its tracker
    const detail = tapDetail(q);
    tasks?.publish({ id: rowId, title: `Swap $${amount.toFixed(2)} of ${pay.symbol} for ${get.symbol}`, usd: amount.toFixed(2), steps: [{ label: INPLACE_WORDS.step, state: "doing", at }], ...(detail ? { detail } : {}), open: { route: "activity" } });
    tasks?.pulse?.();
    const start: LiveTrack = { id: rowId, kind: "swap", title: `Swap $${trimCents(amount.toFixed(2))}`, wallets: ["near"], startMs: at, steps: [] };
    onTrack(() => inplaceTrack(start, { state: "doing" }, at));
    mark("away");
    void runInplaceJob({ bridge, tasks, rowId, route, units, q, key, tapMs: at, onView: (v) => {
      mark(v.end ? (v.end.ok ? "landed" : "refused") : "checking");
      onTrack((t) => inplaceTrack(t ?? start, v, Date.now()));
    } });
  };
  const side = (label: string, c: PickCoin, on: () => void, dollarsHeld?: number) => (
    <button className="wl-swap-pick" onClick={on} aria-label={`${label}: ${c.symbol}`}>
      <span className="zf-small">{label}</span><CoinIcon symbol={c.symbol} {...(c.icon ? { icon: c.icon } : {})} {...(c.logo ? { src: c.logo } : {})} size={28} />
      <span className="zf-body wl-sw-name">{c.symbol}<span className="zf-small wl-sw-where">{c.name}</span></span>
      {dollarsHeld !== undefined && <span className="zf-small">{dollars(dollarsHeld.toFixed(2))}</span>}
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
      <p className="zf-small wl-sw-arrives" data-testid="swap-arrives">{price.q && !block ? inplaceArrives(route.side, price.q, get.symbol) : ""}</p>
      <div className="wl-swap-chips" role="group" aria-label={`Amount, up to $${most.toFixed(2)}`}>
        {["10", "25", "50"].map((d) => <button key={d} type="button" className="zf-chip" onClick={() => { setPreset(true); onUsd(d); }} disabled={Number(d) > most}>{`$${d}`}</button>)}
        <button type="button" className="zf-chip wl-swap-all" onClick={() => { setPreset(true); onUsd(most.toFixed(2), true); }} aria-label={`Max, $${most.toFixed(2)}`}>{SWAP_WORDS.max}</button>
      </div>
      <Keypad value={padBase(usd || "0", preset)} decimals={2} onChange={(v) => { setPreset(false); onUsd(v === "0" ? "" : v); }} />
      {!block && price.q && <p className="zf-small wl-sheet-lead" data-testid="swap-route">{inplaceLine(route.side, price.q)}</p>}
      {!block && price.waiting && <p className="zf-small wl-sheet-lead" role="status" data-testid="swap-price-wait">{quoteWaitLine(price.waitedMs)}</p>}
      {!block && (price.late || price.said) && <p className="zf-small wl-sheet-lead" role="status" data-testid="swap-price-late">{price.late ? INPLACE_WORDS.late : price.said} <button className="zf-link" onClick={price.again}>Try again</button></p>}
      {block && (block !== SWAP_WORDS.amount || tried) && <p className="zf-small wl-mv-why" role="status" data-testid="swap-why">{block}</p>}
      <button type="button" className="zf-btn wl-sheet-go" data-testid="swap-go" disabled={block !== SWAP_WORDS.amount && (!!block || !price.q)}
        onClick={(e) => (block === SWAP_WORDS.amount ? setTried(true) : go(e.currentTarget))}>{SWAP_WORDS.title}</button>
    </>
  );
}
