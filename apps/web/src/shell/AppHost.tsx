// Several apps inside one. The shell owns moving between them (J2, 2 Nov; the tray, Job 1):
// - the bottom row: Home · Trade · Browser · AgentZero · pump.fun to start, an icon and a name each, one tap to switch
//   (packages/design AppBar); the person chooses what sits there (tray.ts);
// - the tray: a swipe up on the bar (or its grab bar, or a press held on it) shows every app; tap one to open it, hold
//   one to keep it in the bottom row or take it out, swipe down to close (packages/design Tray);
// - a swipe from the screen's left or right edge (bug report, 4 Nov: a drag across the page never moves the app's frame):
//   a quarter of the width, or a quick flick, moves one app (the row's order, then the rest); the next app follows the
//   finger, and the release lands on a spring that keeps the finger's speed; the first and the last app hold still past
//   their end; a vertical scroll is never taken, and a swipe that starts on a sheet, a field, a chart or a strip that
//   scrolls sideways is left to it; the arrow keys for a keyboard.
// Money moves in one sheet, in place (Job 1): openMoney(ask) shows Wallet's MoneyHost over the app on screen, on Wallet's
// own bridge, and its one "it went" line (WentLine) says so on the screen the person is on.
// There is no Security app and no Apps app: openApp("security", tab) opens that place inside Home, and
// openApp("social", site) opens that site's page inside Social trading (S17: one entry for pump.fun, GMGN and
// the sites to come, never an app per site).
// Each move is a spring (packages/design spring.ts) on the pages' position, written straight to their style on every
// frame: nothing re-renders while a page moves, and a touch catches a moving page where it is. Reduce Motion: a
// short crossfade. The phone's light tap (device.haptic) marks each switch.
import { readBack } from "@zerofee/shell-api/back-to.ts";
import type { TradeAsk, TradeEnd } from "@zerofee/shell-api/trade-ask.ts";
import { Suspense, memo, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppBar, glideBar, type AppBarItem } from "@zerofee/design/AppBar.tsx";
import { followScroll } from "@zerofee/design/bar-scroll.ts";
import { useServiceNotice } from "./StatusBanner.tsx";
import { NoticeBar, RANK, type NoticeItem } from "./NoticeBar.tsx";
import { onWent, type MoneyAsk, type MoneyEnd } from "@zerofee/shell-api/money.ts";
import { iosHost } from "../host/ios.ts";
import { MoneyHost, preloadSheets } from "@zerofee/wallet/app/money/MoneyHost.tsx";
import { AppAgent, AppAgentOn, AppBrowser, AppBrowserOn, AppChat, AppChatOn, AppHome, AppHomeOn, AppSocial, AppSocialOn, AppTiles, AppTrade, AppTradeOn } from "@zerofee/design/icons.tsx";
import { reducedMotion } from "@zerofee/design/spring.ts";
import { ShellContext } from "@zerofee/shell-api/AppFrame.tsx";
import type { AppContext, AppId } from "@zerofee/shell-api/app-module.ts";
import { createOverlayQueue } from "@zerofee/shell-api/overlay-queue.ts";
import { routeScreen } from "@zerofee/shell-api/screen.ts";
import { setShown } from "@zerofee/shell-api/rest.ts";
import type { Bridge } from "@zerofee/core/bridge";
import type { NextStep, Problem } from "@zerofee/core/problem";
import { HIDDEN_APP_PROBLEM, PHONE_ON_WEB, foldedInto } from "../shown-apps.ts";
import { webWallet } from "@zerofee/shell-api/release.ts";
import type { PhoneReason } from "@zerofee/shell-api/web-wallet-words.ts";
import { OnYourPhone } from "@zerofee/shell-api/OnYourPhone.tsx";
import { startAppIndex } from "./start-app.ts";
import { returnAfterWaiting } from "./return-after-waiting.ts";
import { clampPos, fingerVelocity, fromEdge, lockAxis, releaseTarget } from "./swipe.ts";
import { SOCIAL_TRADING as WORDS } from "@zerofee/browser/social/social-trading.ts";
import { LOCKED_IDS, SOCIAL_TRADING, arrangeNote, barSlot, markSlot, markTraySeen, moveItem, orderFor, pageOrder, rowOf, saveOrder, savedOrder, trayBeckons } from "./tray.ts";
import { LOCKED_APPS } from "./locked-tiles.tsx";
import { ProblemView } from "./ProblemView.tsx";
import { AppBoundary, AppWaiting } from "./AppBoundary.tsx";
import { later } from "../later.tsx";
/** The Waiting screen (a request the account holds): its code loads with the neighbours, after the first paint, never in
 *  Home's first load (the speed budget: room for the compositor's flights). */
const WaitingView = later(() => import("./WaitingView.tsx").then((m) => m.WaitingView));
import { useAgentZeroNotice } from "./AgentZeroDot.tsx";
import { TASK_APPS, newsApps, taskStore } from "@zerofee/shell-api/tasks.ts";
import { PARKED, parkedTask } from "./parked.ts";
import { screenApp, screenMoney } from "./screen-app.ts";
import "./apphost.css";

export interface HostedApp {
  /** The page's id: an app's ("wallet", "trade", "social": the Browser), or Social trading's ("site:trading"). */
  id: AppId | `site:${string}`;
  name: string;
  /** One line about the app (kept for the apps' own modules; the tray shows names only). */
  line: string;
  /** Its icon in the bottom row and the tray (an app's default by its id). */
  icon?: () => ReactNode;
  /** The bridge this app gets through useShell(): forApps(shellBridge, id) for every app module. */
  bridge: Bridge;
  render: () => ReactNode;
  /** Start loading the app's code now (apps.ts lazyApp), so opening it later is instant. */
  preload?: () => void;
}

/**
 * Speed (2 Nov): the app on screen renders alone first, so its reads have the network (and the main thread) to
 * themselves; its neighbours, rendered so a swipe is instant, join this long after, or at once when a swipe starts.
 * Every app's code is loaded then too. An app once shown stays (its screen is where the person left it).
 */
export const NEIGHBOURS_AFTER_MS = 1500;
/** The compositor's flights (slide.ts), asked for as the shell loads, outside Home's first load (the speed budget). */
let slideCode: typeof import("./slide.ts") | null = null;
void import("./slide.ts").then((m) => { slideCode = m; }, () => undefined);

