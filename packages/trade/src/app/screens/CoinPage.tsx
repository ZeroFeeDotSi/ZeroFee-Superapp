// A coin (D136, the approved mockup's order; design review 2026-11-03 items 1-3, 10, 17-19): the coin in its own light, its
// name once and "SOL · PumpSwap"; the price (live, swapped in place, never rolling, a soft glint when it moves; "Updated 40 s
// ago" once nothing has come for 30 s, "Updates every few seconds" while it is read instead of over the chain's socket) and
// the range's change in dollars and percent, in its colour (chart bug); one line full width, the coin's icon faint behind it (a finger reads that moment, and lets go with the finger;
// candles one tap away); what you hold; the coin's numbers; then, on the page itself (product decision, 5 Nov: no More sheet), price
// orders, the exit plan, standing buys, the coin's details, where it trades and its latest trades. A solid floor with
// Sell and Buy, on the app bar at every scroll. A coin that fails a check gets one line saying why, not a pill. Its own website and social links aren't
// shown: no URL is opened from a coin's own data.
import { useEffect, useRef, useState } from "react";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Mark } from "@zerofee/design/Mark.tsx";
import "../coinpage.css";
import "./trap.css";
import type { CoinDetail, CoinRow, LiveState, Range } from "../../market/types.ts";
import { MarketError } from "../../market/gt.ts";
import { tradeProblems } from "../../trade-problems.ts";
import { pageRefusal, type PageRefusal } from "../coin-refusal.ts";
import { coinSafety, sellTrap } from "../coin-safety.ts";
import { landedWith, landedWithout, mergeTrades, tradeSide, type TradeRow } from "../trades-list.ts";
import { OFFLINE_SHORT, useOnline } from "../online.ts";
import { useBarStay } from "../bar-stay.ts";

/** The words Buy would give, so the coin page says them before anyone taps Buy. */
const REFUSAL_WORDS: Record<PageRefusal, (symbol: string) => { whatHappened: string }> = {
  unsellable: tradeProblems.coinUnsellable, freezable: tradeProblems.coinFreezable, delegated: tradeProblems.coinDelegated, pausable: tradeProblems.coinPausable, hooked: tradeProblems.coinHooked,
  "fee-raisable": tradeProblems.coinFeeRaisable, "fee-high": tradeProblems.coinFeeHigh,
};
import { agoText } from "../chart-math.ts";
import { amount, compactUsd, dexName, listPrice, pct, moveWords, usd } from "../format.ts";
import { coinPageSince } from "../your-coins.ts";
import { CoinOrders } from "./Orders.tsx";
import { CoinStanding } from "./Standing.tsx";
import { CoinExitPlan } from "./ExitPlan.tsx";
import { paidPrice } from "../exit-words.ts";
import { Chart, type ChartMode } from "../Chart.tsx";
import { ageText, CHART_REFRESH_MS, lastHour, headerMove, rangeWords, timeTicks, withLive } from "../chart-math.ts";
import { wholeLife } from "../../market/candles.ts";
import { buyCoin } from "./buy-button.ts";
import { statFigures } from "../coin-stats.ts";
import { CandlesIcon, LineIcon } from "../icons.tsx";
import { CHAIN_NAME, MARKET, NEAR_NOT_TRADED, useCoinChart, useCoinDetail, useLive, useNoteTick, useTick, useTrade, useWarmRanges } from "../runtime.tsx";
import { tickKey } from "../../market/ticks.ts";
import { CHAIN_SHORT } from "./Discover.tsx";
import type { Candle } from "../../market/types.ts";

