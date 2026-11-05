// Apps (app id "social"; it grew out of Social trading and the ZeroFee App Store, renamed by D47): a catalog of crypto apps that run inside
// ZeroFee's own window, paying from Spending (D52: two pots only, Safe and Spending; grade 1 Nov c, P11).
//
// - The catalog (catalog.ts) lists only apps whose phone page showed "ZeroFee" in their own wallet list when probed.
//   Each is a Browser preset, so its exact hosts and chains are pinned on the iPhone and reviewed by Security.
// - One wallet per chain (D55): an app pays from your Solana wallet, the same one Trade and ZeroFee Chat use, filled from
//   Spending. An app's page says what's ready on Solana and has one action, "Make $10 ready" (spending.makeReady), whose
//   row is in Activity; Spending's Put away brings it home. No pocket of its own to make, fund or read (grade 02e, E4).
// - Opening an app: on the phone it opens in ZeroFee's own window with the ZeroFee wallet built in (device.openSite),
//   and every signature is the core's native sheet, "<site> asks …", decoded from the bytes. fomo isn't listed (D47: no
//   phone site, no outside wallet login); a fomo deposit address is paid with Wallet's Send like any Solana address.
// - Where there is no ZeroFee window (the web demo), "Open <app>" opens the real site in a new tab, without the wallet.
// Every failure goes to the shell's Problem screen; the "Having trouble?" rows say plainly what a site did.
// Job 1 (the spine): there is no "Apps" app on the bar any more. Each site is an app of its own in the tray ("site:pump"),
// whose page is SiteRoot. Job 3: that page is the site's own window and its own settings (SiteApp.tsx).
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_STORE_NAME } from "@zerofee/core/app-store";
import { ProblemError, type Problem } from "@zerofee/core/problem";
import type { SpendingStatus } from "@zerofee/core/spending";
import { Chevron } from "@zerofee/design/icons.tsx";
import { More } from "@zerofee/design/More.tsx";
import type { AppModule } from "@zerofee/shell-api/app-module.ts";
import { AppFrame, PushedFrame, useShell, type TrayItem } from "@zerofee/shell-api/AppFrame.tsx";
import { usd } from "@zerofee/trade/app/format.ts";
import { browserProblems } from "../browser-problems.ts";
import type { Preset } from "../presets.ts";
import { PRESET_LOGO } from "../app/chains.tsx";
import { CATEGORIES, LISTED, type Category } from "./catalog.ts";
import { simSitesOn } from "../sim/sites-data.ts";
import { SiteApp } from "./SiteApp.tsx";
import { SocialHub } from "./SocialHub.tsx";
import { useTopUpHost } from "../use-top-up-host.ts";
import type { Bridge } from "@zerofee/core/bridge";
import "./social.css";
type Listed = (typeof LISTED)[number];
type Tab = "all" | Category;

const Icon = ({ d }: { d: string }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path className="zf-hl" d={d} /></svg>
);
const TRAY_ICON: Record<Tab, string> = {
  all: "M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z",
  Trade: "M4 17l5-5 4 3 7-8M15 7h5v5",
  Swap: "M5 8.5h13l-3.5-3.5M19 15.5H6l3.5 3.5",
  Earn: "M12 20v-8M12 12c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5zM12 14.5c0-3-2.3-5-5.5-5 0 3 2.3 5 5.5 5z",
};
const TRAY: TrayItem<Tab>[] = [
  { id: "all", label: "All apps", icon: () => <Icon d={TRAY_ICON.all} /> },
  ...CATEGORIES.map((c) => ({ id: c, label: c, icon: () => <Icon d={TRAY_ICON[c]} /> })),
];
const TABS = TRAY.map((t) => t.id);

/** Is ZeroFee's own window here (the iPhone host)? Elsewhere a site opens in a new tab, without the wallet. */
const onPhone = () => typeof window !== "undefined" && !!(window as { webkit?: { messageHandlers?: Record<string, unknown> } }).webkit?.messageHandlers?.zerofee;
const problemOf = (e: unknown): Problem | undefined => (e instanceof ProblemError ? e.problem : (e as { problem?: Problem })?.problem);
const AppLogo = ({ id, size }: { id: string; size: number }) => <img className="st-app-logo" src={PRESET_LOGO[id]} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }} />;