/** Product decision, 3 Nov: Earn, Perps and Predict are locked tiles (locked-tiles.tsx); a tap says what each will do, never opens
 *  it. Their "Coming soon" sheet (locked-apps.tsx) loads after the first paint or on that tap: never in Home's first load. */
const lockedApps = () => import("./locked-apps.tsx");
/** The tray (packages/design Tray.tsx) loads as the shell comes up, never in Home's first load (speed budget, 3 Nov:
 *  room for the five-app row and the site apps); asked again when it is opened, so it shows the moment it is here. */
let trayHere: typeof import("@zerofee/design/Tray.tsx") | null = null;
const trayModule = () => import("@zerofee/design/Tray.tsx").then((m) => (trayHere = m));

// Social trading wears its own glyph, two people (S17 pair); never Trade's
const ICONS: Record<string, () => ReactNode> ={ wallet: AppHome, trade: AppTrade, chat: AppChat, social: AppBrowser, agent: AppAgent, [SOCIAL_TRADING]: AppSocial };
/** Each one's filled twin, on the tab on screen (the capsule, product decision, 4 Nov). */
const ICONS_ON: Record<string, () => ReactNode> = { wallet: AppHomeOn, trade: AppTradeOn, chat: AppChatOn, social: AppBrowserOn, agent: AppAgentOn, [SOCIAL_TRADING]: AppSocialOn };
/** The bar's and the tray's short name: "ZeroFee Chat" is Chat there; Social trading is "Social" (its full name would be
 *  cut on a 390 tray tile; the page's title and Home's Hot heading keep the full one). */
export const barName = (name: string, id?: string): string => (id === SOCIAL_TRADING ? WORDS.short : name.replace(/^ZeroFee\s+/, ""));
/** The bar's (and the tray's) item for each of these apps: its short name and its icon. */
export function barItems(apps: readonly { id: string; name: string; icon?: () => ReactNode }[]): AppBarItem[] {
  return apps.map((a) => {
    const on = a.icon ? undefined : ICONS_ON[a.id];
    return { id: a.id, label: barName(a.name, a.id), icon: a.icon ?? ICONS[a.id] ?? AppTiles, ...(on ? { iconOn: on } : {}) };
  });
}

/** The social trading sites (S17): their pages are inside Social trading, never apps of their own. */
export const SOCIAL_SITES: readonly string[] = ["pump", "gmgn"];
/** Where openApp(id, tab) lands among these pages: Security's places are inside Home ("security/<tab>"); a social trading
 *  site is its page inside Social trading; Apps without one is the tray. Pure (app-bar.test.ts). */
export function landing(id: string, tab: string | undefined, pages: readonly string[]): { id: string; tab?: string } | "tray" | null {
  if (id === "security") return { id: "wallet", tab: tab && tab !== "overview" ? `security/${tab}` : "security" };
  // a social trading site (S17: pump.fun, GMGN) opens on its page inside Social trading; any other, the Browser
  if (id === "social") return tab && SOCIAL_SITES.includes(tab) && pages.includes(SOCIAL_TRADING) ? { id: SOCIAL_TRADING, tab } : pages.includes("social") ? { id: "social", ...(tab ? { tab } : {}) } : "tray";
  return pages.includes(id) ? { id, ...(tab ? { tab } : {}) } : null;
}

/** Whose tasks a page writes (D144): Social trading ("site:trading") writes the Browser's, where its sites' Adds always were. */
export const taskApp = (id: string): string => (id.startsWith("site:") ? "social" : id);

/** A swipe never starts on these: a sheet (its own drag), a field, a chart's scrub, or what asks not to be swiped. */
const NO_SWIPE = '[role="dialog"], .zf-sheet, input, textarea, select, canvas, [contenteditable=""], [contenteditable="true"], [data-swipe="off"]';
/** May a swipe between apps start at `t`? Only on a page, never on NO_SWIPE, and never inside something that scrolls
 *  sideways itself (a carousel keeps its own swipe). */
function swipeAllowed(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  const page = t.closest(".ah-page");
  if (!page || t.closest(NO_SWIPE)) return false;
  for (let el: Element | null = t; el && el !== page; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const o = getComputedStyle(el).overflowX;
      if (o === "auto" || o === "scroll") return false;
    }
  }
  return true;
}

type Drag = { id: number; x0: number; y0: number; axis: "x" | "y" | null; lockDx: number; pos0: number; start: number; samples: { t: number; x: number }[] };
type HostApi = {
  openApp: (id: string, tab?: string, link?: string, from?: string) => void;
  showProblem: (i: number, p: Problem) => Promise<NextStep>;
  endProblem: (i: number, p: Problem) => boolean;
  showWaiting: (i: number, h: { id: string; readyAtIso: string; needsSecondDevice: boolean }) => void;
  openSwitcher: () => void;
  openMenu: (back?: () => void) => void;
  openMoney: (i: number, ask: MoneyAsk, onEnd?: (end: MoneyEnd) => void) => void;
  /** Does this build show the app? */
  shows: (id: string) => boolean;
};

/** `shellBridge` runs and cancels held requests on the Waiting screen; apps only ever hand the shell their outcome. */
/** `start`: open on this app (and tab) instead of Home (D31b), as if the shell had called openApp(id, tab). */
/** `startWithTray`: the tray open from the first frame (the screens gallery). */
/** `firstTray`: the first time the person ever opens the app, the grab bar glows a little stronger for a few pulses (
 *  3 Nov; kept in device.store). The tray itself never opens by itself. */
/** `notice`: what must be said over every app (the freeze banner, the funding's thread): the shell's one notice at the
 *  bottom, first in line (product decision, 3 Nov: never a popup on top). A NoticeItem is one line with its ×; any other content
 *  takes the same place as it is. A function is given the shell's openApp, for a banner whose button opens an app. */
/** `run`: what works in the background while the apps are shown, whichever is on screen (Spending's engine, D52/H23); it
 *  returns its stop, called when the apps leave (the lock, a Problem screen, leaving the account). */
/** A notice given as one line with its × (NoticeBar.tsx), not as content. */
const isNoticeItem = (n: unknown): n is NoticeItem => !!n && typeof n === "object" && typeof (n as NoticeItem).key === "string" && typeof (n as NoticeItem).line === "string";
/** Another app fills in Trade's own Buy or Sell page: the rules (only AgentZero's own page, on screen at the moment it
 *  asks; Trade shown; a chain Trade lists) are trade-ask.ts's shellAsk, loaded with the first ask, never in Home's load. */