/** wallet v1's ranges: LIVE (the last hour, the price now on its newest candle), then a day to everything it has traded. */
const RANGES: [Range, string][] = [["1H", "LIVE"], ["1D", "1D"], ["1W", "1W"], ["1M", "1M"], ["1Y", "1Y"], ["ALL", "ALL"]];
/** The range tabs' words: with recorded prices (?demo) the first is "1H", never "LIVE" (grade 30 Oct, item 3). */
export const rangeTabs = (recorded: boolean): [Range, string][] => (recorded ? RANGES.map(([r, l]) => [r, r === "1H" ? "1H" : l]) : RANGES);
/** The coin's page on a known explorer, built from its address alone (never a link from the coin's own data). */
const EXPLORER: Partial<Record<CoinRow["chain"], (a: string) => string>> = { sol: (a) => `https://solscan.io/token/${a}`, bsc: (a) => `https://bscscan.com/token/${a}`, near: (a) => `https://nearblocks.io/token/${encodeURIComponent(a)}` };
/** A price not heard from for this long is never shown as live (V1's D09): it says how old it is. */
const STALE_MS = 30_000;
/** A whale: a trade of at least this many dollars (V1's). */
const WHALE_USD = 1_000;

/** `auto`: another app asked for this coin's Buy or Sell page (trade-ask.ts): it opens once the coin is read, or `onAutoFail`
 *  says why it can't (Buy would refuse the coin, nothing is held to sell, the coin can't be read). */
/** The longest a page another app asked for waits on its reads before it says it couldn't. */
export const ASK_READ_MS = 12_000;

