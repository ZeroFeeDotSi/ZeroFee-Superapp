// "Your wallets" (the Browser thesis, part 3): every site wallet ever made, on one page from the Browser's start page.
// Pure, so node tests it (your-wallets.test.ts): which wallets, in what order, their dollars and coins, which ones can
// Move back to Safe, and the list "Move everything back" goes through. Loaded with that page only, never in Home's first
// load (speed budget).
// - The wallets: Spending's list (spending.wallets), every site's current wallets: a listed site's (pump.fun, GMGN, and
//   the ones that left the catalog) and any other site's own wallet ("host:<host>", audit C1), never AgentZero's pocket.
// - Coins: the core's subwallet.coins for each wallet; until they are read, the wallet's own coin as Spending read it.
//   A coin with no price shows its amount, never $0.00. A wallet that can't be read now keeps what it showed last
//   (keepLast), and is never put with the empty ones.
// - Move back: the money sheet's site Take out (shell.openMoney "siteback"), which moves a wallet's own coin home from the
//   networks ZeroFee carries back (take-out.ts TAKES_OUT), $2 or more; any other coin is sold on its site first.
import type { SpendingWallet } from "@zerofee/core/spending";
import { SITE_WALLETS, isAgentPocket } from "@zerofee/core/site-wallets";
import { usd } from "@zerofee/trade/app/format.ts";
import type { SiteCoin } from "./site-wallet.ts";
import { TAKES_OUT } from "./take-out.ts";

/** Under this a move back would mostly go on fees (take-out.ts's floor, the money sheet's SITE_MIN_USD). */
export const BACK_MIN_USD = 2;
/** Each network's own coin. */
const NATIVE: Readonly<Record<string, string>> = { sol: "SOL", bsc: "BNB", eth: "ETH", base: "ETH", arb: "ETH", hood: "ETH", gnosis: "xDAI" };
const NETWORK: Readonly<Record<string, string>> = { sol: "Solana", bsc: "BNB", eth: "Ethereum", base: "Base", arb: "Arbitrum", hood: "Robinhood Chain", gnosis: "Gnosis" };
/** The order a site's networks are listed in. */
const ORDER = ["sol", "bsc", "hood", "eth", "base", "arb", "gnosis"];
const rank = (n: string) => { const i = ORDER.indexOf(n); return i < 0 ? 99 : i; };

export const words = {
  title: "Your wallets",
  row: "Each site's own wallet, in one place.",
  total: "In your site wallets",
  someUnseen: "Some wallets didn't answer, so they're not counted.",
  noPrice: "Plus coins with no price.",
  back: "Take out",
  /** The button with what it moves: "Take out $9.70" (one word for the move, crawl F14); its sheet opens at it (F5). */
  backUsd: (usd: string) => `Take out ${usd}`,
  all: "Take out all",
  allLine: (n: number) => (n === 1 ? "One wallet." : `${n} wallets, one at a time.`),
  allDone: "All of it is on its way to your Safe.",
  allStopped: (n: number, of: number) => `${n} of ${of} on their way. The others still have their money.`,
  empty: "No money",
  showEmpty: (n: number) => `Show empty (${n})`,
  hideEmpty: "Hide empty",
  none: "No site wallets yet. A site gets its own wallet when you sign in to it.",
  allEmpty: "No money in any site wallet.",
  looking: "Looking…",
  cantSee: "Can't see it now",
  lastLook: "Can't see it now. This is from the last look.",
  readFailed: "Your wallets didn't load. These are from the last look.",
  sellFirst: (site: string, coins: string) => `Take out moves ${coins} only. Sell your other coins on ${site} first.`,
  tooSmall: "Under $2, so it stays. Fees would take most of it.",
  staysOn: (network: string) => `Take out leaves ${network} money here for now.`,
} as const;

/** One coin of a site's wallets, as its row says it: "$8.20", or "0.0012 ETH" when it has no price. */
export interface CoinLine { key: string; name: string; symbol: string; value: string; priced: boolean }

/** Where a Move back starts: the money sheet's siteback for this wallet, sweeping the site's other movable wallets too. */
/** `usd`: what the sheet moves (Spending's own-coin figure, QA 4 Nov), so the button's number matches the sheet's. */
export interface BackAsk { wallet: string; name: string; also: string[]; usd: number }

export interface WalletCard {
  /** The wallet's site: "pump", or "host:example.com". */
  site: string;
  /** Its site's name ("pump.fun"), or its host for a site ZeroFee doesn't list. */
  name: string;
  /** The host a per-host wallet is for (its logo is looked up by it); none for a listed site. */
  host?: string;
  /** The tile's letter when there is no logo. */
  letter: string;
  /** Its dollars ("$12.40"); a coin's amount when nothing has a price; "Looking…" or "Can't see it now" when unknown. */
  dollars: string;
  /** Its priced dollars, for the total and the order; null: not known now. */
  usd: number | null;
  /** Some coins have no price (said under the dollars). */
  unpriced: boolean;
  coins: CoinLine[];
  /** Holds anything, or can't be read (never taken for empty). */
  hasMoney: boolean;
  /** Shown from the last look: the chain didn't answer this time. */
  stale: boolean;
  /** Its Move back to Safe, when there is something it can move. */
  back?: BackAsk;
  /** Plain lines under it: coins to sell on its site first, too small to move, a network ZeroFee can't move back. */
  notes: string[];
}

