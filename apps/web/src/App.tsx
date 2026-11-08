// The shell's flow. Launch shows the title (the mark drawing itself) while the core says where this device stands:
// no account → Welcome; backup not finished → the words; ready → the apps, opening on Wallet (D31b). Every failure is the core's own
// Problem, shown on the Problem screen with its one next step.
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { Problem } from "@zerofee/core/problem";
import type { AccountInfo, RecoveryPending, TxOutcome } from "@zerofee/core/signer";
import { securityProblems } from "@zerofee/core/security-problems";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { appBridge, shellBridge, spending } from "./core.ts";
import { primeHome } from "@zerofee/wallet/app/home-cache.ts";
import { accountShown, keepAccount, keptAccount, keptWithin, openFromKept, sealedKept } from "./kept-account.ts";

/** Once the account is home: Spending's engine, and Social Trading's site wallets made from the words (quietly). */
const startHome = () => {
  const stop = spending.start();
  // loaded after Home, never in its first load (speed budget); made from the words, nothing moves, no sheet
  void import("@zerofee/browser/social/prepare.ts").then((m) => m.prepareSites(appBridge("social"))).catch(() => undefined);
  // a site wallet's Take out finishes from its saved record on any app, never only from the page that started it
  // (browser-sites crawl F1, MUST): its landed first leg goes on home with no tap (reads only; the core sends it, once)
  let stopBacks: (() => void) | undefined, gone = false;
  void import("@zerofee/browser/social/take-out-resume.ts").then((m) => { if (!gone) stopBacks = m.resumeTakeOuts(appBridge("social")); }).catch(() => undefined);
  // QA 16's MUST on T12 (8 Nov): a trade still checking after a reload is followed from Home's start, and its Jobs row
  // kept to it, whether or not Trade is ever opened (Trade's runtime alone, with its own bridge; never its screens)
  let stopTrades: (() => void) | undefined;
  void import("@zerofee/trade/app/trade-follow.ts").then((m) => { if (!gone) stopTrades = m.followTrades(appBridge("trade")); }).catch(() => undefined);
  // T13 phase 2: the person's own servers (Settings → Status), read from the sealed store into the doors before a trade
  // (no check, no network: the status service's own.get only reads the store)
  void shellBridge.call("status.own.get").catch(() => undefined);
  // the account's own parts and Settings, fetched now Home is up, so their first tap is as quick as before (headroom)
  void Promise.all([SecurityRows.preload(), SettingsPanel.preload()]).catch(() => undefined);
  // set-up's and recovery's screens (new words, Was this you?, Check my words), so they draw at once from Home too
  void setupScreens();
  return () => { gone = true; stopBacks?.(); stopTrades?.(); stop(); };
};
import { APPS } from "./apps.ts";
import { appsFor, mvpOn, publicApps } from "./shown-apps.ts";
import { Title } from "./screens/Title.tsx";
import { whileTitle } from "./splash.ts";
import type { Funding } from "@zerofee/core/demo-core";
import { OPENING_STEPS, Working } from "./screens/Working.tsx";
// Set-up's, recovery's and the terms' screens (about 50 KB with the 2,048 backup words) load beside the boot when this
// device has no open account, and once Home is up otherwise, never in Home's first load (speed budget, 5 Nov). Same
// names, same props; until they are here the screen stays on the title (setupScreens below), so nothing blinks.
const onboarding = () => import("./screens/Onboarding.tsx");
const recoveryScreens = () => import("./screens/Recovery.tsx");
const Welcome = later(() => onboarding().then((m) => m.Welcome));
const MakeKey = later(() => onboarding().then((m) => m.MakeKey));
const Words = later(() => onboarding().then((m) => m.Words));
const Check = later(() => onboarding().then((m) => m.Check.preload().then(() => m.Check)));
const RenewDone = later(() => onboarding().then((m) => m.RenewDone));
const BankOpen = later(() => onboarding().then((m) => m.BankOpen));
const RestoreWords = later(() => recoveryScreens().then((m) => m.RestoreWords));
const RecoveryWaiting = later(() => recoveryScreens().then((m) => m.RecoveryWaiting));
const WasThisYou = later(() => recoveryScreens().then((m) => m.WasThisYou));
const Terms = later(() => import("./screens/Terms.tsx").then((m) => m.Terms));
const SETUP_SCREENS = [Welcome, MakeKey, Words, Check, RenewDone, BankOpen, RestoreWords, RecoveryWaiting, WasThisYou, Terms];
/** Every screen above, fetched once (a failed fetch is asked again next time): setup-gate.ts. */
const SETUP = setupGate(() => Promise.all(SETUP_SCREENS.map((c) => c.preload())));
const setupScreens = SETUP.fetch;
/** The views drawn with them: shown only once they are all here (the title, or the screen before, until then). */
const SETUP_VIEWS: ReadonlySet<View["k"]> = new Set(["welcome", "makekey", "words", "renewWords", "renewCheck", "renewDone", "check", "open", "restore", "waiting", "alert", "checkwords", "terms"]);
// "Add money to start" loads only when set-up or its bar needs it, never in Home's first load (speed budget, 2 Nov).
const FundingShell = lazy(() => import("./screens/FundingShell.tsx").then((m) => ({ default: m.FundingShell })));
const FundFlow = lazy(() => import("./screens/FundStart.tsx").then((m) => ({ default: m.FundFlow })));
import type { FundView } from "@zerofee/core/fund-start";
import { wordsBack, type DelayChoice } from "./screens/recovery-words.ts";
import { termsAccepted } from "./terms-accepted.ts";
import { chosenDelay, setChosenDelay, setupChoices, setupFinished, takeFirstChoice } from "./screens/first-run-state.ts";
import { EXTENSION_BUILD, MAINNET, PUBLIC_BUILD, SAMPLE_LINK, SIM, WEB_MODES, WEB_WALLET, otherMode } from "./mode.ts";
import { WEB_START, takeWebWords } from "./screens/web-words-held.ts";
import { SETUP_WORDS } from "./screens/setup-words.ts";
/** The web wallet's first screens (no Safe), when its words weren't chosen before the lock (a reload in between). */
const WebStart = lazy(() => import("./screens/WebStart.tsx").then((m) => ({ default: m.WebStart })));
/** The web wallet's account rows and their sheets (bug report, 5 Nov late): one chunk, loaded only on the web wallet, asked
 *  for as its Home opens so the rows are there when Your account opens; never in the phone's or the Sim's load. */
