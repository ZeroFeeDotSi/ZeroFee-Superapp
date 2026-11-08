// Native coins (product decision, 5 Nov, items 4-5), one chunk loaded only when Trade's Native coins tab or a Safe coin's page is
// opened (never in Home's first load): the list of every coin NEAR Intents lists (best 24 h first, searchable), and a
// coin's page in Trade's own look (its chart is Trade's Lightweight Charts line), with Buy and Sell from the Safe through
// the ONE swap path (swap.ts: ledger.swapQuote, ledger.swap). Market data is display only and never sizes a swap.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { LiveRow } from "@zerofee/design/LiveRow.tsx";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { isPositive, padBase } from "@zerofee/design/keypad.ts";
import { chipAt } from "@zerofee/design/money-entry.ts";
import "@zerofee/design/moneyentry.css";
import { Mark } from "@zerofee/design/Mark.tsx";
import { MoneySheet, SheetTop } from "@zerofee/design/MoneySheet.tsx";
import { Receipt } from "@zerofee/design/Receipt.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { JOB_WORDS, ownRowJob } from "@zerofee/shell-api/job-start.ts";
import { taskStore, type TaskStep } from "@zerofee/shell-api/tasks.ts";
import { sheetsHeard } from "@zerofee/shell-api/approval-answered.ts";
import { onOwnApproval } from "@zerofee/shell-api/job-run.ts";
import { JobReceipt, THROUGH_CONFIDENTIAL } from "@zerofee/wallet/app/money/JobMade.tsx";
import { SHEET_NEEDS, restsProps, useServices } from "@zerofee/wallet/app/services.ts";
import { SAFE_SWAP_PRIVATE } from "@zerofee/core/safe-swap-private";
// S7: a held coin reads as Home reads it ("253.0275 NEAR"), never to 6 decimals beside Home's 4; audit 17's H4: a Sell's
// landed figure, said once, big, as Activity says it (landedUsd: one formatter)
import { amountOf, landedUsd } from "@zerofee/wallet/app/format.ts";
import { safeCanSell } from "@zerofee/core/band-coins";
import { feesFigure, intentsKept } from "@zerofee/core/zero-fee";
import { faceIdBandUsd } from "@zerofee/core/spending";
import type { Candle, Range } from "../market/types.ts";
import { relayBase } from "../market/relay.ts";
import { Chart } from "../app/Chart.tsx";
import { coinHeadline, compactUsd, isRawCoinId, listPrice, moveWords, pct, price, usd } from "../app/format.ts";
import { Search } from "../app/icons.tsx";
import { useOnline, OFFLINE_SHORT } from "../app/online.ts";
import { coinRoute } from "../app/requests.ts";
import "../app/discover.css";
import "../app/coinpage.css";
import "../app/screens/sheet.css";
import "./native.css";
import { chainWords, logoVia, searchNative, type NativeRow } from "./assets.ts";
import { nativeData, type NativeFacts, type NativeFault } from "./data.ts";
import { SERVICE_NAMES } from "@zerofee/core/services";
import { chartDown, heldWorth, rangesShown, rowWorth, statsShown } from "./look.ts";
import { SAFE_FILL_OPEN } from "@zerofee/core/safe-fill-open";
import { NATIVE_WORDS, amountIn, askQuote, buyTitle, paceLegs, groupTyped, heldOf, legsTime, privateHas, quoteLive, safeFills, resultOf, runSwap, sellStart, sellTitle, type HeldRow, type SafeQuote, type SwapRecord, type SwapView } from "./swap.ts";
import { NATIVE_COPY as W } from "./words.ts";
import { coinPrice, useOnePrices } from "./one-price.ts";

const RELAY = relayBase(import.meta.env?.VITE_ZEROFEE_RELAY);
const logo = (r: Pick<NativeRow, "logo" | "gt"> | undefined, small = true) => logoVia(RELAY, r?.logo, small, r?.gt);
const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/** The list, streamed: the last answer at once, a fresh one now and every minute while it is on screen. */
function useNativeList(): { rows: NativeRow[] | null; failed: boolean; retry: () => void } {
  const data = nativeData();
  const [rows, setRows] = useState<NativeRow[] | null>(() => data.list());
  const [failed, setFailed] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    let dead = false;
    const read = () => { if (visible()) void data.refreshList().then((r) => { if (!dead) { setRows(r); setFailed(false); } }, () => { if (!dead) setFailed(true); }); };
    read();
    const t = setInterval(read, 60_000);
    return () => { dead = true; clearInterval(t); };
  }, [n]);
  return { rows, failed, retry: () => setN((x) => x + 1) };
}

/** The failed list's one line, the source by name (rule 9a); no source named: the plain line. */
const faultLine = (f: NativeFault | null): string =>
  !f ? W.listDown : W.listFault(f.service === "gecko" ? SERVICE_NAMES.gecko : W.faultNames[f.service], f.fault === "busy" || f.fault === "slow" ? f.fault : "down");