/** What Make ready moves at once, in dollars (one action, D52). */
export const READY_USD = 10;

/** Spending on Solana as the apps see it (spending.status): what's ready there now, and whether a Make ready is on its way. */
interface Ready { readyUsd: number; making?: number }

function SocialScreens({ site }: { site?: string }) {
  const shell = useShell();
  const { bridge, active, showProblem } = shell;
  const asked = site ? undefined : shell.requestedTab;
  const [tab, setTab] = useState<Tab>(asked && (TABS as string[]).includes(asked) ? (asked as Tab) : "all");
  /** The app whose page is open (pushed over the catalog), by its preset id; a site's own app: always its own. */
  const [openId, setOpenId] = useState<string | null>(site ?? (asked && LISTED.some((a) => a.id === asked) ? asked : null));
  const [ready, setReady] = useState<Ready | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  /** A test account (testnet): Spending moves real money only (grade 02g, G7). Read once, when the app is first shown. */
  const testAccount = useRef<Promise<boolean> | null>(null);
  const isTest = () => (testAccount.current ??= bridge.call<{ account?: { network?: string } }>("account.state").then((r) => "ok" in r && r.ok.account?.network === "testnet", () => false));

  useEffect(() => {
    if (!asked) return;
    if ((TABS as string[]).includes(asked)) setTab(asked as Tab);
    else if (LISTED.some((a) => a.id === asked)) setOpenId(asked);
  }, [asked, shell.requestSeq]);
  useEffect(() => bridge.on("spending.changed", refresh), [bridge, refresh]);
  useEffect(() => bridge.on("device.returned", refresh), [bridge, refresh]);
  // Each read is numbered; a newer read's answer is never overwritten by an older one (round 4 robot).
  const reads = useRef({ asked: 0, shown: 0 });
  useEffect(() => {
    if (!active) return;
    const n = ++reads.current.asked;
    void bridge.call<SpendingStatus>("spending.status").then((r) => {
      if (n < reads.current.shown || !("ok" in r)) return;
      reads.current.shown = n;
      const sol = r.ok.networks.find((x) => x.network === "sol");
      const making = r.ok.onItsWay.find((m) => m.kind === "ready" && m.network === "sol");
      setReady({ readyUsd: Number(sol?.readyUsd ?? 0), ...(making ? { making: Number(making.usd) } : {}) });
    });
  }, [active, bridge, tick]);
  useEffect(() => {
    if (!active) return;
    // while money is being made ready, look often: it shows the moment it lands (grade 1 Nov, item 11)
    const t = setInterval(refresh, ready?.making ? 1000 : 15000);
    return () => clearInterval(t);
  }, [active, refresh, ready?.making]);

  const problem = async (p: Problem, retry?: () => void) => {
    const step = await showProblem(p);
    if (step.kind === "retry") retry?.();
    // "Top up Spending" (spending.ready.short) opens Wallet's Top up: the label says it, so the tap does it (grade 01c, P5).
    // Wallet's Top up comes back here, on this app's page, when it ends (grade 02g, G6).
    if (step.kind === "open" && step.screen === "spending-topup") shell.openMoney({ kind: "topup" }, refresh);
    return step;
  };
  // every failure is a plain screen: one with no Problem of its own is the plain "didn't go through" (never a silent stop)
  const fail = async (e: unknown, retry?: () => void) => {
    await problem(problemOf(e) ?? browserProblems.socialFailed(), retry);
  };

  /** Make $10 ready (D55): Spending's cash → your Solana wallet, the one every app uses; no sheet, your own wallets. */
  const makeReady = async () => {
    setBusy(true);
    try {
      // On a test account the honest answer comes first: nothing can be made ready, and Top up can't help either.
      if (await isTest()) {
        await problem(browserProblems.readyTestAccount());
        return;
      }
      const r = await bridge.call("spending.makeReady", { network: "sol", usd: READY_USD });
      // Not enough cash in Spending: straight to Wallet's Top up for the $10 asked, never a Problem screen first (UX
      // walk 2 Nov: Make $10 ready → "Spending has $0.00 cash" → Top up Spending → a sheet at another amount). It comes
      // back to this app's page when it ends, done or not.
      if ("problem" in r && r.problem.code === "spending.ready.short" && r.problem.next.kind === "open" && r.problem.next.screen === "spending-topup") {
        // The one money sheet's Top up, in place over this app (Job 1): the $10 asked; when it went, make it ready.
        shell.openMoney({ kind: "topup", usd: String(READY_USD) }, (end) => { refresh(); if (end.went) void makeReady(); });
      } else if ("problem" in r) await problem(r.problem, () => void makeReady());
      refresh();
    } catch (e) {
      void fail(e, () => void makeReady());
    } finally {
      setBusy(false);
    }
  };

  const open = async (site: Preset, desktop = false) => {
    // Sim (D157): the site's own app page, whose window is our sample site (SiteApp), never a new tab
    if (simSitesOn()) return shell.openApp("social", site.id);
    if (!onPhone()) {
      // No ZeroFee window here: the real site, in a new tab, from this tap.
      window.open(site.url, "_blank", "noopener,noreferrer");
      setOpened(site.id);
      return;
    }
    const r = await bridge.call("device.openSite", { url: site.url, desktop });
    if ("problem" in r) void problem(browserProblems.siteUnreachable(site.hosts[0]!), () => void open(site, desktop));
  };

  const app = openId ? LISTED.find((a) => a.id === openId) : undefined;

  if (app) {
    const page = (
      <div className="st-page">
        <AppHead app={app} />
        <PaysFromSpending ready={ready} busy={busy} onReady={() => void makeReady()} onActivity={() => shell.openApp("wallet", "activity")} />
        <OpenCard app={app} solid={(ready?.readyUsd ?? 0) >= 1} opened={opened === app.id} onOpen={() => void open(app.preset)} />
        <Trouble site={app.preset} onProblem={(p, retry) => void problem(p, retry)} onOpen={(desktop) => void open(app.preset, desktop)} />
        <div className="zf-fill" />
      </div>
    );
    // A site's own app (the tray): its page is the app, no Back.
    if (site) return <AppFrame name={app.preset.name} tray={[]} tab="all" onTab={() => {}}>{page}</AppFrame>;
    return <PushedFrame name={app.preset.name} onBack={() => setOpenId(null)}>{page}</PushedFrame>;
  }

  const shown = LISTED.filter((a) => tab === "all" || a.category === tab);
  return (
    <AppFrame name={APP_STORE_NAME} tray={TRAY} tab={tab} onTab={setTab}>
      <div className="st-page">
        <div className="zf-label st-list-label">{tab === "all" ? "All apps" : tab}</div>
        <ul className="st-list" aria-label={tab === "all" ? "All apps" : `${tab} apps`}>
          {shown.map((a) => (
            <li key={a.id}>
              <button className="st-app-row" onClick={() => setOpenId(a.id)}>
                <AppLogo id={a.id} size={52} />
                <span className="st-app-text">
                  <span className="st-app-name">{a.preset.name}</span>
                  <span className="st-app-what">{a.what}</span>
                  <span className="st-tags">
                    {tab === "all" && <span className="st-tag">{a.category}</span>}
                  </span>
                </span>
                <span className="st-chev" aria-hidden="true"><Chevron /></span>
              </button>
            </li>
          ))}
        </ul>
        <p className="zf-small st-foot">Apps pay from Spending, never your Safe. They trade without asking. They can't send money out.</p>
      </div>
    </AppFrame>
  );
}