const webAccount = () => import("./shell/WebAccountRows.tsx");
const WebAccountRows = lazy(() => webAccount().then((m) => ({ default: m.WebAccountRows })));
const WebAccountSheet = lazy(() => webAccount().then((m) => ({ default: m.WebAccountSheet })));
import { laptopWords } from "./apps/security/laptop-words.ts";
import { ProblemView } from "./shell/ProblemView.tsx";
import { ApprovalSheet, type Pending as PendingSheet } from "./shell/ApprovalSheet.tsx";
import type { SecurityActions } from "./apps/security/SecurityApp.tsx";
import { later } from "./later.tsx";
import { setupGate } from "./setup-gate.ts";
// Headroom (3 Nov): Settings and the account's own parts (its rows, places, holds, record; with them the guardian's QR,
// Protection, email alerts) load when first drawn, never in Home's first load. Same names, same props.
const SettingsPanel = later(() => import("./shell/SettingsPanel.tsx").then((m) => m.SettingsPanel));
const security = () => import("./apps/security/SecurityApp.tsx");
const SecurityRows = later(() => security().then((m) => m.SecurityRows));
const SecurityWaiting = later(() => security().then((m) => m.SecurityWaiting));
const SecurityPlace = later(() => security().then((m) => m.SecurityPlace));
const AccountActivity = later(() => security().then((m) => m.AccountActivity));
import { hostApps } from "./shell/home-apps.tsx";
import { readProtection, setKnown, useKnown } from "./apps/security/known.ts";
import { KeyProofCard } from "./apps/security/KeyProof.tsx";
import { logEvent } from "./apps/security/local.ts";
import { AppHost } from "./shell/AppHost.tsx";
import { FreezeBanner } from "./shell/FreezeBanner.tsx";
import { AccountThread } from "./shell/AccountThread.tsx";
// S-2: the Safe sheet's health check loads with the sheet's first open, never in Home's first load
const SafeHealth = lazy(() => import("./shell/SafeHealth.tsx").then((m) => ({ default: m.SafeHealth })));
// Dead ends row 16: a spare phone says yes for another account from Welcome; its screen loads only then.
const GuardianSide = lazy(() => import("./apps/security/GuardianSide.tsx").then((m) => ({ default: m.GuardianSide })));
const HEALTH_RULES = { read: readProtection, use: () => useKnown().protection };
import { freezeNotice, freezeNoticeItem, type RecoveryStatus } from "./shell/freeze.ts";
import { usePageVisible } from "./shell/visible.ts";
import type { Held } from "./shell/WaitingView.tsx";
/** The Waiting screen, loaded when a request is held (the shell's own asks for it with the neighbours). */
const WaitingView = later(() => import("./shell/WaitingView.tsx").then((m) => m.WaitingView));
// The Safe's update (product decision, 5 Nov): the card loads beside Home (it shows nothing until the core answers, so nothing
// moves); its held screen loads only when opened. Neither is in Home's first load (speed-budget.test.ts).
const SafeUpdateCard = later(() => import("./shell/SafeUpdateCard.tsx").then((m) => m.SafeUpdateCard));
const SafeUpdateHeld = later(() => import("./shell/SafeUpdateHeld.tsx").then((m) => m.SafeUpdateHeld));
import { iosHost } from "./host/ios.ts";
import { coreIsIsolated } from "./host/core.ts";
import { clearThisBrowser, lockedWith } from "./unlock/UnlockGate.tsx";
import { openSettings, opensSettings, phoneBlocker } from "./host/phone-check.ts";
import { PHONE_BLOCKERS } from "@zerofee/core/security-problems";
import { installBack } from "@zerofee/design/back.ts";
import { parseScreen } from "@zerofee/shell-api/screen.ts";
import type { AppId } from "@zerofee/shell-api/app-module.ts";

/** A laptop page a person can open from here (not on mainnet before launch, nor the iPhone's test build): only then is
 *  "Add my laptop" offered at set-up's end and on the vault banner (UX walk 2 Nov: it named a page that answers 404). */
/** D157: in the extension (Real), no sheet shows in the side panel: each goes to the extension's own full-screen window,
 *  where Approve is the person's iPhone (host/extension.ts); its yes is the shell gate's (core.ts, window-yes.ts). */
const SHEETS_IN_WINDOW = EXTENSION_BUILD && !SIM && !iosHost();
const sheetInWindow = (p: PendingSheet) =>
  Promise.all([import("./host/extension.ts"), import("./unlock/device.ts")]).then(([w, d]) => w.answerInWindow(p, shellBridge, (words) => w.windowSheet(words, () => d.browserDevice().readRecord())));
const LAPTOP_PAGE = !laptopWords(PUBLIC_BUILD, typeof location === "undefined" ? undefined : location.origin, MAINNET).later;

type View =
  | { k: "boot" }
  /** The phone check again (after its Problem's Try again, or on coming back from Settings), then on to set-up. */
  | { k: "checkPhone" }
  /** `moving`: this device is waiting for an account's move (Back from its wait, grade 02g G10): Welcome says it keeps
   *  waiting and leads back to it, never into a second set-up or restore. */
  | { k: "welcome"; moving?: true }
  /** Dead ends row 16: this phone as another account's second phone or guardian, with no account of its own. */
  | { k: "guard" }
  /** Set-up's one screen: the key, the recovery wait's line (release 7: `seconds`, fixed after) and the terms if not yet. */
  | { k: "makekey"; choices: DelayChoice[]; seconds: number }
  | { k: "working"; text: string; steps?: readonly string[]; at?: number }
  /** "Try again" after a failed account creation: straight back to making it (the key is kept: no Face ID again). */
  | { k: "create" }
  /** "Add money to start": the coins, an address, then the checklist (FundStart.tsx). */
  /** `away`: the person closed the checklist: the apps, each saying the account is opening, under the funding's bar. */
  | { k: "funding"; funding?: Funding; away?: boolean }
  /** The checklist again, over Home (its last step, the rest into Private, runs with the account open). */
  | { k: "fundCheck"; account: AccountInfo }
  /** `first`: before any money (J2, words first). */
  | { k: "words"; words: string[]; first?: true }
  /** `back`: where Back from the new words returns (Details, or Security, where they were asked for: grade 01d, Q11). */
  | { k: "renewWords"; words: string[]; account: AccountInfo; back?: Start }
  | { k: "renewCheck"; words: string[]; account: AccountInfo; back?: Start }
  /** `moved`: what Move it now did; `stuck`: some of it is still under the old words (Try again); `started`: what's
   *  already on its way, never asked again (renew-move.ts). */
  | { k: "renewDone"; waitingUntilIso?: string; account: AccountInfo; moved?: string; stuck?: true; started?: string[] }
  | { k: "check"; words: string[]; first?: true }
  | { k: "open"; account: AccountInfo; start?: Start; restored?: true }
  | { k: "home"; account: AccountInfo; start?: Start }
  | { k: "restore"; badWord?: number; wrong?: true; words?: string[] }
  | { k: "waiting"; pending: RecoveryPending; delaySeconds: number }
  | { k: "alert"; pending: RecoveryPending; account: AccountInfo }
  | { k: "reroute" }
  /** The web wallet with no words in it yet: Create my wallet or I already have one (WebStart.tsx). */
  | { k: "webStart" }
  | { k: "checkwords"; account: AccountInfo; badWord?: number; wrong?: true; words?: string[] }
  | { k: "checked"; account: AccountInfo; matches: boolean }
  | { k: "terms"; next: View }
  /** `back`: where Done returns (the Security screen it was opened from, grade 01d Q11); none: Home's own start. */
  | { k: "held"; held: Held; account: AccountInfo; back?: Start }
  /** The Safe's update, held (SafeUpdateHeld.tsx): from Home's card and from Security's Protection; Close returns there. */
  | { k: "safeUpdate"; account: AccountInfo; back?: Start }
  | { k: "problem"; problem: Problem; then: View };

