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
import { typedUsd } from "../hub.ts";
import { dollars } from "../format.ts";
import type { PickCoin } from "./coin-pick.ts";
import { SWAP_WORDS, swapKey } from "./swap-corridor.ts";
import { INPLACE_STALE_MS, INPLACE_WORDS, endsAtOf, inplaceArrives, inplaceBlock, inplaceFee, inplaceFigures, inplaceTitle, inplaceTrack, inplaceUnits, quoteFailed, runInplaceJob, tapDetail, type InplaceHeld, type InplaceQuote, type InplaceRoute } from "./swap-inplace.ts";
import { MOVE_WORDS } from "../screens/move-split.ts";
import { intentsKept } from "@zerofee/core/zero-fee";
import type { LiveTrack } from "./live-steps.ts";

/** Where a coin bought in place lands (copywriter: as other coins there say). */
const NEAR_WALLET = "Your NEAR wallet";

/** A dry quote shown is asked again this often while the sheet sits (item 9: it was asked once and kept forever), and a
 *  tap on one older than QUOTE_FRESH_MS asks again first (the tap's `atLeast` is never from a stale price). */
export const QUOTE_REFRESH_MS = 15_000, QUOTE_FRESH_MS = 30_000;

/** The core's dry quote for the amount, 0.3 s after it stops changing (nothing moves), asked again every 15 s. */
function useInplaceQuote(bridge: Bridge, ask: { side: string; coin: string; amount: string } | null) {
  const [q, setQ] = useState<{ q: InplaceQuote; at: number } | null>(null);
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
    let slow: ReturnType<typeof setTimeout> | undefined, again: ReturnType<typeof setTimeout> | undefined;
    // the first ask shows "Getting a price…"; a refresh keeps the price shown until the new one comes
    const once = (first: boolean) => {
      if (first) { setWaiting(true); slow = setTimeout(() => { if (live) { setWaiting(false); setLate(true); } }, QUOTE_WAIT_MS); }
      void bridge.call<InplaceQuote>("subwallet.float.swapQuote", ask).then((r) => {
        clearTimeout(slow);
        if (!live) return;
        setWaiting(false);
        if ("ok" in r) { setQ({ q: r.ok, at: Date.now() }); setSaid(null); } else if (first) setSaid(r.problem.whatHappened);
        again = setTimeout(() => once(false), QUOTE_REFRESH_MS);
      }, () => { clearTimeout(slow); if (live && first) { setWaiting(false); setLate(true); } });
    };
    const t = setTimeout(() => once(true), 300);
    return () => { live = false; clearTimeout(t); clearTimeout(slow); clearTimeout(again); };
  }, [bridge, key, tries]);
  return { q: q?.q ?? null, at: q?.at ?? 0, waiting, waitedMs, said, late, again: () => setTries((n) => n + 1) };
}

/** A coin 1Click's list doesn't price: what all of it is worth, from the core's dry quote of selling it whole. */
function useWorth(bridge: Bridge, coin: string, held: InplaceHeld | undefined): number | null {
  const [worth, setWorth] = useState<number | null>(null);
  const ask = held && held.usd === null ? held.raw : null;
  useEffect(() => {
    setWorth(null);
    if (!ask) return;
    let live = true;
    void bridge.call<InplaceQuote>("subwallet.float.swapQuote", { side: "sell", coin, amount: ask }).then((r) => { if (live && "ok" in r) setWorth(Math.floor(Number(r.ok.amountOut) / 1e4) / 100); }, () => undefined);
    return () => { live = false; };
  }, [bridge, coin, ask]);
  return worth;
}