export interface YourWallets {
  /** Wallets with money (or that can't be read), largest first. */
  money: WalletCard[];
  /** Wallets with nothing in them: behind "Show empty", listed sites first. */
  empty: WalletCard[];
  /** The total of every priced coin; "…" before anything is read. */
  total: string;
  totalNote?: string;
  /** "Move everything back": the money sheets it opens, one site after another, largest first. */
  sweep: BackAsk[];
}

/** The coins each wallet showed last (by wallet id): a read that failed (null) keeps what was there. */
export function keepLast(last: Readonly<Record<string, readonly SiteCoin[]>>, got: Readonly<Record<string, readonly SiteCoin[] | null>>): Record<string, readonly SiteCoin[]> {
  const out: Record<string, readonly SiteCoin[]> = { ...last };
  for (const [id, coins] of Object.entries(got)) if (coins) out[id] = coins;
  return out;
}

/** The site wallets Spending lists, by site (current ones; never AgentZero's pocket or a chain wallet). */
export function siteWalletsOf(list: readonly SpendingWallet[]): SpendingWallet[] {
  return list.filter((w) => w.role === "site" && w.current && typeof w.site === "string" && w.site !== "" && !isAgentPocket(w.site));
}

const hostOf = (site: string): string | undefined => (site.startsWith("host:") ? site.slice(5) : undefined);
export const nameOfSite = (site: string): string => SITE_WALLETS.find((s) => s.site === site)?.name ?? hostOf(site) ?? site;
export const letterOf = (name: string): string => name.replace(/^(www|app)\./, "").charAt(0).toUpperCase() || "?";