/** An app (and tab) to open on once the app is showing, as openApp(id, tab) would. */
type Start = { id: string; tab?: string };
/** A wallet made here (web): its first Home opens on Wallet's set-up, once (WalletApp: asked "setup"). */
let setupStart: Start | undefined;

/** `wordsDue`: a new account's words come first (J2): shown and checked before the money is asked for. */
type State = { stage: "none" | "needs-funding" | "needs-backup" | "ready" | "recovering"; account?: AccountInfo; setupUntilIso?: string; wordsDue?: true };

/** The words were closed before their check (J2, words first): they still come before the money, said once, one step. */
const WORDS_FIRST: Problem = { code: "shell.words.first", whatHappened: "Your 24 words come first.", money: { state: "not-involved" }, more: "Write them on paper. Then you add money.", next: { kind: "nothing", label: "Show my words" } };

/** One bridge per app for the life of the page, so apps can depend on it (e.g. in effects). */
const APP_BRIDGES = new Map(APPS.map((m) => [m.id, appBridge(m.id)]));
// AgentZero's live card drives the Browser app's own session (agentzero/browser-bridge.ts reads it)
(globalThis as { zfBrowserBridge?: () => Bridge }).zfBrowserBridge = () => APP_BRIDGES.get("browser")!;
/** Where the open account is kept: in a browser, Wallet's sealed store (a locked browser shows no account id); the phone's
 *  WebView storage as before (no web lock there). */
const KEPT = iosHost() ? null : sealedKept(APP_BRIDGES.get("wallet")!);
/** The terms come first, once per device: before a bank is made or restored here. */
const gate = (next: View): View => (termsAccepted() ? next : { k: "terms", next });

