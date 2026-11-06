// Home (Job 1, the spine): the Wallet app with Security inside it, the hub (D51, D52). The ZeroFee mark stands at its
// top (B18); its one screen is the money, then the account's rows (Protection, Devices, Recovery, from the shell through
// HomeSlots) and Activity, each one tap to its own screen. Activity has two parts, Money and Account (what the account
// itself did, who approved it). Convert joins Home as a section once the test mainnet proof opens a 1Click route in
// CONVERT_ROUTES (D13: nothing on screen that doesn't work).
// Balance shows the two pots, Safe and Spending; Top up, Put away and the cap are sheets over it; Details, a coin, Send
// and Receive are pushed screens (Back, no tray). Send, Receive and Withdraw live here (D48: Pay folds into Wallet;
// openApp("pay", …) lands here, AppHost). A request the account's protection holds goes to the shell's waiting screen
// (D17). Every Problem goes to the shell's Problem screen, and its next step is followed here. First open with an empty
// balance: the set-up journey (D21), forced with openApp("wallet", "setup") or ?setup=wallet (so ?demo, whose sample
// isn't empty, can walk it). Private (D27) is a row on Balance with its own screen, shown only once this phone can use it.
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import type { NextStep, Problem } from "@zerofee/core/problem";
import { Mark } from "@zerofee/design/Mark.tsx";
import { Segmented } from "@zerofee/design/Segmented.tsx";
import { accountPlaceOf, useHomeSlots, type AccountPlace } from "@zerofee/shell-api/home-slots.ts";
import { Waiting } from "./Waiting.tsx";
import type { AppModule } from "@zerofee/shell-api/app-module.ts";
import { AppFrame, PushedFrame, useShell, type TrayItem } from "@zerofee/shell-api/AppFrame.tsx";
import { CONVERT_ROUTES } from "../convert.ts";
import type { Balance, Chain, Movement } from "../types.ts";
import { amountOf, chainName, placeOf, receiveChainFor, titleOf, type Line } from "./format.ts";
import { TrayBalance, TrayConvert } from "./icons.tsx";
import { WalletProvider, WalletRuntimeContext, useWallet } from "./runtime.tsx";
import { setHistory } from "@zerofee/shell-api/history-slot.ts";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import { sealJobs } from "@zerofee/shell-api/job-start.ts";
import { ShellContext } from "@zerofee/shell-api/shell-context.ts";
import { later } from "./later.tsx";
import { FRESH, loadSetup, nextStep, saveSetup, type SetupState } from "./setup.ts";
/** A coin's own page: its code loads with Home (after the first paint) or its first tap, drawn the moment it is here. */
const Coin = later<Parameters<typeof import("./screens/Coin.tsx").Coin>[0]>(
  () => import("./screens/Coin.tsx").then((m) => m.Coin),
  () => <p className="zf-small" role="status">Opening…</p>,
  () => <p className="zf-small" role="status">This didn't open. <button className="zf-link" onClick={() => location.reload()}>Try again</button></p>,
);
import { Home } from "./screens/Home.tsx";
import { privateDoor, safeCoinRoute } from "./screens/safe-hot.ts";
import { NavRow } from "./screens/NavRow.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { NATIVE_COINS, onDemoPage, privateOpen, webWallet } from "@zerofee/shell-api/release.ts";
import { onPhone } from "@zerofee/shell-api/approval-words.ts";
import { settingsLine } from "./settings-line.ts";
import { OnYourPhone } from "@zerofee/shell-api/OnYourPhone.tsx";
import { askedUsd, backLink, readBack, type BackTo } from "@zerofee/shell-api/back-to.ts";
import { TEST_NOTE, dismissNote, isTestNote, noteDismissed } from "./test-note.ts";
import { codeGate } from "./money/code-gate.ts";
import { watchSwapEnds } from "./money/swap-ended.ts";
/** The pickers (a network, a coin to convert or move): asked for when one opens, outside Home's first load (the speed
 *  budget); drawn the moment their code is here. */
const pickers = codeGate(() => import("./screens/Sheets.tsx"));
import type { StatementSheet as StatementSheetType } from "./screens/StatementSheet.tsx";

/** The first-run steps (D21), only for an account with no money yet: loaded when shown, never in Home's first load
 *  (O-2c trimmed it out to keep Home within its budget, measured: 11 KB). */
const Setup = lazy(() => import("./screens/Setup.tsx").then((m) => ({ default: m.Setup })));
/** Activity (its rows, one move one row) loads when opened, never in Home's first load (speed budget, 3 Nov). */
// a chunk that didn't load (offline, a new version) says so here, never takes Wallet down (security review, Low)
// drawn the moment its code is here (later.tsx: never Suspense's 300 ms hold on a chunk that took tens of ms)
const Activity = later<Parameters<typeof import("./screens/Activity.tsx").Activity>[0]>(
  () => import("./screens/Activity.tsx").then((m) => m.Activity),
  () => <p className="zf-small" role="status">Reading your activity…</p>,
  () => <p className="zf-small" role="status">Activity didn't open. <button className="zf-link" onClick={() => location.reload()}>Try again</button></p>,
);
/** Home's address card at a wallet tab's top (D127): its one-time address, loaded with the tab, never in Home's first
 *  load; a chunk that didn't load draws nothing (never the wallet's public address). */
