// Every page: the real app (and its unlock), the laptop page, ?demo and ?screens. The public build (D157) is the Sim
// only: the sample-money demo; the real app, the gallery, the fund walk and the laptop page aren't in that build at all
// (read inline, so the bundler drops them).
import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import type { Root } from "react-dom/client";
import { ModeMark } from "./shell/ModeMark.tsx";
import { ProblemView } from "./shell/ProblemView.tsx";
import { Title } from "./screens/Title.tsx";
import { APP_SAME_BROWSER, EXTENSION_BUILD, LAPTOP_PATH, MODE, WEB_WALLET, appRefusedHere } from "./mode.ts";
import { TopNotePage, topNoteOn } from "./top-note.tsx";
import { onPhone } from "@zerofee/shell-api/approval-words.ts";
import { UnlockGate } from "./unlock/UnlockGate.tsx";
import { setupUnfinished } from "./screens/setup-unfinished.ts";
import { FORK } from "@zerofee/core/fork";

/** The real app (and its core) loads only after the K-8 check: nothing opens the account's vault before it passes. */
let appCode: Promise<typeof import("./App.tsx")> | null = null;
let AppNow: typeof import("./App.tsx").App | null = null;
const loadApp = () =>
  (appCode ??= import("./App.tsx").then(
    (m) => ((AppNow = m.App), m),
    (e: unknown) => {
      appCode = null;
      throw e;
    },
  ));
// Each page's own code loads only on that page (speed, 2 Nov): the sample-money demo, the screens gallery and the laptop
// page never sit in the real app's first load.
const NONE = () => null;
const Screens = import.meta.env.VITE_ZEROFEE_PUBLIC === "1" ? NONE : lazy(() => import("./gallery/Screens.tsx").then((m) => ({ default: m.Screens })));
/** D157 (product decision, 4 Nov): the extension is the real, final app, with no Sim at all: its build ships no sample-money demo
 *  (read inline so the bundler drops it; only the load check's own test build, never zipped, keeps it). */
const EXTENSION_RELEASE = import.meta.env.VITE_ZEROFEE_TARGET === "extension" && import.meta.env.VITE_ZEROFEE_EXTENSION_CHECK !== "1";
const Demo = EXTENSION_RELEASE ? NONE : lazy(() => import("./gallery/Demo.tsx").then((m) => ({ default: m.Demo })));
/** The laptop page, behind its own lock off the phone (its Touch ID / Windows Hello words load with it, never in Home's
 *  first load). */
const LaptopGate = import.meta.env.VITE_ZEROFEE_PUBLIC === "1" ? NONE : lazy(() => import("./laptop/LaptopGate.tsx").then((m) => ({ default: m.LaptopGate })));
/** The "Add money to start" walk (?screens&walk=fund): the real core on a fake mainnet, 1Click stubbed. */
const FundWalk = import.meta.env.VITE_ZEROFEE_PUBLIC === "1" ? NONE : lazy(() => import("./gallery/FundWalk.tsx").then((m) => ({ default: m.FundWalk })));
const walk = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("walk");
/** Set-up's first screens, only on a device with nothing on it yet: a device that has an account opens on the lock. */
const FirstRun = lazy(() => import("./screens/FirstRun.tsx").then((m) => ({ default: m.FirstRun })));
/** The web wallet's first screens (WebStart.tsx): Create my wallet or I already have one, before its password. */
const WebStart = lazy(() => import("./screens/WebStart.tsx").then((m) => ({ default: m.WebStart })));

const page = "page" in MODE ? MODE.page : "app";
/** D157: the public site is the Sim, unless this browser chose the web wallet (product decision, 4 Nov: WEB_WALLET, the real
 *  app with no Safe, its words and keys in this browser under a password). */
const SIM_SITE = import.meta.env.VITE_ZEROFEE_PUBLIC === "1" && import.meta.env.VITE_ZEROFEE_TARGET !== "extension" && !WEB_WALLET;
// The phone has no K-8 check and no web lock: its App's code is asked for as this page loads, beside the first render (D134).
if (!SIM_SITE && page === "app" && !("refused" in MODE) && onPhone()) void loadApp().catch(() => undefined);

const UNLOADED = { code: "shell.app.unloaded", whatHappened: "ZeroFee's code didn't load. Try again.", money: { state: "safe", where: "in your Safe" }, next: { kind: "retry", label: "Try again" } } as const;

/**
 * The App, mounted the moment its code is here: a plain state change, never a Suspense retry, so React 19's 300 ms
 * fallback throttle never holds Home back (D134). The title shows only while the code is still coming.
 */