export function App() {
  const [view, setView] = useState<View>({ k: "boot" });
  // The 24 words in memory only while their screens need them (audit K-7): once the person has left them (not just a
  // "working" moment or a Problem whose way back holds them), the array is overwritten so it doesn't linger in the page.
  const heldWords = useRef<string[] | null>(null);
  useEffect(() => {
    const holding = wordsIn(view);
    if (heldWords.current && heldWords.current !== holding && view.k !== "working") {
      heldWords.current.fill("");
      heldWords.current.length = 0;
    }
    if (holding || view.k !== "working") heldWords.current = holding;
  }, [view]);
  const [menu, setMenu] = useState(false);
  // Settings opened from Home's Your account sheet: its ‹ goes back to that sheet (k-security crawl, 4 Nov)
  const menuBack = useRef<(() => void) | null>(null);
  const openMenu = (back?: () => void) => { menuBack.current = back ?? null; setMenu(true); };
  // Settings belongs to the screen it opened over: a new kind of screen closes it (funding's apps → the words, say).
  useEffect(() => setMenu(false), [view.k]);
  // Home's account is kept whenever it shows (set-up's end and a restore too), so the next unlock opens Home at once
  const shown = accountShown(view);
  useEffect(() => void (shown && keepAccount(shown, KEPT)), [shown]);

  /** Leaving set-up before any money is seen (J1): the app's own clear, then its first screen. The phone's Reset this
   *  iPhone (Face ID first; false when declined), or this browser's clear (the lock screen's "Clear and start again"). */
  const leaveSetup = {
    device: iosHost() ? "this iPhone" : "this browser",
    go: async (): Promise<boolean> => {
      const host = iosHost();
      if (host) {
        const r = await host.call<{ reset: boolean }>("shell.reset");
        return "ok" in r && r.ok.reset;
      }
      await clearThisBrowser();
      return true;
    },
  };

  /** Call the core; a Problem goes to the Problem screen, whose button leads to its own next screen, else `then`. */
  async function ask<T>(method: string, params: Record<string, unknown> | undefined, then: View): Promise<T | null> {
    const res: BridgeResult<T> = await shellBridge.call<T>(method, params);
    if ("problem" in res) {
      setView({ k: "problem", problem: res.problem, then: nextFor(res.problem, then) });
      return null;
    }
    return res.ok;
  }

  /** A Problem that names a screen ("open → recover") goes there; anything else to the caller's fallback. */
  function nextFor(problem: Problem, fallback: View): View {
    if (problem.next.kind !== "open") return fallback;
    switch (problem.next.screen) {
      case "recover": return { k: "restore" };
      case "welcome": return { k: "welcome" };
      case "home":
      case "backup": return { k: "reroute" };
      default: return fallback;
    }
  }

  /**
   * A signature's outcome: a Problem goes to the Problem screen; declined goes home; held by the account's protection
   * (it takes the strictest band) goes to the Waiting screen; only done counts as done.
   */
  async function settle(account: AccountInfo, res: BridgeResult<TxOutcome>, doneEvent: string) {
    const out: TxOutcome = "problem" in res ? { status: "problem", problem: res.problem } : res.ok;
    if (out.status === "problem") return setView({ k: "problem", problem: out.problem, then: nextFor(out.problem, { k: "home", account }) });
    if (out.status === "declined") return setView({ k: "home", account });
    if (out.status === "waiting") return setView({ k: "held", held: { id: out.id, readyAtIso: out.readyAtIso, needsSecondDevice: out.needsSecondDevice }, account });
    logEvent(doneEvent);
    await route();
  }

  /** Remove another phone's key (e.g. a lost old phone). It's a signature, so the approval sheet comes up. */
  async function removeKey(account: AccountInfo, handle: string, what?: "second device") {
    // H09: a lost second device goes the same way (it waits first; the Waiting screen shows the date).
    setView({ k: "working", text: what ? SETUP_WORDS.removeLost : SETUP_WORDS.removePhone });
    await settle(account, await shellBridge.call<TxOutcome>("account.removeKey", { handle }), what ? "Removed a lost second device" : "Removed another phone's key");
  }

  /** Practise the backup words against the account's recovery key. Signs nothing. No words: typed on the phone's own screen. */
  async function checkWords(account: AccountInfo, words?: string[]) {
    setView({ k: "working", text: words ? SETUP_WORDS.checking : SETUP_WORDS.typeOnPhone });
    const res = await shellBridge.call<{ matches: boolean }>("recovery.check", words ? { words } : {});
    if ("ok" in res) return setView({ k: "checked", account, matches: res.ok.matches });
    if (res.problem.code === "security.words.stopped") return setView({ k: "home", account });
    setView({ k: "problem", problem: res.problem, then: res.problem.next.kind === "fix-input" ? { k: "checkwords", account, ...wordsBack(res.problem), ...(words ? { words } : {}) } : { k: "home", account } });
  }

  /** `start`: the app (and tab) Home opens on, when it is Home. */
  async function route(splash = false, start?: Start): Promise<void> {
    // A failed read is never "no account" (D1): its Problem's Try again reads again, and Welcome comes only when the core
    // says this device's vault is empty (stage "none"). A read that is only slow or unreachable, on a device whose account
    // was open before, is no Problem screen (Job 1, B21): Home opens from the account as last read here, and its own
    // reads say in one quiet line what they couldn't read.
    const asking = shellBridge.call<State>("account.state").then(async (res): Promise<State | null> => {
      if ("ok" in res) {
        if (res.ok.stage === "ready" && res.ok.account) void keepAccount(res.ok.account, KEPT);
        return res.ok;
      }
      const kept = await keptAccount(KEPT);
      if (kept && readOnly(res.problem)) {
        setView({ k: "home", account: kept, start });
        return null;
      }
      setView({ k: "problem", problem: res.problem, then: nextFor(res.problem, { k: "reroute" }) });
      return null;
    });
    let state: State | null;
    // D134, Home instant: a device whose account was open before shows Home at once, from the account and the figures
    // kept here, and the core's own answer (two NEAR nodes, up to seconds) is read behind it. Anything but "ready" (a
    // recovery, words due, a wiped vault, a Problem) then takes over the screen as before; the same account stays put.
    const kept = splash && termsAccepted() ? await keptWithin(keptAccount(KEPT)) : null;
    // the copy (read since boot, on this device) so Home's first render has its figures; never waited on for long
    if (await openFromKept(kept, () => primeHome(APP_BRIDGES.get("wallet")!), (account) => setView({ k: "home", account, start }))) {
      state = await asking;
      if (state?.stage === "ready" && state.account) {
        setupFinished();
        if (JSON.stringify(state.account) !== JSON.stringify(kept)) setView({ k: "home", account: state.account, start });
        return;
      }
    } else if (splash) {
      // no account open here before: set-up's screens load while the title is up
      void setupScreens();
      // The title leaves the moment the core answers, with no floor (D134), a second at most; a slower core gets a plain screen.
      if ((await whileTitle(asking)) === "late") setView({ k: "working", text: SETUP_WORDS.reading });
      state = await asking;
    } else state = await asking;
    if (!state) return;
    // The web wallet (no Safe): its words, chosen before the lock, make its wallets now; with none waiting, its own start.
    if (WEB_WALLET && state.stage === "none") {
      const kept = takeWebWords();
      return kept ? void webImport(kept.words, kept.made) : setView({ k: "webStart" });
    }
    if (state.stage !== "none") setupFinished();
    // A device that already has a bank but never agreed (made before the terms existed): agree, then route again.
    if (state.stage !== "none" && !termsAccepted()) return setView({ k: "terms", next: { k: "reroute" } });
    if (state.stage === "ready" && state.account) {
      const first = setupStart;
      setupStart = undefined;
      return setView({ k: "home", account: state.account, start: start ?? first });
    }
    if (state.stage === "needs-backup") return showWords();
    // Mainnet: the words first (J2) where the core takes them before the money; then, or reloaded while waiting for the
    // money, the checklist the core keeps (or, closed, the apps under its bar); with nothing asked yet, account.create
    // again (it resumes) and the coins.
    if (state.stage === "needs-funding") return state.wordsDue ? showWords(true) : openFunding();
    if (state.stage === "recovering") {
      const status = await ask<RecoveryStatus>("recovery.status", undefined, { k: "reroute" });
      if (status?.pending) return setView({ k: "waiting", pending: status.pending, delaySeconds: status.delaySeconds ?? 0 });
    }
    // A browser's first visit chose already, before its lock (FirstRun: Welcome, terms, Make your key): go straight on.
    const first = state.stage === "none" ? takeFirstChoice() : null;
    if (first === "create") return void create();
    if (first === "restore") return setView(gate({ k: "restore" }));
    if (first === "guard") return setView({ k: "guard" });
    setView({ k: "welcome" });
  }

  /** The web wallet: the core keeps the words (sealed under the password) and makes their three wallets, then Home. */
  async function webImport(words: string[], made: boolean) {
    setView({ k: "working", text: WEB_START.making });
    const res = await shellBridge.call("account.web.import", { words });
    if ("ok" in res) {
      // A new wallet's first Home, right after Agree, opens on its set-up (a web test, 4 Nov)
      if (made) setupStart = { id: "wallet", tab: "setup" };
      return route();
    }
    setView({ k: "problem", problem: res.problem, then: { k: "reroute" } });
  }

  /** New phone: the words find the account by themselves (the core retries a fresh key's index), then the wait. No words: typed on the phone's own screen. */
  async function restore(words?: string[]) {
    setView({ k: "working", text: words ? SETUP_WORDS.finding : SETUP_WORDS.typeOnPhone });
    const res = await shellBridge.call<{ readyAtIso: string }>("recovery.start", words ? { words } : {});
    if ("ok" in res) {
      setupFinished();
      return showWaiting({ readyAtIso: res.ok.readyAtIso });
    }
    if (res.problem.code === "security.words.stopped") return setView({ k: "welcome" });
    // Not now on the sheet is the person's choice, not a Problem (grade 02e, E1): back to the words, all still there.
    if (res.problem.code === "security.recovery.declined") return setView({ k: "restore", ...(words ? { words } : {}) });
    setView({ k: "problem", problem: res.problem, then: { k: "restore", ...wordsBack(res.problem), ...(words ? { words } : {}) } });
  }

  /** The new phone's wait, as the account says it now (release 7: whether it needs the second device's yes, the
   *  fallback); `fallback` when the account can't be read this moment. */
  async function showWaiting(fallback: RecoveryPending) {
    const status = await shellBridge.call<RecoveryStatus>("recovery.status");
    if ("ok" in status && !status.ok.pending) return setView({ k: "problem", problem: securityProblems.recoveryStopped(), then: { k: "restore" } });
    setView({ k: "waiting", pending: "ok" in status && status.ok.pending ? status.ok.pending : fallback, delaySeconds: "ok" in status ? status.ok.delaySeconds ?? 0 : 0 });
  }

  async function finishRestore(readyAtIso: string) {
    setView({ k: "working", text: SETUP_WORDS.bringing });
    const res = await shellBridge.call<AccountInfo>("recovery.finish");
    if ("ok" in res) {
      logEvent("Account moved to this device");
      return setView({ k: "open", account: res.ok, restored: true });
    }
    const p = res.problem;
    if (p.code === "security.recovery.waiting") return showWaiting({ readyAtIso: p.next.kind === "wait" && p.next.untilIso ? p.next.untilIso : readyAtIso });
    setView({ k: "problem", problem: p, then: p.code === "security.recovery.stopped" ? { k: "welcome" } : { k: "reroute" } });
  }

  /** New backup words (recovery.renew): on the phone they show and are checked on ZeroFee's own screen; here, on ours. */
  async function startRenew(account: AccountInfo, back?: Start) {
    if (coreIsIsolated(iosHost())) {
      setView({ k: "working", text: SETUP_WORDS.newOnPhone });
      const out = await ask<TxOutcome>("recovery.renew", undefined, { k: "home", account });
      if (out) renewSettled(account, out);
      return;
    }
    const res = await ask<{ words: string[] }>("recovery.renew", undefined, { k: "home", account, start: back });
    if (res) setView({ k: "renewWords", words: res.words, account, back });
  }

  async function renewConfirm(account: AccountInfo, words: string[], positions: number[], picked: string[]) {
    setView({ k: "working", text: SETUP_WORDS.renewing });
    const out = await ask<TxOutcome>("recovery.renewConfirm", { positions, words: picked }, { k: "renewCheck", words, account });
    if (out) renewSettled(account, out);
  }

  function renewSettled(account: AccountInfo, out: TxOutcome) {
    if (out.status === "problem") return setView({ k: "problem", problem: out.problem, then: nextFor(out.problem, { k: "home", account }) });
    if (out.status === "declined") return setView({ k: "home", account });
    logEvent(out.status === "done" ? "New backup words are in" : "New backup words are on their way");
    setView({ k: "renewDone", account, ...(out.status === "waiting" ? { waitingUntilIso: out.readyAtIso } : {}) });
  }

  /**
   * New words are in: what the core can move itself out of the wallets the old words still open (the NEAR wallet and the
   * private pocket) goes to the new words' ones (renew-move.ts). Trading wallets on their chains, and the Browser and card
   * wallets, are moved from Trade, Browser and Pay, which mark them "Opens with your old words".
   */
  async function moveOld(account: AccountInfo, before: string[] = []) {
    setView({ k: "working", text: SETUP_WORDS.movingOld });
    // Dead ends row 8: a failed read or move is named and offers Try again, never "Nothing here needed moving."
    const { moveOldHome } = await import("./screens/renew-move.ts");
    const out = await moveOldHome(shellBridge, Date.now().toString(36), before);
    setView({ k: "renewDone", account, moved: out.line, started: out.started, ...(out.stuck ? { stuck: true as const } : {}) });
  }

  /** Old phone: stop someone else's recovery. It's a signature, so the approval sheet comes up. */
  async function stopRecovery(account: AccountInfo) {
    setView({ k: "working", text: SETUP_WORDS.stopping });
    await settle(account, await shellBridge.call<TxOutcome>("recovery.cancel"), "Stopped someone moving your account");
  }

  /** `first`: before any money (J2, words first): closed before the check, they still come first, said once. */
  async function showWords(first = false): Promise<void> {
    // On the phone with the isolated core, the words show on ZeroFee's own native screen and never reach this page.
    if (coreIsIsolated(iosHost())) {
      setView({ k: "working", text: SETUP_WORDS.backupOnPhone });
      const res = await shellBridge.call<{ ok: true }>("recovery.backup");
      if ("ok" in res) return afterBackup(first);
      if (first && res.problem.code === "security.backup.declined") return setView({ k: "problem", problem: WORDS_FIRST, then: { k: "reroute" } });
      return setView({ k: "problem", problem: res.problem, then: nextFor(res.problem, { k: "reroute" }) });
    }
    const res = await ask<{ words: string[] }>("recovery.words", undefined, { k: "reroute" });
    if (res) setView({ k: "words", words: res.words, ...(first ? { first: true as const } : {}) });
  }

  async function create() {
    await startAccount(SETUP_WORDS.opening);
  }

  async function openFunding(): Promise<void> {
    const r = await shellBridge.call<FundView>("account.fund.status");
    // The apps only once money is seen (J1; fund.ts mayGoToApp, which FundingShell holds to as well): before it,
    // reopening lands on the address again.
    const seen = "ok" in r && r.ok.state !== "waiting" && r.ok.state !== "expired" && r.ok.steps.some((s) => s.state === "done" || s.state === "failed");
    if ("ok" in r) return setView({ k: "funding", ...(r.ok.away && r.ok.deposit && seen ? { away: true } : {}) });
    return startAccount(SETUP_WORDS.lookingForMoney);
  }

  /** The account is open (the funding's checklist said so): its backup words next. */
  function fundOpened() {
    logEvent("Account created on this device");
    void showWords();
  }

  /** account.create: on testnet it returns the account; on mainnet it first asks for NEAR (the funding screen). */
  async function startAccount(text: string): Promise<void> {
    // Three short lines that tick as the core does them (account.create.step), instead of a bare wait.
    setView({ k: "working", text, steps: OPENING_STEPS, at: 0 });
    const off = shellBridge.on<{ step?: unknown; retrying?: unknown }>("account.create.step", ({ step, retrying }) => {
      if (typeof step === "number") setView((v) => (v.k === "working" && v.steps ? { ...v, at: step, ...(retrying === true ? { text: SETUP_WORDS.retrying } : {}) } : v));
    });
    const delay = chosenDelay();
    const params = delay ? { recoveryDelaySeconds: delay } : undefined;
    const res = await ask<AccountInfo | Funding>("account.create", params, { k: "create" }).finally(off);
    if (!res) return;
    setupFinished();
    // Mainnet: the account waits for its money; the core says whether its words come first (J2), and route follows it.
    if ("stage" in res) return route();
    logEvent("Account created on this device");
    await showWords();
  }

  async function confirm(words: string[], positions: number[], picked: string[], first = false) {
    setView({ k: "working", text: first ? SETUP_WORDS.checking : SETUP_WORDS.addingWords });
    const ok = await ask<{ ok: true }>("recovery.confirm", { positions, words: picked }, { k: "check", words, ...(first ? { first: true as const } : {}) });
    if (ok) await afterBackup(first);
  }

  /**
   * The words are checked. Before any money (J2): on to Add money; their key goes on chain with the account, which then
   * opens ready, and the funding's last screen is the one "Your account is open". After the money (the order before
   * J2): the recovery key is on chain and the account is open (the laptop is offered there, as one link).
   */
  async function afterBackup(first = false): Promise<void> {
    logEvent(first ? "Backup words written down and checked" : "Backup words added. They bring your account back.");
    const state = await ask<State>("account.state", undefined, { k: "reroute" });
    if (state?.stage === "needs-funding") return openFunding();
    // the account opens straight into the app, as on the phone (B28 addition 3: no "Your account is open · Open ZeroFee")
    if (state?.account) setView({ k: "home", account: state.account });
  }

  // Once per page: a second first route (React's development double effect) would find the set-up choice already taken
  // and show Welcome over the account being made (D1, set-up right after the lock).
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    // The browser's Back stays in ZeroFee (D15): it closes what's on top, and with nothing open does nothing.
    installBack();
    // Speed (2 Nov): the coin list and the networks (1Click's and the bridge's, up to a second each) are the slowest
    // reads Home waits for, and they don't depend on the account: asked now, beside the account's own state, Home finds
    // them ready (the ledger keeps them 5 minutes and shares one read). Nothing about the money is decided from them here.
    void APP_BRIDGES.get("wallet")?.call("ledger.tokens");
    void route(true);
  }, []);
  // The new phone, while it waits: the account is read again every 15 s, so the second device's yes (or its refusal,
  // or the old phone's stop) shows without a reload.
  const waitingNow = view.k === "waiting";
  useEffect(() => {
    if (!waitingNow) return;
    const t = window.setInterval(() => {
      void shellBridge.call<RecoveryStatus>("recovery.status").then((r) => {
        if (!("ok" in r)) return;
        if (!r.ok.pending) return setView({ k: "problem", problem: securityProblems.recoveryStopped(), then: { k: "restore" } });
        setView((v) => (v.k === "waiting" ? { ...v, pending: r.ok.pending!, delaySeconds: r.ok.delaySeconds ?? v.delaySeconds } : v));
      });
    }, 15_000);
    return () => window.clearInterval(t);
  }, [waitingNow]);

  /** Set-up's one screen, with the recovery wait's choices: the core's (account.recoveryChoices), else the release's own,
   *  on the default (48 hours) until changed. First the phone check (H16, H17): a phone that can't make or use the key
   *  says which, on its own screen, before anything is chosen. */
  async function choose() {
    const blocked = await phoneBlocker(iosHost());
    if (blocked) return setView({ k: "problem", problem: blocked, then: blocked.next.kind === "retry" || opensSettings(blocked) ? { k: "checkPhone" } : { k: "welcome" } });
    const res = await shellBridge.call<DelayChoice[]>("account.recoveryChoices");
    const choices = "ok" in res && res.ok.length ? res.ok : setupChoices(MAINNET);
    setView({ k: "makekey", choices, seconds: (choices.find((c) => c.default) ?? choices[0]).seconds });
  }
  // A trading session ends the moment the phone locks or ZeroFee leaves the screen: the next trade asks for Face ID
  // again. One call ends them all, so the shell can't miss one it didn't track.
  useEffect(() => {
    const endAll = () => void shellBridge.call("subwallet.session.endAll", { reason: "locked" });
    const onHide = () => document.visibilityState === "hidden" && endAll();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", endAll);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", endAll);
    };
  }, []);
  useEffect(() => {
    if (view.k === "reroute") void route();
    if (view.k === "create") void create();
    if (view.k === "checkPhone") void choose();
  }, [view.k]);

  // A phone-check screen (Face ID off for ZeroFee, say) and the person comes back from Settings: check again by itself.
  const phoneBlocked = view.k === "problem" && (PHONE_BLOCKERS as readonly string[]).includes(view.problem.code) && view.then.k === "checkPhone";
  useEffect(() => {
    if (!phoneBlocked) return;
    const back = () => document.visibilityState === "visible" && setView({ k: "checkPhone" });
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [phoneBlocked]);

  // While the bank is open on this device, watch for anyone using the words to move it.
  const homeAccount = view.k === "home" ? view.account : null;
  // The switcher's Security line and Security itself count from the same facts (known.ts, D19): read protection on
  // Home, and again when a held change ends, so the card is right before Security is ever opened.
  useKnown();
  // the web wallet's account rows: their chunk asked for as Home opens (WebAccountRows above)
  useEffect(() => { if (homeAccount && WEB_WALLET) void webAccount().catch(() => undefined); }, [homeAccount]);
  useEffect(() => {
    if (!homeAccount || WEB_WALLET) return;
    setKnown({ account: homeAccount });
    void readProtection(shellBridge);
    return shellBridge.on("account.waiting.ended", () => void readProtection(shellBridge));
  }, [homeAccount]);
  // Grade 01c, P12: the core watches for a move only while the page is on screen (listening is what keeps its watcher
  // running); shown again, it looks at once.
  const visible = usePageVisible();
  useEffect(() => {
    if (!homeAccount || !visible || WEB_WALLET) return;
    return shellBridge.on<{ readyAtIso: string }>("recovery.started", ({ readyAtIso }) => {
      // Release 7: who can stop it, from the account itself; the event's own time if it can't be read now.
      void shellBridge.call<RecoveryStatus>("recovery.status").then((r) => setView({ k: "alert", pending: "ok" in r && r.ok.pending ? r.ok.pending : { readyAtIso }, account: homeAccount }));
    });
  }, [homeAccount, visible]);

  // Release 6: while payments are frozen (a recovery waits, or this device just stopped one), Home says so. Read on
  // opening Home (after a stop, too), then from the core's own watcher, which reads the status every half minute anyway
  // (grade 01c, P12: Home read it a second time on its own timer), so the banner goes when the freeze ends.
  const [recovery, setRecovery] = useState<RecoveryStatus | null>(null);
  useEffect(() => {
    if (!homeAccount || WEB_WALLET) return;
    let live = true;
    void shellBridge.call<RecoveryStatus>("recovery.status").then((r) => live && "ok" in r && setRecovery(r.ok));
    const off = shellBridge.on<RecoveryStatus>("recovery.status", (s) => live && setRecovery(s));
    return () => {
      live = false;
      off();
    };
  }, [homeAccount]);
  const freeze = homeAccount ? freezeNotice(recovery) : null;

  // The funding's checklist, once the account is open: the thread's Money in opens it until it is seen done (the core
  // keeps the record; account.fund.status answers "not opening" once it is gone).
  const [fundOn, setFundOn] = useState(false);
  useEffect(() => {
    if (!homeAccount || WEB_WALLET) return;
    let live = true;
    void shellBridge.call<FundView>("account.fund.status").then((r) => live && setFundOn("ok" in r));
    return () => {
      live = false;
    };
  }, [homeAccount]);

  // New words that were waiting have run: say what they cover now (once).
  useEffect(() => {
    if (!homeAccount) return;
    return shellBridge.on("recovery.renewed", () => setView({ k: "renewDone", account: homeAccount }));
  }, [homeAccount]);

  // Set-up's and recovery's screens load beside the boot (or once Home is up): a view that draws them before they are here
  // keeps the title up (the same element as the boot's, so nothing redraws) and shows itself the moment they land.
  const waitSetup = SETUP.useWaiting(SETUP_VIEWS.has(view.k));

  let screen;
  switch (view.k) {
    case "boot": screen = <Title />; break;
    case "welcome": screen = <Welcome onCreate={() => void choose()} onRestore={() => setView(gate({ k: "restore" }))} onGuard={() => setView(gate({ k: "guard" }))} {...(view.moving ? { onMoving: () => void route() } : {})} {...(WEB_MODES ? { other: otherMode()! } : MAINNET && SAMPLE_LINK && !coreIsIsolated(iosHost()) ? { onSample: () => location.assign("/?demo") } : {})} />; break;
    case "makekey": screen = <MakeKey web={iosHost() ? undefined : lockedWith() ?? "passkey"} terms={!termsAccepted()} wait={{ choices: view.choices, seconds: view.seconds, onChange: (seconds) => setView({ ...view, seconds }) }} onBack={() => setView({ k: "welcome" })} onContinue={() => { setChosenDelay(view.seconds); void create(); }} />; break;
    case "working": screen = <Working text={view.text} steps={view.steps} at={view.at} />; break;
    // Every app is there to look at while the account opens, and each says so: never an error, never a half-made screen.
    case "funding": screen = <Suspense fallback={<Working text={SETUP_WORDS.loading} />}><FundingShell bridge={shellBridge} wallet={APP_BRIDGES.get("wallet")!} away={view.away} apps={hostApps(appsFor(APPS, mvpOn(location.search, MAINNET), MAINNET), (id) => APP_BRIDGES.get(id as AppId)!).map(({ id, name, line, bridge }) => ({ id, name, line, bridge }))} onWords={fundOpened} onReroute={() => setView({ k: "reroute" })} onProblem={(problem) => setView({ k: "problem", problem, then: nextFor(problem, { k: "reroute" }) })} onMenu={() => openMenu()} leave={leaveSetup} /></Suspense>; break;
    case "fundCheck": { const account = view.account; screen = <Suspense fallback={<Working text={SETUP_WORDS.loading} />}><FundFlow bridge={shellBridge} wallet={APP_BRIDGES.get("wallet")!} onAway={() => setView({ k: "home", account })} onWords={() => setView({ k: "home", account })} onDone={() => { setFundOn(false); setView({ k: "home", account }); }} onWordsFirst={() => setView({ k: "reroute" })} onProblem={(problem) => setView({ k: "problem", problem, then: { k: "home", account } })} /></Suspense>; break; }
    case "words": { const first = view.first; screen = <Words words={view.words} moneyIn={MAINNET && !first} onDone={() => setView({ k: "check", words: view.words, ...(first ? { first } : {}) })} />; break; }
    case "renewWords": screen = <Words renew words={view.words} onBack={() => setView({ k: "home", account: view.account, start: view.back })} onDone={() => setView({ k: "renewCheck", words: view.words, account: view.account, back: view.back })} />; break;
    case "renewCheck": screen = <Check renew words={view.words} onBack={() => setView({ k: "renewWords", words: view.words, account: view.account, back: view.back })} onDone={(pos, picked) => void renewConfirm(view.account, view.words, pos, picked)} />; break;
    case "renewDone": screen = <RenewDone waitingUntilIso={view.waitingUntilIso} moved={view.moved} stuck={view.stuck} onMove={() => void moveOld(view.account, view.started)} onDone={() => setView({ k: "home", account: view.account })} />; break;
    case "check": { const first = view.first; screen = <Check words={view.words} moneyIn={MAINNET && !first} onBack={() => setView({ k: "words", words: view.words, ...(first ? { first } : {}) })} onDone={(pos, picked) => confirm(view.words, pos, picked, first === true)} />; break; }
    case "open": screen = <BankOpen accountId={view.account.accountId} network={view.account.network} restored={view.restored} bridge={appBridge("wallet")} keyCard={<KeyProofCard bridge={shellBridge} />} onEnter={() => setView({ k: "home", account: view.account, start: view.start })} {...(LAPTOP_PAGE ? { onLaptop: () => setView({ k: "home", account: view.account, start: { id: "security", tab: "laptop" } }) } : {})} />; break;
    case "home": {
      const account = view.account;
      // Security is the shell's own part, inside Home (Job 1): it uses the full bridge through App's handlers, never an
      // app bridge.
      const actions: SecurityActions = {
        bridge: shellBridge,
        onProblem: (problem) => setView({ k: "problem", problem, then: nextFor(problem, { k: "home", account }) }),
        onRemoveKey: (h, what) => removeKey(account, h, what),
        onStopRecovery: () => stopRecovery(account),
        onCheckWords: () => setView({ k: "checkwords", account }),
        onNewWords: (back) => void startRenew(account, back),
        // The phone's own words screen turns approvals back on after Face ID changed (recovery.rearm, audit IOS-1b).
        ...(coreIsIsolated(iosHost()) ? { rearm: { onMoving: () => void route() } } : {}),
        onChanged: () => void route(),
        onWaiting: (held, tab) => setView({ k: "held", held, account, back: { id: "security", tab } }),
        onSafeUpdate: () => setView({ k: "safeUpdate", account, back: { id: "security", tab: "protection" } }),
      };
      const apps = hostApps(PUBLIC_BUILD ? publicApps(APPS, false) : appsFor(APPS, mvpOn(location.search, account.network === "mainnet"), account.network === "mainnet"), (id) => APP_BRIDGES.get(id as AppId)!, {
        rows: (open) => <SecurityRows account={account} bridge={shellBridge} open={open} />,
        waiting: () => <SecurityWaiting bridge={shellBridge} />,
        place: (place, step, back) => <SecurityPlace account={account} actions={actions} place={place} step={step} onBack={back} />,
        accountActivity: () => <AccountActivity bridge={shellBridge} />,
        // The web wallet has no Safe: no Safe health check and no Safe thread on its Home. Its account sheet's first card is
        // the phone's rows, each saying what this browser has (bug report, 5 Nov late; WalletApp draws them on the web only).
        ...(WEB_WALLET ? {
          webRows: {
            rows: (open) => <Suspense fallback={null}><WebAccountRows open={open} /></Suspense>,
            sheet: (place, close) => <Suspense fallback={null}><WebAccountSheet place={place} bridge={shellBridge} codeUrl={import.meta.env.VITE_CODE_URL} onClose={close} /></Suspense>,
          },
        } : {
        // S-2: the Safe's health check; each line not done opens its own fix (the screens that already exist).
        health: (go) => <Suspense fallback={null}><SafeHealth account={account} bridge={shellBridge} rules={HEALTH_RULES} phone={iosHost()} go={{ ...go, checkWords: () => setView({ k: "checkwords", account }), settings: () => openMenu() }} /></Suspense>,
        // The one thread (Job 1): the account's next step; each opens its one screen.
        thread: (go) => <><SafeUpdateCard bridge={shellBridge} onOpen={() => setView({ k: "safeUpdate", account })} onProblem={(problem) => setView({ k: "problem", problem, then: { k: "home", account } })} /><AccountThread account={account} bridge={shellBridge} onOpen={(step) => {
          if (step === "protected") return go.place("protection");
          if (step === "device") return go.place("devices");
          if (step === "words") return setView({ k: "checkwords", account });
          return fundOn ? setView({ k: "fundCheck", account }) : go.addMoney();
        }} /></>,
        }),
      });
      // Only an alert sits above the apps (a move of the account under way); every step is the thread, on Home (Job 1).
      screen = <AppHost apps={apps} onMenu={openMenu} shellBridge={shellBridge} firstTray start={view.start} run={startHome} notice={freeze ? freezeNoticeItem(freeze, <FreezeBanner notice={freeze} onCancel={() => stopRecovery(account)} onNewWords={() => void startRenew(account)} bare />) : null} />;
      break;
    }
    case "webStart": screen = <Suspense fallback={<Title />}><WebStart onWords={(words, made) => void webImport(words, made)} /></Suspense>; break;
    case "guard": screen = <Suspense fallback={<Working text={SETUP_WORDS.loading} />}><GuardianSide bridge={shellBridge} mainnet={MAINNET} onBack={() => setView({ k: "welcome" })} onProblem={(problem) => setView({ k: "problem", problem, then: { k: "welcome" } })} /></Suspense>; break;
    case "reroute": screen = <Working text={SETUP_WORDS.loading} />; break;
    // On the phone with the isolated core, the words are typed on ZeroFee's own screen and never reach this page.
    case "checkwords": screen = coreIsIsolated(iosHost()) ? <NativeWords run={() => checkWords(view.account)} /> : <RestoreWords purpose="check" badWord={view.badWord} wrong={view.wrong} initial={view.words} onBack={() => setView({ k: "home", account: view.account })} onSubmit={(w) => checkWords(view.account, w)} />; break;
    case "checked": screen = <ProblemView problem={{ code: "shell.words.checked", whatHappened: view.matches ? "Your words are right." : "These words don't match your account.", money: { state: "not-involved" }, more: view.matches ? "Keep your paper somewhere safe and dry. Check again every few months." : "Check your paper: a word is wrong or out of order.", next: { kind: "nothing", label: view.matches ? "Done" : "Try again" } }} onNext={() => setView(view.matches ? { k: "home", account: view.account } : { k: "checkwords", account: view.account })} />; break;
    case "restore": screen = coreIsIsolated(iosHost()) ? <NativeWords run={() => restore()} /> : <RestoreWords badWord={view.badWord} wrong={view.wrong} initial={view.words} onBack={() => setView({ k: "welcome" })} onSubmit={restore} />; break;
    case "waiting": screen = <RecoveryWaiting pending={view.pending} delaySeconds={view.delaySeconds} onFinish={() => finishRestore(view.pending.readyAtIso)} onBack={() => setView({ k: "welcome", moving: true })} />; break;
    case "alert": screen = <WasThisYou pending={view.pending} onStop={() => stopRecovery(view.account)} onItsMe={() => setView({ k: "home", account: view.account })} />; break;
    case "terms": screen = <Terms onBack={view.next.k === "reroute" ? undefined : () => setView({ k: "welcome" })} onAgree={() => setView(view.next)} />; break;
    // Done (and Back) return to the screen it was opened from; "See Activity" opens that tab (grade 01d, Q3 and Q11).
    case "held": { const back = view.back; screen = <WaitingView bridge={shellBridge} held={view.held} onClose={() => void route(false, back)} onOpen={(_, s) => { const to = parseScreen(s); void route(false, to ? { id: to.app, tab: to.tab } : back); }} />; break; }
    case "safeUpdate": { const back = view.back; const account = view.account; screen = <SafeUpdateHeld bridge={shellBridge} onClose={() => void route(false, back)} onProblem={(problem) => setView({ k: "problem", problem, then: { k: "safeUpdate", account, ...(back ? { back } : {}) } })} />; break; }
    case "checkPhone": screen = <Working text={SETUP_WORDS.loading} />; break;
    // "Open Settings" (Face ID off for ZeroFee): ZeroFee's page in iOS Settings, then the check runs again on return.
    // Back (the arrow, Escape, browser Back) leaves without the next step: a set-up that couldn't go on returns to
    // Welcome, never into making the account again (grade 01d, Q8: the busy set-up screen had no way back).
    case "problem": { const back = view.then.k === "create" || view.then.k === "checkPhone" ? { k: "welcome" as const } : view.then; screen = <ProblemView problem={view.problem} onBack={() => setView(back)} onNext={() => { if (opensSettings(view.problem)) void openSettings(iosHost()); setView(view.then); }} />; break; }
  }
  if (waitSetup) screen = <Title />;

  return (
    <>
      {screen}
      {menu && view.k === "home" && <SettingsPanel accountId={view.account.accountId} bridge={shellBridge} onClose={() => setMenu(false)} {...(menuBack.current ? { onBack: menuBack.current } : {})} />}
      {/* While the account opens (money seen, the apps under the funding's bar): the same Settings, with no address yet. */}
      {menu && view.k === "funding" && <SettingsPanel accountId="" bridge={shellBridge} onClose={() => setMenu(false)} />}
      <ApprovalSheet bridge={shellBridge} {...(SHEETS_IN_WINDOW ? { inWindow: sheetInWindow } : {})} />
    </>
  );
}

/** A Problem that only says a read couldn't finish (slow, or the network unreachable), never one about the account. */
export const readOnly = (p: Problem): boolean => p.code === "security.read.slow" || /\.(unreachable|offline|network)$/.test(p.code);

/** The words a view holds, itself or on its way back (a Problem's `then`). */
function wordsIn(view: View): string[] | null {
  if ("words" in view) return view.words ?? null;
  if (view.k === "problem") return wordsIn(view.then);
  return null;
}

/** While the words are typed on the phone's own screen: nothing here but a line. Asks the core once. */
function NativeWords({ run }: { run: () => Promise<void> }) {
  const asked = useRef(false);
  useEffect(() => {
    // Once: a second ask would find the native screen already open and read as "stopped".
    if (asked.current) return;
    asked.current = true;
    void run();
  }, []);
  return <Working text={SETUP_WORDS.typeOnPhone} />;
}