const askTrade = (host: HostApi, ask: TradeAsk, onEnd: ((end: TradeEnd) => void) | undefined, from: string, onScreen: boolean) =>
  void import("@zerofee/shell-api/trade-ask.ts").then((m) => m.shellAsk(host, ask, onEnd, from, onScreen), () => onEnd?.({ went: false, refused: "Trade didn't open." }));

export function AppHost({ apps: given_, onMenu, shellBridge, startWithTray = false, firstTray = false, start: asked, notice: given, run }: { apps: HostedApp[]; onMenu: (back?: () => void) => void; shellBridge: Bridge; startWithTray?: boolean; firstTray?: boolean; start?: { id: string; tab?: string }; notice?: NoticeItem | ReactNode | ((openApp: (id: string, tab?: string) => void) => ReactNode); run?: () => () => void }) {
  useEffect(() => run?.(), [run]);
  // The tray's order (kept on this device, D147): its first four are the bottom row; the pages swipe in its order. The
  // locked tiles are in it too (never pages); an app this build does show (`?all`) is its real tile instead.
  const ids: string[] = given_.map((a) => a.id);
  const available = [...ids, ...LOCKED_IDS.filter((id) => !ids.includes(id))];
  const [order, setOrder] = useState(() => orderFor(available, savedOrder()));
  const shownOrder = useMemo(() => orderFor(available, order), [available.join(), order.join()]);
  const shownRow = useMemo(() => rowOf(shownOrder), [shownOrder.join()]);
  const apps = useMemo(() => pageOrder(given_, shownOrder), [given_, shownOrder.join()]);
  const appsRef = useRef(apps);
  appsRef.current = apps;
  const start = useMemo(() => {
    if (!asked) return undefined;
    const to = landing(asked.id, asked.tab, ids);
    return to && to !== "tray" ? to : undefined;
  }, []);
  const [index, setIndex] = useState(() => startAppIndex(apps, start));
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) {
      for (const a of apps) a.preload?.();
      preloadSheets();
      void WaitingView.preload().catch(() => undefined);
      return;
    }
    const t = window.setTimeout(() => setNear(true), NEIGHBOURS_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [near]);
  /** Apps shown once stay shown (their screen is kept), by id; `kept` grows only. */
  const kept = useRef(new Set<string>());
  const [, keep] = useState(0);
  const [tray, setTray_] = useState(startWithTray);
  /** What the last hold in the tray did, said there until it closes. */
  const [trayNote, setTrayNote] = useState("");
  /** The grab bar glows now and then until the tray has been opened once in this session (product decision, 3 Nov). */
  const [beckon, setBeckon] = useState(() => !startWithTray && trayBeckons());
  /** The locked apps' module once loaded, and the one whose "Coming soon." sheet is up, if any. */
  const [lockedMod, setLockedMod] = useState<Awaited<ReturnType<typeof lockedApps>> | null>(null);
  const [soon, setSoon] = useState("");
  const [trayMod, setTrayMod] = useState(trayHere);
  useEffect(() => {
    if (!trayMod) void trayModule().then(setTrayMod, () => {});
  }, [tray]);
  useEffect(() => {
    if (near || tray) void lockedApps().then(setLockedMod, () => {});
  }, [near, tray]);
  const setTray = (open: boolean) => {
    setTray_(open);
    if (!open) setTrayNote("");
    else {
      markTraySeen();
      setBeckon(false);
    }
  };
  // product decision, 3 Nov (P0): the tray NEVER opens by itself, only on the person's swipe or tap. The very first time ever, the grab
  // bar glows a little stronger for a few pulses instead (compositor-only), then the usual beckon (D147).
  const [firstGlow, setFirstGlow] = useState(false);
  useEffect(() => {
    if (!firstTray || startWithTray) return;
    const store = given_.find((a) => a.id === "wallet")?.bridge ?? shellBridge;
    let live = true;
    let done: ReturnType<typeof setTimeout> | undefined;
    void import("./tray-first.ts").then((m) => m.trayFirstTime(store)).then((first) => {
      if (!live || !first) return;
      setFirstGlow(true);
      done = setTimeout(() => setFirstGlow(false), 7000);
      // never keeps a test's process alive (node only; a browser has no unref)
      (done as unknown as { unref?: () => void }).unref?.();
    }, () => undefined);
    return () => { live = false; if (done) clearTimeout(done); };
  }, []);
  const [requested, setRequested] = useState<{ id: string; tab?: string; link?: string; seq: number } | null>(start && apps.some((a) => a.id === start.id) ? { ...start, seq: 0 } : null);
  const seq = useRef(0);
  /** The one money sheet, over the app that asked (Job 1, criterion 6); null when none is up. */
  const [money, setMoney] = useState<{ ask: MoneyAsk; at: number; onEnd?: (end: MoneyEnd) => void; seq: number } | null>(null);
  // UI's no-hang audit (3 Nov): a money sheet replaced by a newer one still tells its asker it ended ("not now", nothing
  // moved), and every asker hears its end exactly once, however the sheet goes
  const moneyNow = useRef(money);
  moneyNow.current = money;
  const once = (f?: (end: MoneyEnd) => void): ((end: MoneyEnd) => void) | undefined => {
    if (!f) return undefined;
    let told = false;
    return (end) => { if (told) return; told = true; f(end); };
  };
  const replaceMoney = (next: { ask: MoneyAsk; at: number; onEnd?: (end: MoneyEnd) => void; seq: number }) => {
    const old = moneyNow.current;
    const onEnd = once(next.onEnd);
    setMoney({ ...next, ...(onEnd ? { onEnd } : {}) });
    old?.onEnd?.({ went: false });
  };
  /** The web wallet's On your phone page for an app it doesn't have (AgentZero, Chat), over the app on screen. */
  const [phone, setPhone] = useState<PhoneReason | null>(null);
  const [went, setWent] = useState<{ text: string; state: "busy" | "went" | "quiet" } | null>(null);
  useEffect(() => onWent(setWent), []);
  // Problems and Waiting screens line up per app (first in, first out) and the shell shows the first item of the app on
  // screen: an app that isn't on screen (the shell renders neighbours too) never covers the one the person is looking
  // at; its item shows when it's opened. A second item never replaces the one showing. Each Problem resolves its own
  // promise with the step tapped. `overlays` is a ref (the line outlives renders); `tick` re-renders when it changes.
  const overlays = useRef(createOverlayQueue());
  const [, tick] = useState(0);
  const bump = () => tick((n) => n + 1);
  // The index as it is now, for callbacks an app keeps from an earlier render (a stale `index` sent Problems astray).
  const indexRef = useRef(index);
  indexRef.current = index;
  const root = useRef<HTMLDivElement>(null);
  const width = () => root.current?.clientWidth || 393;
  /** Screen pixels per app pixel: below 1 when the app is shown scaled down inside a frame (a laptop). */
  const scale = () => {
    const el = root.current;
    return el && el.clientWidth ? el.getBoundingClientRect().width / el.clientWidth : 1;
  };
  const clamp = (i: number) => Math.max(0, Math.min(apps.length - 1, i));

  // ── Where the pages are. `pos` is in pages (1.5: halfway from the second app to the third); `goal` is where they are
  // going. A far jump (Security → Apps) brings the app in from the side, as if it were next door: `remap` gives the two
  // apps their places for that flight. Nothing here renders: paint() writes the pages' and the bar's style. ──────────
  const pages = useRef<(HTMLElement | null)[]>([]);
  const bar = useRef<HTMLElement | null>(null);
  const pos = useRef(index);
  const goal = useRef(index);
  const remap = useRef<Map<number, number> | null>(null);
  const flight = useRef<(() => void) | null>(null);
  const fade = useRef<{ anim: Animation; from: number; to: number } | null>(null);
  /** A compositor flight is under way (slide): paint() leaves the pages and the marker to it. */
  const sliding = useRef(false);
  /** While pages move under the app bar (a slide or a finger), the bar drops its backdrop blur for a solid ground, so the
   *  blur isn't recomputed every frame over moving pages (speed worker, 3 Nov); it comes back at rest. One attribute
   *  write at each end, never one per frame. */
  const moving = (on: boolean) => root.current?.toggleAttribute("data-moving", on);
  const paint = () => {
    if (sliding.current) return;
    const W = width();
    const p = pos.current;
    const map = remap.current;
    const f = fade.current;
    pages.current.forEach((el, i) => {
      if (!el) return;
      const slot = map ? map.get(i) : i;
      const off = slot === undefined ? 9 : slot - p;
      const seen = Math.abs(off) < 0.999 || f?.from === i;
      const t = !seen || off === 0 || f?.from === i ? "" : `translate3d(${Math.round(off * W * 100) / 100}px,0,0)`;
      if (el.style.transform !== t) el.style.transform = t;
      const v = seen ? "" : "hidden";
      if (el.style.visibility !== v) el.style.visibility = v;
    });
    let at = p;
    if (map) {
      const [[a, sa], [b, sb]] = [...map] as [[number, number], [number, number]];
      at = a + (b - a) * ((p - sa) / (sb - sa));
    }
    const row = shownRowRef.current;
    glideBar(bar.current, markSlot(Math.max(0, Math.min(apps.length - 1, at)), appsRef.current.map((a) => a.id), row, litRef.current), row.length);
  };
  /** The app lit in the bar while another app's screen, opened from it with a back link, is up (markSlot). */
  const litRef = useRef<{ on: string; as: string } | null>(null);
  const [lit, setLit] = useState<{ on: string; as: string } | null>(null);
  const setLitNow = (v: { on: string; as: string } | null) => { litRef.current = v; setLit(v); };
  // swiped off the screen that carried the mark: the mark is the plain one again
  const lastAt = useRef(index);
  useEffect(() => {
    const was = appsRef.current[lastAt.current]?.id;
    lastAt.current = index;
    if (litRef.current && was === litRef.current.on && appsRef.current[index]?.id !== was) setLitNow(null);
  }, [index]);
  const shownRowRef = useRef(shownRow);
  shownRowRef.current = shownRow;
  useLayoutEffect(paint);
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => paint());
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  /** The React side follows once the pages are still: which app is on screen (its `active`, the others inert). */
  const commit = (to: number) => {
    if (to === indexRef.current) return;
    indexRef.current = to;
    startTransition(() => setIndex(to));
  };
  /** Show an app now (a swipe's neighbour, a tap's target): it renders, and its first screen fades in. */
  const show = (i: number) => {
    const id = appsRef.current[i]?.id;
    if (!id || kept.current.has(id)) return;
    kept.current.add(id);
    keep((n) => n + 1);
  };
  const hapticBridge = apps[0]?.bridge ?? shellBridge;
  const haptic = (kind: "tap" | "success" = "tap") => {
    try {
      void hapticBridge.call("device.haptic", { kind }).catch(() => undefined);
    } catch {
      /* a bridge without the phone: nothing to feel */
    }
  };
  /** Ends a far jump's flight or a crossfade at once (a new move starts from a still page). */
  const land = () => {
    if (!remap.current && !fade.current) return;
    flight.current?.();
    flight.current = null;
    const f = fade.current;
    fade.current = null;
    f?.anim.cancel();
    remap.current = null;
    pos.current = goal.current;
    paint();
    commit(goal.current);
  };
  /** Move to app `to`: a spring from where the pages are (at `velocity`, pages per second, from a release), a crossfade
   *  with Reduce Motion, or at once (`now`: behind the switcher). */
  /** The tab a finger is down on (AppBar onPress): its light tap was given then, so the switch it makes gives none. */
  const pressed = useRef(-1);
  const go = (target: number, velocity = 0, now = false, felt = false) => {
    const to = clamp(target);
    land();
    flight.current?.();
    flight.current = null;
    if (to !== goal.current && !felt) haptic();
    goal.current = to;
    show(to);
    // usable from the first frame (speed, D145): the app it goes to takes taps while it slides in, and the one it leaves
    // takes none; React's own inert and aria-hidden follow at the commit with the same values
    pages.current.forEach((p, i) => {
      if (!p) return;
      p.inert = i !== to;
      p.setAttribute("aria-hidden", String(i !== to));
    });
    const from = pos.current;
    if (now || reducedMotion()) {
      const was = Math.round(from);
      pos.current = to;
      const el = pages.current[to];
      if (now || was === to || !el || typeof el.animate !== "function") {
        paint();
        return commit(to);
      }
      // Reduce Motion: the app on screen stays still under the next one, which fades in over it
      el.style.zIndex = "1";
      const anim = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
      fade.current = { anim, from: was, to };
      paint();
      const end = () => {
        if (fade.current?.anim !== anim) return;
        fade.current = null;
        el.style.zIndex = "";
        paint();
        commit(to);
      };
      anim.onfinish = end;
      anim.oncancel = () => {
        el.style.zIndex = "";
      };
      return;
    }
    let dest = to;
    if (Math.abs(to - from) > 1.001) {
      const base = Math.round(from);
      const d = Math.sign(to - base);
      remap.current = new Map([[base, base], [to, base + d]]);
      pos.current = base;
      dest = base + d;
    }
    flight.current = slide(pos.current, dest, to, () => {
      flight.current = null;
      remap.current = null;
      pos.current = to;
      paint();
      commit(to);
    });
  };
  /** A flight on the compositor (slide.ts: transform only, never a style per frame); its code not here yet (the first
   *  tap within a moment of opening), the switch is made at once. stop() halts the pages where they are. */
  const slide = (from: number, dest: number, to: number, done: () => void): (() => void) => {
    const code = slideCode;
    if (!code) { done(); return () => {}; }
    const row = shownRowRef.current, ids = appsRef.current.map((x) => x.id);
    return code.fly({
      pages: pages.current, map: remap.current, from, dest, to, W: width(), bar: bar.current, n: row.length,
      slotOf: (x) => barSlot(Math.max(0, Math.min(apps.length - 1, x)), ids, row),
      start: () => { sliding.current = true; moving(true); },
      end: () => { sliding.current = false; moving(false); done(); },
      // stopped mid-way: the pages stay where they are, under the finger
      stop: (at) => { sliding.current = false; moving(false); if (at !== null) pos.current = at; paint(); },
    });
  };
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tray || soon || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as Element | null;
      if (t instanceof Element && t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowRight") go(goal.current + 1);
      if (e.key === "ArrowLeft") go(goal.current - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Which app handed the person to each app (openApp from another app): where a Waiting screen's Done goes back to. */
  const openedBy = useRef(new Map<string, string>());
  const openApp = (id: string, tab?: string, link?: string, from?: string): void => {
    // D146: a parked sheet's task in the Activity centre: its app, and the sheet up again, as it was asked
    if (tab?.startsWith(PARKED)) {
      const p = parked.current.get(tab);
      const j = appsRef.current.findIndex((a) => a.id === (p?.app ?? id));
      if (!p || j < 0) return openApp(id, undefined, link, from);
      parked.current.delete(tab);
      taskStore().remove(TASK_APPS[taskApp(p.app)]![0]!, tab);
      if (j !== goal.current) go(j);
      // it opens once its app is on screen (the sheet shows only there); the asker heard "not now" when it was parked,
      // so it hears again only if it goes
      replaceMoney({ ask: p.ask, at: j, onEnd: (end) => { if (end.went) p.onEnd?.(end); }, seq: ++seq.current });
      return;
    }
    const folded = foldedInto(id, tab);
    if (folded) return openApp(folded.id, folded.tab, link, from);
    const list = appsRef.current;
    const to = landing(id, tab, list.map((a) => a.id));
    if (to === "tray") return setTray(true);
    const j = to ? list.findIndex((a) => a.id === to.id) : -1;
    if (!to || j < 0) {
      // An app this build doesn't show (D31): the Problem screen on the app on screen, never nothing.
      // the web wallet: an app that lives on the phone (AgentZero, Chat) is its On your phone page
      if (webWallet() && PHONE_ON_WEB[id]) { setPhone(PHONE_ON_WEB[id]!); return; }
      void overlays.current.push(list[indexRef.current]!.id, { kind: "problem", problem: HIDDEN_APP_PROBLEM });
      bump();
      return;
    }
    if (from && from !== to.id) openedBy.current.set(to.id, from);
    // the app it came from stays lit while this screen is up (a back link to it); any other open clears the mark
    const back = readBack(link);
    setLitNow(back && back.app !== to.id && shownRowRef.current.includes(back.app) ? { on: to.id, as: back.app } : null);
    setRequested({ id: to.id, tab: to.tab, link, seq: ++seq.current });
    go(j);
  };
  const notice = typeof given === "function" ? given((id, tab) => openApp(id, tab)) : given;
  const noticeItem = isNoticeItem(notice) ? notice : null;
  // What a page's context calls, always the latest (a page's context is made once and kept: no re-render to pass on).
  const api = useRef<HostApi>(null as unknown as HostApi);
  api.current = {
    openApp,
    showProblem: (i, p) => {
      const step = overlays.current.push(apps[i].id, { kind: "problem", problem: p });
      if (i === indexRef.current) bump();
      return step;
    },
    endProblem: (i, p) => {
      const gone = overlays.current.drop(apps[i].id, p, { kind: "nothing", label: "Back" });
      if (gone && i === indexRef.current) bump();
      return gone;
    },
    showWaiting: (i, h) => {
      void overlays.current.push(apps[i].id, { kind: "waiting", held: { id: h.id, readyAtIso: h.readyAtIso, needsSecondDevice: h.needsSecondDevice } });
      if (i === indexRef.current) bump();
    },
    openSwitcher: () => setTray(true),
    // a button's click hands its event: only a function is a way back
    openMenu: (back) => onMenu(typeof back === "function" ? back : undefined),
    // D146: a sheet belongs to the app that asked and shows only while it is on screen: asked by an app the person has
    // already left (a site's sheet that came late), it never shows; the app hears "not now", nothing moved
    openMoney: (i, ask, onEnd) => {
      if (i !== indexRef.current) return void onEnd?.({ went: false });
      replaceMoney({ ask, at: i, ...(onEnd ? { onEnd } : {}), seq: ++seq.current });
    },
    shows: (id) => appsRef.current.some((a) => a.id === id),
  };
  // A-4: Siri or a shortcut asked for something (host/intent.ts): taken once the app is showing, and again each time
  // the phone says one came in. It only opens and fills in: AgentZero's field, or Wallet's Send. Never over a money
  // sheet, a Problem or Waiting screen already up (review M: it would replace a send under way): it stays on the phone
  // until they close. Its code loads after the first paint, on the phone only (speed budget).
  const intentTake = useRef(() => {});
  useEffect(() => {
    const host = iosHost();
    if (!host) return;
    const take = (intentTake.current = () => void (blocked.current || moneyUp.current || import("../host/intent.ts").then((m) => m.takeIntent(host, api, indexRef))));
    take();
    // A-6: AgentZero's finished steps as the phone's own notifications while ZeroFee is away (host/job-alerts.ts)
    // (a screen gone before its code arrived never listens: one notification per event, never two)
    let stopJobs: (() => void) | null = null, gone = false;
    void import("../host/job-alerts.ts").then((m) => { stopJobs = m.watchJobs(host); if (gone) stopJobs(); });
    const off = host.on("shell.intent", take);
    return () => { gone = true; off(); stopJobs?.(); };
  }, []);
  const current = apps[index];
  const overlay = current ? overlays.current.first(current.id) : undefined;
  /** A swipe can't start under a Problem or Waiting screen, or the tray. */
  const blocked = useRef(false);
  blocked.current = Boolean(overlay) || tray || Boolean(soon);
  const moneyUp = useRef(false);
  moneyUp.current = money !== null;
  useEffect(() => intentTake.current(), [blocked.current, moneyUp.current]);
  // review M5: the shell's sheets hear whether a money step is open (a relay's Face ID sheet shows only then)
  screenMoney(money !== null);
  // D146: the person left the app whose sheet is up: it is put away, never shown over another app. Nothing it would sign
  // has been asked (its Approve comes only from a tap on it), so nothing moves; it waits in the Activity centre as
  // "Waiting for you", a tap there brings its app back with the sheet up again.
  const parked = useRef(new Map<string, { ask: MoneyAsk; app: string; onEnd?: (end: MoneyEnd) => void }>());
  useEffect(() => {
    const here = apps[index]?.id;
    if (here) screenApp(here);
    const m = money;
    if (!m || m.at === index) return;
    setMoney(null);
    const app = apps[m.at]?.id;
    if (app && TASK_APPS[taskApp(app)]) {
      const id = `${PARKED}${m.seq}`;
      parked.current.set(id, { ask: m.ask, app, ...(m.onEnd ? { onEnd: m.onEnd } : {}) });
      taskStore().forApp(taskApp(app)).publish(parkedTask(id, m.ask));
    }
    m.onEnd?.({ went: false });
  }, [index]);
  // a parked sheet lives only in this run: one left from before a restart can't come back up, so it goes
  useEffect(() => {
    const store = taskStore();
    for (const t of store.list()) if (t.open?.route?.startsWith(PARKED)) store.remove(t.app, t.id);
  }, []);

  // ── The swipe: touch (its own events, so a vertical scroll is the browser's from the first move) and a mouse or pen
  // (pointer events). Listeners are the page's own, non-passive: a horizontal drag stops the page scrolling. ─────────
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let g: Drag | null = null;
    let quietUntil = 0;
    const begin = (id: number, x: number, y: number, target: EventTarget | null) => {
      g = null;
      if (blocked.current || apps.length < 2 || !swipeAllowed(target)) return;
      const r = root.current?.getBoundingClientRect();
      if (!r || !fromEdge((x - r.left) / scale(), width())) return;
      g = { id, x0: x, y0: y, axis: null, lockDx: 0, pos0: pos.current, start: goal.current, samples: [] };
    };
    /** Returns true while the drag is the shell's (the caller then stops the browser's own handling). */
    const move = (x: number, y: number): boolean => {
      const d = g;
      if (!d) return false;
      const s = scale();
      const dx = (x - d.x0) / s;
      const dy = (y - d.y0) / s;
      if (d.axis === null) {
        const axis = lockAxis(dx, dy);
        if (axis === null) return Math.abs(dx) > Math.abs(dy);
        if (axis === "y") {
          g = null;
          return false;
        }
        // caught: a moving page stops under the finger, and the drag goes on from there
        land();
        flight.current?.();
        flight.current = null;
        d.axis = "x";
        moving(true);
        d.lockDx = dx;
        d.pos0 = pos.current;
        d.start = Math.round(pos.current);
        show(d.start - 1);
        show(d.start + 1);
        setNear(true);
      }
      const raw = Math.max(d.start - 1, Math.min(d.start + 1, d.pos0 - (dx - d.lockDx) / width()));
      pos.current = clampPos(raw, apps.length);
      const t = performance.now();
      d.samples.push({ t, x: dx });
      if (d.samples.length > 12) d.samples.shift();
      paint();
      return true;
    };
    const end = (cancelled = false) => {
      const d = g;
      g = null;
      if (!d || d.axis !== "x") return;
      moving(false);
      quietUntil = performance.now() + 350;
      const v = cancelled ? 0 : (-fingerVelocity(d.samples, performance.now()) * 1000) / width();
      goRef.current(releaseTarget({ start: d.start, pos: pos.current, velocity: v, count: apps.length }), v);
    };
    const touchOf = (e: TouchEvent) => (g ? [...e.changedTouches].find((t) => t.identifier === g!.id) : undefined);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        if (g?.axis === "x") end(true);
        g = null;
        return;
      }
      const t = e.touches[0]!;
      begin(t.identifier, t.clientX, t.clientY, e.target);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = touchOf(e);
      if (t && move(t.clientX, t.clientY) && e.cancelable) e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (touchOf(e)) end(e.type === "touchcancel");
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      begin(e.pointerId, e.clientX, e.clientY, e.target);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !g || g.id !== e.pointerId) return;
      if (move(e.clientX, e.clientY) && g?.axis === "x") globalThis.getSelection?.()?.removeAllRanges();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch" && g?.id === e.pointerId) end(e.type === "pointercancel");
    };
    // the click at the end of a swipe is not also a tap on what it started on
    const onClick = (e: MouseEvent) => {
      if (performance.now() < quietUntil) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("click", onClick, true);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("click", onClick, true);
    };
  }, [apps.length]);
  useEffect(() => () => flight.current?.(), []);

  const finish = (step: NextStep) => {
    overlays.current.finish(current.id, step);
    bump();
  };
  /** An `open` step tapped on a Problem or Waiting screen. The screen goes away first; then, when the step names a place
   * in the whole app ("<app>/<tab>", see Problem.next), the shell takes the person there. Any other name is the owning
   * app's own screen: it only gets the tapped step back, as before. */
  const openScreen = (step: Extract<NextStep, { kind: "open" }>) => {
    finish(step);
    // "held/<id>": a request the account holds (a Top up's "Finish my new rules"), opened in place over the app that
    // asked, so its Done comes straight back there (mainnet 2 Nov: a test account was sent to Security and lost its Top up).
    const held = /^held\/(\d{1,20})$/.exec(step.screen);
    if (held) {
      void overlays.current.push(current.id, { kind: "waiting", held: { id: held[1]!, readyAtIso: new Date(0).toISOString(), needsSecondDevice: false }, inPlace: true });
      bump();
      return;
    }
    const to = routeScreen(step.screen, [...apps.map((a) => a.id), "security", "social"]);
    if (to) openApp(to.app as AppId, to.tab);
  };
  const all = useMemo(() => barItems(given_), [given_.map((a) => `${a.id}:${a.name}`).join()]);
  /** Every tile in the tray's order: the apps' and the locked ones'. */
  const tiles = useMemo(() => shownOrder.map((id) => all.find((x) => x.id === id) ?? LOCKED_APPS.find((x) => x.id === id)).filter((t): t is AppBarItem => Boolean(t)), [all, shownOrder.join()]);
  /** The bottom row: a straight view of the first five tiles (D147, five since 3 Nov). */
  const items = useMemo(() => tiles.slice(0, shownRow.length), [tiles, shownRow.length]);
  /** A locked tile tapped (in the tray or the bottom row): its "Coming soon" sheet; the app on screen stays. */
  const openSoon = (id: string) => {
    void lockedApps().then(setLockedMod, () => {});
    setSoon(id);
  };
  const soonRef = useRef(openSoon);
  soonRef.current = openSoon;
  const pick = useMemo(() => (i: number) => {
    const felt = pressed.current === i;
    pressed.current = -1;
    const id = shownRowRef.current[i];
    if (litRef.current) { litRef.current = null; setLit(null); }
    const j = appsRef.current.findIndex((a) => a.id === id);
    if (j < 0) return void (id && soonRef.current(id));
    if (j !== goal.current) goRef.current(j, 0, false, felt);
    else homeRootRef.current(id!);
  }, []);
  /** The tab already on screen tapped again: the app hears `zf:home-root` and returns to its own root. Its money sheet
   *  (MoneyHost) closes by its own Close path, a "not now" that is sealed like the person's ✕; this only announces. */
  const homeRoot = (id: string) => {
    if (typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent("zf:home-root", { detail: { app: id } }));
  };
  const homeRootRef = useRef(homeRoot);
  homeRootRef.current = homeRoot;
  /** A finger down on a tab (the capsule, product decision, 4 Nov): the light tap as the icon gives, before the switch. */
  const press = useMemo(() => (i: number) => {
    pressed.current = i;
    haptic();
  }, []);
  const openTray = useMemo(() => () => {
    haptic();
    setTray(true);
  }, []);
  /** A drag in the tray (D147): the tile at `from` lands at `to`; the first five are the bottom row. The app on screen
   *  stays on screen; the order is kept on this phone, and the phone's tap marks the drop. */
  const arrange = (from: number, to: number) => {
    const next = moveItem(shownOrder, from, to);
    const id = shownOrder[from]!;
    haptic("success");
    setTrayNote(arrangeNote(shownRow, rowOf(next), id, (x) => tiles.find((a) => a.id === x)?.label ?? x));
    const here = appsRef.current[indexRef.current]?.id;
    const j = Math.max(0, pageOrder(given_, next).findIndex((a) => a.id === here));
    land();
    flight.current?.();
    flight.current = null;
    pos.current = goal.current = j;
    indexRef.current = j;
    setIndex(j);
    setOrder(next);
    saveOrder(next);
  };
  const pickInTray = (id: string) => {
    const j = appsRef.current.findIndex((a) => a.id === id);
    setTray(false);
    if (j < 0) return openSoon(id);
    if (j !== goal.current) go(j, 0, Math.abs(j - goal.current) > 1);
  };
  const showBar = apps.length > 1;
  // A quiet dot on each tab whose app has work going (shell-api newsApps), never the one on screen; and the bar steps
  // aside while a page scrolls down, back on the way up (bar-scroll.ts; never under Reduce Motion).
  const [, setTaskTick] = useState(0);
  useEffect(() => taskStore().subscribe(() => setTaskTick((n) => n + 1)), []);
  const newsKey = [...newsApps(taskStore().list(), current?.id)].sort().join();
  const news = useMemo(() => new Set(newsKey ? newsKey.split(",") : []), [newsKey]);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    return followScroll(el, () => bar.current);
  }, []);
  // The money sheet's context: Wallet's own bridge (the money moves as it always did), the app that asked for the rest
  // (its Problems and Waiting screens show over it).
  const walletBridge = given_.find((a) => a.id === "wallet")?.bridge;
  // the shell's notices: a service that stopped (B30), AgentZero at work (D114); with the freeze and a move that went,
  // one at a time at the bottom (NoticeBar.tsx)
  const serviceNotice = useServiceNotice(walletBridge ?? null);
  const agentNotice = useAgentZeroNotice();
  const moneyCtx: AppContext | null = walletBridge && money ? {
    bridge: walletBridge,
    openApp: (id, tab, link) => api.current.openApp(id, tab, link, "wallet"),
    showProblem: (p) => api.current.showProblem(money.at, p),
    showWaiting: (h) => api.current.showWaiting(money.at, h),
    openMoney: (ask, onEnd) => api.current.openMoney(money.at, ask, onEnd),
    openTrade: (ask, onEnd) => askTrade(api.current, ask, onEnd, "wallet", false),
    tasks: taskStore().forApp("wallet"),
    openSwitcher: () => api.current.openSwitcher(),
    openMenu: (back) => api.current.openMenu(back),
    active: true,
    index: money.at,
    count: apps.length,
  } : null;
  return (
    <div className={`ah${showBar ? " ah--bar" : ""}${firstGlow ? " ah--first" : ""}`} ref={root}>
      {/* under a Problem or Waiting screen the apps can't be reached or read (one screen at a time, one Done) */}
      <div inert={overlay ? true : undefined} aria-hidden={overlay ? true : undefined} className="ah-track">
        {apps.map((app, i) => {
          const shown = kept.current.has(app.id) || i === index || (near && Math.abs(i - index) <= 1);
          if (shown) kept.current.add(app.id);
          const asked = requested?.id === app.id ? requested : null;
          return <AppPage key={app.id} app={app} i={i} count={apps.length} here={i === index} active={i === index && !tray} shown={shown} requestedTab={asked?.tab} requestSeq={asked?.seq} requestedLink={asked?.link} api={api} pages={pages} />;
        })}
      </div>
      {showBar && !overlay && <AppBar items={items} current={Math.round(markSlot(index, apps.map((a) => a.id), shownRow, lit && apps[index]?.id === lit.on ? lit : null))} onPick={pick} onPress={press} onHold={openTray} onOpenTray={openTray} hint={beckon} news={news} barRef={bar} />}
      {phone && <OnYourPhone reason={phone} onClose={() => setPhone(null)} />}
      {overlay && (
        // Keyed by the app and the item, so the next item is a fresh screen: never the old one acting on a new id.
        <div className="ah-problem" key={`${current.id}:${overlay.kind === "problem" ? overlay.problem.code : overlay.held.id}:${overlays.current.count(current.id)}`}>
          {/* The arrow, Back and Escape close a Problem screen, as its own way out (grade 01c, P5: the Apps one trapped the person) */}
          {overlay.kind === "problem"
            ? <ProblemView close problem={overlay.problem} onBack={() => finish({ kind: "nothing", label: "Back" })} onNext={() => finish(overlay.problem.next)} onOpen={(screen) => openScreen({ kind: "open", label: overlay.problem.next.label, screen })} onNext2={next2Screen(overlay.problem, openScreen)} />
            : <WaitingView key={overlay.held.id} bridge={shellBridge} held={overlay.held} onClose={() => {
              finish({ kind: "nothing", label: "Done" });
              // Opened in place from this app's own step (a Top up's "Finish my new rules"): stay, on the sheet that asked
              // (UX walk 2 Nov: Apps → Make $10 ready → Top up → Finish → Back left the person on Apps' list).
              if (overlay.inPlace) return;
              // Done goes back to the app that handed the person here (Wallet's Send → Pay): its Activity lists the hold.
              const back = returnAfterWaiting(current.id, openedBy.current.get(current.id));
              if (back) { openedBy.current.delete(current.id); openApp(back.app, back.tab); }
            }} onOpen={(label, screen) => openScreen({ kind: "open", label, screen })} />}
        </div>
      )}
      {money && moneyCtx && money.at === index && (
        <ShellContext.Provider value={moneyCtx}>
          <MoneyHost key={money.seq} ask={money.ask} asker={apps[money.at]?.id} onEnd={(end) => { const m = money; setMoney((c) => (c?.seq === m.seq ? null : c)); m.onEnd?.(end); }} />
        </ShellContext.Provider>
      )}
      {/* Product decision, 3 Nov: one notice at a time, one line at the bottom above the app row, with its × (NoticeBar.tsx). Content
          given as it is (the funding's thread) takes the same place, first in line. */}
      {notice && !noticeItem
        ? <div className="zf-notice zf-notice--given">{notice as ReactNode}</div>
        : <NoticeBar items={[
            noticeItem,
            // D114: AgentZero's browser at work on this phone, with its Stop
            agentNotice,
            // HOME-VISUAL §3.7: not while Home is on screen (its live row says the same)
            went && went.text && current?.id !== "wallet" ? { key: `went:${went.state}:${went.text}`, rank: RANK.went, line: went.text } : null,
            // B30: a service that stopped, by name; it leaves by itself when it is back
            serviceNotice,
            // (the dust line moved to the top, with Beta: ModeMark.tsx, product decision, 3 Nov)
          ]} here={current?.id} />}
      {tray && trayMod && <trayMod.Tray apps={tiles} pinned={shownRow} current={current?.id} note={trayNote} onPick={pickInTray} onMove={arrange} onLift={() => haptic()} onClose={() => setTray(false)} />}
      {soon && lockedMod && <lockedMod.SoonSheet id={soon} onClose={() => setSoon("")} />}
    </div>
  );
}

