// The Trade app (V1's shape): its tray (Home, Trade, Activity), the coin page, the result as pushed screens; your wallets are in Wallet's Details (D55)
// (Back, no tray), and the Buy, Sell, Top up and Put away sheets. Its money is Spending's (D52): no set-up, the one engine
// behind it, and the top line reads "Trading $X · per chain". Every Problem goes to the shell's Problem screen; its next
// step is followed here.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { TrayActivity } from "@zerofee/design/icons.tsx";
import type { NextStep, Problem } from "@zerofee/core/problem";
import { spendingProblems } from "@zerofee/core/spending";
import type { AppModule } from "@zerofee/shell-api/app-module";
import { AppFrame, PushedFrame, ShellContext, useShell, type TrayItem } from "@zerofee/shell-api/AppFrame.tsx";
import { setAppHistory } from "@zerofee/shell-api/history-slot.ts";
import type { CoinDetail, CoinRow } from "../market/types.ts";
import { CHAINS, landedMs, type TradeRecord } from "../service.ts";
import { normAddr } from "../market/map.ts";
import { proven } from "../float-view.ts";
import { addRowLine, takeOutRowLine } from "./approval.ts";
import type { ChainId, Side } from "../types.ts";
import { Forward, TrayDiscover, TrayPerps } from "./icons.tsx";
import { PERPS_ON, tabOf, trayTabs, type TradeTab } from "../perps/flag.ts";
import { readRequest, segOfRequest, type TradeSeg } from "./requests.ts";
import { MARKET, TradeProvider, TradeRuntimeContext, useFloat, useTrade } from "./runtime.tsx";
import { Activity } from "./screens/Activity.tsx";
import { Bought } from "./screens/Bought.tsx";
import { CoinPage } from "./screens/CoinPage.tsx";
import { Discover } from "./screens/Discover.tsx";
import type { Win } from "./screens/discover-rules.ts";
import { YourCoins } from "./screens/YourCoins.tsx";
import { MissedOrders } from "./screens/Orders.tsx";
import { bookFor, standingFor } from "./order-book.ts";
import { MissedStanding } from "./screens/Standing.tsx";
import { Receive } from "./screens/Receive.tsx";
import { amount as fmtAmount, usd } from "./format.ts";
import { Settings } from "./screens/Settings.tsx";
import { TradeSheet } from "./screens/TradeSheet.tsx";
import { OFFLINE_WORDS, useOnline } from "./online.ts";
import { askLine, askStart, tradeAsks, type TradeAsk } from "@zerofee/shell-api/trade-ask.ts";
import { backLink, readBack, type BackTo } from "@zerofee/shell-api/back-to.ts";
import { fundAsk } from "./fund-ask.ts";
import { NATIVE_COINS, webWallet } from "@zerofee/shell-api/release.ts";
import { Segmented } from "@zerofee/design/Segmented.tsx";
import "./trade.css";

// the shell checks an ask's chain against these before it switches the person to Trade (trade-ask.ts)
tradeAsks.setListed(MARKET);

// FLOW-V4 (D106): Home is the trading home, so Trade is the market only: Trade (discover any coin, by chain) and
// Activity. Its old Home tab (the balances, Move, Top up) is Wallet's Home now. D119: Perps between them, only when
// PERPS_ON is on (perps/flag.ts); while it is off there is no tab and its screen is never loaded.
type Tab = TradeTab;
const TRAY_ITEMS: Partial<Record<Tab, TrayItem<Tab>>> = {
  trade: { id: "trade", label: "Trade", icon: TrayDiscover },
  ...(PERPS_ON ? { perps: { id: "perps", label: "Perps", icon: TrayPerps } as TrayItem<Tab> } : {}),
  activity: { id: "activity", label: "Activity", icon: TrayActivity },
};
const TRAY: TrayItem<Tab>[] = trayTabs().map((t) => TRAY_ITEMS[t]!);
/** Perps' own screen, a chunk of its own, loaded the first time the tab is opened (never in Home's first load). */
const PerpsTab = PERPS_ON ? lazy(() => import("../perps/PerpsTab.tsx")) : null;
/** Native coins (product decision, 5 Nov, items 4-5): one chunk of its own, loaded the first time the tab or a Safe coin's page
 *  opens; with the switch off (VITE_NATIVE_COINS) the bundler drops it, and nothing of it is shown. */
