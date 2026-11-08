// A site's window (Job 3, product decision, 2 Nov B15/B24), opened from Social Trading's tiles (SocialHub, `onLeave`: Close and Back
// come back to the hub) or, as before, as a site's own app. The app IS the site's window:
// - on the phone, opening the app opens the site in ZeroFee's own window (device.openSite): our bar on top (Back, the
//   site's name over its real host, Settings, Close), no pop-up, no leaving the app. Back walks the site's own history,
//   then closes the window; Close leaves the app; Settings closes the window onto this app's settings;
// - in a browser (the web demo) the same bar stands over a page that says the site opens here in the phone app, with
//   "Open <site> in a new tab" (a site's page can't be shown inside another page: they refuse it).
// Settings: the site's OWN wallet (core site-wallets.ts): which it is, what it holds, Add (from the Safe, privately: the
// one money sheet's Add) and Move back (to the Safe, privately, on the core's own sheet), whether the site can see it
// (Disconnect), and its key in Home's Details.
import { noteAgentZeroStep } from "@zerofee/shell-api/agentzero-steps.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { ProblemError, type Problem } from "@zerofee/core/problem";
import type { SpendingWallet } from "@zerofee/core/spending";
import { outsideShort } from "@zerofee/core/format";
import { Back, Close } from "@zerofee/design/icons.tsx";
import { More } from "@zerofee/design/More.tsx";
import { PushedFrame, useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { usd } from "@zerofee/trade/app/format.ts";
import { browserProblems } from "../browser-problems.ts";
import { PRESET_LOGO } from "../app/chains.tsx";
import { useConnections } from "../app/SiteRows.tsx";
import { LISTED } from "./catalog.ts";
import { SimSitePage } from "../sim/SimSitePage.tsx";
import { simSiteKind, simSitesOn } from "../sim/sites-data.ts";
import "./social.css";


const onPhone = () => typeof window !== "undefined" && !!(window as { webkit?: { messageHandlers?: Record<string, unknown> } }).webkit?.messageHandlers?.zerofee;
const problemOf = (e: unknown): Problem | undefined => (e instanceof ProblemError ? e.problem : (e as { problem?: Problem })?.problem);
// six and six, as every outside address (core format.ts outsideShort; Sim test)
const short = outsideShort;
const Gear = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    <path className="zf-hl" d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8ZM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
  </svg>
);

type Why = "close" | "back" | "settings" | "topup";
/** The window's own ask moves exactly this (WalletGate.firstAddUsd in HostRules.swift): the small first Add. */
const FIRST_ADD_USD = "5";

/** `browser`: the Browser's bridge, for this site's connection (its yes is kept as the Browser's, where its engine is).
 *  `onLeave`: Close, and Back at the site's first page, come back to the app that opened it (Social Trading). */
