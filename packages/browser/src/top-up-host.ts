// The product Browser thesis, part 2 (4 Nov 2026): Top up, right there in the Browser, for the site's own wallet. A
// Browser tab whose page the engine answered with that site's own Solana wallet says "<host> has its own wallet." on its
// one bottom line, with Top up and × (the iPhone's EverySite.swift). Its tap puts the tab in the back and tells the
// Browser `device.site.topupHost { host, tab }`: the host WebKit shows, never the page's word. The Browser, on screen,
// opens Home's Put money in for that host's own wallet (D160: shell.openMoney siteadd with "host:<host>"; a listed site's
// own wallet by its id, as its tile does), then shows the tab again; when the money went, the tab says so itself.
import { SITE_WALLETS } from "@zerofee/core/site-wallets";
import type { MoneyAsk, MoneyEnd } from "@zerofee/shell-api/money.ts";

export const TOPUP_HOST_EVENT = "device.site.topupHost";

/** A plain public host as the phone's bar shows it: lower case, no port, no user. */
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** A tab's id (the phone's UUID, as tabs.ts reads it). */
const TAB = /^[0-9A-F-]{36}$/i;

export interface TopUpHost { host: string; tab?: string }
/** The phone's event, read strictly: a plain host and, if it is one, the tab's id; anything else is nothing. */
export function topUpHostOf(raw: unknown): TopUpHost | null {
  if (!raw || typeof raw !== "object") return null;
  const { host, tab } = raw as Record<string, unknown>;
  if (typeof host !== "string" || !HOST.test(host)) return null;
  return typeof tab === "string" && TAB.test(tab) ? { host, tab } : { host };
}

/** The part of Spending's list (spending.wallets) the ask reads. */
export interface WalletRow { id: string; role?: string; site?: string; network?: string; current?: boolean }

/**
 * Put money in for this host's own wallet. A listed site's host (pump.fun in a Browser tab) has its fixed wallet (core
 * site-wallets.ts; subwallet.site.forHost gives it there): its Solana wallet's id from Spending's list, under its own
 * name. Any other host: its site id, "host:<host>", which Home's sheet turns into its own wallet (D160) or, with none
 * yet, says to connect there first.
 */
export function topUpAsk(host: string, rows: readonly WalletRow[] | null): Extract<MoneyAsk, { kind: "siteadd" }> {
  const listed = SITE_WALLETS.find((s) => !s.agent && s.hosts.includes(host));
  if (!listed) return { kind: "siteadd", wallet: `host:${host}`, name: host };
  const sol = rows?.find((w) => w.role === "site" && w.site === listed.site && w.network === "sol" && w.current !== false);
  return { kind: "siteadd", wallet: sol?.id ?? `host:${host}`, name: listed.name, ...(listed.chains.length > 1 ? { network: "Solana" } : {}) };
}

export interface TopUpDeps {
  /** D146: is the Browser on screen now (read when the event comes, not when the listener was made)? */
  onScreen: () => boolean;
  /** Spending's list, for a listed site's wallet id (null: not read). */
  wallets: () => Promise<readonly WalletRow[] | null>;
  /** A listed site's own Solana wallet from the core (subwallet.site.forHost: the same fixed wallet every time), when
   *  Spending's list didn't name it: its id, or null. */
  siteWallet?: (host: string) => Promise<string | null>;
  openMoney: (ask: MoneyAsk, onEnd: (end: MoneyEnd) => void) => void;
  /** The tab again, on screen. */
  showTab: (id: string) => Promise<boolean>;
  /** The tab on screen hears its Top up went (it says its own line). */
  went: (host: string) => void;
}

/**
 * One Top up from the phone's event. Only while the Browser is on screen (D146: a late one after the person left is
 * dropped). When the sheet is over, the tab comes back (unless the person left the Browser meanwhile); if the money went,
 * the tab says so. Answers whether a sheet opened. (One at a time is the phone's: its tab is in the back once tapped.)
 */
export function topUpHandler(deps: TopUpDeps): (raw: unknown) => Promise<boolean> {
  return async (raw) => {
    const e = topUpHostOf(raw);
    if (!e || !deps.onScreen()) return false;
    const listed = SITE_WALLETS.some((s) => !s.agent && s.hosts.includes(e.host));
    const rows = listed ? await deps.wallets().catch(() => null) : null;
    let ask = topUpAsk(e.host, rows);
    // A listed site's host whose wallet Spending's list didn't name (the list unread, or read before the wallet was made):
    // "host:pump.fun" would be a wallet of its own that the page never signs with, so Home's sheet could only say
    // "connect first" while the person is on pump.fun. Its fixed wallet comes from the core instead (bug report, 4 Nov).
    if (listed && ask.wallet.startsWith("host:") && deps.siteWallet) {
      const id = await deps.siteWallet(e.host).catch(() => null);
      if (id) ask = topUpAsk(e.host, [...(rows ?? []), { id, role: "site", site: SITE_WALLETS.find((s) => s.hosts.includes(e.host))!.site, network: "sol", current: true }]);
    }
    if (!deps.onScreen()) return false;
    deps.openMoney(ask, (end) => {
      if (!e.tab || !deps.onScreen()) return;
      void deps.showTab(e.tab).then((shown) => { if (shown && end.went) deps.went(e.host); }, () => undefined);
    });
    return true;
  };
}
