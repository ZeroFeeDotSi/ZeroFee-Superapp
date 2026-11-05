// Discover (D136, the A+ pass of 3 Nov's design review). One row of tabs where the balance is the tab: All, then each
// chain whose coins the market lists, its logo and what your wallet there holds (D129: each chain's own wallet, never a
// "Trading" pot); a wallet with no market yet (NEAR, until its fast route) keeps its balance at the end of the row, quiet
// and not a tab. Then the one pill on the screen: search by name or a pasted address (Paste is plain text in the field and
// reads the clipboard only on its tap, D33). Then the lists as text tabs, the same six on every chain: Hot (GeckoTerminal's
// own trending order, never coins we pick) · New (the newest launches) · 5m · 1h · 6h · 24h (the biggest rise). Then the
// rows: only they rise in; every coin has its own logo (a shimmer until it arrives, and a coin with no logo anywhere stays
// out of Hot and New); the change is coloured text; a price that moved gets a glint, never a box, and its digits never
// roll; at most two rows glow in their coin's own light. The list paints from the device in the first frame
// (runtime.tsx useMarketList) and reads again by itself; a press warms the coin's page before the tap lands.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { LiveRow } from "@zerofee/design/LiveRow.tsx";
import { ReceiptMark } from "@zerofee/design/Receipt.tsx";
import { mark, tapBurst } from "@zerofee/design/tap.ts";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { ProblemError } from "@zerofee/core/problem";
import { CHAINS, type TradeRecord } from "../../service.ts";
import { amount as fmtAmount } from "../format.ts";
import { createFeedback } from "../feedback.ts";
import { landedDetail, whenCosted } from "../landed-detail.ts";
import { ROW_RECEIPT_MS, rowBuyEnd, rowBuyLanded, rowBuyLine, type RowBuy as RowBuyState } from "./row-buy.ts";
import { useQuickBuy } from "./quick-buy.ts";
import type { CoinRow } from "../../market/types.ts";
import { tickKey } from "../../market/ticks.ts";
import type { BuyRefusal } from "../../sol/screen.ts";
import type { ChainId } from "../../types.ts";
import type { FloatSnapshot } from "../../float-view.ts";
import { listPrice, pct, rowUsd, usd } from "../format.ts";
import { Gear, Search } from "../icons.tsx";
import { readPasted } from "../paste.ts";
import { OFFLINE_SHORT, useOnline } from "../online.ts";
import { changeIn, moversOf } from "../movers.ts";
import { LISTS, NOT_AN_ADDRESS, litRows, newestAcross, notAnAddress, risesIn, type Win } from "./discover-rules.ts";
import { fromAgoText } from "../list-age.ts";
import { LISTED, MARKET, useFloat, useLogo, useMarketList, usePrefetchCoin, useSeenPrefetch, useTick, useTrade } from "../runtime.tsx";
import { rowLogo } from "../../market/logo.ts";
import "../discover.css";

/** Home's words for each chain (D124): the coin, and ETH (RH) for Robinhood Chain. */
export const CHAIN_SHORT: Record<ChainId, string> = { sol: "SOL", hood: "ETH (RH)", near: "NEAR", bsc: "BNB" };
/** The bundled logos, by trusted key. */
const CHAIN_ICON: Record<ChainId, string> = { sol: "sol", hood: "hood", near: "near", bsc: "bsc" };
/** A coin's worth in a row: the row form, suffixed ("$3.1K", "$153.4K", never "$153,447": the copy review's ruling, 5 Nov). */
const capWords = (n: number): string => rowUsd(n);
/** A launch younger than this wears its age, with a live dot. */
const NEW_MS = 6 * 3_600_000;


const ageText = (ms: number): string => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : `${Math.round(ms / 3_600_000)} h`);

/** What each wallet holds, in dollars (undefined until read: a shimmer, never "$0.00" for a wallet not read yet).
 *  One figure with Home (re-check, 5 Nov: Trade's SOL tab said $137.19 while Home said $137.23, read 2 s apart): the
 *  float's own chain figure, the one spending.status rounds into Home's row (core usdText), never the trade engine's
 *  sizing price. Each tab is the wallet's own coin, as Home's row is. */
