// The contract between the shell (S2) and every app inside it.
//
// ZeroFee is several apps inside one. The shell owns moving between them (the app bar at the bottom, one tap; a swipe
// from anywhere on the page, a quarter of the width or a flick; press and hold the bar for the switcher; the arrow
// keys), onboarding, the approval sheet, the Problem screen and whole-app settings. An app owns only what is inside its
// own frame: it renders <AppFrame name tray tab onTab> (./AppFrame.tsx), its sections a segmented control at the top.
//
// Stack: React 19 + Vite (apps/web). An app is a workspace package exporting one AppModule; it registers with one line
// in apps/web/src/apps.ts.
import type { TradeAsk, TradeEnd } from "./trade-ask.ts";
import type { ComponentType } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { NextStep, Problem } from "@zerofee/core/problem";
import type { MoneyAsk, MoneyEnd } from "./money.ts";
import type { Tasks } from "./tasks.ts";

export type AppId = "wallet" | "pay" | "trade" | "extension" | "browser" | "social" | "agent" | "earn" | "chat";

export interface AppModule {
  id: AppId;
  /** Shown in the app's top bar and on its switcher card, e.g. "Wallet". */
  name: string;
  /** The switcher card's one line, e.g. "Your money, every chain". */
  line: string;
  /** The app's root. It renders <AppFrame …> itself and reads everything it needs from useShell(). */
  Root: ComponentType;
  /** An app whose code loads when first shown (apps.ts lazyApp): start loading it now, e.g. once the first screen is up. */
  preload?: () => void;
}

/** What the shell gives the app it is rendering (read it with useShell() from ./AppFrame.tsx). */
export interface AppContext {
  /**
   * This app's bridge: forApps(shellBridge, id). It hides approval.* (only the shell's sheet sees approvals) and stamps
   * the app's id on tx.* requests and device.* calls, so an app can't pose as another app or reach another app's data.
   */
  bridge: Bridge;
  /**
   * Move to another app (e.g. Wallet → Pay), optionally to one of its tray tabs, optionally handing it a payment link in
   * Pay's own format (e.g. a payment link → Pay's Send, filled in). Apps never animate this themselves.
   */
  openApp(id: AppId | "security", tab?: string, link?: string): void;
  /** A tab another app asked for when it opened this one, if any. */
  requestedTab?: string;
  /** Counts the shell's openApp calls that named this app: changes on every one, so an app that is already open can tell
   * a new request for the same tab from the old one. */
  requestSeq?: number;
  /**
   * The payment link another app handed over with it, if any. It's a suggestion, not an order: the receiving app parses
   * it like a scanned code and the person still confirms on the approval sheet.
   */
  requestedLink?: string;
  /**
   * Show a Problem on the shell's Problem screen (what happened, where the money is, one next step). Resolves with the
   * step the person tapped, so the app can act on it (retry, wait, open a screen, fix an input). Apps never draw their
   * own error screens.
   */
  showProblem(problem: Problem): Promise<NextStep>;
  /**
   * A tx.request came back `waiting` (the account's protection is holding it): pass the outcome here and the shell shows
   * its one Waiting screen (what it is, the countdown, cancel; send when ready). Apps never run or cancel held requests.
   */
  showWaiting(held: { id: string; readyAtIso: string; needsSecondDevice: boolean }): void;
  /**
   * The one money sheet (Job 1): Send, Top up, Put away, Add money, opened in place over this app, never a jump to
   * another app. `onEnd`: told once it is over (went, or closed), on this app.
   */
  openMoney(ask: MoneyAsk, onEnd?: (end: MoneyEnd) => void): void;
  /**
   * Trade's own Buy or Sell page, filled in by another app (AgentZero), opened in Trade (trade-ask.ts): the coin by its
   * chain and address, the dollars or the share; the page says who filled it in, and only the person's own tap on it
   * trades. `onEnd`: told once, { went, tradeId?, landedMs? }, or { went: false, refused } at once for an ask that can't
   * open. Optional so older hosts and tests that build a context by hand still type.
   */
  openTrade?(ask: TradeAsk, onEnd?: (end: TradeEnd) => void): void;
  /**
   * D144: the Activity centre (tasks.ts). Publish, update and end this app's own tasks; the shell stamps the app, so an
   * app can't touch another app's. Optional so older hosts and tests that build a context by hand still type.
   */
  tasks?: Tasks;
  /** Open the switcher / whole-app settings (holding the app bar and the frame's top-left button already do). */
  openSwitcher(): void;
  /** `back`: opened from a list one step up (Home's Your account sheet): Settings' ‹ goes back there (k-security crawl,
   *  4 Nov); with none, Settings has its ✕ only. */
  openMenu(back?: () => void): void;
  /**
   * True while this app is the one on screen. The shell also renders its neighbours (so a swipe is instant), so anything
   * that reaches past the page (camera, microphone, timers that poll the network) starts only while `active`.
   */
  active: boolean;
  /** This app's place among the apps (the app bar shows it). */
  index: number;
  count: number;
}