/**
 * One app's page. Memoised, with a context made once per change of what it holds: moving between apps, a Problem
 * elsewhere or the bar re-render nothing inside an app that didn't change. Its first screen fades in when it first
 * shows (`.ah-app`), never pops.
 */
const AppPage = memo(function AppPage({ app, i, count, here, active, shown, requestedTab, requestSeq, requestedLink, api, pages }: {
  app: HostedApp;
  i: number;
  count: number;
  here: boolean;
  active: boolean;
  shown: boolean;
  requestedTab?: string;
  requestSeq?: number;
  requestedLink?: string;
  api: { current: HostApi };
  pages: { current: (HTMLElement | null)[] };
}) {
  // read when an ask comes, not when the context was made: an agent that thinks for a while keeps an old context
  const onScreen = useRef(active);
  onScreen.current = active;
  // which app is on screen, for what rests elsewhere (rest.ts: the live balance push runs only where money shows)
  useEffect(() => { setShown(app.id, active); return () => setShown(app.id, false); }, [app.id, active]);
  const ctx = useMemo<AppContext>(() => ({
    bridge: app.bridge,
    openApp: (id, tab, link) => api.current.openApp(id, tab, link, app.id),
    requestedTab,
    requestSeq,
    requestedLink,
    showProblem: (p) => api.current.showProblem(i, p),
    endProblem: (p) => api.current.endProblem(i, p),
    showWaiting: (h) => api.current.showWaiting(i, h),
    openSwitcher: () => api.current.openSwitcher(),
    openMenu: (back) => api.current.openMenu(back),
    openMoney: (ask, onEnd) => api.current.openMoney(i, ask, onEnd),
    openTrade: (ask, onEnd) => askTrade(api.current, ask, onEnd, app.id, onScreen.current),
    // D144: the shell stamps the app on its tasks (an app writes only its own; a site's app writes the Browser's)
    tasks: taskStore().forApp(taskApp(app.id)),
    active,
    index: i,
    count,
  }), [app, i, count, active, requestedTab, requestSeq, requestedLink]);
  const ref = useMemo(() => (el: HTMLElement | null) => {
    pages.current[i] = el;
  }, [i]);
  return (
    <section ref={ref} className="ah-page" aria-hidden={!here} inert={!here}>
      {shown && <ShellContext.Provider value={ctx}><AppBoundary name={app.name}><Suspense fallback={<AppWaiting name={app.name} />}><div className="ah-app">{app.render()}</div></Suspense></AppBoundary></ShellContext.Provider>}
    </section>
  );
});

/** A Problem's quiet link that names a place ("<app>/<tab>"): the shell takes the person there, as for its pill. */
function next2Screen(p: Problem, open: (step: Extract<NextStep, { kind: "open" }>) => void): (() => void) | undefined {
  const n2 = p.next2;
  return n2?.kind === "open" && n2.screen ? () => open({ kind: "open", label: n2.label, screen: n2.screen! }) : undefined;
}