export function walletUsdOf(snap: Pick<FloatSnapshot, "loaded" | "unread" | "reserveUsd" | "chains">, c: ChainId): number | undefined {
  if (!snap.loaded || snap.unread) return undefined;
  if (c === "near") return snap.reserveUsd;
  const ch = snap.chains.find((x) => x.chain === c);
  // to the cent as core usdText does (Math.round(x * 100) / 100, never below 0)
  return ch && !ch.unread ? Math.round(Math.max(0, ch.nativeUsd) * 100) / 100 : undefined;
}
function useWalletUsd(): (c: ChainId) => number | undefined {
  const { snap } = useFloat();
  return (c) => walletUsdOf(snap, c);
}

/** The one row of tabs: All, then each market chain as its logo and its wallet's balance (the balance is the tab); a
 *  marker slides under the chosen one. A wallet with no market yet shows its balance after the tabs, not as a tab. */
function ChainTabs({ chain, onChain, onSettings, onMove }: { chain: ChainId | "all"; onChain: (c: ChainId | "all") => void; onSettings?: () => void; onMove?: () => void }) {
  const usdOf = useWalletUsd();
  const box = useRef<HTMLDivElement>(null);
  const [mark, setMark] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-chain="${chain}"]`);
    if (el) setMark({ x: el.offsetLeft, w: el.offsetWidth });
  }, [chain, usdOf("sol") === undefined, usdOf("hood") === undefined]);
  const quiet = LISTED.filter((c) => !MARKET.includes(c));
  const money = (c: ChainId) => { const v = usdOf(c); return v === undefined ? <span className="zf-shimmer dc-tab-sk" /> : <span className="dc-tab-usd">{usd(v)}</span>; };
  return (
    <div className="dc-top">
      <div className="dc-tabs" role="tablist" aria-label="Your wallets and their markets" ref={box}>
        <button data-chain="all" role="tab" aria-selected={chain === "all"} className={chain === "all" ? "on" : ""} onClick={() => onChain("all")}>All</button>
        {MARKET.map((c) => {
          const v = usdOf(c);
          return (
            <button key={c} data-chain={c} role="tab" aria-selected={chain === c} className={chain === c ? "on" : ""} onClick={() => onChain(c)}
              aria-label={`Your ${CHAIN_SHORT[c]} wallet${v === undefined ? "" : `, ${usd(v)}`}`}>
              <CoinIcon symbol={CHAIN_SHORT[c]} icon={CHAIN_ICON[c]} size={18} />{money(c)}
            </button>
          );
        })}
        {quiet.filter((c) => (usdOf(c) ?? 0) > 0).map((c) => (
          <span key={c} className="dc-tab-quiet" aria-label={`Your ${CHAIN_SHORT[c]} wallet${usdOf(c) === undefined ? "" : `, ${usd(usdOf(c)!)}`}`}>
            <CoinIcon symbol={CHAIN_SHORT[c]} icon={CHAIN_ICON[c]} size={18} />{money(c)}
          </span>
        ))}
        {mark && <span className="dc-mark" aria-hidden="true" style={{ transform: `translateX(${mark.x}px)`, width: mark.w }} />}
      </div>
      {/* Move without leaving Trade (product decision, 4 Nov): Home's own Move sheet over Trade, back here once it is on its way */}
      {onMove && <button className="dc-move" aria-label="Move money between your Safe and your wallets" onClick={onMove}>Move</button>}
      {onSettings && <button className="dc-gear" aria-label="Settings" onClick={onSettings}><Gear /></button>}
    </div>
  );
}

/** A coin's own logo, or a shimmer disc while it comes; never a letter. A coin with none anywhere is a plain disc. */
function Logo({ r, lit }: { r: CoinRow; lit: boolean }) {
  const logo = useLogo(rowLogo(r.logoUrl));
  return (
    <span className={`zf-halo dc-logo${lit && logo.src ? " is-on" : ""}`}>
      {lit && logo.src && <img className="zf-halo__light" src={logo.src} alt="" />}
      {logo.src ? <img className="dc-img" src={logo.src} alt="" width={40} height={40} />
        : logo.state === "loading" ? <span className="zf-shimmer dc-img dc-img--wait" /> : <span className="dc-img dc-img--none" />}
    </span>
  );
}

/** One coin: its logo (its chain's mark on All), its name, its price (a glint when it moves; the digits never roll) and its
 *  change as coloured text. Out of Hot and New when the coin has no logo anywhere (`needsLogo`). `rise`: its place among the
 *  rows new to the list when it first mounted (it rises in, staggered), or null for one already shown: a row stays mounted
 *  across tabs and lists, so a switch only filters (D145: the speed worker measured a remount of every row at 78 ms p95). */
const Row = memo(function Row({ r, rise, win, showChain, refused, lit, needsLogo, onCoin }: { r: CoinRow; rise: number | null; win: Win; showChain: boolean; refused: boolean; lit: boolean; needsLogo: boolean; onCoin: (r: CoinRow) => void }) {
  const [enter] = useState(rise);
  const tick = useTick(tickKey(r.chain, r.address));
  const logo = useLogo(rowLogo(r.logoUrl));
  const prefetch = usePrefetchCoin();
  const seen = useSeenPrefetch(r);
  const ch = changeIn(r, win === "new" ? "trending" : win);
  const age = r.createdAt ? Date.now() - r.createdAt : undefined;
  const fresh = age !== undefined && age >= 0 && age < NEW_MS;
  // the quiet Buy chip's trade (row-buy.ts): while it is on, the row IS the receipt (the mark on the logo, the line under the name)
  const [buy, setBuy] = useState<RowBuyState | null>(null);
  // a trade still checking is followed on the service's events (RowBuy): the row that owns it stops the follow when it goes
  const follow = useRef<(() => void) | null>(null);
  useEffect(() => () => { follow.current?.(); follow.current = null; }, []);
  // the row is the receipt until the trade's end is known: a landed or refused one stays ROW_RECEIPT_MS, then the chip is
  // back; one still checking keeps the row (no chip: a second $25 must never be invited by a trade that may still land)
  useEffect(() => {
    if (!buy || buy.phase === "away" || buy.phase === "checking") return;
    const t = setTimeout(() => setBuy(null), ROW_RECEIPT_MS);
    return () => clearTimeout(t);
  }, [buy]);
  // after every hook (the 5 Nov walk: returning before the chip's hooks crashed Trade, "Rendered fewer hooks", when a row's logo failed on New)
  if (needsLogo && logo.state === "none") return null;
  return (
    <div className={`dc-rr${buy ? ` is-${buy.phase}` : ""}`}>
    <LiveRow rowRef={seen} state="past" className={`dc-row${enter !== null ? " zf-rise" : ""}`} style={enter !== null ? { ["--i" as string]: enter } : undefined} onPointerDown={() => prefetch(r)} onOpen={() => onCoin(r)}
      mark={<span className="dc-logo-box">
        {buy ? <ReceiptMark state={buy.phase} icon={<Logo r={r} lit={false} />} size={48} /> : <Logo r={r} lit={lit} />}
        {showChain && !buy && <span className="dc-badge" role="img" aria-label={`on ${CHAIN_SHORT[r.chain]}`}><CoinIcon symbol={CHAIN_SHORT[r.chain]} icon={CHAIN_ICON[r.chain]} size={16} /></span>}
      </span>}
      title={<span className="dc-sym">{r.symbol}{fresh && !buy && <span className="dc-age"><span className="zf-live" />{ageText(age!)}</span>}</span>}
      // the chain is the logo's badge, spoken as "on ETH (RH)" (webd-money2 crawl, 4 Nov: CASHCAT's row didn't say ETH (RH))
      line={buy ? <span className="dc-sub--buy" role="status">{buy.phase === "away" && <span className="zf-live" aria-hidden="true" />}<span className="dc-sub__words">{rowBuyLine(buy, r.symbol)}</span></span>
        // product decision, 5 Nov (via a proxy): the line is the coin's name and worth ("Doge Pepe · $3.27M"); on All the chain is
        // the badge on the logo and the row's spoken label, never words that pushed the name to "SOL ·…" beside the chip
        : <span className="dc-sub"><span className="dc-name">{r.name}</span>{r.marketCapUsd ? <span className="dc-cap">{capWords(r.marketCapUsd)}</span> : null}</span>}
      usd={<span className={`dc-px${tick === "up" ? " dc-glint-up" : tick === "down" ? " dc-glint-down" : ""}`}>{r.priceUsd ? listPrice(r.priceUsd) : ""}</span>}
      when={refused ? <span className="dc-chg">Not offered</span> : ch !== undefined ? <span className={`dc-chg ${ch > 0 ? "up" : ch < 0 ? "down" : ""}`}>{pct(ch)}</span> : undefined} />
    {!refused && !buy && <RowBuy r={r} onState={setBuy} follow={follow} />}
    </div>
  );
});

/** The quiet Buy chip (Build A): one tap buys Settings' Quick buy amount of the row's coin through the sheet's own service, origin
 *  `chip:<address>` in the one-tap lock's key (a double tap is one trade; a chip beside an open sheet is another trade).
 *  It lights only under the finger. The checks are the sheet's: a chain with less than the preset ready refuses on the
 *  row before anything is asked; the core's refusal is said on the row in its own words; never a silent fail. */
function RowBuy({ r, onState: tell, follow }: { r: CoinRow; onState: (b: RowBuyState) => void; follow: MutableRefObject<(() => void) | null> }) {
  // the crawl's clock (QA): the row's state leaves the Receipt's marks (tap.ts), as the sheet's does
  const onState = (b: RowBuyState) => { mark(b.phase); tell(b); };
  const { svc } = useTrade();
  const { bridge, tasks } = useShell();
  const { snap } = useFloat();
  const feel = useMemo(() => createFeedback(bridge), [bridge]);
  // Settings' Quick buy amount (quick-buy.ts): $25 unless the person picked another
  const quick = useQuickBuy(bridge);
  const busy = useRef(false);
  const press = async (el: HTMLElement) => {
    if (busy.current) return;
    busy.current = true;
    tapBurst(el, () => feel.key());
    // inside the tap: a phone lets the fill's ting play only if its audio was woken by the touch (bug report, 5 Nov:
    // a row's Buy was silent because only the sheet armed)
    feel.arm();
    const at = performance.now();
    onState({ phase: "away", at });
    // the sheet's own check: a chain whose ready money is under the preset offers nothing to send (NEAR coins trade in Spending: no chain view)
    const ready = snap.chains.find((x) => x.chain === r.chain)?.readyUsd;
    if (ready !== undefined && ready < quick) {
      busy.current = false;
      onState({ phase: "refused", at, why: `Only $${ready.toFixed(2)} on ${CHAINS[r.chain].name}. Open the coin to buy less.` });
      return;
    }
    const taskId = `trade-${Date.now()}`, taskAt = Date.now();
    const route = `coin:${r.chain}:${r.address}:${r.symbol}`;
    const secs = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
    try {
      const p = await svc.quote("buy", r.chain, r.address, { usd: quick });
      await p.ready();
      const q = p.quote;
      const got = `${fmtAmount(q.getRaw, q.decimals)} ${r.symbol}`;
      onState({ phase: "away", at, got });
      tasks?.publish({ id: taskId, title: `Buy $${quick} of ${r.symbol}`, open: { route },
        steps: [{ label: "Sent", state: "doing", at: taskAt }, { label: "Landed", state: "waiting" }, { label: `In your ${CHAINS[r.chain].symbol} wallet`, state: "waiting" }] });
      const rec = await svc.trade(p, `chip:${r.address}`);
      const landed = (rec: TradeRecord) => {
        const now = Date.now(), ms = performance.now() - at;
        rowBuyLanded(tasks, taskId, { taskAt, now, wallet: `In your ${CHAINS[r.chain].symbol} wallet`, detail: landedDetail(secs(ms), rec, CHAINS[r.chain].name), proof: (rec.hashes ?? []).map((hash) => ({ chain: r.chain, hash })) });
        whenCosted(svc.on, rec, () => void tasks?.update(taskId, { detail: landedDetail(secs(ms), rec, CHAINS[r.chain].name) }));
        void feel.filled();
        onState({ phase: "landed", at, got, ms });   // the Row keeps the state: this chip is gone the moment the row is the receipt
      };
      const refused = (rec: TradeRecord, why?: string) => {
        tasks?.end(taskId, rec.status === "declined" ? "stopped" : "failed", why);
        if (rec.status !== "declined") feel.failed();
        onState({ phase: "refused", why, at, got });
      };
      const end = rowBuyEnd(rec);
      if (end.phase === "landed") { landed(rec); return; }
      if (end.phase === "refused") { refused(rec, end.why); return; }
      // unconfirmed (QA's MUST): the chain's answer was lost after the send, so the trade may still land. The task
      // stays open (Sent done, Landed doing), no failed buzz, the row stays the receipt with no chip; the service looks at the
      // record again (its resume on the next open) and the row and the task end only as that answer says
      tasks?.update(taskId, { detail: "Sent · still checking", steps: [{ label: "Sent", state: "done", at: taskAt }, { label: "Landed", state: "doing" }, { label: `In your ${CHAINS[r.chain].symbol} wallet`, state: "waiting" }] });
      onState({ phase: "checking", at, got });
      let ended = false;   // two events can each start activity() before the follow is off: the end fires once
      const off = svc.on(() => void svc.activity().then((all) => {
        if (ended) return;
        const now = all.find((x) => x.id === rec.id);
        if (!now || now.status === "unconfirmed" || now.status === "confirming" || now.status === "sending" || now.status === "signing") return;
        ended = true;
        off();
        follow.current = null;
        const e2 = rowBuyEnd(now);
        if (e2.phase === "landed") landed(now); else if (e2.phase === "refused") refused(now, e2.why);
      }));
      follow.current = off;   // the Row stops it if it goes first
    } catch (e) {
      const why = e instanceof ProblemError ? e.problem.whatHappened : "It didn't go through. Nothing moved.";
      tasks?.end(taskId, "failed", why);
      feel.failed();
      onState({ phase: "refused", at, why });
    } finally { busy.current = false; }
  };
  return (
    <button type="button" className="dc-qb" aria-label={`Buy $${quick} of ${r.symbol}`} onClick={(e) => void press(e.currentTarget)}>
      <span className="dc-qb__pill" aria-hidden="true">Buy</span>
    </button>
  );
}



/** `chain`: the chain tab it opens on (a Home row asked for that chain's market, FLOW-V4); a chain not listed is All. */
/** `onSettings`: Trade's settings, one tap away at the end of the tabs. */
/** `win`, `onWin`: the list shown (Hot, New, 5m…), kept by Trade so Back from a coin keeps it (re-test). */
export function Discover({ onCoin, chain: start, onChain, onSettings, onMove, win: startWin, onWin }: { onCoin: (row: CoinRow) => void; chain?: ChainId | "all"; onChain?: (chain: ChainId | "all") => void; onSettings?: () => void; /** Trade's Move (Home's Move sheet over Trade) */ onMove?: () => void; win?: Win; onWin?: (w: Win) => void }) {
  const { refused: refusedOf, sample: sampleP } = useTrade();
  const [sample, setSample] = useState(false);
  useEffect(() => { void sampleP.then(setSample, () => undefined); }, [sampleP]);
  const [q, setQ] = useState("");
  const [win, setWinState] = useState<Win>(startWin ?? "trending");
  const setWin = (w: Win) => { setWinState(w); onWin?.(w); };
  const { bridge } = useShell();
  // the Paste tap: the one moment the clipboard is read; nothing there says so in the field for a moment
  const [nothing, setNothing] = useState(false);
  useEffect(() => { if (!nothing) return; const t = setTimeout(() => setNothing(false), 3_000); return () => clearTimeout(t); }, [nothing]);
  const paste = async () => { const t = await readPasted(bridge); if (t) setQ(t); else setNothing(true); };
  const [chain, setChainState] = useState<ChainId | "all">(start && start !== "all" && MARKET.includes(start) ? start : MARKET.length === 1 ? MARKET[0]! : "all");
  // the screen's coins line follows the tab shown (3 Nov e2e walk, 82)
  const setChain = (c: ChainId | "all") => { setChainState(c); onChain?.(c); };
  useEffect(() => { onChain?.(chain); }, []);
  const term = q.trim();
  // an address that can't be one is said at once, never sent to the market (finding 14)
  const badAddress = notAnAddress(term);
  const newAll = !term && win === "new" && chain === "all";
  const one = useMarketList(term ? (badAddress ? null : { kind: "search", q: term }) : win === "new" ? (chain === "all" ? null : { kind: "new", chain }) : { kind: "trending", chain });
  // New on All: one list per market chain, merged (MARKET is fixed for the page's life, so these hooks never change count)
  const each = MARKET.map((c) => useMarketList(newAll ? { kind: "new", chain: c } : null));
  const list = newAll
    ? { rows: each.some((l) => l.rows) ? newestAcross(each.map((l) => l.rows)) : null, loading: each.some((l) => l.loading) && !each.some((l) => l.rows?.length), failed: each.every((l) => l.failed), staleMs: each.reduce<number | null>((m, l) => (l.staleMs === null ? m : Math.max(m ?? 0, l.staleMs)), null), retry: () => each.forEach((l) => l.retry()) }
    : one;
  // a list that couldn't be read is asked again by itself, sooner first (useMarketList: 2 s, 4 s, 8 s … 30 s), and Try
  // again asks at once (QA's crawl, 4 Nov: Trending stopped on a market 429 with no way on)
  const failedEmpty = list.failed && !(list.rows?.length);
  // coins Buy would refuse (Solana's mint checks): asked beside the list, never holding it back; they leave the lists when
  // the answer comes, and a coin searched for still shows, as "Not offered"
  const [refused, setRefused] = useState<Map<string, BuyRefusal>>(new Map());
  const solKey = (list.rows ?? []).filter((x) => x.chain === "sol").map((x) => x.address).join(",");
  useEffect(() => {
    if (!solKey) return;
    let live = true;
    void refusedOf("sol", solKey.split(",")).then((m) => { if (live) setRefused(m); }, () => undefined);
    return () => { live = false; };
  }, [solKey, refusedOf]);
  // Hot and New offer only coins with a logo (every coin has one); a search still finds any coin, on a plain disc
  const rows = (list.rows ?? []).filter((x) => MARKET.includes(x.chain) && (chain === "all" || x.chain === chain) && (term ? true : !refused.has(x.address) && !!x.logoUrl));
  const shown = term || win === "new" ? rows : moversOf(rows, win);
  const lit = litRows(shown, term ? "trending" : win);
  // rows new to the list rise in, staggered among themselves; a row already shown just stays (it is never remounted)
  // the first screen of rows is there at full ink, with no rise (UX audit 4 Nov: they reached 95 % ink only at ~900 ms)
  const seen = useRef(new Set<string>());
  let next = 0;
  const riseOf = new Map(shown.map((r) => { const k = `${r.chain}:${r.address}`; return [k, risesIn(seen.current, k) ? next++ : null] as const; }));
  useEffect(() => { for (const r of shown) seen.current.add(`${r.chain}:${r.address}`); });
  // one function for every row, so a tab switch re-renders no row whose coin didn't change
  const onCoinNow = useRef(onCoin);
  onCoinNow.current = onCoin;
  const openRow = useCallback((r: CoinRow) => onCoinNow.current(r), []);
  const online = useOnline();
  return (
    <div className="dc">
      <ChainTabs chain={chain} onChain={setChain} {...(onSettings ? { onSettings } : {})} {...(onMove ? { onMove } : {})} />
      <label className="dc-field">
        <Search />
        <input id="tr-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={nothing ? "Nothing copied to paste" : "Name or address"} autoComplete="off" spellCheck={false} />
        {!q ? <button className="dc-paste" onClick={() => void paste()}>Paste</button>
          : <button className="dc-paste" onClick={() => { setQ(""); document.getElementById("tr-search")?.blur(); }}>Clear</button>}
      </label>
      {!term && (
        <div className="dc-wins" role="tablist" aria-label="Lists">
          {LISTS.map(([w, label]) => <button key={w} role="tab" aria-selected={w === win} className={w === win ? "on" : ""} onClick={() => setWin(w)}>{label}</button>)}
        </div>
      )}
      {list.staleMs !== null && (list.rows?.length ?? 0) > 0 && <p className="dc-age-line" role="status">{fromAgoText(list.staleMs)}</p>}
      {!list.rows && list.loading && (
        <div className="dc-skel" aria-busy="true" aria-label="Loading">
          {[0, 1, 2, 3, 4].map((i) => <span key={i} className="dc-skel-row"><span className="zf-shimmer dc-skel-dot" /><span className="zf-shimmer dc-skel-bar" /></span>)}
        </div>
      )}
      {badAddress && <p className="dc-quiet" role="status">{NOT_AN_ADDRESS}</p>}
      {failedEmpty && <p className="dc-quiet" role="status">{online ? "GeckoTerminal isn't answering. Trying again." : OFFLINE_SHORT} <button type="button" className="zf-link" onClick={list.retry} data-testid="list-retry">Try again</button></p>}
      {list.rows && !list.loading && !list.failed && shown.length === 0 && <p className="dc-quiet">{sample && /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(term)
        ? "No coin is at that address. Check it, or search by name."
        : term ? "No coin by that name or address." : "Nothing here right now."}</p>}
      <div className="dc-list">
        {shown.map((r) => { const k = `${r.chain}:${r.address}`; return <Row key={k} r={r} rise={riseOf.get(k) ?? null} win={term ? "trending" : win} showChain={chain === "all"} refused={refused.has(r.address)} lit={lit.has(k)} needsLogo={!term} onCoin={openRow} />; })}
      </div>
    </div>
  );
}