export function InplaceSwap({ bridge, tasks, pay, get, route, most, held, cashRaw, onPickPay, onPickGet, onTrack }: {
  bridge: Bridge; tasks: Tasks | undefined; pay: PickCoin; get: PickCoin; route: InplaceRoute;
  /** The most it can swap, in dollars: the NEAR wallet's cash (a buy, item 4: its one figure), or the coin held (a sale). */
  most: number;
  /** A sale: the coin held, in raw units and dollars (null: no price). */
  held?: InplaceHeld;
  /** A buy: the cash's own raw units, so Max spends all of it (item 4: Max stranded 3 %). */
  cashRaw?: string;
  onPickPay: () => void; onPickGet: () => void;
  onTrack: (next: (t: LiveTrack | null) => LiveTrack) => void;
}) {
  const [usd, setUsd] = useState("");
  const [preset, setPreset] = useState(false);
  const [all, setAll] = useState(false);
  const [tried, setTried] = useState(false);
  const [who, setWho] = useState(false);
  const worth = useWorth(bridge, route.coin, route.side === "sell" ? held : undefined);
  const heldNow: InplaceHeld | undefined = held && held.usd === null && worth !== null ? { raw: held.raw, usd: worth } : held;
  const mostNow = route.side === "sell" ? heldNow?.usd ?? 0 : most;
  const amount = Number(typedUsd(usd) ?? 0);
  const block = inplaceBlock({ side: route.side, amount, all, most: mostNow, priced: route.side === "buy" || (heldNow?.usd ?? null) !== null });
  const units = block ? null : inplaceUnits(route.side, amount, all, heldNow, cashRaw);
  const price = useInplaceQuote(bridge, units ? { side: route.side, coin: route.coin, amount: units } : null);
  const went = useRef(false);
  const onUsd = (v: string, max = false) => { setTried(false); setAll(max); setUsd(v); };
  const go = (el: HTMLElement) => {
    const q = price.q;
    if (!q || !units || went.current) return;
    // a price older than QUOTE_FRESH_MS is asked again first: the tap never signs a stale least
    if (Date.now() - price.at > QUOTE_FRESH_MS) return price.again();
    went.current = true;
    mark("tap");
    tapBurst(el, () => void bridge.call("device.haptic", { kind: "tap" }).catch(() => undefined));
    const at = Date.now();
    const key = swapKey();
    const rowId = `swap:${key}`;
    // what it pays in dollars: the amount, or (all of a coin) the quote's own figure
    const paid = amount > 0 ? amount : inplaceFigures(route.side, q).payUsd;
    const getName = route.side === "buy" ? get.symbol : "USDC";
    const payName = route.side === "buy" ? "USDC" : pay.symbol;
    const title = inplaceTitle(paid, payName, getName);
    // in the tap's frame: the job's row on Home (the protocol named, the quoter's own time) and this sheet as its tracker;
    // a closed phone's job is ended by the core's record on the next load (resumeInplace); the store's clock only past the core's week
    const detail = tapDetail(q);
    tasks?.publish({ id: rowId, title, usd: `$${paid.toFixed(2)}`, steps: [{ label: INPLACE_WORDS.step, state: "doing", at }], ...(detail ? { detail } : {}), ...endsAtOf(at, q), open: { route: `activity:${rowId}` }, staleMs: INPLACE_STALE_MS, staleDetail: INPLACE_WORDS.unread });
    tasks?.pulse?.();
    const start: LiveTrack = { id: rowId, kind: "swap", title, wallets: ["near"], startMs: at, steps: [], bar: SWAP_WORDS.title, made: true, ...endsAtOf(at, q) };
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
  // what it pays from, with what it holds; what it gets, with where it lands (item 12: the NEAR wallet, never the coin's
  // own long name)
  const payHeld = route.side === "buy" || (heldNow?.usd ?? null) !== null ? mostNow : undefined;
  const getWhere: PickCoin = route.side === "buy" ? { ...get, name: NEAR_WALLET } : get;
  return (
    <>
      {side(SWAP_WORDS.pay, pay, onPickPay, payHeld)}
      {side(SWAP_WORDS.get, getWhere, onPickGet)}
      <div className="wl-swap-amount" style={{ ["--w" as string]: `${Math.max(1, (usd || "0").length) + 0.3}ch` }}>
        <MoneyAmount usd={usd} onUsd={(v) => onUsd(v)} label={`Dollars of ${pay.symbol} to swap`} />
      </div>
      <p className="zf-small wl-sw-arrives" data-testid="swap-arrives">{price.q && !block ? inplaceArrives(route.side, price.q, get.symbol) : ""}</p>
      <div className="wl-swap-chips" role="group" aria-label={`Amount, up to $${mostNow.toFixed(2)}`}>
        {["10", "25", "50"].map((d) => <button key={d} type="button" className="zf-chip" onClick={() => { setPreset(true); onUsd(d); }} disabled={Number(d) > mostNow}>{`$${d}`}</button>)}
        <button type="button" className="zf-chip wl-swap-all" onClick={() => { setPreset(true); onUsd(mostNow > 0 ? mostNow.toFixed(2) : "", true); }} aria-label={`Max, $${mostNow.toFixed(2)}`}>{SWAP_WORDS.max}</button>
      </div>
      <Keypad value={padBase(usd || "0", preset)} decimals={2} onChange={(v) => { setPreset(false); onUsd(v === "0" ? "" : v); }} />
      {!block && price.waiting && <p className="zf-small wl-sheet-lead" role="status" data-testid="swap-price-wait">{quoteWaitLine(price.waitedMs)}</p>}
      {!block && (price.late || price.said) && <>
        <p className="zf-small wl-sheet-lead" role="status" data-testid="swap-price-late">{quoteFailed(price.late ? INPLACE_WORDS.late : price.said ?? "")}</p>
        <button type="button" className="zf-btn zf-btn--quiet" data-testid="swap-price-again" onClick={price.again}>Try again</button>
      </>}
      {block && (block !== SWAP_WORDS.amount || tried) && <p className="zf-small wl-mv-why" role="status" data-testid="swap-why">{block}</p>}
      <div className="wl-mv-who">
        <button type="button" className="wl-mv-who__q" aria-expanded={who} onClick={() => setWho((w) => !w)} data-testid="swap-who">{MOVE_WORDS.who}</button>
        {who && <p className="zf-small wl-mv-foot" data-testid="swap-private">{SWAP_WORDS.privately}</p>}
      </div>
      {/* the fee block, right above the button (the copy review, 6 Nov): the figure is this quote's */}
      <div className="zf-fee">
        {!block && price.q && <p className="zf-small" data-testid="swap-fee">{inplaceFee(route.side, price.q)}</p>}
        <p className="zf-small" data-testid="swap-paid">{intentsKept(!block && !!price.q)}</p>
      </div>
      <button type="button" className="zf-btn wl-sheet-go" data-testid="swap-go" disabled={block !== SWAP_WORDS.amount && (!!block || !price.q)}
        onClick={(e) => (block === SWAP_WORDS.amount ? setTried(true) : go(e.currentTarget))}>{SWAP_WORDS.title}</button>
    </>
  );
}