const AddressCard = lazy(() => import("./money/AddressCard.tsx").then((m) => ({ default: m.AddressCard }), () => ({ default: () => null })));
/** Convert (its own tab, shown only once CONVERT_OPEN) loads when opened, never in Home's first load (Home shell 2, 3 Nov:
 *  main grew past the budget under it). A chunk that didn't load says so. */
const Convert = lazy(() => import("./screens/Convert.tsx").then((m) => ({ default: m.Convert }), () => ({ default: () => <p className="zf-small" role="status">Convert didn't open. <button className="zf-link" onClick={() => location.reload()}>Try again</button></p> })));
/** The private pocket's own screens (no place on Home since D128, reached from Details) load when opened, never in Home's
 *  first load (home/words, 3 Nov: D132's server-limit line needed the room). A chunk that didn't load says so. */
const privateDidntLoad = () => ({ default: () => <p className="zf-small" role="status">This didn't open. <button className="zf-link" onClick={() => location.reload()}>Try again</button></p> });
const PrivateScreen = lazy(() => import("./screens/Private.tsx").then((m) => ({ default: m.PrivateScreen }), privateDidntLoad));
const AddToPrivate = lazy(() => import("./screens/Private.tsx").then((m) => ({ default: m.AddToPrivate }), privateDidntLoad));
/** A coin that can move into the pocket: listed, NEAR's own, not already there (Private.tsx's rule, kept here so the
 *  screen itself loads later). */
const canGoPrivate = (b: Balance) => b.listed !== false && b.held !== "private" && b.chain === "near" && !b.bridged;
/** Details (every wallet's full address) loads when opened, never in Home's first load (Home's wallet bar, 3 Nov: the
 *  room it needed). A chunk that didn't load says so, as Activity's does. */
// Receive (the networks list behind Add's "another network") loads when opened: Home's first load stays in its budget.
const Receive = lazy(() => import("./screens/Receive.tsx").then((m) => ({ default: m.Receive }), () => ({ default: () => <p className="zf-small" role="status">Receive didn't load. Close it and open it again.</p> })));
/** The web wallet's Details (its wallets' addresses, no Safe, no key export): loaded when opened, on the web only. */
const WebDetailsPage = lazy(() => import("./screens/WebDetails.tsx").then((m) => ({ default: m.WebDetailsPage }), () => ({ default: () => <p className="zf-small" role="status">Details didn't open. <button className="zf-link" onClick={() => location.reload()}>Try again</button></p> })));
const Details = lazy(() => import("./screens/Details.tsx").then((m) => ({ default: m.Details }), () => ({ default: () => <p className="zf-small" role="status">Details didn't open. <button className="zf-link" onClick={() => location.reload()}>Try again</button></p> })));
import "./wallet.css";

type Tab = "balance" | "convert";
/** Shut until the test dust proof opens a route (convert.ts). */
const CONVERT_OPEN = CONVERT_ROUTES.intents || CONVERT_ROUTES.nearOrigin;
/** Home's own sections: none (one screen) until Convert opens. */
const TRAY: TrayItem<Tab>[] = CONVERT_OPEN ? [{ id: "balance", label: "Balance", icon: TrayBalance }, { id: "convert", label: "Convert", icon: TrayConvert }] : [];
/** The coins most people convert into, first in the picker. */
const POPULAR = [
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "nep141:usdt.tether-token.near", "nep141:wrap.near",
  "nep141:sol.omft.near", "nep141:eth.omft.near", "nep141:btc.omft.near", "nep245:v2_1.omni.hot.tg:56_11111111111111111111",
];
/** k-security crawl (4 Nov, S4) and sd-security (e): the Settings row says what that Settings holds (settings-line.ts). */
const SETTINGS_LINE = settingsLine({ phone: onPhone(), webWallet: webWallet(), sim: onDemoPage() });
type View = { kind: "tabs" } | { kind: "activity"; part?: "money" | "account"; open?: string; fromAccount?: boolean } | { kind: "place"; place: AccountPlace; step?: string; fromAccount?: boolean } | { kind: "send" } | { kind: "details"; /** the app that opened it (Trade's Your wallets): its Back goes back there */ back?: BackTo; fromAccount?: boolean } | { kind: "coin"; line: Line } | { kind: "receive"; fromSetup?: SetupState } | { kind: "setup"; state: SetupState } | { kind: "private" } | { kind: "toPrivate" } | { kind: "phone"; reason: "safe" | "private" };
/** Details, opened by another app's link (backLink): Back goes back to the app and page it names; none, Home. */
export function detailsFor(link: string | undefined): View {
  const back = readBack(link);
  return back ? { kind: "details", back } : { kind: "details" };
}
/** The set-up journey asked for by the page itself (?setup=wallet), for the demo. */
const setupInUrl = () => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "").get("setup") === "wallet";
  } catch {
    return false;
  }
};

function WalletScreens() {
  const shell = useShell();
  // the web wallet (product decision, 4 Nov) has no Safe: none of Security's places (Devices, Protection, the recovery
  // wait, the account's steps) shows, and no Details (its key export asks no password; Settings' asks it)
  const web = webWallet();
  const homeSlots = useHomeSlots();
  const slots: typeof homeSlots = web ? {} : homeSlots;
  // the web wallet's own account rows (bug report, 5 Nov late): the phone's first card, each saying what this browser has;
  // set by the shell only on the web wallet, never read on the phone or the Sim
  const webRows = web ? homeSlots.webRows : undefined;
  const [webSheet, setWebSheet] = useState<AccountPlace | null>(null);
  const { bridge, chains, tokens, balances, balanceProblem, earning, pocket, spending, refresh } = useWallet();
  // The one Activity (D144, the design review §4.7): the Activity centre draws Home's money history under Now. It is drawn
  // outside this tree, so it carries this screen's runtime and shell with it; its pages (a row's detail, the statement)
  // draw over the centre. Handed again on every render, so the centre shows fresh figures; cleared when Home goes.
  const runtime = useWallet();
  const historyPart = useRef<"money" | "account">("money");
  useEffect(() => {
    setHistory((overlay, closeCentre) => (
      <ShellContext.Provider value={shell}>
        <WalletRuntimeContext.Provider value={runtime}>
          <HistoryPart overlay={overlay} close={closeCentre} part={historyPart} account={slots.accountActivity}
            onProblem={(p) => { closeCentre(); void problem(p); }} onHeld={(h) => { closeCentre(); shell.showWaiting(h); }} />
        </WalletRuntimeContext.Provider>
      </ShellContext.Provider>
    ));
  });
  useEffect(() => () => setHistory(null), []);
  // a swap in place still running when the page went (a reload mid-swap, bug hunt item 3) is picked up from the core's own
  // moves and followed to its end, once the job rows are back from Home's sealed store (sealJobs: until then this page has
  // none); its code loads only when there is one
  useEffect(() => {
    void sealJobs(bridge).then(() => {
      const pending = taskStore().list().filter((t) => t.app === "home" && t.state === "pending" && t.id.startsWith("swap:"));
      if (pending.length) void import("./money/swap-inplace.ts").then((m) => m.resumeInplace({ bridge, tasks: shell.tasks, pending }), () => undefined);
    }, () => undefined);
  }, []);
  // however it was followed, a swap in place's end reads the money again at once (real-tap proof, 6 Nov: after a reload nothing did)
  const readAgain = useRef(refresh);
  readAgain.current = refresh;
  useEffect(() => watchSwapEnds(taskStore(), () => readAgain.current()), []);
  const asked = shell.requestedTab;
  const [tab, setTab] = useState<Tab>("balance");
  /** A Security place asked for ("security/protection"): that place inside Home; "security/activity": Activity's Account. */
  const viewFor = (t: string | undefined): View | null => {
    const at = accountPlaceOf(t);
    if (at === "home") return { kind: "tabs" };
    // the web wallet: a way in to the Safe's places or Private is its On your phone page
    // Send's "Top up Private" (copy review, 5 Nov: the fill shut): the fill itself, Safe → Private; the web wallet, its phone page
    if (t === "private/add") return web ? { kind: "phone", reason: "private" } : privateOpen() ? { kind: "toPrivate" } : null;
    if (web && (at || t === "private")) return { kind: "phone", reason: t === "private" ? "private" : "safe" };
    if (at === "activity") return { kind: "activity", part: "account" };
    if (at) return slots.place ? { kind: "place", place: at.place, ...(at.step ? { step: at.step } : {}) } : { kind: "tabs" };
    if (t === "private" && privateOpen()) return { kind: "private" };
    // the Activity centre's task (live-steps.ts taskOf): "activity:move:<id>" opens Activity on that item's page
    if (t?.startsWith("activity:")) return { kind: "activity", open: t.slice("activity:".length) };
    return t === "activity" ? { kind: "activity" } : null;
  };
  const [view, setView] = useState<View>(() => viewFor(asked) ?? (asked === "details" && !web ? detailsFor(shell.requestedLink) : { kind: "tabs" }));
  const [over, setOver] = useState<ReactNode>(null);
  useEffect(() => Coin.preload(), []);
  const [sheet, setSheet] = useState<null | "add" | "chains" | "from" | "to" | "privateFrom" | "account">(null);
  const [Pick, setPick] = useState(() => pickers.here());
  useEffect(() => { if (sheet && sheet !== "account" && !Pick) void pickers.load().then((m) => setPick(() => m), () => undefined); }, [sheet]);
  // H-3: the statement sheet, over the whole app as the account sheet is; it loads on its first tap (Activity's own load
  // stays small) and a load that fails says so on its row
  const [Statement, setStatement] = useState<typeof StatementSheetType | 0 | null>(null);
  const openStatement = () => void import("./screens/StatementSheet.tsx").then((m) => setStatement(() => m.StatementSheet), () => setStatement(0));
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [chainId, setChainId] = useState("near");
  /** A network was picked before (here or in Pay's Receive): Add money offers the choice; else it opens on NEAR's QR. */
  const [picked, setPicked] = useState(false);
  const [fromKey, setFromKey] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  /** A test account: one quiet line on top of Wallet instead of a sheet, until a tap dismisses it (remembered on the phone). */
  const [testNote, setTestNote] = useState(false);
  const [noteGone, setNoteGone] = useState(true);
  useEffect(() => {
    let live = true;
    void noteDismissed(bridge).then((gone) => live && setNoteGone(gone));
    return () => { live = false; };
  }, [bridge]);

  // A network another app asked for wins over the one remembered, whichever answer comes first. Read again each time
  // Wallet comes on screen: Pay's Receive (D29) may have picked another meanwhile.
  const linkedChain = useRef(false);
  useEffect(() => {
    if (!shell.active) return;
    void bridge.call<{ chain: string | null }>("ledger.receiveChain").then((r) => {
      if (!("ok" in r) || !r.ok.chain) return;
      setPicked(true);
      if (!linkedChain.current) setChainId(r.ok.chain);
    });
  }, [bridge, shell.active]);
  // Coming back on screen, everything is read again: a trade in Trade moves "In trading" without telling the ledger.
  const wasActive = useRef(shell.active);
  useEffect(() => {
    if (shell.active && !wasActive.current) refresh();
    wasActive.current = shell.active;
  }, [shell.active]);
  useEffect(() => {
    // Another app's Send, Add money or Top up (an old link, a Problem's step): the one money sheet, over Home (Job 1).
    if (asked === "receive") shell.openMoney({ kind: "receive", ...(shell.requestedLink ? { link: shell.requestedLink } : {}) });
    if (asked === "send") shell.openMoney({ kind: "send", ...(shell.requestedLink ? { link: shell.requestedLink } : {}) });
    // Another app's "Top up Spending" (Apps, a site short of cash): Wallet's own Top up sheet, over Balance.
    // Its OK, its close and its Done go back to that app's page (grade 02g, G6), never leave the person on Wallet.
    if (asked === "topup") {
      const usd = askedUsd(shell.requestedLink);
      const back = readBack(shell.requestedLink);
      shell.openMoney({ kind: "topup", ...(usd ? { usd } : {}) }, () => { if (back) shell.openApp(back.app, back.tab); });
    }
    if (asked === "details" && !web) setView(detailsFor(shell.requestedLink));
    if (asked === "private/add" && !web && privateOpen()) setView({ kind: "toPrivate" });
    if (asked === "balance") {
      setTab("balance");
      setView({ kind: "tabs" });
    }
    const placed = viewFor(asked);
    if (placed) setView(placed);
  }, [asked, shell.requestSeq]);

  const tabs = () => setView({ kind: "tabs" });
  // The Home tab tapped while Home is on screen (the shell's zf:home-root): back to Home's root, by the same closes.
  useEffect(() => {
    const back = (e: Event) => {
      if ((e as CustomEvent<{ app?: string }>).detail?.app !== "wallet") return;
      setSheet(null);
      setView({ kind: "tabs" });
    };
    if (typeof window.addEventListener !== "function") return; // a test's bare window
    window.addEventListener("zf:home-root", back);
    return () => window.removeEventListener("zf:home-root", back);
  }, []);

  // Another app opened Receive for a coin (openApp("wallet", "receive", "<coin>")): its network, this visit only.
  const link = shell.requestedLink;
  useEffect(() => {
    if (asked !== "receive") return;
    const id = receiveChainFor(link, chains, tokens);
    if (id) {
      linkedChain.current = true;
      setChainId(id);
    }
  }, [asked, link, chains, tokens]);

  // First open: the set-up journey (D21), once the balance is known (money already there: no journey). Read once, and
  // never over a screen another app asked for. Asked for (a wallet just made: the web's first Home, right after Agree)
  // it shows at once, never waiting on a balance read (a web test, 4 Nov: it came only after a Retry). Shown once: the
  // saved copy says so, so an unlock or a reload never brings it back.
  const setupChecked = useRef(false);
  useEffect(() => {
    if (setupChecked.current) return;
    const forced = asked === "setup" || setupInUrl();
    if (!forced && (balances === null || balanceProblem)) return;
    setupChecked.current = true;
    if (asked && !forced) return;
    // the web wallet: only right after Agree (forced), never on an unlock or a reload (webd-money2 crawl, 4 Nov: an unlock
    // showed Home, then flipped to "You're set" on a $0.72 wallet: its money is in the trading wallets, never `balances`)
    if (web && !forced) return;
    void loadSetup(bridge).then((saved) => {
      const state = forced ? FRESH : saved;
      if (nextStep(state, !forced && !!balances && (balances.length > 0 || earning.length > 0)) === "off") return;
      setView({ kind: "setup", state });
      if (!state.started) void saveSetup(bridge, { ...state, shown: true });
    });
  }, [bridge, balances, asked]);
  const setupTo = (state: SetupState) => {
    setView({ kind: "setup", state });
    void saveSetup(bridge, state);
  };
  const follow = (next: NextStep) => {
    if (next.kind === "retry") refresh();
    if (next.kind === "open") {
      if (next.screen === "receive" || next.screen === "wallet/receive") return setView({ kind: "receive" });
      if (next.screen === "spending-cap") return shell.openMoney({ kind: "cap" });
      if (next.screen.startsWith("security/")) return setView(viewFor(next.screen) ?? { kind: "tabs" });
      // a held request the shell already opened in place, over Wallet
      if (next.screen.startsWith("held/")) return;
      if (next.screen === "convert" || next.screen === "balance") {
        setTab(next.screen === "convert" && CONVERT_OPEN ? "convert" : "balance");
        return tabs();
      }
      return setView(viewFor(`security/${next.screen}`) ?? { kind: "tabs" });
    }
    tabs();
  };
  /** `quiet`: Wallet's own reading, not a tap. A tap that meets the test account shows its line again, dismissed or not. */
  const problem = async (p: Problem, quiet = false) => {
    // A test account's note is a line on Wallet, never a sheet.
    if (isTestNote(p)) {
      setTestNote(true);
      if (!quiet) setNoteGone(false);
      return follow(p.next);
    }
    return follow(await shell.showProblem(p));
  };
  // A read that failed (the Safe's coins) is Home's one quiet line with Retry, never the Problem screen (B21): only a
  // test account's note, which is a line too, is taken from it here.
  useEffect(() => {
    if (balanceProblem && isTestNote(balanceProblem)) void problem(balanceProblem, true);
  }, [balanceProblem]);
  // A test account's balance is its test NEAR (worth nothing): the same quiet note says so.
  useEffect(() => {
    if (balances?.some((b) => b.test)) setTestNote(true);
  }, [balances]);

  const pickChain = (c: Chain) => {
    setChainId(c.id);
    setPicked(true);
    setSheet(null);
    void bridge.call("ledger.receiveChain", { chain: c.id });
  };
  // Add money on a network that can't give an address: a plain Problem, never a quiet close (not even the test account's
  // line), and the pick isn't kept, so the next Add opens on NEAR again (grade 02e, E2).
  const addFailed = async (p: Problem) => {
    const home = chains.find((c) => c.id === "near");
    if (home && chainId !== home.id) pickChain(home);
    tabs();
    follow(await shell.showProblem(p));
  };
  // Home's wallet preset (its Send from a wallet's own tab): Send opens From that wallet; a tap's event is no wallet
  const send = (wallet?: unknown) => shell.openMoney({ kind: "send", ...(typeof wallet === "string" ? { wallet } : {}) }, (end) => end.went && moved());
  const chain = chains.find((c) => c.id === chainId) ?? chains[0];

  // Convert: from a listed coin you hold (one place at a time), into any coin 1Click lists.
  const holdings = (balances ?? []).filter((b) => b.listed !== false);
  const keyOf = (b: { tokenId: string; held: string }) => `${b.tokenId}|${b.held}`;
  const biggest = [...holdings].sort((a, b) => Number(b.usd ?? 0) - Number(a.usd ?? 0))[0];
  const from = holdings.find((b) => keyOf(b) === fromKey) ?? biggest ?? null;
  const toDefault = POPULAR.find((id) => id !== from?.tokenId && !(from?.tokenId === "near" && id === "nep141:wrap.near"));
  const to = tokens.get(toId ?? "") ?? tokens.get(toDefault ?? "") ?? null;
  const intoRows = [...tokens.values()]
    .filter((t) => t.assetId !== from?.tokenId)
    .sort((a, b) => (POPULAR.indexOf(a.assetId) + 1 || 99) - (POPULAR.indexOf(b.assetId) + 1 || 99) || a.symbol.localeCompare(b.symbol))
    .map((t) => ({ key: t.assetId, symbol: t.symbol, icon: t.icon, title: t.symbol, detail: chainName(chains, t.chain) }));
  // Private: from a listed coin native to NEAR, one place at a time; a dollar coin first, since Private is for paying.
  const privateCoins = holdings.filter(canGoPrivate);
  const dollarFirst = (b: { symbol: string }) => (b.symbol === "USDC" || b.symbol === "USDT" ? 0 : 1);
  const privateFrom = privateCoins.find((b) => keyOf(b) === privateKey) ?? [...privateCoins].sort((a, b) => dollarFirst(a) - dollarFirst(b) || Number(b.usd ?? 0) - Number(a.usd ?? 0))[0] ?? null;
  const setUpPrivate = async (): Promise<boolean> => {
    const r = await bridge.call("ledger.privateSetup");
    if ("problem" in r) {
      void problem(r.problem);
      return false;
    }
    refresh();
    return true;
  };
  // Private ready before its tap (rule 2, instant; QA's gates re-crawl, 5 Nov): its key comes from the words and
  // nothing goes on chain (subwallet.create), so Home sets it up behind, once, and Home's door opens Private at once. A
  // failure is silent here (Private's own screen sets up and says why); a second ask while one runs is the same one.
  const privateRun = useRef<Promise<boolean> | null>(null);
  // the door was tapped: from then on a failed set-up says what failed, where the money is and the next tap (rule 8)
  const privateAsked = useRef(false);
  const ensurePrivate = (): Promise<boolean> => (privateRun.current ??= bridge.call("ledger.privateSetup").then((r) => {
    if ("problem" in r) {
      privateRun.current = null;
      if (privateAsked.current) void problem(r.problem);
      return false;
    }
    refresh();
    return true;
  }, () => ((privateRun.current = null), false)));
  /** Home's door: Private's screen at once; a set-up not done yet (or one that failed behind) runs again from the tap. */
  const openPrivate = () => {
    privateAsked.current = true;
    setView({ kind: "private" });
    if (!pocket?.ready) void ensurePrivate();
  };
  useEffect(() => {
    if (privateOpen() && !web && view.kind === "tabs" && pocket?.available && !pocket.ready) void ensurePrivate();
  }, [pocket?.available, pocket?.ready, view.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  // A build with no relay can't use Private (ledger: pocket.available false), so a link to it lands on Home, as Home has
  // no door there: never a "Set up" that can only fail (rule 1). Unread (null) isn't a no.
  useEffect(() => {
    if ((view.kind === "private" || view.kind === "toPrivate") && pocket && !privateDoor(pocket, privateOpen())) setView({ kind: "tabs" });
  }, [pocket?.available, view.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  // Once the journey offers Private, it stays step 2 until answered: setting the pocket up makes it "ready", which must
  // not skip the default question or drop Private from You're set.
  const privateOffered = useRef(false);
  if (pocket?.available && !pocket.ready) privateOffered.current = true;
  const setPrivateDefault = async (on: boolean) => {
    const r = await bridge.call("ledger.privateDefault", { on });
    if ("problem" in r) void problem(r.problem);
    refresh();
  };
  /** A Top up or Put away went: back to Balance, read again at once and as it lands (a move may not say when it does). */
  const moved = () => {
    setSheet(null);
    tabs();
    refresh();
    for (const ms of [3_000, 8_000, 20_000]) setTimeout(refresh, ms);
  };
  const converted = (_m: Movement) => {
    setView({ kind: "activity" });
    refresh();
  };
  const openPlace = (place: AccountPlace, step?: string, fromAccount = false) => setView(web ? { kind: "phone", reason: "safe" } : { kind: "place", place, ...(step ? { step } : {}), ...(fromAccount ? { fromAccount } : {}) });
  // k-security crawl (4 Nov, S3): a page opened from the Your account sheet goes back to that sheet, one step up, never
  // to Home (Devices, Protection, Check my words, Details)
  const toAccount = () => { tabs(); setSheet("account"); };
  const backFrom = (v: { fromAccount?: boolean }) => (v.fromAccount ? toAccount : tabs);

  let body;
  if (view.kind === "phone") {
    body = <OnYourPhone reason={view.reason} onClose={tabs} />;
  } else if (view.kind === "place" && slots.place) {
    body = slots.place(view.place, view.step, backFrom(view));
  } else if (view.kind === "activity") {
    const part = slots.accountActivity ? view.part ?? "money" : "money";
    body = (
      <PushedFrame name="Activity" onBack={backFrom(view)}>
        {slots.accountActivity && <div className="wl-act-seg"><Segmented label="Activity" items={[{ id: "money", label: "Money" }, { id: "account", label: "Account" }]} value={part} onChange={(p) => setView({ kind: "activity", part: p, fromAccount: !!view.fromAccount })} /></div>}
        {part === "money" ? <Activity overlay={setOver} onProblem={(p) => void problem(p)} onHeld={(h) => shell.showWaiting(h)} onStatement={openStatement} statementFailed={Statement === 0} {...(view.open ? { openId: view.open } : {})} /> : slots.accountActivity!()}
      </PushedFrame>
    );
  } else if (view.kind === "details" && !web) {
    // opened by another app (Trade's Your wallets, k-trade test, 4 Nov S3): Back goes back to that app's page, not Home;
    // opened from Your account (k-security test, 4 Nov S3): Back goes back to Your account
    const back = view.back;
    body = <PushedFrame name="Details" onBack={back ? () => { tabs(); shell.openApp(back.app, back.tab); } : backFrom(view)}><Suspense fallback={<p className="zf-small" role="status">Reading your wallets…</p>}><Details onNewWords={() => openPlace("recovery", "new-words")} onProblem={(p) => void problem(p)} /></Suspense></PushedFrame>;
  } else if (view.kind === "details") {
    // the web wallet's own (bug report, 5 Nov late): each network's wallet address with Copy, nothing about a Safe, no key
    // export (Settings has it, behind the password)
    const back = view.back;
    body = <Suspense fallback={null}><WebDetailsPage onBack={back ? () => { tabs(); shell.openApp(back.app, back.tab); } : backFrom(view)} /></Suspense>;
  } else if (view.kind === "coin") {
    // its Send opens From this coin (QA's Sim crawl, 5 Nov: it opened on USDC)
    const coin = view.line.symbol;
    body = <PushedFrame name={titleOf(view.line)} onBack={tabs}><Coin line={view.line} onSend={() => shell.openMoney({ kind: "send", coin }, (end) => end.went && moved())} /></PushedFrame>;
  } else if (view.kind === "setup") {
    const state = view.state;
    body = (
      <PushedFrame name="Wallet" onBack={tabs}>
        <Suspense fallback={null}>
        <Setup
          state={state}
          offerPrivate={privateOffered.current && privateOpen()}
          onSetUpPrivate={setUpPrivate}
          onPrivateDefault={setPrivateDefault}
          onState={setupTo}
          // the web wallet has no Safe and no bridge (webd-money2 crawl, 4 Nov: "NEAR Intents' bridge is down… It's in your Safe"
          // on a new wallet): its own SOL address, straight away, on the web's Add
          onReceive={web ? () => { void saveSetup(bridge, { ...state, money: "receive" }); setView({ kind: "tabs" }); shell.openMoney({ kind: "receive", wallet: "sol" }); }
            : () => { setView({ kind: "receive", fromSetup: { ...state, money: "receive" } }); setSheet("chains"); }}
          onDone={tabs}
        />
        </Suspense>
      </PushedFrame>
    );
  } else if (view.kind === "private") {
    body = <PushedFrame name="Private balance" onBack={tabs}><Suspense fallback={null}><PrivateScreen onAdd={() => setView({ kind: "toPrivate" })} onMove={() => shell.openMoney({ kind: "move", source: "private" }, moved)} onSetUp={openPrivate} onDefault={(on) => void setPrivateDefault(on)} onProblem={(p) => void problem(p)} /></Suspense></PushedFrame>;
  } else if (view.kind === "toPrivate") {
    body = (
      <PushedFrame name="Add to your private balance" onBack={() => setView({ kind: "private" })}>
        <Suspense fallback={null}>
          <AddToPrivate
            from={privateFrom}
            onPickFrom={() => setSheet("privateFrom")}
            onDone={() => { refresh(); setView({ kind: "private" }); }}
            onProblem={(p) => void problem(p)}
            onHeld={(h) => shell.showWaiting(h)}
          />
        </Suspense>
      </PushedFrame>
    );
  } else if (view.kind === "receive") {
    const back = view.fromSetup;
    body = (
      <PushedFrame name="Add money" onBack={back ? () => setView({ kind: "setup", state: back }) : tabs}>
        {chain ? <Suspense fallback={<Waiting size={44} text="Opening…" />}><Receive bridge={bridge} tokens={tokens} chain={chain} chains={chains} onChange={() => setSheet("chains")} onProblem={addFailed} /></Suspense> : <Waiting size={44} text="Reading the networks…" />}
      </PushedFrame>
    );
  } else {
    body = (
      <AppFrame name="Home" top={<Mark size={30} mode="still" label="ZeroFee" />} menu={{ label: "Your account", open: () => setSheet("account") }} tray={TRAY} tab={tab} onTab={setTab}>
        {testNote && (
          <button className="wl-note" hidden={noteGone} onClick={() => { setNoteGone(true); void dismissNote(bridge); }} aria-label={`${TEST_NOTE}. Dismiss`}>{TEST_NOTE}</button>
        )}
        {tab === "balance" ? (
          <Home
            overlay={setOver}
            onAdd={(wallet) => shell.openMoney({ kind: "receive", ...(wallet ? { wallet } : {}) })}
            addressCard={(wallet) => <Suspense fallback={null}><AddressCard wallet={wallet} /></Suspense>}
            onSend={send}
            onSwap={(wallet) => shell.openMoney({ kind: "swap", ...(wallet ? { wallet } : {}) }, (end) => end.went && moved())}
            onMove={(from, wallet) => shell.openMoney(from === "safe" ? { kind: "move", ...(wallet ? { wallet } : {}) } : { kind: "putaway" }, moved)}
            onCoin={(line) => { const to = NATIVE_COINS ? safeCoinRoute(line) : null; if (to) shell.openApp("trade", to, backLink({ app: "wallet" })); else setView({ kind: "coin", line }); }}
            {...(NATIVE_COINS ? { onBuy: () => shell.openApp("trade", "native") } : {})}
            {...(privateOpen() && !web ? { onPrivate: openPrivate } : {})}
            onRow={(chain) => shell.openApp("trade", `market:${chain}`)}
            onSite={(site) => shell.openApp("social", site)}
            onRowCoin={(chain, address, symbol) => shell.openApp("trade", `coin:${chain}:${address}${/^[A-Za-z0-9.$_-]{1,16}$/.test(symbol) ? `:${symbol}` : ""}`, backLink({ app: "wallet" }))}
            onHeld={(h) => shell.showWaiting(h)}
            onRetrySpending={refresh}
            readFailed={balanceProblem && !isTestNote(balanceProblem) ? { onRetry: refresh } : undefined}
            waiting={slots.waiting?.()}
            thread={slots.thread?.({ place: openPlace, addMoney: () => (picked ? setSheet("add") : setView({ kind: "receive" })) })}
            {...(slots.health ? { health: (close: () => void) => slots.health!({ place: (p, step) => { close(); openPlace(p, step); }, details: () => { close(); setView({ kind: "details" }); }, close }) } : {})}
          />
        ) : (
          <Suspense fallback={null}><Convert from={from} to={to} onPickFrom={() => setSheet("from")} onPickTo={() => setSheet("to")} onDone={converted} onProblem={(p) => void problem(p)} onHeld={(h) => shell.showWaiting(h)} /></Suspense>
        )}
      </AppFrame>
    );
  }

  /** The menu glyph's sheet (design review §1.1): the account's rows, off the money screen; each opens its own screen. */
  const go = (then: () => void) => () => { setSheet(null); then(); };
  return (
    <div className="wl-app" style={{ position: "absolute", inset: 0 }}>
      {body}
      {/* a screen's own sheet (Home's and Activity's live tracker), over the whole app */}
      {over}
      {sheet === "account" && (
        <Sheet title="Your account" onClose={() => setSheet(null)}>
          {/* the design review §4.9: two grouped cards: what keeps the account safe, then what you did and the app */}
          <div className="wl-acct-rows">
            {webRows ? webRows.rows((place) => { setSheet(null); setWebSheet(place); }) : slots.rows?.((place, step) => { setSheet(null); openPlace(place, step, true); })}
          </div>
          <div className="wl-acct-rows">
            {/* k-security crawl (4 Nov, 1c6f4215f): Activity and Settings go back to this sheet too, as Details does */}
            <NavRow title="Activity" line="What you did" icon="clock" onClick={go(() => (shell.tasks?.open ? shell.tasks.open({ back: toAccount }) : setView({ kind: "activity", fromAccount: true })))} />
            <NavRow title="Details" line="Your address on each network" icon="code" onClick={go(() => setView({ kind: "details", fromAccount: true }))} />
            <NavRow title="Settings" line={SETTINGS_LINE} icon="dials" onClick={go(() => shell.openMenu(toAccount))} />
          </div>
        </Sheet>
      )}
      {/* a web account row's own sheet (WebAccountRows): drawn over the app, never inside Your account (the sheet under
          another is hidden); its Close goes back to Your account */}
      {webRows && webSheet && webRows.sheet(webSheet, () => { setWebSheet(null); setSheet("account"); })}
      {Statement ? <Statement onClose={() => setStatement(null)} /> : null}
      {sheet === "add" && Pick && (
        <Pick.AddMoneySheet
          chains={chains}
          current={chainId}
          onPick={(c) => { pickChain(c); setView({ kind: "receive" }); }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "chains" && chain && Pick && <Pick.ChainSheet chains={chains} current={chain.id} onPick={pickChain} onClose={() => setSheet(null)} />}
      {sheet === "from" && Pick && (
        <Pick.PickSheet
          title="Convert from"
          rows={holdings.map((b) => ({ key: keyOf(b), symbol: b.symbol, icon: b.icon, title: b.symbol, detail: placeOf(b, chains), right: amountOf(b.amount, b.symbol) }))}
          current={from ? keyOf(from) : undefined}
          onPick={(k) => { setFromKey(k); setSheet(null); }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "privateFrom" && Pick && (
        <Pick.PickSheet
          title="Move to your private balance from"
          rows={privateCoins.map((b) => ({ key: keyOf(b), symbol: b.symbol, icon: b.icon, title: b.symbol, detail: placeOf(b, chains), right: amountOf(b.amount, b.symbol) }))}
          current={privateFrom ? keyOf(privateFrom) : undefined}
          onPick={(k) => { setPrivateKey(k); setSheet(null); }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "to" && Pick && <Pick.PickSheet title="Into" rows={intoRows} current={to?.assetId} onPick={(k) => { setToId(k); setSheet(null); }} onClose={() => setSheet(null)} />}
    </div>
  );
}

/** The money history in the Activity centre: the same list the Activity page shows (Activity, with its statement row),
 *  and Account beside it where Security gives one, under the same Money · Account switch. */
function HistoryPart({ overlay, close, part, account, onProblem, onHeld }: { overlay: (n: ReactNode) => void; close: () => void; part: { current: "money" | "account" }; account?: (() => ReactNode) | undefined; onProblem: (p: Problem) => void; onHeld: (h: NonNullable<Movement["held"]>) => void }) {
  const [p, setP] = useState(part.current);
  const pick = (v: "money" | "account") => { part.current = v; setP(v); };
  const [failed, setFailed] = useState(false);
  const statement = () => void import("./screens/StatementSheet.tsx").then((m) => overlay(<m.StatementSheet onClose={() => overlay(null)} />), () => setFailed(true));
  return (
    <>
      {account && <div className="wl-act-seg"><Segmented label="Activity" items={[{ id: "money", label: "Money" }, { id: "account", label: "Account" }]} value={p} onChange={(v) => pick(v as "money" | "account")} /></div>}
      {p === "money" || !account ? <Activity overlay={overlay} onDone={close} onProblem={onProblem} onHeld={onHeld} onStatement={statement} statementFailed={failed} /> : account()}
    </>
  );
}

function WalletRoot() {
  const { bridge } = useShell();
  return <WalletProvider bridge={bridge}><WalletScreens /></WalletProvider>;
}

export const walletApp: AppModule = { id: "wallet", name: "Home", line: "Your money and your account", Root: WalletRoot };