/** An app's page, top: its own mark, its name, its real host, what it does. */
function AppHead({ app }: { app: Listed }) {
  return (
    <section className="st-head zf-enter" aria-label={app.preset.name}>
      <AppLogo id={app.id} size={72} />
      <div className="st-head-text">
        <div className="st-head-name">{app.preset.name}</div>
        {/* Its real host, unless the name already is it ("pump.fun / pump.fun", 02f E16). */}
        {app.preset.hosts[0]?.toLowerCase() !== app.preset.name.toLowerCase() && <div className="zf-small">{app.preset.hosts[0]}</div>}
        <div className="st-tags">
          <span className="st-tag">{app.category}</span>
        </div>
      </div>
      <p className="zf-body st-head-what">{app.what}</p>
    </section>
  );
}

/** On an app's page: "Pays from Spending · $X ready on Solana", and one action, "Make $10 ready" (D55: the money is in
 *  your Solana wallet, the one every app, Trade and Chat use), whose row is in Activity. Never a pot of its own. */
function PaysFromSpending({ ready, busy, onReady, onActivity }: { ready: Ready | null; busy: boolean; onReady: () => void; onActivity: () => void }) {
  const making = busy || !!ready?.making;
  return (
    <section className="st-strip" aria-label="Pays from Spending">
      <p className="zf-body" data-testid="social-pays">{ready ? `Pays from Spending · ${usd(ready.readyUsd)} ready on Solana` : "Pays from Spending."}</p>
      <button className="zf-btn st-line-btn st-ready" disabled={making} onClick={onReady}>{making ? `Making $${ready?.making ?? READY_USD} ready…` : `Make $${READY_USD} ready`}</button>
      {ready?.making && <p className="zf-small st-arriving" role="status">It comes from Spending. <button className="zf-link" onClick={onActivity}>See it in Activity</button></p>}
    </section>
  );
}

