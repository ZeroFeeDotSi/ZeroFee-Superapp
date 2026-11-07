// Whole-app settings, from the top-left of any app: the account's name (the person's own) with its address under it (tap to copy), appearance
// (white by default, black by choice), Passwords, Sites, and "Forget this device" as one sheet.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Mark } from "@zerofee/design/Mark.tsx";
import { Segmented } from "@zerofee/design/Segmented.tsx";
import { Back, Close } from "@zerofee/design/icons.tsx";
import { useBack } from "@zerofee/design/back.ts";
import { MAINNET, SIM, WEB_MODES, switchWebMode } from "../mode.ts";
import { iosHost } from "../host/ios.ts";
import { loginsClient, type LoginsClient } from "../host/logins.ts";
import { PasswordsScreen } from "./PasswordsScreen.tsx";
import { FaceIdRow } from "./FaceIdRow.tsx";
import { QUICK_BUY_CHOICES, QUICK_BUY_DEFAULT, readQuickBuy, writeQuickBuy } from "@zerofee/trade/app/screens/quick-buy.ts";
// Settings > Open source loads when it opens: its notices (35 KB of licence text) are never in Home's first load.
const OpenSourceScreen = lazy(() => import("./OpenSourceScreen.tsx").then((m) => ({ default: m.OpenSourceScreen })));
import { forApps, type Bridge } from "@zerofee/core/bridge";
import { ConnectedSiteRows, useConnections } from "@zerofee/browser/app/SiteRows.tsx";
import { DISCONNECT_SITES, MONEY_LABEL, footerWords, forgetWords, moneyLine } from "./settings-words.ts";
import { onPhone } from "@zerofee/shell-api/approval-words.ts";
import { PUBLIC_RELEASE } from "@zerofee/shell-api/release.ts";
import "@zerofee/design/sheet.css";
import "./settings.css";
import { applyTheme, savedTheme, type Theme } from "./theme.ts";
import { lockNow, lockedWith } from "../unlock/UnlockGate.tsx";
import { webWallet } from "@zerofee/shell-api/release.ts";
import { ON_IPHONE, ON_IPHONE_PAGES, WEB_PASSWORDS_LINE } from "@zerofee/shell-api/web-account-words.ts";
// the web wallet's key rows: loaded only on the web build (Home's JS budget)
const WebWalletRows = lazy(() => import("./WebWalletRows.tsx").then((m) => ({ default: m.WebWalletRows })));
/** Settings → Status (rule 9b): the sheet and its checks load when it opens, never in Home's first load. */
const StatusSheet = lazy(() => import("./StatusSheet.tsx").then((m) => ({ default: m.StatusSheet })));
import { useStatusSummary } from "./status-row.ts";
/** The web wallet's Passwords page (On iPhone): loaded when opened. */
const OnIphoneSheet = lazy(() => import("./OnIphoneSheet.tsx").then((m) => ({ default: m.OnIphoneSheet })));

export { applyTheme, savedTheme, type Theme };

/**
 * `logins` defaults to the phone's Keychain (null in a browser: the Passwords row then says "On the phone only.").
 * `bridge` (the shell's) shows "Sites": the sites that can see the Browser wallet, each with Disconnect.
 */
/** The plain rows at the foot of Settings; "Open source" opens its screen. No hooks, so a test can tap it directly. */
export function MoreRows({ onOpenSource }: { onOpenSource: () => void }) {
  return (
    <>
      {/* k-security crawl (4 Nov, S3): no "Currency USD" and "Language English" rows. They looked like settings and
          did nothing; there is one of each, so there is nothing to choose (drop, don't degrade). */}
      <button className="set__row set__row--btn" onClick={onOpenSource}><span>Open source</span><span /></button>
    </>
  );
}

/** No bridge (a test, the gallery): no sites, and the same stand-in every render. */
const NO_SITES: Bridge = { call: async () => ({ ok: [] as never }), on: () => () => {} };

/** `onStartOver` (the web demo): back to the first screen, set up again. `onBack`: opened from Home's Your account sheet,
 *  ‹ (and Escape) go back there; ✕ closes (k-security crawl, 4 Nov: Close landed on Home). */