const NativeList = NATIVE_COINS ? lazy(() => import("../native/NativeScreens.tsx").then((m) => ({ default: m.NativeList }))) : null;
const NativeCoinPage = NATIVE_COINS ? lazy(() => import("../native/NativeScreens.tsx").then((m) => ({ default: m.NativeCoinPage }))) : null;
/** Trade's two tabs (product decision, 5 Nov): Trenches (the memecoin market) and NEAR Intents (the Safe's coins). segOfRequest
 *  (requests.ts) reads a request's name, the old ones too. */
type Seg = TradeSeg;
// tabOf (perps/flag.ts): a tab another app asked for by its older name still opens; "home" is the market now.
/** `ask`: the ask (trade-ask.ts) this coin page was opened for: a new ask on the same coin opens it afresh. */
type View = { kind: "tabs" } | { kind: "coin"; seed: CoinRow; ask?: number; /** opened by another app (Home's Hot coin row): its Back goes there */ back?: BackTo } | { kind: "native"; assetId: string; symbol: string; buy?: boolean; /** opened by another app (Home's Safe row): its Back goes there */ back?: BackTo } | { kind: "done"; rec: TradeRecord } | { kind: "receive"; chain: ChainId } | { kind: "settings" } | { kind: "trades" };
/** `start`: the amount a Buy sheet reopens at. `back`: the Buy sheet a Top up was opened from, reopened when it ends. */
type BuyBack = { side: Side; coin: CoinDetail; value: string };
type SheetState = null | { kind: "trade"; side: Side; coin: CoinDetail; start?: string; asked?: number } | { kind: "move" } | { kind: "receive" };