/** The row's 36x20 line: the last day, hourly, in its day's colour. */
export function sparkPath(p: readonly number[], w = 36, h = 20): string {
  const lo = Math.min(...p), hi = Math.max(...p), span = hi - lo || 1;
  return p.map((v, i) => `${i ? "L" : "M"}${((i / (p.length - 1)) * w).toFixed(1)} ${(h - 1 - ((v - lo) / span) * (h - 2)).toFixed(1)}`).join(" ");
}

export function NativeList({ onCoin }: { onCoin: (r: NativeRow, buy?: boolean) => void }) {
  const { rows, failed, retry } = useNativeList();
  const online = useOnline();
  // C3 (audit 12): each row's price is Home's (one-price.ts), the market's only where the ledger has none
  const book = useOnePrices(useShell().bridge);
  const [q, setQ] = useState("");
  const shown = useMemo(() => (rows ? searchNative(rows, q) : null), [rows, q]);
  return (
    <div className="dc nc" data-testid="native-list">
      <p className="nc-best">{rows ? W.best(rows.length) : W.fromSafe}</p>
      <label className="dc-field">
        <Search />
        <input id="nc-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={W.search} autoComplete="off" spellCheck={false} aria-label={W.search} />
        {q && <button type="button" className="dc-paste" onClick={() => { setQ(""); document.getElementById("nc-search")?.blur(); }}>{W.clear}</button>}
      </label>
      {!shown && !failed && <div className="dc-skel" aria-busy="true" aria-label="Loading">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="dc-skel-row"><span className="zf-shimmer dc-skel-dot" /><span className="zf-shimmer dc-skel-bar" /></span>)}</div>}
      {!shown && failed && <p className="dc-quiet" role="status">{online ? faultLine(nativeData().fault()) : OFFLINE_SHORT} <button type="button" className="zf-link" onClick={retry}>{W.retry}</button></p>}
      {shown && shown.length === 0 && <p className="dc-quiet">{W.noMatch}</p>}
      <div className="dc-list">
        {/* Trenches' own row (LiveRow): the coin's disc, its name and its worth (one row per coin, audit 17's H1: no chain word); the price and the day's
            move on the right; the quiet Buy chip beside it (a sibling, never a button in a button). A coin the Safe can't
            buy yet has no chip: its page says why (end to end or hidden) */}
        {shown?.map((r) => {
          const src = logo(r);
          const name = r.name !== r.symbol && r.name.length <= 18 ? r.name : r.symbol;
          const px = coinPrice(book, r.assetId, r.symbol, r.price);
          return (
            <div key={r.assetId} className="dc-rr nc-rr" data-asset={r.assetId}>
              <LiveRow state="past" className="dc-row nc-row" onOpen={() => onCoin(r)} label={`${name}${px ? `, ${price(px)}` : ""}`}
                mark={<span className="dc-logo-box"><span className="dc-logo"><CoinIcon symbol={r.symbol} {...(src ? { src } : {})} size={40} /></span></span>}
                title={<span className="dc-sym">{name}</span>}
                line={<span className="dc-sub">{r.marketCap || r.fdv ? <span className="dc-cap">{rowWorth((r.marketCap || r.fdv)!)}</span> : null}</span>}
                usd={<span className={`dc-px${px && listPrice(px).length > 9 ? " dc-px--long" : ""}`}>{px ? listPrice(px) : ""}</span>}
                when={r.change24h !== undefined ? <span className={`dc-chg ${r.change24h > 0 ? "up" : r.change24h < 0 ? "down" : ""}`}>{pct(r.change24h)}</span> : undefined} />
              {/* every listed coin can be bought (data.ts lists only safeCanSell's), so every row has its chip */}
              {/* only while the Safe's Buy goes through NEAR Confidential (SAFE_SWAP_PRIVATE): off, no chip */}
              {SAFE_SWAP_PRIVATE && <button type="button" className="dc-qb" aria-label={`${W.buy} ${r.symbol}`} onClick={() => onCoin(r, true)}>
                <span className="dc-qb__pill" aria-hidden="true">{W.buy}</span>
              </button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const RANGES: [Range, string][] = [["1H", "LIVE"], ["1D", "1D"], ["1W", "1W"], ["1M", "1M"], ["1Y", "1Y"], ["ALL", "ALL"]];
const RANGE_WORDS: Record<Range, string> = { "1H": "in the last hour", "1D": "today", "1W": "this week", "1M": "this month", "1Y": "this year", ALL: "all time" };

/** The header's move for the range on screen: the chart's own first and last price (24 h: the market's figure). */
export function rangeMove(range: Range, candles: readonly Candle[] | undefined, price: number | undefined, change24h: number | undefined): { usd: number; pct: number; dir: "up" | "down" } | null {
  if (range === "1D" && change24h !== undefined && price) { const was = price / (1 + change24h / 100); return { usd: price - was, pct: change24h, dir: change24h >= 0 ? "up" : "down" }; }
  if (!candles || candles.length < 2) return null;
  const a = candles[0]!.o, b = price ?? candles[candles.length - 1]!.c;
  if (!(a > 0)) return null;
  const p = ((b - a) / a) * 100;
  return { usd: b - a, pct: p, dir: p >= 0 ? "up" : "down" };
}

/** A Safe coin's page: opens at once from what was last read, then streams. `buy`: opened by a row's Buy chip. */
export function NativeCoinPage({ assetId, symbol: seedSymbol, buy }: { assetId: string; symbol?: string; buy?: boolean }) {
  const shell = useShell();
  const { bridge, active } = shell;
  const data = nativeData();
  const online = useOnline();
  const book = useOnePrices(bridge);
  const [row, setRow] = useState<NativeRow | undefined>(() => data.coin(assetId));
  const [range, setRange] = useState<Range>("1D");
  /** A2: a range the person tapped (its tabs stay even with no chart, so another can be picked). */
  const [picked, setPicked] = useState(false);
  const [facts, setFacts] = useState<NativeFacts | undefined>(() => (row?.gt ? data.peekFacts(row.gt) : undefined));
  const [candles, setCandles] = useState<Candle[] | undefined>(() => (row ? data.peekCandles(row, "1D") : undefined));
  /** The chart's source that didn't answer, by name (C9, audit 12); null: none failed. */
  const [chartFailed, setChartFailed] = useState<string | null>(null);
  const [chartTry, setChartTry] = useState(0);
  const [scrub, setScrub] = useState<Candle | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [canSend, setCanSend] = useState(false);
  // a coin native to NEAR in the Safe: Send fills Private from the Safe first, so it can go with nothing in Private
  const [safeSends, setSafeSends] = useState(false);
  /** The coin's one Safe figure, Home's (wallet balance-parts.ts readSafeHeld): shown; `held` (its NEAR Intents part) is
   *  what Sell can pay */
  const [figure, setFigure] = useState<{ amount: string; usd: string; rest?: ("private" | "staked")[] } | null>(null);
  const [records, setRecords] = useState<SwapRecord[]>([]);
  // Buy and Sell only for a coin the Safe can also sell today (band-coins.ts safeCanSell, the one switch)
  // Buy and Sell from the Safe go only through NEAR Confidential (product decision, 8 Nov): off, the page has neither (no line either)
  const sellable = SAFE_SWAP_PRIVATE && safeCanSell(assetId);
  const [sheet, setSheet] = useState<"buy" | "sell" | null>(buy && sellable ? "buy" : null);
  const [gone, setGone] = useState(false);
  const [eta, setEta] = useState<number | undefined>(() => lastEta);
  // the coin: from the list kept on the device at once; the list read when this page opened first
  useEffect(() => {
    let dead = false;
    const read = () => void data.refreshList().then(() => { if (!dead) { const r = data.coin(assetId); setRow(r); if (!r) setGone(true); } }, () => undefined);
    read();
    const t = setInterval(() => { if (active && visible()) read(); }, 60_000);
    return () => { dead = true; clearInterval(t); };
  }, [assetId, active]);
  // its pools (GeckoTerminal), then the range's chart on its top pool, else CoinGecko's
  useEffect(() => {
    if (!row?.gt) return;
    let dead = false;
    const read = () => void data.facts(row.gt!).then((f) => { if (!dead) setFacts(f); }, () => undefined);
    read();
    const t = setInterval(() => { if (active && visible()) read(); }, 60_000);
    return () => { dead = true; clearInterval(t); };
  }, [row?.gt?.network, row?.gt?.address, active]);
  const pool = facts?.pools[0];
  useEffect(() => {
    // C9 (audit 12): a build with no price server asks no market, so it draws no chart box at all
    if (!row || !RELAY) return;
    let dead = false;
    const kept = data.peekCandles(row, range);
    if (kept) setCandles(kept);
    setChartFailed(null);
    const read = () => void data.candles(row, range, pool).then((c) => { if (!dead) { setCandles(c); setChartFailed(null); } }, (e: unknown) => { if (!dead) setChartFailed(chartDown(e)); });
    read();
    const t = setInterval(() => { if (active && visible()) read(); }, range === "1H" ? 30_000 : 120_000);
    return () => { dead = true; clearInterval(t); };
  }, [row?.assetId, range, pool?.address, active, chartTry]);
  // what the Safe holds of it, and the swaps it was bought with (the result only from those)
  const readHeld = () => {
    void bridge.call<HeldRow[]>("ledger.balances").then((r) => { const rows = "ok" in r && Array.isArray(r.ok) ? r.ok : null; setHeld(rows ? heldOf(rows, assetId) : null); setSafeSends(safeFills(rows, assetId, SAFE_FILL_OPEN)); }, () => undefined);
    void bridge.call<{ rows?: HeldRow[] }>("ledger.private").then((r) => setCanSend("ok" in r && !!r.ok && privateHas(r.ok.rows, assetId)), () => setCanSend(false));
    void import("@zerofee/wallet/app/balance-parts.ts").then((m) => m.readSafeHeld(bridge, assetId)).then(setFigure, () => undefined);
    void bridge.call<SwapRecord[]>("ledger.activity", { limit: 200 }).then((r) => { if ("ok" in r && Array.isArray(r.ok)) setRecords(r.ok); }, () => undefined);
  };
  useEffect(() => { readHeld(); return bridge.on("ledger.balancesChanged", readHeld); }, [assetId]);
  // today's time, 1Click's own (a small dry price of this coin): said on the notice line, never a figure of ours
  useEffect(() => {
    if (lastEta !== undefined || !row) return;
    let dead = false;
    void askQuote(bridge, "buy", row.assetId, "5").then((r) => { if (!dead && "ok" in r && r.ok.etaSeconds) { lastEta = Math.round(r.ok.etaSeconds); lastFill = r.ok.fillSeconds; setEta(lastEta); } });
    return () => { dead = true; };
  }, [row?.assetId]);

  const symbol = row?.symbol ?? seedSymbol ?? "";
  // C3 (audit 12): the coin's one price, Home's (the ledger's, one-price.ts); the market's only where the ledger has none
  const px = coinPrice(book, assetId, symbol, facts?.priceUsd, row?.price);
  const shownPrice = scrub ? scrub.c : px;
  const moved = rangeMove(range, candles, px, row?.change24h);
  const heldN = held ? Number(held) : 0;
  // what is shown: the one figure; until it is read, the part Sell pays from. A1 (audit 10): its dollars at the hero's own
  // price, the one Buy fills at (look.ts heldWorth), never Home's price beside it
  const heldAmount = figure?.amount ?? held;
  // C3 (audit 12): at Home's price, Home's own figure for it (to the cent: Home rounds each part, then adds them)
  const shownHeld = heldAmount ? { amount: heldAmount, usd: figure && book.has(assetId) ? figure.usd : heldWorth(heldAmount, px) } : null;
  const partOnly = sellable && figure && held !== null && Number(figure.amount) - heldN > 1e-9;
  const result = held && px ? resultOf(records, assetId, heldN, px) : null;
  // the numbers in Trenches' order and words (Worth, Liquidity, Traded 24h), each only once it has a figure: never "—",
  // never an empty box (C9, audit 12: three grey boxes sat on NEAR's page when the pools never came)
  const stats = statsShown([[W.worth, row?.marketCap ?? facts?.marketCapUsd ?? row?.fdv ?? facts?.fdvUsd], [W.liquidity, facts?.liquidityUsd], [W.tradedToday, facts?.volume24hUsd ?? row?.volume24h]]);
  const chain = row ? chainWords(row.blockchain) : "";
  const noChart = !(candles && candles.length >= 2) && (!!chartFailed || (!!candles && candles.length < 2));
  const name = coinHeadline(row?.name, symbol, assetId);
  if (gone && !row) return <div className="tr-coin cp"><p className="zf-body nc-gone">{W.notListed}</p></div>;
  return (
    <div className="tr-coin cp zf-enter nc-page" data-testid="native-coin" data-asset={assetId}>
      {/* Trenches' head: the coin in its own light, its name once, its symbol and chain under it */}
      <div className="tr-coin-head">
        <span className="zf-halo is-on cp-logo">{logo(row, false) && <img className="zf-halo__light" src={logo(row, false)} alt="" />}<CoinIcon symbol={symbol} {...(logo(row, false) ? { src: logo(row, false)! } : {})} size={48} /></span>
        <div><div className="tr-sym">{name}</div><div className="zf-small cp-where">{name !== symbol && symbol && !isRawCoinId(symbol, assetId) ? `${symbol} · ${chain}` : chain}</div></div>
      </div>
      <div className="tr-price"><span>{shownPrice !== undefined ? price(shownPrice) : <span className="zf-shimmer cp-price-sk" aria-label={W.loadingPrice} />}</span></div>
      <div className="zf-small tr-change">{scrub ? new Date(scrub.t).toLocaleString() : moved ? <><span className={`cp-move cp-move--${moved.dir}`}>{moveWords(moved.usd, moved.pct)}</span> <span className="tr-mute">{RANGE_WORDS[range]}</span></> : " "}</div>
      {RELAY && <div className="tr-chart-box cp-chart">
        {candles && candles.length >= 2 ? <Chart candles={candles} mode="line" dir={moved?.dir} height={220} onScrub={setScrub} />
          : noChart ? <div className="tr-inline cp-chart-empty" data-testid="native-nochart"><p className="zf-small">{!online ? OFFLINE_SHORT : chartFailed ? <>{W.didntAnswer(chartFailed)} <button type="button" className="zf-link" onClick={() => setChartTry((n) => n + 1)}>{W.retry}</button></> : W.noChart}</p></div>
          : <div className="tr-center cp-chart-empty"><Mark size={40} mode="loading" /></div>}
      </div>}
      {RELAY && rangesShown(noChart, picked) && <div className="tr-tabs tr-ranges" role="tablist">
        {RANGES.map(([r, label]) => <button key={r} role="tab" aria-selected={r === range} className={r === range ? "on" : ""} onClick={() => { setRange(r); setPicked(true); setScrub(null); }}>{label}</button>)}
      </div>}
      {/* what the Safe holds of it, as Trenches' held row: the coin, the amount, the result since bought, the dollars */}
      {shownHeld && (
        <div className="cp-hold" data-testid="native-held" aria-label={W.whatYouHold}>
          <CoinIcon symbol={symbol} {...(logo(row) ? { src: logo(row)! } : {})} size={36} />
          <span className="cp-hold-t"><span>{W.youHold(amountOf(shownHeld.amount, symbol, row?.decimals), symbol)}</span>
            <span className="zf-small">{W.inYourSafe}{result && <span className={`nc-result nc-result--${result.usd >= 0 ? "up" : "down"}`} data-testid="native-result"> · {W.since(moveWords(result.usd, result.pct))}</span>}</span></span>
          <span className="cp-hold-v">{Number(shownHeld.usd) > 0 ? usd(Number(shownHeld.usd)) : ""}</span>
        </div>
      )}
      {partOnly && <p className="zf-small nc-part" data-testid="native-part">{W.sellPart(amountOf(held!, symbol, row?.decimals), symbol, figure?.rest)}</p>}
      {stats.length > 0 && (
        <div className="cp-stats nc-stats" data-testid="native-stats">
          {stats.map(([l, v]) => <div key={l} className="cp-stat"><b>{compactUsd(v)}</b><span className="zf-small">{l}</span></div>)}
        </div>
      )}
      {/* a coin the Safe holds can always be sent from its page (Sim test, item 5: no Send there). the copy review's ruling (5 Nov):
          a quiet row under the figures, never a third button beside Buy and Sell; it opens Send From this coin */}
      {shownHeld && (canSend || safeSends) && <button type="button" className="tr-kv nc-send" data-testid="native-send" onClick={() => shell.openMoney({ kind: "send", coin: symbol })}><span>{W.sendCoin}</span><span aria-hidden="true">›</span></button>}
      {/* what More held, on the page (product decision, 5 Nov, as Trenches): where the money is and how it moves, the coin, its pools */}
      <div className="cp-more-inline">
        {sellable && <div className="tr-kvs" data-testid="native-safe">
          <div className="zf-label tr-sec">{W.yourSafe}</div>
          {/* the place only, never a figure: Buy pays from the USDC inside NEAR Intents (swap.ts safeCashOf), a part of the
              Safe's USDC; a figure here was a fourth USDC figure beside Home's, Send's and Swap's (Sim test, item 7) */}
          <div className="tr-kv"><span>{W.paysFrom}</span><span>{W.safeCash}</span></div>
          <div className="tr-kv"><span>{W.landsIn}</span><span>{W.yourSafe}</span></div>
          <div className="tr-kv"><span>{W.goesThrough}</span><span>{W.confidential}</span></div>
          <div className="tr-kv"><span>{W.fills}</span><span>{W.filler}</span></div>
          <div className="tr-kv"><span>{W.zeroFee}</span><span>{W.nothing}</span></div>
          <div className="tr-kv"><span>{W.takes}</span><span>{legsTime(paceLegs({ etaSeconds: eta, fillSeconds: lastFill }))}</span></div>
        </div>}
        <div className="tr-kvs">
          <div className="zf-label tr-sec">{W.about_}</div>
          {chain && <div className="tr-kv"><span>{W.network}</span><span>{chain}</span></div>}
        </div>
        {facts && facts.pools.length > 0 && (
          <div className="tr-kvs nc-pools" data-testid="native-pools">
            <div className="zf-label tr-sec">{W.pools}</div>
            {facts.pools.slice(0, 3).map((p) => <div key={p.address} className="tr-kv"><span>{p.name || (p.dex ? dexWords(p.dex) : "")}</span><span>{p.liquidityUsd !== undefined ? W.liquidityOf(compactUsd(p.liquidityUsd)) : ""}</span></div>)}
          </div>
        )}
        <p className="zf-small cp-source">{W.sourceOf(book.has(assetId), !!RELAY)}</p>
      </div>
      {/* Trenches' floor: Sell (quiet) beside Buy (the one lit verb); a coin the Safe can't buy yet says why there, nothing lit */}
      <div className="tr-floor tr-coin-floor">
        {sellable
          ? <div className="tr-pair cp-pair">
              {held && <button className="tr-btn2" onClick={() => setSheet("sell")}>{W.sell}</button>}
              <button className={`zf-btn${online && row ? " zf-sweep" : ""}`} disabled={!online || !row} onClick={() => setSheet("buy")}>{W.buy}</button>
            </div>
          : SAFE_SWAP_PRIVATE ? <p className="zf-small tr-why" data-testid="native-soon">{W.soonLine}</p> : null}
      </div>
      {/* the sheet sits where Trenches' sheet sits: on Trade's own ground, over the app bar, never inside the page's scroll
          (inside it the bar covered Buy and the page showed at its sides) */}
      {sheet && row && sellable && onTradeGround(<NativeTradeSheet side={sheet} row={row} {...(px !== undefined ? { price: px } : {})} held={held} onClose={() => { setSheet(null); readHeld(); }} />)}
    </div>
  );
}
/** The job's steps as its row says them (runSwap: into Private, the swap, back), each ticked only on its read. */
function JobSteps({ job }: { job: string }) {
  const [steps, setSteps] = useState<TaskStep[]>([]);
  useEffect(() => {
    const s = taskStore();
    const read = () => setSteps(s.list().find((t) => t.id === job)?.steps ?? []);
    read();
    return s.subscribe(read);
  }, [job]);
  return <ol className="nc-steps" data-testid="native-steps">{steps.map((x, i) => <li key={i} className="zf-receipt__line" data-state={x.state}>{x.label}</li>)}</ol>;
}
/** Trade's own ground (.tr-app, where Trenches' TradeSheet is drawn); the page itself when there is none. */
const onTradeGround = (el: ReactNode) => { const at = typeof document === "undefined" ? null : document.querySelector(".tr-app"); return at ? createPortal(el, at) : el; };
/** 1Click's own time, as last heard on this page (it is the same for every coin today). */
let lastEta: number | undefined;
/** the dry quote's own fill time (the Sim's pace), beside lastEta */
let lastFill: number | undefined;

const dexWords = (id: string) => id.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
/** A held amount said short: at most 6 decimals, trailing zeros gone. */
export const trimAmount = (s: string): string => (s.includes(".") ? s.replace(/(\.\d{0,6})\d*$/, "$1").replace(/\.?0+$/, "") : s) || "0";

const BUY_CHIPS = ["10", "25", "50", "100"];
/** Buy or Sell from the Safe (D135: the whole screen, Close), Trade's one-tap shape: the tap IS the job, published at once;
 *  the receipt lands in the same sheet. The person never reads the protocol's names here; the job in Activity names it. */
export function NativeTradeSheet({ side, row, price: px, held, onClose }: { side: "buy" | "sell"; row: NativeRow; price?: number; held: string | null; onClose: () => void }) {
  const { bridge, tasks } = useShell();
  const online = useOnline();
  const [value, setValue] = useState(side === "buy" ? "25" : "");
  const [fresh, setFresh] = useState(true);
  const [all, setAll] = useState(side === "sell");
  const [quote, setQuote] = useState<{ q?: SafeQuote; problem?: string; for?: string }>({});
  const [view, setView] = useState<SwapView | null>(null);
  const [sent, setSent] = useState<SafeQuote | null>(null);
  const [again, setAgain] = useState(0);
  // "Job created." (Sim re-check, 5 Nov: a Buy never said it): at the tap where no sheet of ours comes (the iPhone's
  // own Face ID); where the Safe's sheet is heard, on its yes, or on the core's answer when no sheet came (rule 2, QA's MUST)
  const [made, setMade] = useState(false);
  // the job's own row (runSwap publishes it at the tap): the receipt, its steps and its clock follow it alone
  const [job, setJob] = useState<string | null>(null);
  // every service the job needs (NEAR Confidential among them): one down stops the sheet before the tap, saying what is
  // down, where the money is and what to do (core waitsLine, audit 11's B4); nothing is asked or signed
  const services = useServices(bridge, SHEET_NEEDS.swap, side === "buy" ? "Buy" : "Sell");
  const heldUsd = held && px ? Number(held) * px : undefined;
  const usdIn = side === "sell" && all ? heldUsd ?? 0 : Number(value) || 0;
  // the Safe's Face ID limit (its first band), said before the tap: over it the core would refuse a price that can't
  // wait (security.quote.cant-wait), so the tap is never offered; not read yet, the core's own check still holds
  const [band, setBand] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void bridge.call<{ usd?: { upToUsd: number | null; level: string }[] | null }>("account.protection.get", {}).then((r) => { if (live && "ok" in r) setBand(r.ok?.usd ? faceIdBandUsd(r.ok.usd) : null); }, () => undefined);
    return () => { live = false; };
  }, [bridge]);
  // Sell opens where swap.ts sellStart says once the band and the holding are read (All within the Face ID band, else the
  // largest share under it, else the band); only while the sheet is still on its opening All, never over a pick
  const started = useRef(false);
  useEffect(() => {
    if (side !== "sell" || started.current || band === undefined || heldUsd === undefined) return;
    started.current = true;
    const s = sellStart(heldUsd, band);
    if (!s.all && all && value === "") { setAll(false); setFresh(true); setValue(s.usd); }
  }, [side, band, heldUsd]);
  const capped = band === 0 ? W.noFaceId : typeof band === "number" && usdIn > band ? W.overFaceId(usd(band)) : null;
  const amt = amountIn({ side, usd: usdIn, all, ...(px !== undefined ? { price: px } : {}), ...(held ? { held } : {}), decimals: row.decimals });
  // the price, asked again as the amount settles and before it runs out (it lasts 30 s)
  const asked = useRef(0);
  useEffect(() => {
    if (!amt || view) return;
    const n = ++asked.current;
    const ask = () => void askQuote(bridge, side, row.assetId, amt, { ...(px !== undefined ? { priceUsd: px } : {}), symbol: row.symbol, name: row.name }).then((r) => { if (n === asked.current) setQuote("ok" in r ? { q: r.ok, for: amt } : { problem: r.problem, for: amt }); });
    const t = setTimeout(ask, 250);
    const again = setInterval(ask, 20_000);
    return () => { clearTimeout(t); clearInterval(again); };
  }, [amt, side, row.assetId, view, again]);
  const q = quote.for === amt ? quote.q : undefined;
  // a service down: no figure from a price that can't be paid now (the line says why)
  const figure = q && !capped && !services.line ? feesFigure(Number(q.feeUsd)) : null;
  const eta = q?.etaSeconds ? Math.round(q.etaSeconds) : undefined;
  // the job's whole time from its legs (into Private as measured, NEAR Intents' own quoted swap): never 1Click's alone
  const time = legsTime(paceLegs(q));
  const usdText = usd(side === "buy" ? Number(value) || 0 : usdIn);
  const title = side === "buy" ? buyTitle(usdText, row.symbol) : sellTitle(usdText, row.symbol);
  const go = async () => {
    if (!q || !amt || capped || services.down) return;
    const tapMs = Date.now();
    // QA: an expired price is never re-asked silently at the tap; the person sees the new one and taps again
    if (!quoteLive(q, tapMs)) { setQuote({ problem: NATIVE_WORDS.expired, for: amt }); setAgain((n) => n + 1); return; }
    const live = q;
    setSent(live);
    setMade(!sheetsHeard("safe"));
    const off = onOwnApproval((yes) => { if (yes) setMade(true); });
    const seen = (v: SwapView) => { if (v.made || v.state !== "doing") { off(); setMade(true); } setView((was) => (v.made && was ? was : v)); };
    const taskId = ownRowJob(`native-${side}-${row.assetId}-${tapMs}`);
    setJob(taskId);
    void runSwap({ bridge, tasks, taskId, title, usd: usdText, quote: live, tapMs, got: side === "buy" ? row.symbol : "USDC", route: coinRoute({ chain: "intents", assetId: row.assetId, symbol: row.symbol }), onView: seen });
  };
  // audit 16's G1: while the sheet can't go (offline, or NEAR Confidential, NEAR Intents, ZeroFee's server or NEAR down), its
  // keypad and chips rest, inert and dimmed (wallet restsProps, Send's D14 rule); only the line above them speaks
  const rests = !online || services.down;
  // one figure, one format (b15's grade edge, "$25" over "Buy $25.00 of NEAR"): at rest (the opening, a chip) the money
  // format both places ("$25.00"); while keys are typed the headline echoes them and the button says the same figure
  const big = side === "buy" && !fresh ? `$${groupTyped(value || "0")}` : usdText;
  const label = side === "buy" ? buyTitle(big, row.symbol) : title;
  // the sell track's thumb: on All, or on the share whose dollars are typed (the chips' own test), else none
  const sellAt = all ? (heldUsd !== undefined ? 2 : 0) : heldUsd !== undefined ? [0.25, 0.5].findIndex((x) => value === (heldUsd * x).toFixed(2)) : -1;
  const coinLogo = <span className="zf-halo zf-halo--big is-on tp-logo"><CoinIcon symbol={row.symbol} {...(logo(row, false) ? { src: logo(row, false)! } : {})} size={56} /></span>;
  return (
    <MoneySheet title={view ? "" : `${side === "buy" ? W.buy : W.sell} ${row.symbol}`} onClose={onClose}>
      <div className="tp nc-sheet" data-testid="native-sheet">
        {view && view.state !== "failed" && made && job ? (
          // the job made (M12-1's receipt, Swap's and Send's own): "Job created." then "Done.", what happened, "It goes
          // through NEAR Confidential.", the three steps as their reads tick them, and the one clock ("Took 11 s.")
          <div className="nc-job" data-state={view.state} data-testid="native-receipt">
            <JobReceipt amount={side === "sell" && view.got ? landedUsd(view.got) : usdText} testid="native-job" job={job} onDone={onClose} etaSec={paceLegs(sent).reduce((n, x) => n + x, 0)}
              icon={<CoinIcon symbol={row.symbol} {...(logo(row, false) ? { src: logo(row, false)! } : {})} size={64} />}
              said={view.checking ?? (side === "buy" ? W.buying(row.symbol) : W.selling(row.symbol))}
              landedSaid={side === "buy" ? W.boughtIn(view.got ? `${amountOf(view.got, row.symbol, row.decimals)} ${row.symbol}` : null, row.symbol) : W.soldIn(row.symbol)}
              steps={<JobSteps job={job} />} through={null} />
          </div>
        ) : view ? (
          // before the Safe's yes (its sheet is up), and a refusal: the sheet's own receipt, no "Job created." yet
          <div className={`tm tm--${view.state} is-in nc-job`} data-state={view.state} data-testid="native-receipt">
            <Receipt state={view.state === "failed" ? "refused" : "away"} side={side} coin={row.symbol}
              coinAmount={sent ? amountOf(side === "buy" ? sent.amountOut : sent.amountIn, row.symbol, row.decimals) : ""} where={W.yourSafeLower} usd={usdText}
              icon={<CoinIcon symbol={row.symbol} {...(logo(row, false) ? { src: logo(row, false)! } : {})} size={64} />}
              say={view.state === "failed" ? { line: view.line ?? NATIVE_WORDS.declined } : { chain: THROUGH_CONFIDENTIAL }} />
            <div className="tm-floor">
              {view.state === "failed" ? <>
                <button className="zf-btn tm-btn1" onClick={() => { setView(null); setSent(null); setJob(null); setAgain((n) => n + 1); }}>{W.tryAgain}</button>
                <button className="zf-btn zf-btn--quiet tm-btn2" onClick={onClose}>{W.close}</button>
              </> : <button className="zf-btn zf-btn--quiet tm-btn2" onClick={onClose}>{W.close}</button>}
            </div>
          </div>
        ) : (<>
          {/* a down service or offline: ON TOP, full width, its status link under it (Swap's and Move's SheetTop, S16-14);
              while it can't go no promise line is said (what it pays with, at least, through), the fee line stays */}
          <SheetTop text={online ? services.line : W.offline(side === "buy" ? W.buy : W.sell)} testid={online ? "native-down" : "native-offline"} offline={!online} />
          <div className="tp-coin">{coinLogo}</div>
          <div className="tp-amt" aria-label={big} style={{ ["--fs" as string]: `${big.length <= 4 ? 84 : big.length <= 6 ? 70 : big.length <= 8 ? 58 : 46}px` }}><span className={`tp-amt-n${side === "buy" && !isPositive(value) ? " zero" : ""}`}>{big}</span></div>
          <p className="tp-get" aria-live="polite" data-testid="native-about">{services.line ? " " : capped ? capped : q ? (side === "buy" ? W.about(amountOf(q.amountOut, row.symbol, row.decimals), row.symbol) : W.aboutSell(amountOf(q.amountIn, row.symbol, row.decimals), row.symbol, usd(Number(q.amountOut)))) : quote.problem && quote.for === amt ? quote.problem : " "}</p>
          <p className="zf-small nc-least" data-testid="native-least">{q && !capped && !services.line ? W.atLeast(side === "buy" ? `${amountOf(q.minOut, row.symbol, row.decimals)} ${row.symbol}` : usd(Number(q.minOut)), time) : " "}</p>
          {!services.down && <p className="tp-pay nc-pay" data-testid="native-pay">{side === "buy" ? W.paysWith : W.paysInto}</p>}
          {side === "buy" ? (
            <>
              <div className="zf-me__chips tp-chips" role="group" aria-label={W.amount} {...restsProps(rests, { ["--n" as string]: BUY_CHIPS.length, ["--at" as string]: Math.max(0, chipAt(BUY_CHIPS, value)) })} data-none={chipAt(BUY_CHIPS, value) < 0 || undefined} data-testid="native-chips">
                <span className="zf-me__thumb" aria-hidden="true" />
                {BUY_CHIPS.map((v) => <button key={v} className={v === value ? "on" : ""} aria-pressed={v === value} onClick={() => { setFresh(true); setValue(v); }}>${v}</button>)}
              </div>
              <div className="tp-pad" {...restsProps(rests)} data-testid="native-pad"><Keypad value={padBase(value, fresh)} decimals={2} onChange={(v) => { setFresh(false); setValue(v); }} /></div>
            </>
          ) : (
            <div className="zf-me__chips tp-chips" role="group" aria-label={W.amount} {...restsProps(rests, { ["--n" as string]: heldUsd !== undefined ? 3 : 1, ["--at" as string]: Math.max(0, sellAt) })} data-none={sellAt < 0 || undefined} data-testid="native-chips">
              <span className="zf-me__thumb" aria-hidden="true" />
              {heldUsd !== undefined && [0.25, 0.5].map((x) => <button key={x} className={!all && value === (heldUsd * x).toFixed(2) ? "on" : ""} aria-pressed={!all && value === (heldUsd * x).toFixed(2)} onClick={() => { setAll(false); setValue((heldUsd * x).toFixed(2)); }}>{x * 100}%</button>)}
              <button className={all ? "on" : ""} aria-pressed={all} onClick={() => setAll(true)}>{W.all}</button>
            </div>
          )}
          {!services.down && <p className="zf-small nc-who" data-testid="native-who">{THROUGH_CONFIDENTIAL}</p>}
          <div className="tp-floor">
            {/* the fee block, right above the button (the copy review, 6 Nov): the figure is this quote's */}
            <div className="zf-fee">
              {figure && <p className="zf-small" data-testid="native-fee">{figure}</p>}
              <p className="zf-small" data-testid="native-paid">{intentsKept(!!figure)}</p>
            </div>
            <button className="zf-btn tr-press tp-go" disabled={!online || !q || !amt || !!capped || services.down} onClick={() => void go()}>{online ? label : OFFLINE_SHORT}</button>
          </div>
        </>)}
      </div>
    </MoneySheet>
  );
}
