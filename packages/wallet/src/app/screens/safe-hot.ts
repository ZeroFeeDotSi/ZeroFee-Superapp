// Home's two tabs, Safe and Hot (product decision, 5 Nov; HOME-SAFE-HOT-SPEC): pure, so node tests each rule.
// - Safe: the coins the account holds inside intents.near plus its own NEAR, one row each, from the ledger's chain reads.
//   A coin's tap opens its trade page (Trade's coin page, "coin:intents:<assetId>"), behind NATIVE_COINS until it lands.
// - Hot: Trade's wallets, one per chain, then one row per site (pump.fun, GMGN, the agent's: siteGroups) that opens to
//   its wallets, each coin its own row at its own price (subwallet.coins), never on the Safe tab.
import type { SpendingWallet } from "@zerofee/core/spending";
import { siteWalletFunded } from "@zerofee/core/site-funded";
import type { Line } from "../format.ts";
import type { PrivatePocket } from "../../types.ts";

export type HomeTab = "safe" | "hot";
export const HOME_TABS: readonly HomeTab[] = ["safe", "hot"];
export const HOME_TAB_NAME: Record<HomeTab, string> = { safe: "Safe", hot: "Hot" };
/** What each tab is, one line under the switch while it is on, for a first-time person (QA's UX hunt, 5 Nov:
 *  "Home never says what Safe or Hot is"; copywriter, 5 Nov). Never "private" for the Safe: it is a public NEAR account (Private and the confidential moves are what's private); no Face ID (the owner struck it from Home's Safe words). The
 *  look (where and when it shows) is the design review's. */
export const HOME_TAB_IS: Record<HomeTab, string> = { safe: "Guarded by your rules.", hot: "Small wallets for trading, and one for each site." };

/** NEAR on the account itself (catalogue.ts NATIVE_NEAR) is wrapped NEAR's page: one coin, one page. */
const NEAR_IDS: Record<string, string> = { near: "nep141:wrap.near" };
/** The Safe's cash, USDC on NEAR (trade native/assets.ts SAFE_CASH): what Buy pays with, never on Trade's list. */
const SAFE_CASH = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/** A 1Click asset id as Trade's coin page reads it. */
const ASSET = /^nep(141|245):[A-Za-z0-9._:-]{2,120}$/;

/** What Trade opens for a Safe coin: "coin:intents:<assetId>:<SYMBOL>", its biggest part's id (USDC on NEAR before USDC
 *  bridged from Base, by dollars). Null for a coin 1Click doesn't list (no page, no price): Wallet's own coin screen. */
export function safeCoinRoute(l: Pick<Line, "symbol" | "listed" | "parts">): string | null {
  if (!l.listed) return null;
  const id = l.parts.map((p) => NEAR_IDS[p.tokenId] ?? p.tokenId).find((t) => ASSET.test(t));
  // the Safe's cash (USDC on NEAR), which Trade's list leaves out (trade native/assets.ts SAFE_CASH), opens Wallet's own
  // coin screen, with Send: never "Your Safe can't trade this coin." alone (Sim test). Any other coin's
  // page has Send for what the Safe holds; Buy and Sell only where safeCanSell lists it (NativeCoinPage). Nothing more
  // here: this file is in Home's first load (speed budget)
  if (!id || id === SAFE_CASH) return null;
  return `coin:intents:${id}${/^[A-Za-z0-9.$_-]{1,16}$/.test(l.symbol) ? `:${l.symbol}` : ""}`;
}

/** The pulse keys a tab's day change counts (pulse.ts holdings): the Safe its coins (Hidden's under it, D128); Hot the
 *  wallets' coins and the coins bought in them. */
export const tabPulse = (tab: HomeTab) => (tab === "safe" ? (k: string) => k.startsWith("safe:") || k.startsWith("hidden:") : (k: string) => k.startsWith("row:") || k.startsWith("held:"));

/** One coin a site wallet holds, as the core lists it (site-coins.ts WalletCoinRow): `amount` in its smallest units. */
export interface SiteCoin { token: string; symbol: string; name?: string; decimals: number; amount: string; usd: number | null }
/** `tap`: it opens its coin page. Only its own coin or a priced one does: a coin with no price is listed nowhere, so it
 *  shows with no tap (QA, 5 Nov). */
export interface HotCoin { key: string; token: string; symbol: string; amount: string; usd: string | null; tap: boolean }

/** The longest symbol a row shows: a site coin's symbol is whatever its maker chose (spam on SOL is airdropped to anyone). */
export const SYMBOL_MAX = 10;
/** A symbol that reads like a place to go ("claim-at-x.io", "www…", "t.me/…"): airdropped spam's bait. "USDC.e" is not. */
const LINKISH = /\.[a-z]{2,}|www|[/:@\\]/i;
/** A site coin's symbol fit for a row: plain marks only, never link-like, capped at SYMBOL_MAX ("…" past it). Null: the
 *  row is hidden (the wallet's figure still counts it). */