function LoadedApp() {
  const [App, setApp] = useState(() => AppNow);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (App || failed) return;
    let live = true;
    loadApp().then((m) => live && setApp(() => m.App), () => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [App, failed]);
  if (failed) return <ProblemView problem={UNLOADED} onNext={() => setFailed(false)} />;
  return App ? <Suspense fallback={<Title />}><App /></Suspense> : <Title />;
}

/**
 * K-8, the app's side: a browser that is already a laptop (second device) for an account can't also hold the account,
 * or one compromise of this browser would take both keys. The phone app has no laptop page, so it never asks.
 */
function AppGate() {
  const [state, setState] = useState<"checking" | "ok" | "refused">(onPhone() ? "ok" : "checking");
  useEffect(() => {
    if (state !== "checking") return;
    void (async () => {
      let names: string[] | null = null;
      try {
        names = (await indexedDB.databases()).map((d) => d.name ?? "").filter(Boolean);
      } catch {
        names = null;
      }
      setState(appRefusedHere(names, "page" in MODE && MODE.mainnet) ? "refused" : "ok");
    })();
  }, [state]);
  if (state === "checking") return <Title />;
  if (state === "refused") {
    return <ProblemView problem={{ code: "shell.app.same-browser", whatHappened: APP_SAME_BROWSER, money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Open the laptop page" } }} onNext={() => location.assign(LAPTOP_PATH)} />;
  }
  const app = <LoadedApp />;
  // The web wallet: its words first (made and checked, or typed), then its password, the one lock; the App then makes the
  // wallets from the words (web-start.ts holds them in memory until it does). The same 15-minute idle lock as any browser.
  if (WEB_WALLET) {
    const intro = (done: (lockNow?: boolean) => void) => (
      <Suspense fallback={<Title />}>
        <WebStart onWords={(words, made) => void import("./screens/web-start.ts").then((m) => (m.keepWebWords(words, made), done(false)))} />
      </Suspense>
    );
    return <UnlockGate web iphoneOnly={false} intro={intro}>{app}</UnlockGate>;
  }
  // In a browser every vault opens only with the person's passkey or passcode (audit K-1); the phone's is the Keychain.
  return onPhone() ? app : <UnlockGate intro={(done) => <Suspense fallback={<Title />}><FirstRun onDone={done} /></Suspense>} unfinished={setupUnfinished}>{app}</UnlockGate>;
}

/** Which mode mark this page shows: the mainnet copy's on every page of its build (VITE_FORK=1, core fork.ts), else Real's
 *  on mainnet, Sim's on the sample page, none elsewhere. */
const MARK: "real" | "sim" | "copy" | null = "refused" in MODE ? null : FORK ? "copy" : MODE.mainnet ? "real" : page === "demo" ? "sim" : null;
/**
 * In a browser there is no status bar, so the mark gets its own strip above the app (mode-mark.css .zf-under-mark): the
 * app sits under it, never under the mark. The iPhone app has its status bar: the mark sits in that gap, as before.
 */
const STRIP = MARK !== null && !onPhone();
/**
 * The web app's top note (product decision, 5 Nov; top-note.tsx): above the app on every screen of the public web build.
 * The build flag is read inline, so a build that isn't the public one (the phone's apps/ios/build-web.sh) folds this to
 * false and drops the note's code; in the public build, both the Sim and Real show it (never the extension).
 */
const TOP_NOTE = import.meta.env.VITE_ZEROFEE_PUBLIC === "1" && topNoteOn(true, EXTENSION_BUILD) && !("refused" in MODE);

export const mount = (root: Root) => {
  document.documentElement.dataset.mode = page;
  const pageNow = (
    <Suspense fallback={<Title />}>
      {SIM_SITE ? <Demo /> : page === "laptop" ? <LaptopGate gate={!onPhone()} /> : page === "screens" ? (walk === "fund" && import.meta.env.DEV ? <FundWalk /> : <Screens />) : page === "demo" ? <Demo /> : <AppGate />}
    </Suspense>
  );
  const withMark = (
    <>
      {STRIP ? <div className="zf-under-mark">{pageNow}</div> : pageNow}
      {/* the mode mark on every screen: Real's Beta and dust line, Sim's quiet "Sim" (ModeMark.tsx) */}
      {MARK && <ModeMark mode={MARK} strip={STRIP} />}
    </>
  );
  root.render(
  <StrictMode>
    {"refused" in MODE ? (
      // `?mainnet` with `?demo` or `?screens`: sample data never runs next to real money. One plain line, nothing else.
      <div className="zf-screen zf-pad" style={{ display: "grid", placeItems: "center", textAlign: "center" }}>
        <p className="zf-body">{MODE.refused}</p>
      </div>
    ) : (
      TOP_NOTE ? <TopNotePage codeUrl={import.meta.env.VITE_CODE_URL}>{withMark}</TopNotePage> : withMark
    )}
  </StrictMode>,
);
};
