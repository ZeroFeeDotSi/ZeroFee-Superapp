// Social trading's page (S17, 5 Nov): one entry in All apps for every social trading site (pump.fun, GMGN, more
// later). It opens on the list of its sites, each a row by its name with its wallet's dollars; a tap opens that site's
// wallet page (SiteWalletApp, unchanged), whose Back comes back to this list. openApp("social", "pump") lands here on
// pump.fun's page (AppHost landing). The web wallet: the same list; a tap says the site works in the phone app.
// It runs on the Browser's bridge (app id "social"), where the sites' wallets always were. Its code loads when it is
// first shown, never in Home's first load. Under its title, one quiet line names the sites inside it (SOCIAL_TRADING.line).
import { useEffect, useRef, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingWallet } from "@zerofee/core/spending";
import { AppFrame, useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { OnYourPhone } from "@zerofee/shell-api/OnYourPhone.tsx";
import { usd } from "@zerofee/trade/app/format.ts";
import { PRESET_LOGO } from "../app/chains.tsx";
import { LISTED } from "./catalog.ts";
import { Mark, initialOf } from "./Favourites.tsx";
import { keptHub, readHub, saveHub } from "./hub-state.ts";
import { chainDown, keptLine, useDownRows } from "@zerofee/trade/app/chain-down.ts";
import { SiteWalletApp } from "./SiteWalletApp.tsx";
import { SOCIAL_TRADING, siteFigures, siteOf } from "./social-trading.ts";
import "./social.css";

const IDS = LISTED.map((a) => a.id);

export function SocialTradingApp({ page, browser, web = false }: { /** this page's id in the shell */ page: string; browser?: Bridge; web?: boolean }) {
  const shell = useShell();
  const { bridge, active, requestedTab, requestSeq } = shell;
  const [site, setSite] = useState<string | null>(() => siteOf(requestedTab, IDS));
  // a new request for a site while this page is up (Home's Hot row, the Browser's Recent): that site's page
  const seen = useRef(requestSeq);
  useEffect(() => {
    if (requestSeq === seen.current) return;
    seen.current = requestSeq;
    const s = siteOf(requestedTab, IDS);
    if (s) setSite(s);
  }, [requestSeq, requestedTab]);
  // the figures: what the hub read last on this phone at once, then Spending's list while this list is on screen
  const [figures, setFigures] = useState<Record<string, number | null>>(() => Object.fromEntries(readHub().map((r) => [r.site, r.usd])));
  // audit 18 (S18-4): a site Solana couldn't read now shows its last figure (hub-state keptHub) with its time and who is
  // down, once under the list, in Home's Hot words (trade chain-down keptLine); never a blank row
  const [unread, setUnread] = useState<readonly string[]>([]);
  const [kept, setKept] = useState(() => keptHub());
  const down = chainDown(useDownRows(bridge), "sol");
  useEffect(() => {
    if (!active || site || web) return;
    let live = true;
    void bridge.call<SpendingWallet[]>("spending.wallets").then((r) => {
      if (!live || !("ok" in r) || !Array.isArray(r.ok)) return;
      const read = siteFigures(r.ok, IDS);
      saveHub(IDS.map((id) => ({ site: id, name: LISTED.find((a) => a.id === id)?.preset.name ?? id, usd: read[id] ?? null })));
      setKept(keptHub());
      setUnread(IDS.filter((id) => read[id] === null));
      setFigures((prev) => Object.fromEntries(IDS.map((id) => [id, read[id] ?? prev[id] ?? null])));
    }, () => undefined);
    return () => { live = false; };
  }, [active, site, web, bridge]);
  const keptAt = unread.flatMap((id) => (kept[id] ? [kept[id]!.at] : []));

  if (site && !web) return <SiteWalletApp site={site} page={page} {...(browser ? { browser } : {})} onBack={() => setSite(null)} />;
  const shownSite = site ? LISTED.find((a) => a.id === site) : undefined;
  return (
    <AppFrame
      name={SOCIAL_TRADING.name}
      top={<span className="st-title"><span className="zf-label" style={{ color: "var(--ink)" }}>{SOCIAL_TRADING.name}</span><span className="st-title__line">{SOCIAL_TRADING.line}</span></span>}
      tray={[]}
      tab="all"
      onTab={() => {}}
    >
      <section className="sh-recent" aria-label={SOCIAL_TRADING.name} data-testid="social-trading">
        <ul className="zf-group sh-group">
          {LISTED.map((a) => {
            const n = unread.includes(a.id) ? kept[a.id]?.usd : figures[a.id];
            return (
              <li key={a.id}>
                <button className="zf-row sh-recent-row" data-testid={`social-trading-${a.id}`} onClick={() => setSite(a.id)}>
                  <span className="sh-recent-logo" aria-hidden="true"><Mark logo={PRESET_LOGO[a.id]} letter={initialOf(a.preset.name)} size={40} /></span>
                  <span>
                    <span className="t">{a.preset.name}</span>
                    <span className="d">{typeof n === "number" ? usd(n) : ""}</span>
                  </span>
                  <span className="v" aria-hidden="true">›</span>
                </button>
              </li>
            );
          })}
        </ul>
        {keptAt.length > 0 && <p className="zf-small st-as-of" data-testid="social-as-of">{keptLine("sol", down, unread.length > 1 ? "Site wallets are" : `Your ${LISTED.find((a) => a.id === unread[0])?.preset.name ?? "site"} wallet is`, Math.min(...keptAt))}</p>}
      </section>
      {web && shownSite && active && <OnYourPhone reason="site" name={shownSite.preset.name} icon={<img src={PRESET_LOGO[shownSite.id]} alt="" width={48} height={48} />} onClose={() => setSite(null)} />}
    </AppFrame>
  );
}
