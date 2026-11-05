// The pages the shell hosts (Job 1, the spine), built the same way for the real app (App.tsx), the sample-money demo and
// the screens gallery, so what is walked is what ships:
// - Home: the Wallet app, with Security inside it (its rows, places and the account's own history handed in through
//   HomeSlots); there is no Security app;
// - the Browser ("social"): the address bar and every other site;
// - Social trading (S17, 5 Nov): ONE entry for pump.fun, GMGN and the sites to come ("site:trading"). It opens
//   on its list of sites; a site's row opens its wallet page, whose big Open button opens the site's window. It runs on
//   the Browser's bridge (app id "social"), where the sites' wallets, rights and sign-ins always were; its code loads
//   when first shown, never in Home's load;
// - every other app as the build lists it.
import type { Bridge } from "@zerofee/core/bridge";
import { useEffect, useState, type ReactNode } from "react";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { OnYourPhone } from "@zerofee/shell-api/OnYourPhone.tsx";
import { webWallet } from "@zerofee/shell-api/release.ts";
import type { PhoneReason } from "@zerofee/shell-api/web-wallet-words.ts";
import type { AppModule } from "@zerofee/shell-api/app-module.ts";
import { HomeSlotsContext, type HomeSlots } from "@zerofee/shell-api/home-slots.ts";
import type { HostedApp } from "./AppHost.tsx";
import { readyLazy } from "../apps.ts";
import { SOCIAL_TRADING as WORDS } from "@zerofee/browser/social/social-trading.ts";
import { SOCIAL_TRADING } from "./tray.ts";

// drawn directly once its code is here (readyLazy: never React.lazy's 300 ms hold on a preloaded Browser)
const hub = readyLazy<{ browser?: Bridge }>(() => import("@zerofee/browser/social/SocialApp.tsx").then((m) => m.HubRoot));
const HubRoot = hub.Root;
const socialTrading = readyLazy<{ page: string; browser?: Bridge; web?: boolean }>(() => import("@zerofee/browser/social/SocialTradingApp.tsx").then((m) => m.SocialTradingApp));
const SocialTradingRoot = socialTrading.Root;
/** When the shell preloads the Browser: its code, and, once the page is idle, its start page's Favourites, Recent and
 *  open pages read ahead (the agent package's warmStartPage), so a first tap paints every row in its first frame. */
export function preloadBrowser(preload: (() => void) | undefined, browser: Bridge | undefined): void {
  preload?.();
  void hub.preload();
  if (!browser) return;
  const idle = (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  const warm = () => void import("@zerofee/browser/social/start-read.ts").then((m) => m.warmStartPage(browser)).catch(() => undefined);
  if (idle) idle(warm, { timeout: 2000 });
  else setTimeout(warm, 0);
}

/** A web wallet's tab for what lives on the phone: the one On your phone page; Close goes Home. The tab's
 *  page stays mounted (AppHost), so Close also takes the sheet away (a web test, 4 Nov: an empty sheet stayed in the
 *  page after each Close); coming back to the tab shows it again. */
export function PhoneTab({ reason, name, icon }: { reason: PhoneReason; name?: string; icon?: ReactNode }) {
  const shell = useShell();
  const [closed, setClosed] = useState(false);
  useEffect(() => { if (shell.active) setClosed(false); }, [shell.active]);
  const close = () => {
    setClosed(true);
    shell.openApp("wallet");
  };
  // only on the tab in view (restore crawl, 4 Nov: an empty dialog stayed in the page after Close): a tab kept behind
  // another holds no sheet, so the page has one dialog at most, the one shown
  return <div className="zf-screen" style={{ position: "absolute", inset: 0 }}>{!closed && shell.active && <OnYourPhone reason={reason} {...(name ? { name } : {})} {...(icon ? { icon } : {})} onClose={close} />}</div>;
}

export function hostApps(modules: readonly AppModule[], bridgeOf: (id: string) => Bridge, home: HomeSlots = {}, web = webWallet()): HostedApp[] {
  const out: HostedApp[] = [];
  for (const m of modules) {
    // D118: the Browser tab is "social" renamed; the old Browser app's page never shows (two "Browser" pages, or a
    // "Browser · Building" one). Its bridge stays: the Browser's wallet engine runs on it (bridgeOf("browser") below).
    if (m.id === "browser") continue;
    const bridge = bridgeOf(m.id);
    if (m.id === "social") {
      // the Browser's bridge too: a site's sign-in (its connection) is kept as the Browser's, where its wallet engine runs
      const browser = bridgeOf("browser") as Bridge | undefined;
      // the web wallet: the Browser's tab stays, the On your phone page (a site can't be framed, and a popup
      // has no wallet), and none of its code loads
      out.push({ id: "social", name: m.name, line: m.line, bridge, render: web ? () => <PhoneTab reason="browser" /> : () => <HubRoot {...(browser ? { browser } : {})} />, ...(web ? {} : { preload: () => preloadBrowser(m.preload, browser) }) });
      // Social trading: one entry, its sites inside it (S17); on the web its list too, a site's tap the On your phone page
      out.push({ id: SOCIAL_TRADING, name: WORDS.name, line: WORDS.line, bridge, render: () => <SocialTradingRoot page={SOCIAL_TRADING} web={web} {...(browser ? { browser } : {})} />, ...(web ? {} : { preload: () => void socialTrading.preload() }) });
      continue;
    }
    const render = m.id === "wallet" ? () => <HomeSlotsContext.Provider value={home}><m.Root /></HomeSlotsContext.Provider> : () => <m.Root />;
    out.push({ id: m.id, name: m.id === "wallet" ? "Home" : m.name, line: m.line, bridge, render, ...(m.preload ? { preload: m.preload } : {}) });
  }
  return out;
}
