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
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { LiveRow } from "@zerofee/design/LiveRow.tsx";
import { ReceiptMark } from "@zerofee/design/Receipt.tsx";
import { mark, tapBurst } from "@zerofee/design/tap.ts";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { ProblemError } from "@zerofee/core/problem";
import { CHAINS, type TradeRecord } from "../../service.ts";
import { amount as fmtAmount } from "../format.ts";
import { createFeedback } from "../feedback.ts";
import { followTurn, turnTask } from "../trade-turn.ts";
import { rowSaid, whenBooked } from "../fill-words.ts";
import { epochOf, tradeMs } from "../../tap-time.ts";
import { tradeEndsAt } from "../trade-pace.ts";
import { followRecord, recordOf, UNCONFIRMED } from "../unconfirmed-follow.ts";
import { landedDetail, whenCosted } from "../landed-detail.ts";
import { ROW_RECEIPT_MS, createChipQuotes, rowBuyEnd, rowBuyLanded, rowBuyLine, type RowBuy as RowBuyState } from "./row-buy.ts";
import type { Prepared } from "../../types.ts";
import { useQuickBuy } from "./quick-buy.ts";
import type { CoinRow } from "../../market/types.ts";
import { tickKey } from "../../market/ticks.ts";
import type { BuyRefusal } from "../../sol/screen.ts";
import type { ChainId } from "../../types.ts";
import type { FloatSnapshot } from "../../float-view.ts";
import { listPrice, pct } from "../format.ts";
import { isNotForSale, markIfUnsellable, NOT_FOR_SALE, useNotForSale } from "../not-for-sale.ts";
import { Gear, Search } from "../icons.tsx";
import { readPasted } from "../paste.ts";
import { OFFLINE_SHORT, isOnline, useOnline } from "../online.ts";
import { chainDown, downChip, downLabel, downRowLine, keptLine, useDownRows } from "../chain-down.ts";
import { changeIn, moversOf } from "../movers.ts";
import { LISTS, NOT_AN_ADDRESS, litRows, newestAcross, notAnAddress, risesIn, type Win } from "./discover-rules.ts";
import { fromAgoText } from "../list-age.ts";
import { LISTED, MARKET, useFloat, useLogo, useMarketList, usePrefetchCoin, useSeenPrefetch, useTick, useTrade } from "../runtime.tsx";
import { rowLogo } from "../../market/logo.ts";
import "../discover.css";