function TradeScreens() {
  const shell = useShell();
  const { float } = useTrade();
  const online = useOnline();
  const [tab, setTab] = useState<Tab>(tabOf(shell.requestedTab as string | undefined));
  const [view, setView] = useState<View>({ kind: "tabs" });
  /** The chain the market opens on (a Home row's request), and a count so asking for the same one again resets it. */
  const [market, setMarketState] = useState<{ chain: ChainId | "all"; n: number }>({ chain: "all", n: 0 });
  const setMarket = (chain: ChainId | "all") => setMarketState((m) => ({ chain, n: m.n + 1 }));
  /** The chain tab the market shows now (Discover's own tabs): the row line and your coins are that chain's, never the
   *  row that opened Trade (3 Nov e2e walk, 82); on All, none. */
  const [shown, setShown] = useState<ChainId | "all">("all");
  /** The list the market shows (Hot, New, 5m…): Back from a coin keeps it (QA's re-test: it reset to Hot). */
  const [win, setWin] = useState<Win>("trending");
  /** Trenches (today's Trade) or NEAR Intents (the Safe's coins), only with the switch on. */
  const [seg, setSeg] = useState<Seg>("trenches");
  const [sheet, setSheet] = useState<SheetState>(null);
  // an ask from another app (AgentZero, trade-ask.ts): the coin it named, its page to open, ended exactly once
  const [asked, setAsked] = useState<{ seq: number; ask: TradeAsk; opened?: true } | null>(null);
  const endAsk = (end: { went: boolean; tradeId?: string; landedMs?: number; refused?: string }) => { if (asked) { tradeAsks.end(asked.seq, end); setAsked(null); } };
  // a Safe coin's Buy or Sell left running by a reload ends from the ledger's own record (sandbox hunt B3); its own chunk,
  // loaded only when this phone still follows one
  useEffect(() => {
    if (!NATIVE_COINS) return;
    try { if (!globalThis.localStorage?.getItem("zf.trade.native-jobs")?.includes("moveId")) return; } catch { return; }
    void import("../native/swap.ts").then((m) => m.resumeSwapJobs({ bridge: shell.bridge, tasks: shell.tasks }), () => undefined);
  }, []);
  /** One wallet per chain (D55): every wallet is listed in one place, Wallet's Details. */
  // Your wallets is Home's Details; its Back comes back to Trade's Settings, never Home (k-trade crawl, 4 Nov, S3)
  const seeWallets = () => shell.openApp("wallet", "details", backLink({ app: "trade", tab: "settings" }));
  // where another app asked Trade to open (openApp("trade", tab)), on every new request: a tray tab by its name, or one
  // of Trade's own screens: "wallets" (your wallets: Wallet's Details, D55), "takeout" (Put away, Everything)
  useEffect(() => {
    const t = shell.requestedTab;
    if (!t) return;
    if (t === "ask") {
      const a = tradeAsks.take();
      if (!a) return;
      if (asked) tradeAsks.end(asked.seq, { went: false });
      if (!MARKET.includes(a.ask.chain)) { tradeAsks.end(a.seq, { went: false, refused: "Trade doesn't trade on that chain yet." }); return; }
      setSheet(null);
      setAsked(a);
      // the coin in the market's own form (a checksummed 0x is lower case there): held, sending and the position all match
      setView({ kind: "coin", seed: { chain: a.ask.chain, address: normAddr(a.ask.chain, a.ask.address), symbol: "", name: "" }, ask: a.seq });
    }
    else if (t === "wallets") { setSheet(null); seeWallets(); }
    else if (t === "settings") { setSheet(null); setView({ kind: "settings" }); }
    // a tab by name: "intents" (Home's Safe "Buy", still sent as "native") or "trenches"; the switch off: Trenches
    else if (segOfRequest(t)) { setSheet(null); setView({ kind: "tabs" }); setTab("trade"); setSeg(NATIVE_COINS ? segOfRequest(t)! : "trenches"); }
    else if (t === "takeout") { setView({ kind: "tabs" }); setTab("trade"); setSheet(null); shell.openMoney({ kind: "putaway" }); }
    else if (t.startsWith("market:") || t.startsWith("coin:")) {
      // Home V4's rows: a chain's market, or a held coin's page; anything that doesn't read cleanly is the market
      const r = readRequest(t);
      setSheet(null);
      // test (5 Nov): a coin page opened from Home's Hot side went Back to Trade's list; Back goes to the app that asked
      if ("coin" in r) { const back = readBack(shell.requestedLink); setView({ kind: "coin", seed: r.coin, ...(back ? { back } : {}) }); }
      // a Safe coin (Home's Safe rows): its page with the switch on, else the market, never an error
      // Home's coin page (QA's QA re-check, item 10: its Back landed on Trade): Back goes to the app that asked
      else if ("native" in r) { const back = readBack(shell.requestedLink); if (NATIVE_COINS) setView({ kind: "native", assetId: r.native.assetId, symbol: r.native.symbol, ...(back ? { back } : {}) }); else { setView({ kind: "tabs" }); setTab("trade"); setMarket("all"); } }
      else { setView({ kind: "tabs" }); setTab("trade"); setSeg("trenches"); setMarket(r.market); }
    }
    else { setSheet(null); setView({ kind: "tabs" }); setTab(tabOf(t)); }
  }, [shell.requestSeq, shell.requestedTab]);
  // T-1: price orders are looked at every 5 s while Trade is on screen and the page is visible; leaving forgets what
  // was seen (orders.ts pause), so a cross while away asks instead of running
  const rt = useTrade();
  const book = bookFor(rt, shell.bridge);
  const plans = standingFor(rt, shell.bridge);
  useEffect(() => {
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    if (!shell.active) { book.pause(); plans.pause(); return; }
    // timers that froze (a suspended phone, the page still "visible") forget what was seen first (review L3)
    let last = Date.now();
    const look = () => { if (Date.now() - last > 15_000) { book.pause(); plans.pause(); } last = Date.now(); if (visible()) { void book.tick().catch(() => undefined); void plans.tick().catch(() => undefined); } };
    const away = () => { if (!visible()) { book.pause(); plans.pause(); } };
    look();
    const t = setInterval(look, 5_000);
    document.addEventListener("visibilitychange", away);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", away); book.pause(); plans.pause(); };
  }, [shell.active, book, plans]);
  // One Activity (D144): the header's Activity centre draws Trade's trades under Home's history, with Trade's name over
  // them (history-slot.ts). Drawn outside this tree, so it carries Trade's runtime and shell; handed again on every render
  // (fresh rows), cleared when Trade goes. "Your trades" in settings stays the same list.
  useEffect(() => {
    setAppHistory("trade", () => (
      <ShellContext.Provider value={shell}>
        <TradeRuntimeContext.Provider value={rt}><Activity tradesOnly /></TradeRuntimeContext.Provider>
      </ShellContext.Provider>
    ));
  });
  useEffect(() => () => setAppHistory("trade", null), []);
  // Spending is read before the tabs draw: before that its total reads $0 (re-walk.1)
  const floatSnap = useFloat().snap;

  /** A test account (testnet), read once from the core: Spending moves real money only (grade 02h, H4). */
  const testAccount = useRef<Promise<boolean> | null>(null);
  const isTest = () => (testAccount.current ??= shell.bridge.call<{ account?: { network?: string } }>("account.state").then((r) => "ok" in r && r.ok.account?.network === "testnet", () => false));
  useEffect(() => void isTest(), [shell.bridge]);
  /** Top up: on a test account the refusal comes on the first tap, with where the money is (grade 02h, H4: four taps
   *  and a $500 default before "This is a test account", which never said the money hadn't moved). */
  /** Top up (Job 1): the one money sheet, in place over Trade; from the Buy sheet, back to it as it was when it ends. */
  const openTopUp = async (back?: BuyBack) => {
    if (await isTest()) { setSheet(null); await onProblem(spendingProblems.testAccount()); return; }
    setSheet(null);
    shell.openMoney({ kind: "topup" }, () => { if (back) setSheet({ kind: "trade", side: back.side, coin: back.coin, start: back.value }); });
  };

  /** The Buy sheet's "Move money to <its wallet>": Home's Move to that wallet at the buy's dollars (fund-ask.ts), and
   *  back to the Buy sheet when it ends, done or not. */
  const openMove = async (back?: BuyBack) => {
    if (await isTest()) { setSheet(null); await onProblem(spendingProblems.testAccount()); return; }
    setSheet(null);
    // the web wallet has no Move (a web test, 4 Nov: a $0 Buy said "Move money…"): Add, set to the buy's own wallet
    if (webWallet()) return void shell.openMoney({ kind: "receive", ...(back && ["sol", "hood", "bsc"].includes(back.coin.chain) ? { wallet: back.coin.chain as "sol" } : {}) }, () => { if (back) setSheet({ kind: "trade", side: back.side, coin: back.coin, start: back.value }); });
    // Trade's own Move (4 Nov: a job is made at once): Home's Move sheet ends the moment it is on its way
    shell.openMoney(back ? fundAsk(back.coin.chain, back.value) : { kind: "move", quick: true }, () => { if (back) setSheet({ kind: "trade", side: back.side, coin: back.coin, start: back.value }); });
  };

  /** One of Trade's own screens, by the name a Problem's step gives it; false when it isn't one. */
  /** `from`: the Buy sheet asking (its coin and amount): a Top up from it goes back to it when it ends, done or not (UX
   *  walk 2 Nov: after the Top up the person had to find the coin and type the amount again). */
  const openScreen = (screen: string, from?: BuyBack): boolean => {
    if (screen === "fund" || screen === "add" || screen === "spending-topup") { void openTopUp(from); return true; }
    if (screen === "move") { void openMove(from); return true; }
    if (screen === "wallets") { setSheet(null); seeWallets(); return true; }
    if (screen === "settings") { setSheet(null); setView({ kind: "settings" }); return true; }
    if (screen === "search") { setSheet(null); setView({ kind: "tabs" }); setTab("trade"); return true; }
    return false;
  };
  const onProblem = async (p: Problem): Promise<NextStep> => {
    const next = await shell.showProblem(p);
    if (next.kind === "open") openScreen(next.screen);
    return next;
  };
  // an ask ends whenever its page stops being the one shown (Top up, Settings, the market, another tab, Back): never a
  // live ask left behind to come back on its own later (review M4). A trade that went has ended it already (onDone).
  useEffect(() => {
    if (!asked) return;
    const onPage = view.kind === "coin" && view.ask === asked.seq && (asked.opened ? sheet?.kind === "trade" && sheet.asked === asked.seq : !sheet);
    if (!onPage) endAsk({ went: false });
  }, [asked, view, sheet]);
  const openCoin = (seed: CoinRow) => setView({ kind: "coin", seed });
  /** Buy or Sell, the person's own tap on the coin page. */
  const openTrade = (side: Side, coin: CoinDetail) => setSheet({ kind: "trade", side, coin });
  /** The page an ask named, opened by the coin page once the coin is read: at the ask's amount, marked as filled in. A
   *  coin that isn't the one asked for ends the ask and opens nothing (re-review L: it fell through to a plain sheet). */
  const openAsked = (side: Side, coin: CoinDetail) => {
    // the coin page holds EVM addresses in lower case, an ask may be checksummed: compared the same way (review H2)
    if (asked && !asked.opened && asked.ask.side === side && asked.ask.chain === coin.chain && normAddr(coin.chain, asked.ask.address) === normAddr(coin.chain, coin.address)) {
      const start = askStart(asked.ask);
      setAsked({ ...asked, opened: true });
      setSheet({ kind: "trade", side, coin, asked: asked.seq, ...(start ? { start } : {}) });
      return;
    }
    endAsk({ went: false, refused: "That isn't the coin AgentZero asked for." });
  };
  // Trade going away (the lock, leaving the account) ends its ask, and with it any hold (re-review M3)
  const askedNow = useRef(asked);
  askedNow.current = asked;
  useEffect(() => () => { const a = askedNow.current; if (a) tradeAsks.end(a.seq, { went: false }); }, []);

  // offline (A10): one plain line at the top of whichever screen is up, under its header
  const offline = !online && <div className="tr-offline" role="status">{OFFLINE_WORDS}</div>;
  let body;
  if (view.kind === "native" && NativeCoinPage) {
    body = (
      <PushedFrame name={view.symbol} onBack={() => { const back = view.back; setView({ kind: "tabs" }); if (back) shell.openApp(back.app, back.tab); }}>
        {offline}
        <Suspense fallback={null}><NativeCoinPage key={view.assetId} assetId={view.assetId} symbol={view.symbol} {...(view.buy ? { buy: true } : {})} /></Suspense>
      </PushedFrame>
    );
  } else if (view.kind === "coin") {
    body = (
      <PushedFrame name={view.seed.symbol} onBack={() => { const back = view.back; if (asked && !asked.opened) endAsk({ went: false }); setView({ kind: "tabs" }); if (back) shell.openApp(back.app, back.tab); }}>
        {offline}
        <CoinPage key={`${view.seed.chain}:${view.seed.address}:${view.ask ?? ""}`} seed={view.seed} onBuy={(coin) => openTrade("buy", coin)} onSell={(coin) => openTrade("sell", coin)}
          {...(asked && !asked.opened && !sheet && view.ask === asked.seq ? {
            auto: asked.ask.side,
            onAuto: openAsked,
            onAutoFail: (why: string) => endAsk({ went: false, refused: why }),
          } : {})} />
      </PushedFrame>
    );
  } else if (view.kind === "receive") {
    const done = () => setView({ kind: "tabs" });
    body = (
      <PushedFrame name={`Receive on ${CHAINS[view.chain].name}`} onBack={() => setView({ kind: "tabs" })}>
        {offline}
        <Receive chain={view.chain} onDone={done} onProblem={onProblem} />
      </PushedFrame>
    );
  } else if (view.kind === "tabs" && !floatSnap.loaded && !floatSnap.unread) {
    // the app's own frame at once, with quiet rows where the list comes: never a blank screen while Trade reads its state
    body = (
      <AppFrame name="Trade" tray={TRAY} tab={tab} onTab={setTab}>
        <div className="tr-skel" aria-busy="true" aria-label="Loading">
          <span className="tr-skel-bar tr-skel-big" />
          {[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className="tr-skel-row"><span className="tr-skel-dot" /><span className="tr-skel-bar" /></span>)}
        </div>
      </AppFrame>
    );
  } else if (view.kind === "settings") {
    body = (
      <PushedFrame name="Settings" onBack={() => setView({ kind: "tabs" })}>
        {offline}
        <Settings onWallets={seeWallets} onTrades={() => setView({ kind: "trades" })} />
      </PushedFrame>
    );
  } else if (view.kind === "trades") {
    // the trade history (UX audit 4 Nov, one Activity: no tab of its own; what is going on is the header's centre)
    body = (
      <PushedFrame name="Your trades" onBack={() => setView({ kind: "settings" })}>
        {offline}
        <Activity />
      </PushedFrame>
    );
  } else if (view.kind === "done") {
    const rec = view.rec;
    body = (
      <PushedFrame name={rec.kind === "buy" ? "Bought" : "Sold"} onBack={() => setView({ kind: "tabs" })}>
        {offline}
        <Bought rec={rec} onDone={() => setView({ kind: "tabs" })} onPosition={() => (rec.coin ? openCoin({ chain: rec.chain, address: rec.coin, symbol: rec.symbol, name: rec.symbol }) : (setView({ kind: "tabs" }), setTab("trade")))} />
      </PushedFrame>
    );
  } else {
    body = (
      <AppFrame name="Trade" tray={TRAY} tab={tab} onTab={setTab}>
        {offline}
        {/* FLOW-V4: the market only; the balances are Wallet's Home. Settings stay one tap away. */}
        {tab === "trade" && NativeList && <Segmented className="tr-native-seg" label="Coins" items={[{ id: "trenches", label: NATIVE_COPY.trenches }, { id: "intents", label: NATIVE_COPY.intents }]} value={seg} onChange={setSeg} />}
        {tab === "trade" && NativeList && seg === "intents" && <Suspense fallback={null}><NativeList onCoin={(r, buy) => setView({ kind: "native", assetId: r.assetId, symbol: r.symbol, ...(buy ? { buy: true } : {}) })} /></Suspense>}
        {tab === "trade" && seg === "trenches" && <MissedOrders />}
        {tab === "trade" && seg === "trenches" && <MissedStanding />}
        {/* the wallet's balance is its chip at the top of Discover now (D129, D136); its coins follow */}
        {/* T-5: the coins held on that chain, with their result since bought */}
        {tab === "trade" && seg === "trenches" && shown !== "all" && <YourCoins key={`coins:${shown}`} chain={shown} onCoin={openCoin} />}
        {tab === "trade" && seg === "trenches" && <Discover key={market.n} chain={market.chain} onCoin={openCoin} onChain={setShown} win={win} onWin={setWin} onSettings={() => setView({ kind: "settings" })} {...(webWallet() ? {} : { onMove: () => void openMove() })} />}
        {PerpsTab && tab === "perps" && <Suspense fallback={null}><PerpsTab /></Suspense>}
        {tab === "activity" && <Activity />}
      </AppFrame>
    );
  }
  return (
    <div className="tr-app">
      {body}
      {sheet?.kind === "trade" && (
        <TradeSheet key={`${sheet.side}:${sheet.coin.chain}:${sheet.coin.address}:${sheet.asked ?? ""}`} side={sheet.side} coin={sheet.coin} {...(sheet.start ? { start: sheet.start } : {})} {...(sheet.asked !== undefined && asked ? { filledBy: askLine(asked.ask), onBusy: (b: boolean) => tradeAsks.hold(sheet.asked!, b) } : {})}
          onClose={() => { if (sheet.asked !== undefined) endAsk({ went: false }); setSheet(null); }} onProblem={onProblem} onOpen={(screen, value) => openScreen(screen, { side: sheet.side, coin: sheet.coin, value })}
          onDone={(rec, value) => {
            if (sheet.asked !== undefined) { const ms = landedMs(rec); endAsk({ went: true, tradeId: rec.id, ...(ms !== undefined ? { landedMs: ms } : {}) }); }
            // the trade counts toward rotating that chain's wallet, and the planner looks again (a sale's money moves on)
            if (rec.chain === "sol" || rec.chain === "hood" || rec.chain === "bsc") void float.traded(rec.chain).catch(() => undefined);
            // the page stays as the trade's receipt until Close (TRADE-A-PLUS 8, 12): no toast over it, said once
          }}
          onSwitch={(side) => setSheet({ kind: "trade", side, coin: sheet.coin })} />
      )}
      {sheet?.kind === "move" && (
        <Sheet title="Move" onClose={() => setSheet(null)}>
          <div className="tr-movechoose">
            {/* the web wallet (product decision, 4 Nov) has no Safe: money comes in by Add */}
            {webWallet() ? <button className="zf-row" onClick={() => void openTopUp()}><span><span className="t">Add money</span><span className="d">From any wallet or exchange</span></span><Forward /></button> : <>
            <button className="zf-row" onClick={() => void openTopUp()}><span><span className="t">Move from your Safe</span><span className="d">{addRowLine()}</span></span><Forward /></button>
            <button className="zf-row" onClick={() => { setSheet(null); shell.openMoney({ kind: "putaway" }); }}><span><span className="t">Move to your Safe</span><span className="d">{takeOutRowLine()}</span></span><Forward /></button>
            <button className="zf-row" onClick={() => { setSheet(null); seeWallets(); }}><span><span className="t">See your wallets</span><span className="d">In Wallet's Details</span></span><Forward /></button>
            </>}
          </div>
        </Sheet>
      )}
      {sheet?.kind === "receive" && (
        // Receive (re-walk): each chain's own trading wallet, titled for its chain, and the vault's any-coin address
        <Sheet title="Receive" onClose={() => setSheet(null)}>
          <div className="tr-movechoose">
            {/* H31: only chains Trade offers; a way in to BNB with no way out would be a one-way door */}
            {(["sol", "hood", "bsc"] as const).filter(proven).map((c) => (
              <button key={c} className="zf-row" onClick={() => { setSheet(null); setView({ kind: "receive", chain: c }); }}><span><span className="t">On {CHAINS[c].name}</span><span className="d">{CHAINS[c].symbol} to your Spending wallet on {CHAINS[c].name}</span></span><Forward /></button>
            ))}
            {!webWallet() && <button className="zf-row" onClick={() => { setSheet(null); shell.openMoney({ kind: "receive" }); }}><span><span className="t">To your Safe</span><span className="d">Any coin, on any network your Safe takes</span></span><Forward /></button>}
          </div>
        </Sheet>
      )}
    </div>
  );
}

export function TradeRoot() {
  const { bridge, active } = useShell();
  return <TradeProvider bridge={bridge} active={active}><TradeScreens /></TradeProvider>;
}

import { boughtLineOf } from "../bought-line.ts";
import { NATIVE_COPY } from "../native/words.ts";
/** The one line after a trade (bought-line.ts). */
export const boughtLine = boughtLineOf;

export const tradeApp: AppModule = { id: "trade", name: "Trade", line: "Buy and sell coins", Root: TradeRoot };