/** "1234500000" with 9 decimals → "1.2345" (six places at most). */
function amountText(amount: string, decimals: number): string {
  if (!/^\d+$/.test(amount) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return "?";
  const s = amount.padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals).replace(/^0+(?=\d)/, "");
  const frac = decimals ? s.slice(s.length - decimals).slice(0, 6).replace(/0+$/, "") : "";
  return `${Number(whole).toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}
const some = (amount: string) => /[1-9]/.test(amount);
/** "0.0012 ETH" (Spending's holds) → is anything there. */
const holdsSome = (h: string | undefined): boolean => !!h && /[1-9]/.test(h.split(" ")[0] ?? "");
/** Spending's own dollars for a wallet's own coin: a number, or null (unread, or no price). */
const cashOf = (w: SpendingWallet): number | null => (!w.unread && w.cashUsd !== undefined && Number.isFinite(Number(w.cashUsd)) ? Number(w.cashUsd) : null);

/** One wallet's coins: the core's list when read, else its own coin as Spending read it; null: not known at all. */
function coinsOfWallet(w: SpendingWallet, coins: readonly SiteCoin[] | undefined): { lines: CoinLine[]; usd: number; unpriced: boolean; other: boolean } | null {
  if (coins) {
    const held = coins.filter((c) => some(c.amount));
    const lines = held.map((c): CoinLine => {
      const symbol = (c.symbol || "").slice(0, 12);
      const priced = c.usd !== null && Number.isFinite(c.usd);
      return { key: `${w.id}:${c.token}`, name: (c.name || symbol).slice(0, 40), symbol, value: priced ? usd(c.usd as number) : `${amountText(c.amount, c.decimals)} ${symbol}`.trim(), priced };
    });
    return { lines, usd: held.reduce((t, c) => t + (c.usd !== null && Number.isFinite(c.usd) ? c.usd : 0), 0), unpriced: lines.some((l) => !l.priced), other: held.some((c) => c.token !== "native") };
  }
  if (w.unread) return null;
  const sym = NATIVE[w.network] ?? "";
  const cash = cashOf(w);
  if (cash !== null) return { lines: cash >= 0.01 ? [{ key: `${w.id}:native`, name: NETWORK[w.network] ?? w.network, symbol: sym, value: usd(cash), priced: true }] : [], usd: cash, unpriced: false, other: false };
  if (holdsSome(w.holds)) return { lines: [{ key: `${w.id}:native`, name: NETWORK[w.network] ?? w.network, symbol: sym, value: w.holds!, priced: false }], usd: 0, unpriced: true, other: false };
  return { lines: [], usd: 0, unpriced: false, other: false };
}

/**
 * The page. `list`: Spending's wallets as last read; `coins`: each wallet's coins as last read (keepLast); `failed`: the
 * wallet ids whose coins didn't answer this time (shown from the last look); `read`: Spending's list is read ("ok"), not
 * yet ("first"), or didn't answer this time ("failed": the list shown is the last one).
 */
export function yourWallets(i: { list: readonly SpendingWallet[]; coins?: Readonly<Record<string, readonly SiteCoin[]>>; failed?: ReadonlySet<string>; read?: "first" | "ok" | "failed" }): YourWallets {
  const mine = siteWalletsOf(i.list);
  const sites = [...new Set(mine.map((w) => w.site!))];
  const cards = sites.map((site): WalletCard => {
    const ws = mine.filter((w) => w.site === site).sort((a, b) => rank(a.network) - rank(b.network));
    const name = nameOfSite(site);
    const host = hostOf(site);
    const each = ws.map((w) => ({ w, c: coinsOfWallet(w, i.coins?.[w.id]) }));
    const known = each.filter((x) => x.c !== null);
    const unknown = known.length < each.length;
    const coins = known.flatMap((x) => x.c!.lines);
    const priced = Math.round(known.reduce((t, x) => t + x.c!.usd, 0) * 100) / 100;
    const unpriced = coins.some((c) => !c.priced);
    const hasMoney = unknown || coins.length > 0;
    const stale = ws.some((w) => i.failed?.has(w.id)) || (i.read === "failed" && ws.length > 0);
    const firstUnpriced = coins.find((c) => !c.priced);
    // the dollars: the priced coins' sum; only coins with no price: the first one's amount (never $0.00 over them)
    const dollars = unknown && !known.length
      ? (i.read === "failed" || stale ? words.cantSee : words.looking)
      : priced < 0.01 && firstUnpriced ? firstUnpriced.value : usd(priced);
    // Move back: each wallet on a network ZeroFee carries home with its own coin at $2 or more (Spending's figure, the one
    // the money sheet moves); the site's Solana wallet leads when it is one of them
    const legs = ws.filter((w) => (TAKES_OUT as readonly string[]).includes(w.network) && (cashOf(w) ?? 0) >= BACK_MIN_USD);
    const back = legs.length ? { wallet: legs[0]!.id, name, also: legs.slice(1).map((w) => w.id), usd: legs.reduce((t, w) => t + (cashOf(w) ?? 0), 0) } : undefined;
    const notes: string[] = [];
    if (stale && known.length) notes.push(words.lastLook);
    // coins bought on the site: Move back takes only each network's own coin, so they're sold there first
    // (a network ZeroFee doesn't carry back says so below instead)
    const carried = (w: SpendingWallet) => (TAKES_OUT as readonly string[]).includes(w.network);
    const other = known.filter((x) => carried(x.w) && x.c!.other);
    if (other.length) notes.push(words.sellFirst(name, [...new Set((legs.length ? legs : other.map((x) => x.w)).map((w) => NATIVE[w.network]!))].join(" and ")));
    const small = ws.some((w) => (TAKES_OUT as readonly string[]).includes(w.network) && (cashOf(w) ?? 0) >= 0.01 && (cashOf(w) ?? 0) < BACK_MIN_USD);
    if (small) notes.push(words.tooSmall);
    for (const w of ws) {
      if ((TAKES_OUT as readonly string[]).includes(w.network)) continue;
      const c = each.find((x) => x.w === w)?.c;
      if (c && c.lines.length) notes.push(words.staysOn(NETWORK[w.network] ?? w.network));
    }
    return { site, name, ...(host ? { host } : {}), letter: letterOf(name), dollars, usd: unknown && !known.length ? null : priced, unpriced: unpriced && priced >= 0.01, coins, hasMoney, stale, ...(back ? { back } : {}), notes };
  });
  const listedFirst = (a: WalletCard, b: WalletCard) => Number(a.site.startsWith("host:")) - Number(b.site.startsWith("host:")) || a.name.localeCompare(b.name);
  const money = cards.filter((c) => c.hasMoney).sort((a, b) => (a.usd === null ? 1 : 0) - (b.usd === null ? 1 : 0) || (b.usd ?? 0) - (a.usd ?? 0) || listedFirst(a, b));
  const empty = cards.filter((c) => !c.hasMoney).sort(listedFirst);
  const sum = Math.round(money.reduce((t, c) => t + (c.usd ?? 0), 0) * 100) / 100;
  const total = i.read === "first" && !cards.length ? "…" : usd(sum);
  const totalNote = money.some((c) => c.usd === null) ? words.someUnseen : money.some((c) => c.unpriced || (c.usd !== null && c.usd < 0.01 && c.coins.length)) ? words.noPrice : undefined;
  return { money, empty, total, ...(totalNote ? { totalNote } : {}), sweep: money.flatMap((c) => (c.back ? [c.back] : [])) };
}
