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
import { MoneySheet } from "@zerofee/design/MoneySheet.tsx";
import { Receipt } from "@zerofee/design/Receipt.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";
import { sheetsHeard } from "@zerofee/shell-api/approval-answered.ts";
import { onOwnApproval } from "@zerofee/shell-api/job-run.ts";
import { TimeLeft } from "@zerofee/wallet/app/money/JobMade.tsx";
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
import { rowWorth } from "./look.ts";
import { SAFE_FILL_OPEN } from "@zerofee/core/safe-fill-open";
import { NATIVE_WORDS, amountIn, askQuote, buyTitle, heldOf, privateHas, quoteLive, safeFills, resultOf, runSwap, sellStart, sellTitle, type HeldRow, type SafeQuote, type SwapRecord, type SwapView } from "./swap.ts";
import { NATIVE_COPY as W } from "./words.ts";

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
        {/* Trenches' own row (LiveRow): the coin's disc, its name, its chain in words and its worth; the price and the day's
            move on the right; the quiet Buy chip beside it (a sibling, never a button in a button). A coin the Safe can't
            buy yet has no chip: its page says why (end to end or hidden) */}
        {shown?.map((r) => {
          const src = logo(r);
          const name = r.name !== r.symbol && r.name.length <= 18 ? r.name : r.symbol;
          return (
            <div key={r.assetId} className="dc-rr nc-rr" data-asset={r.assetId}>
              <LiveRow state="past" className="dc-row nc-row" onOpen={() => onCoin(r)} label={`${name}, ${chainWords(r.blockchain)}${r.price ? `, ${price(r.price)}` : ""}`}
                mark={<span className="dc-logo-box"><span className="dc-logo"><CoinIcon symbol={r.symbol} {...(src ? { src } : {})} size={40} /></span></span>}
                title={<span className="dc-sym">{name}</span>}
                line={<span className="dc-sub"><span className="dc-name">{chainWords(r.blockchain)}</span>{r.marketCap || r.fdv ? <span className="dc-cap">{rowWorth((r.marketCap || r.fdv)!)}</span> : null}</span>}
                usd={<span className={`dc-px${r.price && listPrice(r.price).length > 9 ? " dc-px--long" : ""}`}>{r.price ? listPrice(r.price) : ""}</span>}
                when={r.change24h !== undefined ? <span className={`dc-chg ${r.change24h > 0 ? "up" : r.change24h < 0 ? "down" : ""}`}>{pct(r.change24h)}</span> : undefined} />
              {/* every listed coin can be bought (data.ts lists only safeCanSell's), so every row has its chip */}
              <button type="button" className="dc-qb" aria-label={`${W.buy} ${r.symbol}`} onClick={() => onCoin(r, true)}>
                <span className="dc-qb__pill" aria-hidden="true">{W.buy}</span>
              </button>
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
  const [row, setRow] = useState<NativeRow | undefined>(() => data.coin(assetId));
  const [range, setRange] = useState<Range>("1D");
  const [facts, setFacts] = useState<NativeFacts | undefined>(() => (row?.gt ? data.peekFacts(row.gt) : undefined));
  const [candles, setCandles] = useState<Candle[] | undefined>(() => (row ? data.peekCandles(row, "1D") : undefined));
  const [chartFailed, setChartFailed] = useState(false);
  const [scrub, setScrub] = useState<Candle | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [canSend, setCanSend] = useState(false);
  // a coin native to NEAR in the Safe: Send fills Private from the Safe first, so it can go with nothing in Private
  const [safeSends, setSafeSends] = useState(false);
  /** The coin's one Safe figure, Home's (wallet balance-parts.ts readSafeHeld): shown; `held` (its NEAR Intents part) is
   *  what Sell can pay */
  const [figure, setFigure] = useState<{ amount: string; usd: string } | null>(null);
  const [records, setRecords] = useState<SwapRecord[]>([]);
  // Buy and Sell only for a coin the Safe can also sell today (band-coins.ts safeCanSell, the one switch)
  const sellable = safeCanSell(assetId);
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
    if (!row) return;
    let dead = false;
    const kept = data.peekCandles(row, range);
    if (kept) setCandles(kept);
    setChartFailed(false);
    const read = () => void data.candles(row, range, pool).then((c) => { if (!dead) setCandles(c); }, () => { if (!dead) setChartFailed(true); });
    read();
    const t = setInterval(() => { if (active && visible()) read(); }, range === "1H" ? 30_000 : 120_000);
    return () => { dead = true; clearInterval(t); };
  }, [row?.assetId, range, pool?.address, active]);
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
    void askQuote(bridge, "buy", row.assetId, "5").then((r) => { if (!dead && "ok" in r && r.ok.etaSeconds) { lastEta = Math.round(r.ok.etaSeconds); setEta(lastEta); } });
    return () => { dead = true; };
  }, [row?.assetId]);

  const symbol = row?.symbol ?? seedSymbol ?? "";
  const px = facts?.priceUsd ?? row?.price;
  const shownPrice = scrub ? scrub.c : px;
  const moved = rangeMove(range, candles, px, row?.change24h);
  const heldN = held ? Number(held) : 0;
  // what is shown: the one figure; until it is read, the part Sell pays from
  const shownHeld = figure ?? (held ? { amount: held, usd: px ? String(heldN * px) : "" } : null);
  const partOnly = sellable && figure && held !== null && Number(figure.amount) - heldN > 1e-9;
  const result = held && px ? resultOf(records, assetId, heldN, px) : null;
  // the numbers in Trenches' order and words (Worth, Liquidity, Traded 24h), each only when known (never "—"); a shimmer
  // while the pools are still being read
  const reading = !!row?.gt && !facts;
  const stats = ([[W.worth, row?.marketCap ?? facts?.marketCapUsd ?? row?.fdv ?? facts?.fdvUsd], [W.liquidity, facts?.liquidityUsd], [W.tradedToday, facts?.volume24hUsd ?? row?.volume24h]] as const)
    .filter(([, v]) => reading || (v !== undefined && v > 0)) as [string, number | undefined][];
  const chain = row ? chainWords(row.blockchain) : "";
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
      <div className="tr-chart-box cp-chart">
        {candles && candles.length >= 2 ? <Chart candles={candles} mode="line" dir={moved?.dir} height={220} onScrub={setScrub} />
          : chartFailed || (candles && candles.length < 2) ? <div className="tr-inline cp-chart-empty"><p className="zf-small">{online ? W.noChart : OFFLINE_SHORT}</p></div>
          : <div className="tr-center cp-chart-empty"><Mark size={40} mode="loading" /></div>}
      </div>
      <div className="tr-tabs tr-ranges" role="tablist">
        {RANGES.map(([r, label]) => <button key={r} role="tab" aria-selected={r === range} className={r === range ? "on" : ""} onClick={() => { setRange(r); setScrub(null); }}>{label}</button>)}
      </div>
      {/* what the Safe holds of it, as Trenches' held row: the coin, the amount, the result since bought, the dollars */}
      {shownHeld && (
        <div className="cp-hold" data-testid="native-held" aria-label={W.whatYouHold}>
          <CoinIcon symbol={symbol} {...(logo(row) ? { src: logo(row)! } : {})} size={36} />
          <span className="cp-hold-t"><span>{W.youHold(trimAmount(shownHeld.amount), symbol)}</span>
            <span className="zf-small">{W.inYourSafe}{result && <span className={`nc-result nc-result--${result.usd >= 0 ? "up" : "down"}`} data-testid="native-result"> · {W.since(moveWords(result.usd, result.pct))}</span>}</span></span>
          <span className="cp-hold-v">{Number(shownHeld.usd) > 0 ? usd(Number(shownHeld.usd)) : ""}</span>
        </div>
      )}
      {partOnly && <p className="zf-small nc-part" data-testid="native-part">{W.sellPart(trimAmount(held!), symbol)}</p>}
      {stats.length > 0 && (
        <div className="cp-stats nc-stats" data-testid="native-stats">
          {stats.map(([l, v]) => <div key={l} className="cp-stat">{v === undefined ? <b className="zf-shimmer cp-stat-sk" aria-label={W.loading} /> : <b>{compactUsd(v)}</b>}<span className="zf-small">{l}</span></div>)}
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
          <div className="tr-kv"><span>{W.fills}</span><span>{W.filler}</span></div>
          <div className="tr-kv"><span>{W.zeroFee}</span><span>{W.nothing}</span></div>
          {eta ? <div className="tr-kv"><span>{W.takes}</span><span>{W.secs(eta)}</span></div> : null}
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
        <p className="zf-small cp-source">{W.source}</p>
      </div>
      {/* Trenches' floor: Sell (quiet) beside Buy (the one lit verb); a coin the Safe can't buy yet says why there, nothing lit */}
      <div className="tr-floor tr-coin-floor">
        {sellable
          ? <div className="tr-pair cp-pair">
              {held && <button className="tr-btn2" onClick={() => setSheet("sell")}>{W.sell}</button>}
              <button className={`zf-btn${online && row ? " zf-sweep" : ""}`} disabled={!online || !row} onClick={() => setSheet("buy")}>{W.buy}</button>
            </div>
          : <p className="zf-small tr-why" data-testid="native-soon">{W.soonLine}</p>}
      </div>
      {/* the sheet sits where Trenches' sheet sits: on Trade's own ground, over the app bar, never inside the page's scroll
          (inside it the bar covered Buy and the page showed at its sides) */}
      {sheet && row && sellable && onTradeGround(<NativeTradeSheet side={sheet} row={row} {...(px !== undefined ? { price: px } : {})} held={held} onClose={() => { setSheet(null); readHeld(); }} />)}
    </div>
  );
}
/** Trade's own ground (.tr-app, where Trenches' TradeSheet is drawn); the page itself when there is none. */
const onTradeGround = (el: ReactNode) => { const at = typeof document === "undefined" ? null : document.querySelector(".tr-app"); return at ? createPortal(el, at) : el; };
/** 1Click's own time, as last heard on this page (it is the same for every coin today). */
let lastEta: number | undefined;

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
  const figure = q && !capped ? feesFigure(Number(q.feeUsd)) : null;
  const eta = q?.etaSeconds ? Math.round(q.etaSeconds) : undefined;
  const usdText = usd(side === "buy" ? Number(value) || 0 : usdIn);
  const title = side === "buy" ? buyTitle(usdText, row.symbol) : sellTitle(usdText, row.symbol);
  const go = async () => {
    if (!q || !amt || capped) return;
    const tapMs = Date.now();
    // QA: an expired price is never re-asked silently at the tap; the person sees the new one and taps again
    if (!quoteLive(q, tapMs)) { setQuote({ problem: NATIVE_WORDS.expired, for: amt }); setAgain((n) => n + 1); return; }
    const live = q;
    setSent(live);
    setMade(!sheetsHeard("safe"));
    const off = onOwnApproval((yes) => { if (yes) setMade(true); });
    const seen = (v: SwapView) => { if (v.made || v.state !== "doing") { off(); setMade(true); } setView((was) => (v.made && was ? was : v)); };
    void runSwap({ bridge, tasks, taskId: `native-${side}-${row.assetId}-${tapMs}`, title, usd: usdText, quote: live, tapMs, route: coinRoute({ chain: "intents", assetId: row.assetId, symbol: row.symbol }), onView: seen });
  };
  const big = side === "buy" ? `$${value || "0"}` : usdText;
  // the sell track's thumb: on All, or on the share whose dollars are typed (the chips' own test), else none
  const sellAt = all ? (heldUsd !== undefined ? 2 : 0) : heldUsd !== undefined ? [0.25, 0.5].findIndex((x) => value === (heldUsd * x).toFixed(2)) : -1;
  const coinLogo = <span className="zf-halo zf-halo--big is-on tp-logo"><CoinIcon symbol={row.symbol} {...(logo(row, false) ? { src: logo(row, false)! } : {})} size={56} /></span>;
  return (
    <MoneySheet title={view ? "" : `${side === "buy" ? W.buy : W.sell} ${row.symbol}`} onClose={onClose}>
      <div className="tp nc-sheet" data-testid="native-sheet">
        {view ? (
          // the same sheet becomes the receipt (Trenches' Receipt): the coin, its ring, the chain's answer; where the money
          // is, who swaps it, and what ZeroFee takes; Done lit only once it landed, Try again only once refused
          <div className={`tm tm--${view.state} is-in nc-job`} data-state={view.state} data-testid="native-receipt">
            <Receipt state={view.state === "done" ? "landed" : view.state === "failed" ? "refused" : view.checking ? "checking" : "away"} side={side} coin={row.symbol}
              coinAmount={sent ? trimAmount(side === "buy" ? view.got ?? sent.amountOut : sent.amountIn) : ""} where={W.yourSafeLower} usd={side === "buy" ? usdText : usd(Number(view.got ?? sent?.amountOut ?? 0) || usdIn)}
              {...(view.tookMs !== undefined ? { landedMs: view.tookMs } : {})}
              icon={<CoinIcon symbol={row.symbol} {...(logo(row, false) ? { src: logo(row, false)! } : {})} size={64} />}
              say={view.state === "failed" ? { line: view.line ?? NATIVE_WORDS.declined }
                : view.state === "doing" ? (view.checking ? { line: view.checking } : { chain: W.stays() })
                : side === "sell" ? { line: W.soldInto(usd(Number(view.got ?? sent?.amountOut ?? 0))) } : {}} />
            {view.state === "doing" && !view.checking && made && <>
              <p className="zf-receipt__head" data-testid="native-job-created">{JOB_WORDS.created}</p>
              <TimeLeft etaSec={eta} />
            </>}
            <div className="tr-kvs nc-receipt-kvs">
              <div className="tr-kv"><span>{W.fills}</span><span>{W.filler}</span></div>
              <div className="tr-kv"><span>{W.zeroFee}</span><span>{W.nothing}</span></div>
            </div>
            <div className="tm-floor">
              {view.state === "failed" ? <>
                <button className="zf-btn tm-btn1" onClick={() => { setView(null); setSent(null); setAgain((n) => n + 1); }}>{W.tryAgain}</button>
                <button className="zf-btn zf-btn--quiet tm-btn2" onClick={onClose}>{W.close}</button>
              </> : view.state === "done"
                ? <button className="zf-btn tm-btn1" onClick={onClose}>{W.done}</button>
                : <button className="zf-btn zf-btn--quiet tm-btn2" onClick={onClose}>{W.close}</button>}
            </div>
          </div>
        ) : (<>
          <div className="tp-coin">{coinLogo}</div>
          <div className="tp-amt" aria-label={big} style={{ ["--fs" as string]: `${big.length <= 4 ? 84 : big.length <= 6 ? 70 : big.length <= 8 ? 58 : 46}px` }}><span className={`tp-amt-n${side === "buy" && !isPositive(value) ? " zero" : ""}`}>{big}</span></div>
          <p className="tp-get" aria-live="polite" data-testid="native-about">{capped ? capped : q ? (side === "buy" ? W.about(trimAmount(q.amountOut), row.symbol) : W.aboutCash(usd(Number(q.amountOut)))) : quote.problem && quote.for === amt ? quote.problem : " "}</p>
          <p className="zf-small nc-least" data-testid="native-least">{q && !capped ? W.atLeast(side === "buy" ? `${trimAmount(q.minOut)} ${row.symbol}` : usd(Number(q.minOut)), eta) : " "}</p>
          <p className="tp-pay nc-pay">{side === "buy" ? W.paysWith : W.paysInto}</p>
          {side === "buy" ? (
            <>
              <div className="zf-me__chips tp-chips" role="group" aria-label={W.amount} style={{ ["--n" as string]: BUY_CHIPS.length, ["--at" as string]: Math.max(0, chipAt(BUY_CHIPS, value)) }} data-none={chipAt(BUY_CHIPS, value) < 0 || undefined}>
                <span className="zf-me__thumb" aria-hidden="true" />
                {BUY_CHIPS.map((v) => <button key={v} className={v === value ? "on" : ""} aria-pressed={v === value} onClick={() => { setFresh(true); setValue(v); }}>${v}</button>)}
              </div>
              <div className="tp-pad"><Keypad value={padBase(value, fresh)} decimals={2} onChange={(v) => { setFresh(false); setValue(v); }} /></div>
            </>
          ) : (
            <div className="zf-me__chips tp-chips" role="group" aria-label={W.amount} style={{ ["--n" as string]: heldUsd !== undefined ? 3 : 1, ["--at" as string]: Math.max(0, sellAt) }} data-none={sellAt < 0 || undefined}>
              <span className="zf-me__thumb" aria-hidden="true" />
              {heldUsd !== undefined && [0.25, 0.5].map((x) => <button key={x} className={!all && value === (heldUsd * x).toFixed(2) ? "on" : ""} aria-pressed={!all && value === (heldUsd * x).toFixed(2)} onClick={() => { setAll(false); setValue((heldUsd * x).toFixed(2)); }}>{x * 100}%</button>)}
              <button className={all ? "on" : ""} aria-pressed={all} onClick={() => setAll(true)}>{W.all}</button>
            </div>
          )}
          <p className="zf-small nc-who" data-testid="native-who">{W.who}</p>
          <div className="tp-floor">
            {/* the fee block, right above the button (the copy review, 6 Nov): the figure is this quote's */}
            <div className="zf-fee">
              {figure && <p className="zf-small" data-testid="native-fee">{figure}</p>}
              <p className="zf-small" data-testid="native-paid">{intentsKept(!!figure)}</p>
            </div>
            <button className="zf-btn tr-press tp-go" disabled={!online || !q || !amt || !!capped} onClick={() => void go()}>{online ? title : OFFLINE_SHORT}</button>
          </div>
        </>)}
      </div>
    </MoneySheet>
  );
}