export function SiteApp({ site, browser, pill, wallet, onLeave }: { site: string; browser?: Bridge; pill?: string; wallet?: string; onLeave?: (why: Why) => void }) {
  const shell = useShell();
  const { bridge, active } = shell;
  // D146: read when a late ask comes, not when the listener was made
  const onScreen = useRef(active);
  onScreen.current = active;
  const app = LISTED.find((a) => a.id === site);
  const [view, setView] = useState<"window" | "settings">("window");
  const opening = useRef(false);
  /** This app's window is the one open: only its own close moves this app (the other site apps hear it too). */
  const mine = useRef(false);
  const name = app?.preset.name ?? site;
  const host = app?.preset.hosts[0] ?? "";

  /** The window closed: Settings stays in this app; Back at its first page and Close leave it, to Home. */
  const closed = useCallback((why: Why) => {
    // opened from Social trading: every way out goes back there (its gear opens the site's wallet sheet there)
    if (onLeave) return onLeave(why);
    if (why === "settings" || why === "topup") return setView("settings");
    setView("window");
    shell.openApp("wallet");
  }, [shell, onLeave]);

  const openWindow = useCallback(async () => {
    if (!app || opening.current) return;
    opening.current = true;
    // ST2: its wallet's dollars for the window's pill (the hub's last read); a tap on the pill comes back to its sheet
    const r = await bridge.call("device.openSite", { url: app.preset.url, ...(pill ? { pill } : {}) });
    mine.current = !("problem" in r);
    if ("problem" in r) {
      opening.current = false;
      const step = await shell.showProblem(browserProblems.siteUnreachable(host));
      if (step.kind === "retry") void openWindow();
    }
  }, [app, bridge, host, shell, pill]);

  // ST10: while its window is open, its wallet's dollars every 5 s to the window's pill and top-up banner (ours, native)
  useEffect(() => {
    if (!wallet || !host || !onPhone()) return;
    let live = true;
    const look = async () => {
      if (!mine.current) return;
      const r = await bridge.call<{ id: string; cashUsd?: string; unread?: boolean }[]>("spending.wallets");
      const w = "ok" in r ? r.ok.find((x) => x.id === wallet) : undefined;
      if (!live || !w || w.unread || w.cashUsd === undefined) return;
      const n = Number(w.cashUsd);
      if (!Number.isFinite(n) || n < 0 || n >= 1e9) return;
      void bridge.call("device.site.money", { host, pill: `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` });
    };
    const t = setInterval(() => void look(), 5000);
    return () => { live = false; clearInterval(t); };
  }, [bridge, host, wallet]);

  // ST11: the window's own "Move $5" (AgentZero's ask over the site): the move starts here, for THIS site's stored wallet
  // (the hub's own list, never anything the page says), only while this site's window is the one open; its words go back
  // to the window (the shell's own sheet and lines would be behind it).
  useEffect(() => bridge.on<{ host?: string; usd?: string }>("device.site.topup", (e) => {
    // only the window's own fixed amount (WalletGate.firstAddUsd), for this site's window, for its stored wallet
    if (!mine.current || !wallet || e?.host !== host || String(e?.usd) !== FIRST_ADD_USD) return;
    // D146: only while this site's window and its app are on screen; a late ask after the person left is dropped (the
    // window hears its money hasn't moved)
    if (!onScreen.current) return void bridge.call("device.site.money", { host, line: "Your money hasn't moved." });
    shell.openMoney({ kind: "siteadd", wallet, name, usd: FIRST_ADD_USD, auto: true }, (end) => {
      // one plain line the window can show (review M3): whitespace collapsed, at most 150 characters
      const raw = (end.line ?? (end.went ? "" : "Your money hasn't moved.")).replace(/\s+/g, " ").trim();
      const line = raw.length > 150 ? `${raw.slice(0, 149)}…` : raw;
      void bridge.call("device.site.money", { host, line: line || "Your money hasn't moved." });
    });
  }), [bridge, host, name, shell, wallet]);
  // AgentZero's receipts (shell-api agentzero-steps): every line the site window shows, exactly as shown
  useEffect(() => bridge.on<{ host?: string; line?: string }>("device.site.step", (e) => {
    if (e?.host !== host || typeof e.line !== "string" || !e.line) return;
    noteAgentZeroStep({ site: name, line: e.line, state: /couldn't|didn't|slow|hold|less than|hasn't moved|Not moved/.test(e.line) ? "refused" : "done" });
  }), [bridge, host, name]);

  // The phone: the app on screen in its window view is the site's window, opened once each time the app is shown.
  useEffect(() => {
    if (!active) {
      opening.current = false;
      return;
    }
    if (view === "window" && onPhone()) void openWindow();
  }, [active, view, openWindow]);
  useEffect(() => bridge.on<{ app?: string; why?: Why }>("device.returned", (e) => {
    if ((e?.app && e.app !== "social") || !mine.current) return;
    mine.current = false;
    opening.current = false;
    closed(e?.why === "settings" ? "settings" : e?.why === "topup" ? "topup" : e?.why === "back" ? "back" : "close");
  }), [bridge, closed]);

  if (!app) return null;
  if (view === "settings") {
    return (
      <PushedFrame name={`${name} settings`} onBack={() => (onLeave ? onLeave("close") : setView("window"))}>
        <SiteSettings site={site} name={name} host={host} browser={browser} />
      </PushedFrame>
    );
  }
  // Sim (the public site, D157): our own window around a sample site we draw, never a new tab (product decision, 3 Nov)
  if (simSitesOn()) return <SimSitePage kind={simSiteKind(site)} site={site} name={name} onClose={() => closed("close")} />;
  return (
    <div className="zf-screen st-window">
      <header className="st-window-bar">
        <button className="zf-icon-btn" aria-label="Back" onClick={() => closed("back")}><Back /></button>
        <span className="st-window-title">
          <span className="st-window-name">{name}</span>
          {/* its real host, unless the name already is it ("pump.fun" over "pump.fun", UI audit 5 Nov; as AppHead) */}
          {host.toLowerCase() !== name.toLowerCase() && <span className="st-window-host">{host}</span>}
        </span>
        <button className="zf-icon-btn" aria-label={`${name} settings`} onClick={() => closed("settings")}><Gear /></button>
        <button className="zf-icon-btn" aria-label={`Close ${name}`} onClick={() => closed("close")}><Close /></button>
      </header>
      <main className="st-window-body">
        <img className="st-app-logo" src={PRESET_LOGO[site]} alt="" width={72} height={72} style={{ width: 72, height: 72, borderRadius: 17 }} />
        {/* the design review §10 (7): in a browser, one line in the window's place */}
        <p className="zf-body st-center">{onPhone() ? `Opening ${name}.` : `${name} opens inside the ZeroFee phone app.`}</p>
        {/* D87 (the web is first-class): never a dead end; the difference named. A site's page can't sign in from ours on
            the web, so it opens in a new tab, and this site's wallet (its money) stays here with Add and Take out. */}
        {!onPhone() && host && (
          <>
            <p className="zf-small st-center">On the web it opens in a new tab. AgentZero can't sign you in there yet. Your money stays here.</p>
            <a className="zf-btn" style={{ textDecoration: "none" }} href={`https://${host}/`} target="_blank" rel="noopener noreferrer" data-testid="site-new-tab">Open {name} in a new tab</a>
          </>
        )}
      </main>
    </div>
  );
}

/** The site app's own settings: its own wallet. */
function SiteSettings({ site, name, host, browser }: { site: string; name: string; host: string; browser?: Bridge }) {
  const shell = useShell();
  const { bridge, active } = shell;
  const [wallets, setWallets] = useState<SpendingWallet[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => bridge.on("spending.changed", refresh), [bridge, refresh]);
  useEffect(() => {
    if (!active) return;
    let gone = false;
    void bridge.call<SpendingWallet[]>("spending.wallets").then((r) => {
      if (!gone && "ok" in r) setWallets(r.ok.filter((w) => w.role === "site" && w.site === site && w.current));
    });
    return () => void (gone = true);
  }, [active, bridge, site, tick]);
  const sol = wallets?.find((w) => w.network === "sol");
  const others = wallets?.filter((w) => w.network !== "sol") ?? [];
  const has = sol?.cashUsd !== undefined && !sol.unread ? Number(sol.cashUsd) : null;

  /** Add: from the Safe, privately (the one money sheet); the wallet is made first if this is the first time. */
  const add = async () => {
    setBusy(true);
    try {
      const made = await bridge.call<{ id: string }>("subwallet.create", { kind: "site", chain: "sol", siteId: site });
      if ("problem" in made) return void (await shell.showProblem(made.problem));
      shell.openMoney({ kind: "siteadd", wallet: made.ok.id, name }, () => refresh());
    } catch (e) {
      await shell.showProblem(problemOf(e) ?? browserProblems.socialFailed());
    } finally {
      setBusy(false);
    }
  };
  const back = () => sol && shell.openMoney({ kind: "siteback", wallet: sol.id, name }, () => refresh());

  return (
    <div className="st-page">
      <section className="st-strip" aria-label={`Your ${name} wallet`}>
        <div className="zf-label">Your {name} wallet</div>
        <div className="st-balance" data-testid="site-wallet-usd">{sol?.cashUsd !== undefined ? usd(Number(sol.cashUsd)) : sol?.holds ?? "$0.00"}</div>
        <p className="zf-small">It pays on {name} only. Your Safe never pays here.</p>
        <button className="zf-btn st-ready" disabled={busy} onClick={() => void add()}>Add from your Safe</button>
        {has !== null && has >= 2 && <button className="zf-link st-back" onClick={back}>Move back to your Safe</button>}
      </section>
      <SiteConnection host={host} name={name} browser={browser} active={active} />
      <More label="Details">
        <div className="st-detail"><span className="t">Solana</span><span className="zf-small">{sol ? short(sol.address) : "Made when you first sign in"}</span></div>
        {others.map((w) => (
          <div key={w.id} className="st-detail"><span className="t">{w.network === "base" ? "Base" : w.network}</span><span className="zf-small">{short(w.address)}</span></div>
        ))}
        <button className="zf-row st-row" onClick={() => shell.openApp("wallet", "details")}><span className="t">Show its key in Home</span></button>
      </More>
    </div>
  );
}

/** Can the site see this wallet? One line, and Disconnect. Read as the Browser, which keeps each site's yes. */
function SiteConnection({ host, name, browser, active }: { host: string; name: string; browser?: Bridge; active: boolean }) {
  if (!browser) return null;
  return <Connection host={host} name={name} browser={browser} active={active} />;
}
function Connection({ host, name, browser, active }: { host: string; name: string; browser: Bridge; active: boolean }) {
  const { list, disconnect } = useConnections(browser, active);
  if (!list) return null;
  const on = list.some((c) => c.host === host);
  return (
    <section className="st-card" aria-label="Sign-in">
      {on ? (
        <div className="st-detail st-detail--action">
          <span><span className="t">{name} can see this wallet</span><span className="zf-small">You signed in with it.</span></span>
          <button className="zf-link" onClick={() => disconnect(host)}>Disconnect</button>
        </div>
      ) : (
        <p className="zf-small">Not signed in yet. Open {name} and sign in. Pick ZeroFee.</p>
      )}
    </section>
  );
}