export function siteSymbol(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!/^[A-Za-z0-9$._-]{1,64}$/.test(t) || LINKISH.test(t)) return null;
  return t.length > SYMBOL_MAX ? `${t.slice(0, SYMBOL_MAX - 1)}…` : t;
}
/** `mark`: its network's logo key (packages/design logos.ts) when one is bundled. `opens`: Trade has pages for its chain's
 *  coins, so its rows tap; off, `noPage` says why they don't (UI audit, 5 Nov: GMGN on Base had no mark and dead rows). */
export interface SiteSection { key: string; site?: string; name: string; network: string; mark?: string; opens: boolean; noPage?: string; usd: string | null; holds?: string; agent?: true; /** B1: it can't be read now */ unread?: true; /** D7: its figure is its last read, as of then */ asOf?: number; coins: HotCoin[] }

/** A site wallet's row on Home, nested under its site (bug report, 5 Nov; the copy review's ruling, 5 Nov):
 *  it opens THAT site's wallet page (its figure, its coins, Add / Take out, "Open pump.fun"), whether or not Trade has a
 *  market for its chain, and never the market: markets open only from the Trade tab and a coin's own row. AgentZero's
 *  pocket and a wallet with no site: no tap. */
export function siteTap(x: Pick<SiteSection, "site" | "agent">, onSite: ((site: string) => void) | undefined): { role?: "button"; tabIndex?: number; onClick?: () => void; onKeyDown?: (e: { key: string }) => void } {
  if (!x.site || x.agent || !onSite) return {};
  const open = () => onSite(x.site!);
  return { role: "button", tabIndex: 0, onClick: open, onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") open(); } };
}

/** The chains Trade has coin pages for (Home's Trade wallets): a site coin there opens its page. */
export const PAGE_CHAINS: readonly string[] = ["sol", "hood", "near", "bsc"];
/** A network's logo key, for the networks a site wallet can be on (core site-coins.ts NATIVE_SYMBOL, and more). */
export const NETWORK_MARK: Readonly<Record<string, string>> = { sol: "sol", hood: "hood", near: "near", bsc: "bsc", eth: "eth", base: "base", arb: "arb", op: "op", gnosis: "gnosis", pol: "pol", avax: "avax", scroll: "scroll" };
/** A network's name, said where Trade has no page for it. */
export const NETWORK_NAME: Readonly<Record<string, string>> = { eth: "Ethereum", base: "Base", arb: "Arbitrum", op: "Optimism", gnosis: "Gnosis", pol: "Polygon", avax: "Avalanche", scroll: "Scroll" };
export const SITE_WORDS = {
  /** Copywriter, 5 Nov. */
  noPage: (network: string) => `${network} coins don't open in Trade.`,
} as const;

/** Smallest units as a decimal ("1420000000", 9 → "1.42"). */
export function unitsText(units: string, decimals: number): string {
  if (!/^\d{1,60}$/.test(units) || !(decimals >= 0 && decimals <= 36)) return "0";
  const s = units.replace(/^0+(?=\d)/, "").padStart(decimals + 1, "0");
  const w = s.slice(0, s.length - decimals), f = s.slice(s.length - decimals).replace(/0+$/, "");
  return f ? `${w}.${f}` : w;
}

/**
 * The site wallets' sections (Hot, after Trade): each site's wallet once made, at $0.00 too; an older one or the agent's
 * pocket only while it holds money or can't be read. The figure is spending.wallets' one figure (its coin and its coins,
 * the same one Home's number counts); its rows are each coin it holds at its own price, its own coin first. Coins not read
 * yet: one row of its own coin, at the wallet's figure. A coin with nothing in it is left out; one with no price shows its
 * amount, never a made-up $0, and no tap. A coin whose symbol reads like a link (airdropped spam) is not a row.
 */
export function siteSections(wallets: readonly SpendingWallet[] | null | undefined, coinsOf: (id: string) => readonly SiteCoin[] | null | undefined, sum: (xs: (string | null | undefined)[]) => string): SiteSection[] {
  // AgentZero's own wallet (role "agent", agent-row.ts) is a section as a site's is (QA 5 Nov: its $1.99 was counted nowhere)
  return (wallets ?? []).filter((w) => w.role === "site" || w.role === "agent").flatMap((w) => {
    const usd = w.unread ? null : sum([w.cashUsd, w.coinsUsd]);
    const made = !!w.site && w.current && w.site !== "agentzero";
    // AgentZero's own wallet (agent-row.ts: role "agent", no site) is its row at $0 too, saying empty (copy review, S14)
    const agent = w.role === "agent" || w.site === "agentzero";
    if (!(made || w.role === "agent" || usd === null || Number(usd) >= 0.01)) return [];
    const listed = coinsOf(w.id), network = String(w.network), opens = PAGE_CHAINS.includes(network);
    const coins: HotCoin[] = Array.isArray(listed)
      ? [...listed].filter((c) => c && /[1-9]/.test(String(c.amount))).sort((a, b) => Number(b.token === "native") - Number(a.token === "native") || (b.usd ?? -1) - (a.usd ?? -1))
        .flatMap((c): HotCoin[] => {
          const native = c.token === "native", symbol = native ? c.symbol : siteSymbol(c.symbol);
          if (symbol === null) return [];                               // link-like or no symbol: hidden, never a tap
          const usd = typeof c.usd === "number" && Number.isFinite(c.usd) ? c.usd.toFixed(2) : null;
          return [{ key: `${w.id}:${c.token}`, token: c.token, symbol, amount: unitsText(c.amount, c.decimals), usd, tap: opens && (native || usd !== null) }];
        })
      : [];
    const mark = NETWORK_MARK[network];
    // the figure is the rows shown when every row has a price (QA's MUST, Sim test: Hot's total and its rows
    // disagreed); a row without one keeps spending.wallets' figure
    const shownUsd = usd !== null && coins.length > 0 && coins.every((c) => c.usd !== null) ? sum(coins.map((c) => c.usd)) : usd;
    return [{ key: w.id, ...(w.site ? { site: w.site } : {}), name: w.label, network, ...(mark ? { mark } : {}), opens, ...(!opens && coins.length ? { noPage: SITE_WORDS.noPage(NETWORK_NAME[network] ?? network.toUpperCase()) } : {}), usd: shownUsd, ...(w.holds ? { holds: w.holds } : {}), ...(agent ? { agent: true as const } : {}), ...(w.unread ? { unread: true as const } : {}), ...(w.asOf ? { asOf: w.asOf } : {}), coins }];
  });
}

/** Audit 12 C7: the site wallets a list shows, by Hot's own rule (siteGroups: a site's wallets with money; none yet, its
 *  first), so Details says the same count as Hot ("GMGN · 1 wallet" over Details' two). Every other wallet stays. */
export function siteWalletsShown<W extends Pick<SpendingWallet, "id" | "role" | "site" | "cashUsd" | "coinsUsd" | "holds" | "unread">>(wallets: readonly W[]): W[] {
  const bySite = new Map<string, W[]>();
  for (const w of wallets) if (w.role === "site" && w.site && w.site !== "agentzero") bySite.set(w.site, [...(bySite.get(w.site) ?? []), w]);
  const keep = new Set<string>();
  for (const ws of bySite.values()) {
    // Hot's figure for it (siteSections: unread is null), then Hot's test (siteGroups)
    const funded = ws.filter((w) => siteWalletFunded(w.unread || (w.holds && !(Number(w.cashUsd ?? 0) + Number(w.coinsUsd ?? 0) >= 0.01)) ? null : Number(w.cashUsd ?? 0) + Number(w.coinsUsd ?? 0), w.holds));
    for (const w of funded.length ? funded : ws.slice(0, 1)) keep.add(w.id);
  }
  return wallets.filter((w) => !(w.role === "site" && w.site && w.site !== "agentzero") || keep.has(w.id));
}

/** One row per site on Hot (S14, 5 Nov: GMGN's SOL and Base wallets were two cards, and so were pump.fun's):
 *  its name, its figure and its wallets, shown once it is opened. AgentZero's pocket is its own. The figure is the sum of
 *  its wallets' figures (the rows inside), so Hot's number still adds up; a wallet that can't be read adds nothing, and a
 *  site none of whose wallets can be read says so (null), never $0. */
/** `unseen` (audit 11's B1, 8 Nov): one of its wallets can't be read (its chain is down): its figure is null, never the
 *  read part alone ("GMGN · $0.00" while its SOL wallet held $27.47), and Home says "Can't see it now". */
export interface SiteGroup { key: string; site?: string; name: string; usd: string | null; agent?: true; unseen?: true; /** D7: the oldest of its wallets' kept reads */ asOf?: number; wallets: SiteSection[] }
export function siteGroups(sections: readonly SiteSection[], sum: (xs: (string | null | undefined)[]) => string): SiteGroup[] {
  const by = new Map<string, SiteSection[]>();
  for (const x of sections) {
    const key = x.agent ? "agent" : `site:${x.site ?? x.key}`;
    by.set(key, [...(by.get(key) ?? []), x]);
  }
  return [...by].map(([key, wallets]) => {
    const first = wallets[0]!;
    const read = wallets.filter((w) => w.usd !== null);
    // its wallets as its page counts them (core site-funded.ts; test: "GMGN / 2 wallets" over a page of one): the ones
    // with money; none yet, its first, so the site still has its row. AgentZero's pocket is its own row, empty or not
    // a wallet with no dollar figure, only what it holds ("0.004 ETH" on Base), is funded by what it holds (audit 12 C7)
    const funded = first.agent ? wallets : wallets.filter((w) => siteWalletFunded(w.usd === null || (w.holds && !(Number(w.usd) >= 0.01)) ? null : Number(w.usd), w.holds));
    return { key, ...(first.site ? { site: first.site } : {}), name: first.agent ? "AgentZero" : first.name.replace(/ wallet$/, ""), usd: read.length && !wallets.some((w) => w.unread) ? sum(read.map((w) => w.usd)) : null, ...(first.agent ? { agent: true as const } : {}), ...(wallets.some((w) => w.unread) ? { unseen: true as const } : {}), ...(wallets.some((w) => w.asOf) ? { asOf: Math.min(...wallets.flatMap((w) => (w.asOf ? [w.asOf] : []))) } : {}), wallets: funded.length ? funded : [first] };
  });
}

/** Audit 13's D7: a chain wallet whose chain can't be read now: the time of the figure it shows (its kept read), else none. */
export const chainAsOf = (wallets: readonly Pick<SpendingWallet, "role" | "network" | "current" | "asOf" | "unread">[] | null | undefined, chain: string): number | undefined =>
  wallets?.find((w) => w.role === "chain" && w.current && w.network === chain && (w.asOf || w.unread))?.asOf;
/** Hot's one time (QA's SHOULD on builder 14, 8 Nov): a chain down, the oldest kept read Hot counts, said once under Hot's
 *  total ("As of 10:47 AM"), never on each row; none when every wallet read now. */
export const hotAsOf = (wallets: readonly Pick<SpendingWallet, "current" | "asOf">[] | null | undefined): number | undefined => {
  const t = (wallets ?? []).flatMap((w) => (w.current !== false && w.asOf ? [w.asOf] : []));
  return t.length ? Math.min(...t) : undefined;
};
/** A site's line on Hot (audit 13's D7): "1 wallet · $27.47"; its figure kept from a read before its chain went down,
 *  "1 wallet" (the figure is the row's own; the time is said once, under Hot's total: hotAsOf); can't be read and never
 *  read, "1 wallet" (the row says "Can't see it now" once). */
export const siteDetail = (g: Pick<SiteGroup, "wallets" | "usd" | "unseen" | "asOf">, $: (usd: string | null) => string): string =>
  `${g.wallets.length} ${g.wallets.length === 1 ? "wallet" : "wallets"}${g.unseen || g.asOf ? "" : ` · ${$(g.usd)}`}`;

/**
 * Private's place on Home (QA's gates re-crawl, 5 Nov, MUST: Private was open but Home had no door to it). On the
 * Safe tab, under its coins; it opens Private's screen at once (rule 2). Its set-up (ledger.privateSetup: a key from the
 * words, nothing on chain) runs behind when Home opens (WalletApp ensurePrivate), so it is done before the tap. Null where Private isn't open (privateOpen), on the web wallet, or before this
 * phone can use it (pocket.available false: D13, nothing shown). Words by the copywriter (5 Nov); QA: the set-up
 * only makes a key from the words (subwallet.create: vault + list, nothing on chain), so no "on NEAR"; what's in it is
 * unseen, the money going in and the payouts are public (PRIVATE_SEEN).
 */
export type PrivateDoor = { kind: "setup" } | { kind: "open" };
export function privateDoor(pocket: Pick<PrivatePocket, "available" | "ready"> | null | undefined, open: boolean): PrivateDoor | null {
  if (!open || !pocket?.available) return null;
  return pocket.ready ? { kind: "open" } : { kind: "setup" };
}
export const PRIVATE_DOOR_WORDS = {
  name: "Private",
  setup: "One tap. Nothing leaves your Safe.",
  open: "The public can't see what's in it.",
} as const;

/** A site wallet's line on Home (test, MUST 9: "SOL wallet / 0.2458 SOL / $27.47" over SOL $25.00 + BONK $2.47): the
 *  dollars of the coin its units name, as the Trade row says it (re-check); each coin it holds is its own line under it.
 *  Its own coin unpriced beside other coins: its units alone, never the whole wallet's dollars. No coins listed (not read
 *  yet) or only its own coin: the wallet's figure. */
export function siteLineUsd(x: Pick<SiteSection, "usd" | "coins">): string | null {
  const native = x.coins.find((c) => c.token === "native");
  return native && x.coins.length > 1 ? native.usd : x.usd;
}