export function CoinPage({ seed, onBuy, onSell, auto, onAuto, onAutoFail }: { seed: CoinRow; onBuy: (d: CoinDetail) => void; onSell: (d: CoinDetail) => void; auto?: "buy" | "sell"; onAuto?: (side: "buy" | "sell", d: CoinDetail) => void; onAutoFail?: (why: string) => void }) {
  const { market, svc, active, refused, mintClean } = useTrade();
  const { bridge } = useShell();
  const online = useOnline();
  const [range, setRange] = useState<Range>("1D");
  // product decision, 4 Nov ("charts should be like the best wallets'"): the line first, candles a tap away
  const [mode, setMode] = useState<ChartMode>("line");
  /** The page's own root: its scroll area keeps the app bar up (the floor sits on it at every scroll, product decision, 5 Nov). */
  const pageAt = useRef<HTMLDivElement>(null);
  // product decision, 5 Nov ("Buy should hover and stay at the bottom"): the page holds the app bar (bar-stay.ts, the Sim builder's)
  useBarStay(pageAt);
  /** The chart last drawn, per coin: it stays on screen while the next range loads, so a range tap never swaps in a
   *  loader and moves the page (chart bug: the header went and the chart jumped ~170 px on the first tap). */
  const kept = useRef<Record<string, Candle[]>>({});
  const [scrub, setScrub] = useState<Candle | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 2_000); return () => clearTimeout(t); }, [copied]);
  const [live, setLive] = useState<number | undefined>(seed.priceUsd);
  // D145 (speed worker): the coin and its chart paint from the device in the first frame (the last visit, or the row's
  // press-down prefetch), then the network's answer replaces them
  const detail = useCoinDetail(seed.chain, seed.address);
  const candles = useCoinChart(seed.chain, seed.address, range);
  // product decision, 4 Nov ("charts should load instantly on every time frame"): once this range is drawn, the other ranges are
  // read behind it, so a tap on any of them draws at once from the device
  useWarmRanges(seed.chain, seed.address, active && candles.value !== undefined && !market.recorded);
  // the market data paused us (its limit is per connection): the chart asks again by itself after the pause, a few times
  const [tries, setTries] = useState(0);
  useEffect(() => setTries(0), [seed.chain, seed.address, range]);
  useEffect(() => {
    if (!candles.error || candles.value || tries >= 3) return;
    const t = setTimeout(() => { setTries((n) => n + 1); candles.reload(); }, 12_000);
    return () => clearTimeout(t);
  }, [candles.error, candles.value, tries]);
  // and while the page stays open, again on the range's own cadence: new candles join (a chart is never a picture of
  // when the page was opened; recorded charts don't move)
  useEffect(() => {
    if (!active || market.recorded) return;
    const t = setInterval(() => candles.reload(), CHART_REFRESH_MS[range]);
    return () => clearInterval(t);
  }, [active, market, range, seed.chain, seed.address]);
  const held = useLive(() => svc.held(seed.chain, seed.address).catch(() => "0"), [seed.chain, seed.address]);
  // a trade of this coin on its way (the sheet stepped aside for Face ID): Buy says so until it lands
  const sending = useLive(() => svc.activity().then((rs) => rs.some((r) => r.chain === seed.chain && r.coin === seed.address && (r.status === "sending" || r.status === "confirming") && Date.now() - r.startedAt < 120_000)), [seed.chain, seed.address]).value;
  // this coin's recorded cost, priced here with the page's own price: no market call of its own (the chart needs the budget)
  // null: Trade has no record of it; undefined: not read yet (T-5 review 2, M1)
  const position = useLive(() => svc.position(seed.chain, seed.address).then((p) => p ?? null), [seed.chain, seed.address]).value;
  // how fresh the price is, and how it reaches us (the chain's socket, or a read every few seconds)
  const [heardAt, setHeardAt] = useState(() => Date.now());
  const [feed, setFeed] = useState<LiveState["state"]>();
  const [, setClock] = useState(0);
  useEffect(() => { if (!active) return; const t = setInterval(() => setClock((n) => n + 1), 5_000); return () => clearInterval(t); }, [active]);
  const noteTick = useNoteTick();
  const tick = useTick(tickKey(seed.chain, seed.address));
  useEffect(() => (active ? market.livePrice(seed.chain, seed.address, (p, t) => { setLive(p); setHeardAt(Math.min(Date.now(), t)); noteTick(tickKey(seed.chain, seed.address), p); }, (s) => setFeed(s.state)) : undefined), [market, seed.chain, seed.address, active]);
  useEffect(() => { if (active) void svc.warm(seed.chain, seed.address); }, [svc, seed.chain, seed.address, active]);
  // the coin's latest trades from its pool (asked again every 15 s while the page is on screen), and on BNB Chain and
  // Robinhood Chain its own checks: both display only, text only
  const [whalesOn, setWhalesOn] = useState(false);
  const trades = useLive(() => market.trades?.(seed.chain, seed.address, whalesOn ? WHALE_USD : undefined) ?? Promise.resolve([]), [seed.chain, seed.address, whalesOn]);
  useEffect(() => { if (!active) return; const t = setInterval(() => trades.reload(), 15_000); return () => clearInterval(t); }, [active, seed.chain, seed.address, whalesOn]);
  // each swap as it lands goes on top (memecoins are instant); the read above only fills in behind
  const [landed, setLanded] = useState<TradeRow[]>([]);
  useEffect(() => {
    setLanded([]);
    if (!active || !market.liveTrades) return;
    return market.liveTrades(seed.chain, seed.address, (t) => setLanded((xs) => landedWith(xs, t)), (tx) => setLanded((xs) => landedWithout(xs, tx)));
  }, [market, seed.chain, seed.address, active]);
  const tradeRows = mergeTrades(landed, trades.value, whalesOn ? WHALE_USD : 0);
  // wrapped, so "answered with nothing" and "not answered yet" differ (an ask waits for the answer, re-review L)
  const checksRead = useLive(() => (seed.chain === "sol" ? Promise.resolve(undefined) : market.checks?.(seed.chain, seed.address) ?? Promise.resolve(undefined)).then((v) => ({ v })), [seed.chain, seed.address]);
  const checks = checksRead.value?.v;
  const checksAnswered = checksRead.value !== undefined || checksRead.error !== undefined;
  const d = detail.value;
  // Buy opens from the tapped row while the page's own read and the chart load (buy-button.ts buyCoin): neither blocks it
  const buyable = buyCoin(d, seed);
  // Recorded prices (the web demo) never move, and the coin's own recording was made a moment apart from the list's: the
  // page says what the row the person tapped said, so the list and the page never disagree (grade 1 Nov, item 4).
  const fromRow = market.recorded === true && seed.priceUsd !== undefined;
  const px = fromRow ? seed.priceUsd : live ?? d?.priceUsd;
  const ch = fromRow ? seed.change24hPct ?? d?.change24hPct : d?.change24hPct ?? seed.change24hPct;
  const dayMove = px !== undefined && ch !== undefined ? { usd: px - px / (1 + ch / 100), pct: ch } : undefined;
  // what Buy would refuse, said here instead of a Buy pill: the mint's own answer or the market's freeze flag (Solana), the
  // coin's own sell check (BNB Chain, Robinhood Chain)
  // and, once that read has answered for THIS coin, whether the chain itself found it clean (the Freeze row's only "fine",
  // T-3): asked at every render (the page redraws every 5 s), so a clean read past its 10 minutes says "Not checked yet",
  // and read again every 10 minutes while the page is open (review M)
  const mintLive = useLive(() => refused(seed.chain, [seed.address]).then((m) => ({ addr: seed.address, why: m.get(seed.address) })), [seed.chain, seed.address]);
  useEffect(() => { if (!active) return; const t = setInterval(() => mintLive.reload(), 600_000); return () => clearInterval(t); }, [active, seed.chain, seed.address]);
  const mintRead = mintLive.value;
  const mint = mintRead?.why;
  const mintHere = mintRead?.addr === seed.address ? mintRead : undefined;   // never the coin before's answer (review L)
  const chainClean = mintHere !== undefined && mintClean?.(seed.chain, seed.address) === true;
  const no = pageRefusal(seed.chain, { mint, freezeFlag: d?.security?.freezeAuthority === true, checks });
  const symbol = d?.symbol ?? seed.symbol;
  const holds = held.value && BigInt(held.value) > 0n;
  // an ask from another app: once, when everything it depends on has answered
  const autoDone = useRef(false);
  useEffect(() => {
    if (!auto || autoDone.current) return;
    if (!d && detail.error) { autoDone.current = true; onAutoFail?.(tradeProblems.marketBusy().whatHappened); return; }
    // a sale of a coin not held ends the moment the wallet is read, waiting for nothing else (AgentZero's rehearsal, 3 Nov:
    // it sat 45 s for the coin's other reads and never answered)
    if (auto === "sell" && held.value !== undefined && !holds) { autoDone.current = true; onAutoFail?.(`You don't hold ${symbol || "this coin"}.`); return; }
    if (!d || mintHere === undefined || held.value === undefined || !checksAnswered) return;
    autoDone.current = true;
    if (no) onAutoFail?.(REFUSAL_WORDS[no](symbol).whatHappened);
    else if (!MARKET.includes(seed.chain)) onAutoFail?.(NEAR_NOT_TRADED);
    else if (auto === "sell" && !holds) onAutoFail?.(`You don't hold any ${symbol}.`);
    else onAuto?.(auto, d);
  }, [auto, d, detail.error, mintHere, held.value, no, holds, checksAnswered]);
  // …and an ask never waits for ever: a read that hasn't answered in ASK_READ_MS ends it, saying which (read when the time
  // is up, never as the page first drew)
  const askReads = useRef({ d, held: held.value, fail: onAutoFail });
  askReads.current = { d, held: held.value, fail: onAutoFail };
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => {
      if (autoDone.current) return;
      autoDone.current = true;
      const r = askReads.current;
      r.fail?.(!r.d ? tradeProblems.marketBusy().whatHappened : r.held === undefined ? "Your wallet didn't answer in time. Nothing moved." : "This coin's checks didn't answer in time. Nothing moved.");
    }, ASK_READ_MS);
    return () => clearTimeout(t);
  }, [auto]);
  // the chart ends at the price above it: the row's, with recorded prices, on every range
  // LIVE is the last hour only (product decision, 4 Nov: trades from 13:38 drawn across the hour to 18:57); recorded prices (?demo) keep theirs
  const hour = candles.value && range === "1H" && !market.recorded ? lastHour(candles.value, Date.now()) : candles.value;
  // every range ends at the price above it (the header's change and colour are the chart's own, so they never disagree)
  const shown = hour && (range === "1H" || fromRow) ? withLive(hour, fromRow ? px : live, fromRow ? undefined : heardAt) : hour && withLive(hour, px);
  const coinKey = `${seed.chain}:${seed.address}`;
  // kept per range: a range not read yet keeps the last chart on screen, faded and unlabelled, never passed off as the
  // range its tab names (bug report, 4 Nov, charts wrong: the old range's line sat under the new range's words)
  if (shown) { kept.current[`${coinKey}:${range}`] = shown; kept.current[coinKey] = shown; }
  const drawn = shown ?? (candles.error ? undefined : kept.current[`${coinKey}:${range}`] ?? kept.current[coinKey]);
  const waiting = !shown && drawn !== undefined && kept.current[`${coinKey}:${range}`] === undefined;
  // a range longer than the coin's life draws the life (candles.ts planFor): its words say so
  const whole = wholeLife(range, d?.createdAt !== undefined ? Date.now() - d.createdAt : undefined);
  // the header's change is the range on screen, coloured as its line is (chart bug: "+5.9% in 24 hours" on every
  // range, green over a red hour)
  const moved = headerMove(range, shown ?? [], dayMove);
  const logo = d?.logoUrl ?? seed.logoUrl;
  const heldUnits = holds && d ? Number(BigInt(held.value!)) / 10 ** (d.decimals ?? 6) : 0;
  const explorer = EXPLORER[seed.chain]?.(seed.address);
  // the market cap at the price on screen (the market data's, moved with the live price); the tapped row's numbers until the page's own come (coin-stats.ts)
  const fig = statFigures(d, seed, px), mcap = fig.mcap;
  // T-3: the coin safety card, drawn from the reads above (display only: Buy is `no`'s, pageRefusal's)
  const safety = coinSafety(seed.chain, { mint: mintHere?.why, mintClean: chainClean, detail: d, checks });
  const trap = sellTrap(safety.card);
  const stale = Date.now() - heardAt > STALE_MS;
  const copy = () => { void navigator.clipboard?.writeText(seed.address).then(() => setCopied(true), () => undefined); };
  const sinceWords = coinPageSince(position, px);
  const where = `${CHAIN_SHORT[seed.chain]}${d?.pools?.[0] && dexName(d.pools[0].dex) ? ` · ${dexName(d.pools[0].dex)}` : ""}`;
  const canTrade = !no && MARKET.includes(seed.chain) && !(!d && detail.error);
  const moveChips = MOVE_CHIPS.flatMap(([w, label, words]) => { const v = d?.moves?.[w]; return v === undefined ? [] : [[w, label, words, v] as const]; });
  const pools = (d?.pools ?? []).filter((p) => dexName(p.dex)).slice(0, 3);
  return (
    <div className="tr-coin cp zf-enter" ref={pageAt}>
      {/* D136 (design review 17, 19): the coin in its own light, its name once, its chain and pool under it */}
      <div className="tr-coin-head">
        <span className="zf-halo is-on cp-logo">{(d?.logoUrl ?? seed.logoUrl) && <img className="zf-halo__light" src={d?.logoUrl ?? seed.logoUrl} alt="" />}<CoinIcon symbol={symbol} src={d?.logoUrl ?? seed.logoUrl} size={48} /></span>
        <div><div className="tr-sym">{d?.name && d.name !== symbol ? d.name : symbol}</div><div className="zf-small cp-where"><CoinIcon symbol={CHAIN_SHORT[seed.chain]} icon={seed.chain === "bsc" ? "bsc" : seed.chain} size={14} />{where}</div></div>
      </div>
      {/* a coin people couldn't sell back says so first, before any price or change (UX audit 4 Nov) */}
      {trap && <p className="cp-trap" role="alert"><span className="cp-trap-mark" aria-hidden="true">!</span>{trap}</p>}
      {/* a finger on the chart: that moment's price and time in place of now's; it lets go when the finger does */}
      {/* a16 (Sim re-walk): the headline reads as the list's row does ("$0.0₅45", format.ts listPrice), never "$0.000004469" */}
      <div className="tr-price"><span className={!scrub && tick ? (tick === "up" ? "cp-glint-up" : "cp-glint-down") : undefined}>{scrub ? listPrice(scrub.c) : px !== undefined ? listPrice(px) : <span className="zf-shimmer cp-price-sk" aria-label="Loading the price" />}</span>
        {!scrub && !market.recorded && !stale && feed !== "polling" && <span className="zf-live-word cp-live"><span className="zf-live" />Live</span>}</div>
      <div className={`zf-small tr-change${trap ? " cp-change--trap" : ""}`}>{scrub ? scrubWhen(scrub.t) : moved ? <><span className={`cp-move cp-move--${moved.dir}`}>{moveWords(moved.usd, moved.pct)}</span> <span className="tr-mute">{rangeWords(range, whole)}</span></> : " "}
        {/* recorded prices (?demo) never tick: no "Updates every few seconds", no "Updated … ago" (item 3) */}
        {!scrub && stale && !market.recorded && <span className="tr-age">Updated {agoText(Date.now() - heardAt)} ago</span>}
        {!scrub && feed === "polling" && !market.recorded && <span className="tr-lbadge">Updates every few seconds</span>}</div>
      <div className={`tr-chart-box cp-chart${waiting ? " cp-chart--wait" : ""}`}>{drawn ? <>{logo && <img className="cp-chart-mark" src={logo} alt="" aria-hidden="true" />}<Chart candles={drawn} mode={mode} dir={moved?.dir} height={220} onScrub={setScrub} />
          <div className={`cp-ticks${mode === "candle" ? " cp-ticks--candle" : ""}`} aria-hidden="true">{timeTicks(waiting ? [] : drawn, range).map((t, i) => <span key={i}>{t}</span>)}</div></>
        : candles.error instanceof MarketError && candles.error.code === "not_found"
          // a coin the market data doesn't list yet (found from the chain): no history to draw, and nothing to retry by hand
          ? <div className="tr-inline cp-chart-empty"><p className="zf-small">No chart yet. This coin is too new for GeckoTerminal.</p></div>
        : candles.error ? <div className="tr-inline cp-chart-empty"><p className="zf-small">{online ? tradeProblems.marketBusy().whatHappened : OFFLINE_SHORT}</p><button className="zf-link" onClick={candles.reload}>{tradeProblems.marketBusy().next.label}</button></div>
        : <div className="tr-center cp-chart-empty"><Mark size={40} mode="loading" /></div>}</div>
      {/* the market data couldn't draw this range: the chart is the coin's last few minutes of trades on chain, said so,
          never passed off as the day or the week its tab names (audit 2 Nov) */}
      {shown && candles.value?.fromChain && <p className="zf-small tr-mute" role="note">Only the last few minutes. The full chart is back when GeckoTerminal answers.</p>}
      <div className="tr-tabs tr-ranges" role="tablist">
        {rangeTabs(market.recorded === true).map(([r, label]) => <button key={r} role="tab" aria-selected={r === range} className={r === range ? "on" : ""} onClick={() => { setRange(r); setScrub(null); }}>{label}</button>)}
        <button className="tr-mode" aria-label={mode === "line" ? "Show candles" : "Show the line"} onClick={() => setMode(mode === "line" ? "candle" : "line")}>{mode === "line" ? <CandlesIcon /> : <LineIcon />}</button>
      </div>
      {/* how the price moved, as pump.fun shows it: four windows from the market data, each in its colour */}
      {/* only the windows the market data has (a window it hasn't is left out, never a dash) */}
      {moveChips.length > 0 && <div className="cp-chips" role="list" aria-label="How the price moved" style={{ ["--n" as string]: moveChips.length }}>{moveChips.map(([w, label, words, v]) => (
        <span key={w} role="listitem" className={`cp-chip${v >= 0 ? " cp-chip--up" : " cp-chip--down"}`} aria-label={`${v >= 0 ? "Up" : "Down"} ${Math.abs(v).toFixed(1)}% in ${words}`}><span className="cp-chip-w">{label}</span><b>{pct(v)}</b></span>
      ))}</div>}
      {/* T-5, design review 19: what you hold, on one row (the same words as its row in Your coins) */}
      {holds && d && (
        <div className="cp-hold" data-testid="coin-position" aria-label="What you hold">
          <CoinIcon symbol={symbol} src={d.logoUrl ?? seed.logoUrl} size={36} />
          <span className="cp-hold-t"><span>You hold {amount(held.value!, d.decimals ?? 6)} {symbol}</span>
            {sinceWords && <span className="zf-small" data-testid="coin-since">{"note" in sinceWords ? sinceWords.note : sinceWords.text}</span>}</span>
          <span className="cp-hold-v">{px !== undefined ? usd(heldUnits * px) : ""}</span>
        </div>
      )}
      {/* product decision, 4 Nov ("coin checks are not needed ... pull only data from GeckoTerminal and show it better"): the coin's
          numbers at once, as Phantom's Info and pump.fun's stats show them; then everything else behind one More */}
      <div className="cp-stats" data-testid="coin-stats">
        <Stat loading={!d} value={mcap !== undefined && mcap > 0 ? compactUsd(mcap) : undefined} label="Market cap" />
        <Stat loading={!d} value={fig.liquidityUsd !== undefined ? compactUsd(fig.liquidityUsd) : undefined} label="Liquidity" />
        <Stat loading={!d} value={fig.volume24hUsd !== undefined ? compactUsd(fig.volume24hUsd) : undefined} label="Traded 24h" />
        <Stat loading={!d} value={d?.holders !== undefined ? d.holders.toLocaleString("en-US") : undefined} label="Holders" />
        <Stat loading={!d} value={fig.createdAt !== undefined ? ageText(Date.now() - fig.createdAt) : undefined} label="Age" />
        <Stat loading={!d} value={d?.top10Pct !== undefined ? `${Math.round(d.top10Pct)}%` : undefined} label="Top 10 hold" />
      </div>
      {d?.buys24h !== undefined && d.sells24h !== undefined && <p className="zf-small cp-trades24">{tradesLine(d.buys24h, d.sells24h)}</p>}
      {/* product decision, 5 Nov ("More takes you to a popup when it should all be on the same page"): everything More held is here,
          on the page, under the numbers: price orders, the exit plan, repeat buys, the coin's details, its pools and its
          latest trades, then where the numbers come from */}
      <div className="cp-more-inline">
        {/* T-1: price orders on this coin (a limit buy; a take profit or stop loss when it is held) */}
        {d && !no && MARKET.includes(seed.chain) && <CoinOrders chain={seed.chain} coin={seed.address} symbol={symbol} px={px} holds={!!holds} />}
        {/* ST-B: the exit plan (rise, fall, a time) on a held coin, in T-1's book */}
        {d && !no && MARKET.includes(seed.chain) && <CoinExitPlan chain={seed.chain} coin={seed.address} symbol={symbol} px={px} paid={position === undefined ? "loading" : paidPrice(position)} holds={!!holds} />}
        {/* T-2: standing buys of this coin */}
        {d && !no && MARKET.includes(seed.chain) && <CoinStanding chain={seed.chain} coin={seed.address} symbol={symbol} />}
        <div className="tr-kvs">
          <div className="zf-label tr-sec">About this coin</div>
          {safety.facts.filter((r) => r.id !== "top10").map((r) => <div key={r.id} className="tr-kv cp-fact" data-check={r.id} data-state={r.state}><span>{r.text}</span></div>)}
          <div className="tr-kv"><span>Network</span><span>{CHAIN_NAME[seed.chain]}</span></div>
          {/* the address itself only behind Copy: no 0x… or base58 fragments in the page's words */}
          <div className="tr-kv cp-addr"><span>Its address</span><span><button className="zf-link tr-copy" onClick={copy}>{copied ? "Copied" : "Copy"}</button>{explorer && <button className="zf-link tr-copy" onClick={() => void bridge.call("device.openUrl", { url: explorer, mode: "sheet" })}>Public record</button>}</span></div>
        </div>
        {pools.length > 0 && (
          <div className="tr-kvs" data-testid="coin-pools">
            <div className="zf-label tr-sec">Where it trades</div>
            {pools.map((p) => <div key={p.address} className="tr-kv"><span>{dexName(p.dex)}</span><span>{p.liquidityUsd !== undefined ? `${compactUsd(p.liquidityUsd)} liquidity` : ""}</span></div>)}
          </div>
        )}
        {(tradeRows.length > 0 || whalesOn) && (
          <div className="tr-kvs tr-trades">
            <div className="tr-trades-head">
              <div className="zf-label tr-sec">Latest trades</div>
              {/* V1's two lists: every trade, or only the big ones */}
              <div className="tr-sizes" role="tablist" aria-label="Trade size">
                {([[false, "All"], [true, "Whales"]] as const).map(([w, label]) => <button key={label} role="tab" aria-selected={whalesOn === w} className={whalesOn === w ? "on" : ""} onClick={() => setWhalesOn(w)}>{label}</button>)}
              </div>
            </div>
            {tradeRows.slice(0, 10).map((t, i) => (
              <div key={t.tx ?? i} className={`tr-kv${t.unconfirmed ? " tr-confirming" : ""}`} data-tx={t.tx}><span>{tradeSide(t)}</span><span>{usd(t.usd)} · {t.unconfirmed ? "now" : agoText(Date.now() - t.t)}</span></div>
            ))}
            {whalesOn && trades.value && tradeRows.length === 0 && <p className="zf-small tr-none">No trades over $1,000 lately.</p>}
            {whalesOn && !trades.value && tradeRows.length === 0 && <div className="tr-center"><Mark size={28} mode="loading" /></div>}
          </div>
        )}
        {!d?.fromChain && <p className="zf-small cp-source">Prices, charts and trades from GeckoTerminal.</p>}
      </div>
      {/* design review 3: a solid floor held to the bottom, two buttons only: Sell (hairline) left, Buy (ink) right */}
      <div className="tr-floor tr-coin-floor">
        {no
          ? <><p className="zf-small tr-why">{REFUSAL_WORDS[no](symbol).whatHappened}</p>{holds && d && <button className="tr-btn2" onClick={() => onSell(d)}>Sell</button>}</>
          : !MARKET.includes(seed.chain)
            ? <p className="zf-small tr-why">{NEAR_NOT_TRADED}</p>
          : !buyable && detail.error
            ? <div className="tr-inline"><p className="zf-body">{online ? tradeProblems.marketBusy().whatHappened : OFFLINE_SHORT}</p><button className="zf-link" onClick={detail.reload}>{tradeProblems.marketBusy().next.label}</button></div>
            : <div className="tr-pair cp-pair">
                {holds && d && <button className="tr-btn2" onClick={() => onSell(d)} aria-label={`Sell ${symbol}: you hold ${amount(held.value!, d.decimals ?? 6)}`}>Sell</button>}
                {sending
                  ? <button className="zf-btn" disabled><Mark size={18} mode="loading" />Sending…</button>
                  : <button className={`zf-btn${buyable && online && canTrade ? " zf-sweep" : ""}`} disabled={!buyable || !online} onClick={() => buyable && onBuy(buyable)}>Buy</button>}
              </div>}
      </div>
    </div>
  );
}