export function SettingsPanel({ onClose, onBack: backTo, onStartOver, logins = loginsClient(iosHost()), bridge }: { accountId: string; onClose: () => void; onBack?: () => void; onStartOver?: () => void; logins?: LoginsClient | null; bridge?: Bridge }) {
  // ‹ closes Settings, then goes where it was opened from
  const onBack = backTo && (() => { onClose(); backTo(); });
  useBack(onBack ?? onClose);
  const [theme, setTheme] = useState<Theme>(savedTheme());
  const [passwords, setPasswords] = useState(false);
  /** The web wallet's Passwords page: the Keychain is the iPhone's (bug report, 5 Nov late). */
  const [passwordsOnIphone, setPasswordsOnIphone] = useState(false);
  const phoneHost = iosHost();
  const [forget, setForget] = useState(false);
  const [restart, setRestart] = useState(false);
  // Reset this iPhone (product decision, 2 Nov): deleting the app keeps the key in the chip; this is the full reset.
  const [reset, setReset] = useState<"ask" | "busy" | "not-done" | null>(null);
  const [openSource, setOpenSource] = useState(false);
  const [status, setStatus] = useState(false);
  // one look at every service as Settings opens (QA's hold: only while open, never from Home)
  const statusWord = useStatusSummary(bridge);
  const browser = useMemo(() => (bridge ? forApps(bridge, "browser") : NO_SITES), [bridge]);
  // Quick buy amount, kept in Trade's own slot (quick-buy.ts), so Settings writes it as Trade
  const trade = useMemo(() => (bridge ? forApps(bridge, "trade") : null), [bridge]);
  const [quick, setQuick] = useState(QUICK_BUY_DEFAULT);
  useEffect(() => { if (trade) void readQuickBuy(trade).then(setQuick); }, [trade]);
  const sites = useConnections(browser, !!bridge);
  if (passwords && logins) return <PasswordsScreen client={logins} onClose={() => setPasswords(false)} />;
  if (passwordsOnIphone) return <Suspense fallback={null}><OnIphoneSheet page={ON_IPHONE_PAGES.passwords} codeUrl={import.meta.env.VITE_CODE_URL} onClose={() => setPasswordsOnIphone(false)} /></Suspense>;
  if (status && bridge) return <Suspense fallback={null}><StatusSheet bridge={bridge} onClose={() => setStatus(false)} /></Suspense>;
  if (openSource) return <Suspense fallback={null}><OpenSourceScreen onClose={() => setOpenSource(false)} codeUrl={import.meta.env.VITE_CODE_URL} onOpenUrl={bridge ? (url) => void import("./open-source.ts").then((m) => m.openInBrowserSheet(bridge, url)) : undefined} /></Suspense>;
  const pick = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
  };
  const forgetAll = async () => {
    for (const c of sites.list ?? []) await sites.disconnect(c.host);
    setForget(false);
  };
  if (reset && phoneHost) {
    const go = async () => {
      setReset("busy");
      const r = await phoneHost.call<{ reset: boolean }>("shell.reset");
      // Done: the app loads its first screen again by itself. Not done (Face ID declined): nothing changed.
      if (!("ok" in r) || !r.ok.reset) setReset("not-done");
    };
    return (
      <div className="set" role="dialog" aria-modal="true" aria-label="Reset this iPhone">
        <div className="set__scrim" onClick={() => setReset(null)} />
        <aside className="set__panel">
          <Mark size={30} mode="still" />
          <div className="zf-label" style={{ color: "var(--ink)", marginTop: 14 }}>Reset this iPhone</div>
          <p className="zf-body" style={{ marginTop: 18 }}>Removes your account and its key from this iPhone.</p>
          <p className="zf-small" style={{ marginTop: 10 }}>Your money stays in your Safe. Your 24 words bring it back.</p>
          {reset === "not-done" && <p className="zf-small" style={{ marginTop: 10 }}>Nothing was reset.</p>}
          <div className="set__sheet-floor">
            <button className="zf-btn" disabled={reset === "busy"} onClick={() => void go()}>{reset === "busy" ? "Resetting…" : "Reset this iPhone"}</button>
            <button className="zf-link" onClick={() => setReset(null)}>Not now</button>
          </div>
        </aside>
      </div>
    );
  }

  if (restart && onStartOver) {
    return (
      <div className="set" role="dialog" aria-modal="true" aria-label="Start over">
        <div className="set__scrim" onClick={() => setRestart(false)} />
        <aside className="set__panel">
          {/* D135: a popup's way out is Close in its corner, beside Not now (QA sd-security (i)) */}
          {/* the sheets' bar: its title centred beside Close (shell audit, 5 Nov: a small mark and a small label stood in for it) */}
          <div className="set__top set__bar"><span aria-hidden="true" /><h1 className="set__bar-title">Start over</h1><button className="zf-sheet__close" onClick={() => setRestart(false)} aria-label="Close"><Close /></button></div>
          <p className="zf-body" style={{ marginTop: 24 }}>Go back to the first screen and set up your account again.</p>
          <p className="zf-small" style={{ marginTop: 10 }}>The sample money goes back to how it was at the start.</p>
          <div className="set__sheet-floor">
            {/* the one action here undoes things: in the alert colour, never the mint every "go on" wears */}
            <button className="zf-btn set__btn--danger" onClick={onStartOver}>Start over</button>
            <button className="zf-link" onClick={() => setRestart(false)}>Not now</button>
          </div>
        </aside>
      </div>
    );
  }
  if (forget) {
    const w = forgetWords(sites.list?.length ?? 0);
    return (
      <div className="set" role="dialog" aria-modal="true" aria-label={w.title}>
        <div className="set__scrim" onClick={() => setForget(false)} />
        <aside className="set__panel">
          <Mark size={30} mode="still" />
          <div className="zf-label" style={{ color: "var(--ink)", marginTop: 14 }}>{w.title}</div>
          <p className="zf-body" style={{ marginTop: 18 }}>{w.body}</p>
          <p className="zf-small" style={{ marginTop: 10 }}>{w.money}</p>
          <div className="set__sheet-floor">
            <button className="zf-btn" onClick={() => void forgetAll()}>{w.button}</button>
            {w.button !== "Close" && <button className="zf-link" onClick={() => setForget(false)}>Not now</button>}
          </div>
        </aside>
      </div>
    );
  }
  return (
    <div className="set" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="set__scrim" onClick={onClose} />
      <aside className="set__panel">
        {/* R2: the sheet's bar (T3 title centred, ✕ right), like every other full-screen sheet (D135) */}
        <div className="set__top set__bar">
          {onBack ? <button className="zf-sheet__back" onClick={onBack} aria-label="Back"><Back /></button> : <span aria-hidden="true" />}
          <h1 className="set__bar-title">Settings</h1>
          <button className="zf-sheet__close" onClick={onClose} aria-label="Close"><Close /></button>
        </div>
        {/* the design review §4.9: one page of grouped sections. Each section is a header, one inset card and, where it
            helps, a footer; a destructive action stands alone at the end. R2: the account is the first card (Apple's
            account row): its name, its address under it, and the Copy chip. */}
        {/* the copy review's S3 (7 Nov): no "Your account · Change" card here: Settings opens from Your account, so it led back to
            itself. The Safe's address and its Copy are on Details. */}
        {/* The public web build's two modes (product decision, 3 Nov): Sim or Real; a switch starts the page again in the other */}
        {WEB_MODES && !onPhone() && (
          <section className="set__sec">
            <h2 className="zf-label set__h">{MONEY_LABEL}</h2>
            <div className="zf-group">
              <div className="set__row set__row--seg">
                <Segmented label={MONEY_LABEL} value={SIM ? "sim" : "web"} items={[{ id: "sim", label: "Sim" }, { id: "web", label: "Real" }]} onChange={(m) => (m === "sim") !== SIM && switchWebMode(m)} />
              </div>
            </div>
            <p className="zf-small set__fn">{moneyLine(SIM)}</p>
          </section>
        )}
        {/* UI concept v3.1 (5 Nov): the Buy chip on a Trade row buys this much with one tap; kept as Trade's */}
        {trade && (
          <section className="set__sec">
            <h2 className="zf-label set__h">Quick buy</h2>
            <div className="zf-group">
              <div className="set__row set__row--seg">
                <Segmented label="Quick buy amount" value={String(quick)} items={QUICK_BUY_CHOICES.map((usd) => ({ id: String(usd), label: "$" + usd }))} onChange={(id) => { const usd = QUICK_BUY_CHOICES.find((c) => String(c) === id); if (usd === undefined) return; setQuick(usd); void writeQuickBuy(trade, usd); }} />
              </div>
            </div>
            <p className="zf-small set__fn">The Buy chip on a Trade row buys this much with one tap.</p>
          </section>
        )}
        <section className="set__sec">
          <h2 className="zf-label set__h">Colors</h2>
          <div className="zf-group">
            <div className="set__row set__row--seg">
              <Segmented label="Colors" value={theme} items={[{ id: "light", label: "White" }, { id: "dark", label: "Black" }]} onChange={pick} />
            </div>
          </div>
        </section>
        {/* Passwords and Open source: their own card, never inside Colors (a web test, 4 Nov) */}
        <section className="set__sec set__more">
          <div className="zf-group">
            {/* rule 9b: every service the app leans on, live; the row says "Checking…" until this open's checks answered */}
            {bridge && <button className="set__row set__row--btn set__row--val" onClick={() => setStatus(true)}><span>Status</span><span data-testid="status-summary">{statusWord}</span></button>}
            {logins ? (
              <button className="set__row set__row--btn" onClick={() => setPasswords(true)}><span>Passwords</span><span /></button>
            ) : (
              // any browser (the Sim too, the copy review's #7, 7 Nov): never a row that offers nothing; it opens what Passwords is on iPhone
              <button className="set__row set__row--btn set__row--two set__row--val" onClick={() => setPasswordsOnIphone(true)}><span><span>Passwords</span><small>{WEB_PASSWORDS_LINE}</small></span><span>{ON_IPHONE}</span></button>
            )}
            <MoreRows onOpenSource={() => setOpenSource(true)} />
          </div>
        </section>
        {bridge && (
          <section className="set__sec">
            <h2 className="zf-label set__h">Site wallets</h2>
            <div className="zf-group set__sites">
              <ConnectedSiteRows bridge={browser} />
              {!!sites.list?.length && <button className="set__row set__row--btn" onClick={() => setForget(true)}><span>{DISCONNECT_SITES}</span><span /></button>}
            </div>
          </section>
        )}
        {/* the web wallet (product decision, 4 Nov): its words and keys behind the password, Lock, and the phone app */}
        {webWallet() && bridge && <Suspense fallback={null}><WebWalletRows bridge={bridge} /></Suspense>}
        {!webWallet() && (phoneHost || lockedWith()) && (
          <section className="set__sec">
            <div className="zf-group">
              {phoneHost && <FaceIdRow host={phoneHost} />}
              {/* Lock now, by hand (grade 02f, M11): only where ZeroFee itself locked this browser (UnlockGate). */}
              {lockedWith() && <button className="set__row set__row--btn set__row--two" onClick={lockNow}><span><span>Lock ZeroFee</span><small>{lockedWith() === "passcode" ? "Opens with your passcode" : "Unlocks with your iPhone"}</small></span></button>}
            </div>
          </section>
        )}
        {/* the destructive ones alone, last, in the alert colour; each opens its own confirm (B7) */}
        {(onStartOver || phoneHost) && (
          <section className="set__sec set__sec--danger">
            <div className="zf-group">
              {onStartOver && <button className="set__row set__row--btn set__row--danger" onClick={() => setRestart(true)}><span>Start over</span></button>}
              {phoneHost && <button className="set__row set__row--btn set__row--danger" onClick={() => setReset("ask")}><span>Reset this iPhone</span></button>}
            </div>
          </section>
        )}
        <p className="zf-small set__foot">{footerWords(MAINNET, PUBLIC_RELEASE, SIM)}</p>
      </aside>
    </div>
  );
}