/** How to connect, and the Open button. */
function OpenCard({ app, solid, opened, onOpen }: { app: Listed; solid: boolean; opened: boolean; onOpen: () => void }) {
  const site = app.preset;
  const phone = onPhone();
  return (
    <section className="st-card" aria-label={`Open ${site.name}`}>
      {/* UI-SIMPLICITY-RULES 1 and 2: the one action first; how to connect, one tap down */}
      <button className={`zf-btn st-open${solid ? "" : " st-line-btn"}`} onClick={onOpen}>Open {site.name}</button>
      {opened && !phone && <p className="zf-small st-web-note" role="status">{site.name} opened in a new tab.</p>}
      <More label="How to connect">
        <ol className="st-steps">
          {app.steps.map((line) => <li key={line}>{line}</li>)}
        </ol>
        {!phone && <p className="zf-small st-web-note">In the ZeroFee phone app, {site.name} opens inside ZeroFee and pays from your Spending. Here it opens in a new tab.</p>}
      </More>
    </section>
  );
}

/** What a site did, in one tap each: the plain Problem screen with its one next step. */
function Trouble({ site, onProblem, onOpen }: { site: Preset; onProblem: (p: Problem, retry?: () => void) => void; onOpen: (desktop: boolean) => void }) {
  const host = site.hosts[0]!;
  const rows: { label: string; problem: Problem; retry?: () => void }[] = [
    { label: `${site.name} asks me to get its app`, problem: browserProblems.siteWantsApp(host), retry: () => onOpen(true) },
    { label: `${site.name} won't open, or says it blocks my browser`, problem: browserProblems.siteBlocked(host) },
  ];
  return (
    <details className="st-trouble">
      <summary className="zf-label">Having trouble?</summary>
      {rows.map((r) => (
        <button key={r.label} className="zf-row st-row" aria-label={r.label} onClick={() => onProblem(r.problem, r.retry)}>
          <span className="t">{r.label}</span>
        </button>
      ))}
    </details>
  );
}


/** Social Trading (product decision, 2 Nov): the one tray app for the sites, each with its own wallet (SocialHub.tsx). The shell
 *  hosts it with the Browser's bridge too (home-apps.tsx HubRoot), where the sites' sign-ins are kept. */
export const socialApp: AppModule = { id: "social", name: APP_STORE_NAME, line: "Your sites, each with its own wallet", Root: () => <SocialHub /> };

/** The hub with the Browser's bridge (its sites' connections: Disconnect in a site's settings). Its Browser tabs' Top up
 *  (the Browser thesis, part 2) opens Home's Put money in here, while the Browser is on screen. */
export function HubRoot({ browser }: { browser?: Bridge }) {
  useTopUpHost(browser);
  return <SocialHub {...(browser ? { browser } : {})} />;
}

/** The catalog as it was (Apps' list and a site's page), kept for its tests and the screens gallery. */
export const SocialCatalog = SocialScreens;

/** A site's own app in the tray, on the Apps bridge (its id is "social"): the site's window and its own settings (Job 3,
 *  SiteApp.tsx). `browser`: the Browser's bridge, where the site's sign-in (its connection) is kept. */
export function SiteRoot({ site, browser }: { site: string; browser?: Bridge }) {
  return <SiteApp site={site} {...(browser ? { browser } : {})} />;
}