/** The four windows of the moves row: the market data's key, its chip's words, its words read aloud (the Copywriter, 4 Nov). */
const MOVE_CHIPS: ["m5" | "h1" | "h6" | "h24", string, string][] = [["m5", "5 min", "5 minutes"], ["h1", "1 hour", "1 hour"], ["h6", "6 hours", "6 hours"], ["h24", "24 hours", "24 hours"]];

/** "1,204 buys · 980 sells in 24 hours" (1 buy, 1 sell: never "1 buys"). */
export function tradesLine(buys: number, sells: number): string {
  const n = (k: number, one: string) => `${Math.round(k).toLocaleString("en-US")} ${one}${Math.round(k) === 1 ? "" : "s"}`;
  return `${n(buys, "buy")} · ${n(sells, "sell")} in 24 hours`;
}

/** One number of the stats grid: the value big, its label under it; a shimmer while the coin is read, and a number the
 *  market data doesn't have is left out (never a dash). */
function Stat({ value, label, loading }: { value: string | undefined; label: string; loading: boolean }) {
  if (value === undefined && !loading) return null;
  return <div className="cp-stat">{value === undefined ? <b className="zf-shimmer cp-stat-sk" aria-label="Loading" /> : <b>{value}</b>}<span className="zf-small">{label}</span></div>;
}

/** While a finger is on the chart, its moment: "7:25 am, 3 Nov" (design review 18). */
function scrubWhen(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s/g, " ").toLowerCase();
  return `${time}, ${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
}