import { CHAIN_SHORT, rowLines, walletChip } from "../coin-words.ts";
/** Home's words for each chain (D124): the coin, and Robinhood for Robinhood Chain (QA 16's MUST 2, 8 Nov; coin-words.ts; hood: "Robinhood"). */
export { CHAIN_SHORT };
/** The bundled logos, by trusted key. */
const CHAIN_ICON: Record<ChainId, string> = { sol: "sol", hood: "hood", near: "near", bsc: "bsc" };
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
  const { snap } = useFloat();
  const { bridge } = useShell();
  const downRows = useDownRows(bridge);
  const box = useRef<HTMLDivElement>(null);
  const [mark, setMark] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-chain="${chain}"]`);
    if (!el) return;
    setMark({ x: el.offsetLeft, w: el.offsetWidth });
    // T2-2 (the copy review's walk, 8 Nov: "ETH (RH) wallet" sat half under the fade): the chosen chip is always whole, scrolled to the
    // nearest edge, the strip's scroll-padding keeping it clear of the fade (discover.css)
    el.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [chain, usdOf("sol") === undefined, usdOf("hood") === undefined]);
  const quiet = LISTED.filter((c) => !MARKET.includes(c));
  // 53, 6 Nov, item 9: each chip names its wallet over its figure ("SOL wallet" / "$169.37"), never a bare amount
  // audit 18 (S18-4): a chain down (the notice's rule) or a wallet that didn't answer, its chip keeps the last figure and
  // one line under the strip says who and the figure's time, in Home's Hot words (keptLine)
  const kept = [...MARKET, ...quiet].flatMap((c) => {
    const view = snap.chains.find((x) => x.chain === c);
    const down = chainDown(downRows, c);
    if (usdOf(c) === undefined || view?.readAt === undefined || !(down || view.kept)) return [];
    return [{ c, line: keptLine(c, down, `${c === "hood" ? "Robinhood" : CHAIN_SHORT[c]} wallet is`, view.readAt) }];
  });
  const money = (c: ChainId) => { const w = walletChip(c, usdOf(c)); return <span className="dc-tab-two"><span className="dc-tab-name">{w.name}</span>{w.figure === null ? <span className="zf-shimmer dc-tab-sk" /> : <span className="dc-tab-usd">{w.figure}</span>}</span>; };
  return (
    <>
    <div className="dc-top">
      <div className="dc-tabs" role="tablist" aria-label="Your wallets and their markets" ref={box}>
        <button data-chain="all" role="tab" aria-selected={chain === "all"} className={chain === "all" ? "on" : ""} onClick={() => onChain("all")}>All</button>
        {MARKET.map((c) => {
          const v = usdOf(c);
          return (
            <button key={c} data-chain={c} role="tab" aria-selected={chain === c} className={chain === c ? "on" : ""} onClick={() => onChain(c)}
              aria-label={walletChip(c, v).label}>
              {money(c)}
            </button>
          );
        })}
        {quiet.filter((c) => (usdOf(c) ?? 0) > 0).map((c) => (
          <span key={c} className="dc-tab-quiet" aria-label={walletChip(c, usdOf(c)).label}>
            {money(c)}
          </span>
        ))}
        {mark && <span className="dc-mark" aria-hidden="true" style={{ transform: `translateX(${mark.x}px)`, width: mark.w }} />}
      </div>
      {/* Move without leaving Trade (product decision, 4 Nov): Home's own Move sheet over Trade, back here once it is on its way */}
      {onMove && <button className="dc-move" aria-label="Move money between your Safe and your wallets" onClick={onMove}>Move</button>}
      {onSettings && <button className="dc-gear" aria-label="Settings" onClick={onSettings}><Gear /></button>}
    </div>
    {kept.map((k) => <p key={k.c} className="zf-small dc-as-of" data-testid="dc-as-of">{k.line}</p>)}
    </>
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
  const words = rowLines(r);
  const age = r.createdAt ? Date.now() - r.createdAt : undefined;
  const fresh = age !== undefined && age >= 0 && age < NEW_MS;
  // the quiet Buy chip's trade (row-buy.ts): while it is on, the row IS the receipt (the mark on the logo, the line under the name)
  const [buy, setBuy] = useState<RowBuyState | null>(null);
  // a trade still checking is followed on the service's events (RowBuy): the row that owns it stops the follow when it goes
  const follow = useRef<(() => void) | null>(null);
  useEffect(() => () => { follow.current?.(); follow.current = null; }, []);
  // while the row says "Not confirmed yet" and Trade is on screen, the service looks at the trade again (RECHECK_MS)
  const { svc, active } = useTrade();
  const checking = buy?.phase === "checking";
  useEffect(() => (checking && active ? svc.watch() : undefined), [checking, active, svc]);
  // the row is the receipt until the trade's end is known: a landed or refused one stays ROW_RECEIPT_MS, then the chip is
  // back; one still checking keeps the row (no chip: a second $25 must never be invited by a trade that may still land)
  useEffect(() => {
    if (!buy || buy.phase === "away" || buy.phase === "checking") return;
    const t = setTimeout(() => setBuy(null), ROW_RECEIPT_MS);
    return () => clearTimeout(t);
  }, [buy]);
  useNotForSale();
  const noSale = refused || isNotForSale(r.chain, r.address);
  // builder 24, item 1: on a down chain the row's second line says so ("Robinhood is down"), with no chip: "Robinhood
  // down" was 124 pt in the chip's 76 pt slot and covered the price and change. A receipt or "Not for sale" keeps its own.
  const downRows = useDownRows(useShell().bridge);
  const down = chainDown(downRows, r.chain) && !buy && !noSale;
  // after every hook (the 5 Nov walk: returning before the chip's hooks crashed Trade, "Rendered fewer hooks", when a row's logo failed on New)
  if (needsLogo && logo.state === "none") return null;
  return (
    <div className={`dc-rr${buy ? ` is-${buy.phase}` : ""}${noSale ? " dc-rr--nfs" : ""}`}>
    <LiveRow rowRef={seen} state="past" className={`dc-row${enter !== null ? " zf-rise" : ""}`} style={enter !== null ? { ["--i" as string]: enter } : undefined} onPointerDown={() => prefetch(r)} onOpen={() => onCoin(r)}
      mark={<span className="dc-logo-box">
        {buy ? <ReceiptMark state={buy.phase} icon={<Logo r={r} lit={false} />} size={48} /> : <Logo r={r} lit={lit} />}
        {showChain && !buy && <span className="dc-badge" role="img" aria-label={`on ${CHAIN_SHORT[r.chain]}`}><CoinIcon symbol={CHAIN_SHORT[r.chain]} icon={CHAIN_ICON[r.chain]} size={16} /></span>}
      </span>}
      // 53, 6 Nov, item 9: the worth beside the symbol, the name on its own line below, whole (2 lines at most)
      title={<span className="dc-sym">{r.symbol}{words.cap && <span className="dc-cap">{words.cap}</span>}{fresh && !buy && <span className="dc-age"><span className="zf-live" />{ageText(age!)}</span>}</span>}
      // the chain is the logo's badge, spoken as "on ETH (RH)" (webd-money2 crawl, 4 Nov: CASHCAT's row didn't say ETH (RH))
      // audit 11's B9 (8 Nov): a trap coin's refused row keeps its name, and its line says who and the money (row-buy.ts)
      line={buy && noSale && buy.phase === "refused" ? <span className="dc-sub dc-sub--trap" role="status"><span className="dc-name">{words.name}</span><span className="dc-sub__words">{rowBuyLine(buy, r.symbol, noSale)}</span></span>
        : down ? <span className="dc-sub dc-sub--down" data-testid="row-down">{downRowLine(r.chain)}</span>
        : buy ? <span className="dc-sub--buy" role="status">{buy.phase === "away" && <span className="zf-live" aria-hidden="true" />}<span className="dc-sub__words">{rowBuyLine(buy, r.symbol, noSale)}</span></span>
        // product decision, 5 Nov (via a proxy): the line is the coin's name and worth ("Doge Pepe · $3.27M"); on All the chain is
        // the badge on the logo and the row's spoken label, never words that pushed the name to "SOL ·…" beside the chip
        : <span className="dc-sub dc-sub--name"><span className="dc-name dc-name--whole">{words.name}</span></span>}
      usd={<span className={`dc-px${tick === "up" ? " dc-glint-up" : tick === "down" ? " dc-glint-down" : ""}`}>{r.priceUsd ? listPrice(r.priceUsd) : ""}</span>}
      when={ch !== undefined ? <span className={`dc-chg ${ch > 0 ? "up" : ch < 0 ? "down" : ""}`}>{pct(ch)}</span> : undefined} />
    {/* T2-5 (the copy review's walk): a coin ZeroFee won't buy says so in mute where Buy was (not-for-sale.ts: only what is proven) */}
    {noSale ? <span className="dc-nfs" data-testid="row-not-for-sale">{NOT_FOR_SALE}</span> : !buy && !down && <RowBuy r={r} onState={setBuy} follow={follow} />}
    </div>
  );
});

/** The quiet Buy chip (Build A): one tap buys Settings' Quick buy amount of the row's coin through the sheet's own service, origin
 *  `chip:<address>` in the one-tap lock's key (a double tap is one trade; a chip beside an open sheet is another trade).
 *  It lights only under the finger. The checks are the sheet's: a chain with less than the preset ready refuses on the
 *  row before anything is asked; the core's refusal is said on the row in its own words; never a silent fail. */
/** The chip's word offline, sized as "Buy $50" so the row's price stays whole (the Sim shot: "You're offline" covered
 *  it); its label says the sheet button's words (buy-button.ts buttonWords), and the list's banner says the rest. */
export const OFFLINE_CHIP = "Offline";
export const OFFLINE_CHIP_LABEL = "You're offline";
/** Every chip's quote, got from the touch (the audit's T3): one store for the list, so a row that re-mounts keeps its warm quote. */
const chipQuotes = createChipQuotes<Prepared>();

function RowBuy({ r, onState: tell, follow }: { r: CoinRow; onState: Dispatch<SetStateAction<RowBuyState | null>>; follow: MutableRefObject<(() => void) | null> }) {
  // the crawl's clock (QA): the row's state leaves the Receipt's marks (tap.ts), as the sheet's does
  const onState = (b: RowBuyState) => { mark(b.phase); tell(b); };
  const { svc } = useTrade();
  const { bridge, tasks } = useShell();
  const { snap } = useFloat();
  const feel = useMemo(() => createFeedback(bridge), [bridge]);
  // Settings' Quick buy amount (quick-buy.ts): $25 unless the person picked another; undefined until the store answers,
  // and till then the chip is off and says no amount (the audit's S10: never a figure the person didn't pick)
  const quick = useQuickBuy(bridge);
  // audit 12 C2: offline, the list's banner says nothing new moves, so the chip is off and says so (as the sheet's
  // button does, buttonWords); one tap online stays one job
  const online = useOnline();
  // audit 13's D3: the row's chain down (the notice's own rule), the chip is off and says so, as offline
  const down = chainDown(useDownRows(bridge), r.chain);
  const busy = useRef(false);
  // T3 (the audit's Trade audit, 8 Nov): the quote of the Quick buy amount, got and checked (ready(): built, the core's check of
  // its bytes) from the touch, so the tap only signs
  const key = `${r.chain}:${r.address}:${quick}`;
  const quoteNow = async (usd: number) => { const p = await svc.quote("buy", r.chain, r.address, { usd }); await p.ready(); return p; };
  const warm = () => { if (quick !== undefined) void chipQuotes.warm(key, () => quoteNow(quick)).catch(() => undefined); };
  // a touch that turned into a scroll: its quote is forgotten (one in flight per coin at most; never the next tap's)
  const cancel = () => chipQuotes.drop(key);
  const press = async (el: HTMLElement) => {
    if (busy.current || quick === undefined) return;
    if (!isOnline() || down) return;
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
    // T3: the job at the tap, before any network answer (its title is the ask)
    // builder 22's item 6: time left from its first frame, the chain's measured pace (trade-pace.ts), never none
    tasks?.publish({ id: taskId, title: `Buy $${quick} of ${r.symbol}`, open: { route }, endsAt: tradeEndsAt(svc, r.chain, taskAt),
      steps: [{ label: "Sent", state: "doing", at: taskAt }, { label: "Landed", state: "waiting" }, { label: `In your ${CHAINS[r.chain].symbol} wallet`, state: "waiting" }] });
    const secs = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
    let got = "";
    const landed = (rec: TradeRecord) => {
      const now = Date.now(), ms = tradeMs(rec, at);   // the audit's T4: the record's time, from the press
      rowBuyLanded(tasks, taskId, { taskAt, now, wallet: `In your ${CHAINS[r.chain].symbol} wallet`, detail: landedDetail(secs(ms), rec, CHAINS[r.chain].name), proof: (rec.hashes ?? []).map((hash) => ({ chain: r.chain, hash })) });
      whenCosted(svc.on, rec, () => void tasks?.update(taskId, { detail: landedDetail(secs(ms), rec, CHAINS[r.chain].name) }));
      // T2 (the audit's Trade audit, 8 Nov): done on one node's word can still turn; followed by its id until its check clears, a
      // turn rewrites the ended task and the row says it (trade-turn.ts)
      const walletStep = `In your ${CHAINS[r.chain].symbol} wallet`;
      followTurn(svc, rec.id, (_r, t) => { turnTask(tasks, taskId, t, { taskAt, wallet: walletStep }); onState({ phase: t.row.phase, at, got, ...(t.row.why ? { why: t.row.why } : {}) }); });
      void feel.filled();
      // the audit's T1: the coins are "about" the quote's until the chain's read books it; then the row says the read figure
      const s = rowSaid(rec);
      got = s.got;
      whenBooked(svc, rec.id, (b) => tell((x) => (x && x.phase === "landed" && x.at === at ? { ...x, ...rowSaid(b) } : x)));
      onState({ phase: "landed", at, got, ...(s.about ? { about: true } : {}), ms });   // the Row keeps the state: this chip is gone the moment the row is the receipt
    };
    const refused = (rec: TradeRecord, why?: string) => {
      tasks?.end(taskId, rec.status === "declined" ? "stopped" : "failed", why);
      if (rec.status !== "declined") feel.failed();
      onState({ phase: "refused", why, at, got });
    };
    // unconfirmed (QA's MUST): the chain's answer was lost after the send, so the trade may still land. The task
    // stays open (Sent done, Landed doing), no failed buzz, the row stays the receipt with no chip; while it says so on
    // screen the service looks at it again (RECHECK_MS, the Row's watch), and the row and the task end only as that answer says
    const stillChecking = (rec: TradeRecord) => {
      tasks?.update(taskId, { detail: "Not confirmed yet", steps: [{ label: "Sent", state: "done", at: taskAt }, { label: "Landed", state: "doing" }, { label: `In your ${CHAINS[r.chain].symbol} wallet`, state: "waiting" }] });
      onState({ phase: "checking", at, got });
      // followed until it ends, once (followRecord); the Row stops it if it goes first
      follow.current = followRecord(svc, rec.id, (now) => {
        follow.current = null;
        const e2 = rowBuyEnd(now);
        if (e2.phase === "landed") landed(now); else if (e2.phase === "refused") refused(now, e2.why);
      });
    };
    try {
      const p = await chipQuotes.take(key, () => quoteNow(quick));
      const q = p.quote;
      got = `${fmtAmount(q.getRaw, q.decimals)} ${r.symbol}`;
      onState({ phase: "away", at, got });
      const rec = await svc.trade(p, `chip:${r.address}`, { task: taskId, tapAt: epochOf(at) });
      const end = rowBuyEnd(rec);
      if (end.phase === "landed") { landed(rec); return; }
      if (end.phase === "refused") { refused(rec, end.why); return; }
      stillChecking(rec);
    } catch (e) {
      // the service throws a trade that may still land as its unconfirmed Problem (run()): the row follows it, never
      // "Didn't buy" with the chip back 6 s later (a second buy would pay twice)
      const rec = e instanceof ProblemError && e.problem.code === UNCONFIRMED ? await recordOf(svc, e.problem) : undefined;
      if (rec) { stillChecking(rec); return; }
      const why = e instanceof ProblemError ? e.problem.whatHappened : "It didn't go through. Nothing moved.";
      // an unseen trap coin refused by the quote: its row says "Not for sale" once the receipt line goes (the audit's note)
      if (e instanceof ProblemError) markIfUnsellable(e.problem.code, r.chain, r.address);
      tasks?.end(taskId, "failed", why);
      feel.failed();
      onState({ phase: "refused", at, why });
    } finally { busy.current = false; }
  };
  return (
    <button type="button" className="dc-qb" disabled={quick === undefined || !online || down} aria-label={!online ? OFFLINE_CHIP_LABEL : down ? downLabel(r.chain) : quick === undefined ? `Buy ${r.symbol}` : `Buy $${quick} of ${r.symbol}`} onPointerDown={warm} onFocus={warm} onPointerCancel={cancel} onClick={(e) => void press(e.currentTarget)}>
      {/* QA 16 on the Sim shot (8 Nov): the figure one tap spends is on the chip ("Buy $5"), once Settings' amount is read */}
      <span className="dc-qb__pill" aria-hidden="true">{!online ? OFFLINE_CHIP : down ? downChip(r.chain) : quick === undefined ? "Buy" : `Buy $${quick}`}</span>
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
