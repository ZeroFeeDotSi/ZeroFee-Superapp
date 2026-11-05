// Social Trading's wallets as the hub shows them, pure (tested in node): which site wallets, in what order, with their
// dollars; and the last read kept on this device so the hub paints at once (dollars and names only: never an address,
// a key or an id that could move money).
import type { SpendingWallet } from "@zerofee/core/spending";
import { SITE_WALLETS, isAgentPocket } from "@zerofee/core/site-wallets";
import { siteWalletFunded } from "@zerofee/core/site-funded";

/** The sites whose wallets the hub always shows, first (product decision, 2 Nov: pump.fun and GMGN are the two in the bottom row). */
export const HUB_SITES: readonly string[] = ["pump", "gmgn"];

/**
 * ST13 (product decision, 2 Nov): a site has a wallet per network it trades on (GMGN: Solana, BNB, Base, Ethereum). The money
 * sheet asks "Which coins will you trade?" with these, in this order; the hub never shows a network.
 */
export type SiteChain = "sol" | "bsc" | "base" | "eth";
export const SITE_CHAINS: Readonly<Record<string, readonly SiteChain[]>> = { gmgn: ["sol", "bsc", "base", "eth"], pump: ["sol"] };
export const CHAIN_NAME: Readonly<Record<SiteChain, string>> = { sol: "Solana", bsc: "BNB", base: "Base", eth: "Ethereum" };
/**
 * The networks Spending fills a site's wallet on today (core spending.ts: Solana open; BNB Chain closed until its own move
 * test, D13; Base and Ethereum are networks Spending never fills). Only these get an amount and Approve.
 */
export const SPENDING_FILLS: readonly SiteChain[] = ["sol"];
/**
 * A network the site trades on that Spending can't fill: the site window's line when the person switches the site to it
 * (never a choice on a sheet: the auditor's rule, "never show a choice that can't be chosen"). BNB Chain is closed until
 * its own move test (D13): the swap service's least move there was $1,000 when last priced (2 Nov evening).
 */
export const notCarried = (c: SiteChain): string => (c === "bsc" ? "ZeroFee can't move BNB under $1,000 yet." : `${CHAIN_NAME[c]} isn't in ZeroFee yet.`);
/** The networks the money sheet may offer for a site: the ones Spending fills, in the site's order. The question "Which
 *  coins will you trade?" shows only when there are two or more; today GMGN's sheet goes straight to Solana. */
export const pickable = (site: string, fills: readonly SiteChain[] = SPENDING_FILLS): SiteChain[] => (SITE_CHAINS[site] ?? ["sol"]).filter((c) => fills.includes(c));
/** Under the amount: where it goes. */
export const goesTo = (name: string, c: SiteChain): string => `Goes to your ${name} ${CHAIN_NAME[c]} wallet.`;

/** One of a site's wallets, as the wallet sheet lists it (only the ones with money). */
export interface HubWallet {
  network: string;
  /** Dollars where Spending prices it; null: unread, or a coin it has no price for (`holds` says what it holds). */
  usd: number | null;
  holds?: string;
  id: string;
  address: string;
}

export interface HubRow {
  site: string;
  name: string;
  /** Dollars in all the site's wallets together (ST13: one number on the tile); null: not read yet, or one of them can't
   *  be read now (never $0 then). */
  usd: number | null;
  /** The wallet's id for the money sheet (the site's Solana wallet: the one Spending fills); absent until the wallet is
   *  made (prepareSites makes it with the account). */
  wallet?: string;
  /** Its address on Solana (the wallet sheet's "Show my address"); never kept on the device by the hub. */
  address?: string;
  /** Every one of the site's current wallets (ST13), read now; never kept on the device. */
  wallets?: HubWallet[];
  /** The Solana wallet's own dollars (the one Add fills and Take out empties); null: unknown. Absent: not read yet. */
  solUsd?: number | null;
}
/** What drives a move on the site's Solana wallet: its own dollars when read, else the tile's (one network sites). */
export const solOf = (r: HubRow | undefined): number | null => (r ? (r.solUsd !== undefined ? r.solUsd : r.usd) : null);

const KEY = "zf.hub.v1";
const nameOf = (site: string) => SITE_WALLETS.find((s) => s.site === site)?.name ?? site;

/** A wallet's dollars: priced, else null (unread, or a coin Spending has no price for). */
/** Its own coin alone (Take out, the window's pill, an Add landing). */
const cashOf = (w: SpendingWallet): number | null => (!w.unread && w.cashUsd !== undefined && Number.isFinite(Number(w.cashUsd)) ? Number(w.cashUsd) : null);
/** All it holds: its coin and the coins bought on the site (spending.wallets' one figure, Home's too). */
const usdOf = (w: SpendingWallet): number | null => (!w.unread && w.cashUsd !== undefined && Number.isFinite(Number(w.cashUsd)) ? Math.round((Number(w.cashUsd) + (Number(w.coinsUsd) || 0)) * 100) / 100 : null);
/** "0.0012 ETH" → is anything there (an unpriced coin that isn't zero). */
const holdsSome = (h: string | undefined): boolean => !!h && /[1-9]/.test(h.split(" ")[0] ?? "");

/**
 * Spending's list (spending.wallets) → the hub's rows: the always-shown sites first, then any other site whose wallets
 * hold money (largest first). Each site's current wallets on every network (ST13): the tile's one number is their sum;
 * `wallet` is the Solana one, the one Add fills.
 */
export function hubRows(list: readonly SpendingWallet[]): HubRow[] {
  const mine = list.filter((w) => w.role === "site" && w.current && w.site);
  const rowOf = (site: string): HubRow => {
    const ws = mine.filter((x) => x.site === site);
    const sol = ws.find((x) => x.network === "sol");
    const wallets: HubWallet[] = ws.map((x) => ({ network: x.network, usd: cashOf(x), ...(x.holds ? { holds: x.holds } : {}), id: x.id, address: x.address }));
    // a wallet Spending fills that can't be read, or holds a coin it couldn't price (review ST13 M1: SOL's price not read
    // is never $0.00), makes the sum unknown (never a smaller number); a wallet on a network Spending doesn't fill
    // (GMGN's Base) that can't be read, or holds a coin with no price, adds nothing and never blanks the tile
    const fills = (x: SpendingWallet) => (SPENDING_FILLS as readonly string[]).includes(x.network);
    const unknown = (x: SpendingWallet) => x.unread || (usdOf(x) === null && holdsSome(x.holds));
    const usd = !ws.length ? 0 : ws.some((x) => fills(x) && unknown(x)) ? null : Math.round(ws.reduce((n, x) => n + (usdOf(x) ?? 0), 0) * 100) / 100;
    // review ST13 M2: what the Solana wallet alone holds drives what touches only it (Take out, the window's pill and its
    // "empty" ask, an Add landing); the sum is for showing and for whether the site opens
    const solUsd = !sol ? 0 : unknown(sol) ? null : (cashOf(sol) ?? 0);
    return { site, name: nameOf(site), usd, solUsd, ...(sol ? { wallet: sol.id, address: sol.address } : {}), ...(ws.length ? { wallets } : {}) };
  };
  // AgentZero's pocket (D90) is AgentZero's, never a Social trading tile.
  const others = [...new Set(mine.map((w) => w.site!))].filter((s) => !HUB_SITES.includes(s) && !isAgentPocket(s)).map(rowOf).filter((r) => r.usd === null || r.usd >= 0.01);
  return [...HUB_SITES.map(rowOf), ...others.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))];
}

/** ST13: the wallet sheet's list, wallets with money only, Solana first: "Solana $10.00 · Base 0.0012 ETH". */
export function fundedLine(r: HubRow): string {
  const order = (n: string) => { const i = (SITE_CHAINS[r.site] ?? []).indexOf(n as SiteChain); return i < 0 ? 99 : i; };
  const funded = (r.wallets ?? []).filter((w) => siteWalletFunded(w.usd, w.holds)).sort((a, b) => order(a.network) - order(b.network));
  const nameOfChain = (n: string) => CHAIN_NAME[n as SiteChain] ?? n;
  return funded.map((w) => `${nameOfChain(w.network)} ${w.usd !== null ? `$${w.usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : w.holds}`).join(" · ");
}

const PICK_KEY = "zf.hub.pick.v1";
/** ST13: the network the person picked last for this site, kept on this device; Solana the first time. Only a network
 *  the site trades on is ever read back. */
export function readPick(site: string, store: Pick<Storage, "getItem"> | undefined = globalThis.localStorage, fills: readonly SiteChain[] = SPENDING_FILLS): SiteChain {
  const chains = pickable(site, fills);
  try {
    const v = (JSON.parse(store?.getItem(PICK_KEY) ?? "{}") as Record<string, unknown>)[site];
    if (typeof v === "string" && (chains as readonly string[]).includes(v)) return v as SiteChain;
  } catch {
    // unreadable: the first time's pick
  }
  return chains[0] ?? "sol";
}
export function savePick(site: string, chain: SiteChain, store: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage): void {
  if (!(SITE_CHAINS[site] ?? []).includes(chain)) return;
  try {
    let v: Record<string, unknown> = {};
    try { v = JSON.parse(store?.getItem(PICK_KEY) ?? "{}") ?? {}; } catch { v = {}; }
    store?.setItem(PICK_KEY, JSON.stringify({ ...v, [site]: chain }));
  } catch {
    // storage blocked: Solana next time
  }
}

/** What the hub read last on this device, or the always-shown sites not read yet. */
export function readHub(store: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): HubRow[] {
  try {
    const v = JSON.parse(store?.getItem(KEY) ?? "null") as { rows?: unknown } | null;
    if (v && Array.isArray(v.rows)) {
      const rows = v.rows.flatMap((r: unknown) => {
        const x = r as Partial<HubRow>;
        if (typeof x.site !== "string" || !SITE_WALLETS.some((s) => s.site === x.site) || isAgentPocket(x.site)) return [];
        // kept: the site and its dollars; the wallet's id is read again before any money moves
        return [{ site: x.site, name: nameOf(x.site), usd: typeof x.usd === "number" && Number.isFinite(x.usd) ? x.usd : null }];
      });
      if (rows.length) return rows;
    }
  } catch {
    // unreadable: the sites, not read yet
  }
  return HUB_SITES.map((site) => ({ site, name: nameOf(site), usd: null }));
}

export function saveHub(rows: readonly HubRow[], store: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    store?.setItem(KEY, JSON.stringify({ rows: rows.map((r) => ({ site: r.site, usd: r.usd })) }));
  } catch {
    // storage blocked: it reads again next time
  }
}

/** What a tile's tap does (ST1, product decision, 2 Nov). */
export type TileTap = { kind: "add" } | { kind: "line"; line: string } | { kind: "open" } | { kind: "wait" };

/**
 * A tile's tap: money on its way → its one line, never the site; no wallet id yet (the first read hasn't come) → wait;
 * $0.00 → the money sheet first; money in it → the site. A wallet Solana couldn't read opens the site: an unread
 * balance never locks a person out of their own money's site.
 */
export function tileTap(r: HubRow, movingUsd: number | undefined, read: "first" | "ok" | "failed"): TileTap {
  if (movingUsd !== undefined) return { kind: "line", line: `$${movingUsd.toFixed(2)} is on its way to ${r.name}. About a minute.` };
  if (!r.wallet) return { kind: read === "failed" ? "open" : "wait" };
  // Decided 3 Nov (a test finding): a tap always opens the site, $0.00 included. Never a sheet first; the
  // site's own window says "Top up your … wallet privately here." while it's empty, one tap from there.
  return { kind: "open" };
}

/** An Add on its way to a site's wallet: its dollars, the wallet's dollars when it started, and since when. */
/** `by`: "agentzero" only when Spending's record of the Add says AgentZero started it (F5); none: the person's own. */
export interface Landing { usd: number; from: number | null; sinceMs: number; by?: "agentzero" }
/** The longest an Add is shown on its way after Spending's own record of it ends, waiting for the wallet to show it. */
export const LANDING_MS = 5 * 60_000;

/**
 * What is on its way to each site (by site): Spending's own record (onItsWay), and an Add whose record has ended but
 * whose money the site's wallet doesn't show yet (its last leg, Spending → the site, still landing). Until the wallet
 * holds more than it did, the tile keeps saying "on its way", so a tap never asks for the same money twice (ST1).
 */
export function landing(onItsWay: readonly { site?: string; usd: string; by?: "agentzero" }[], was: Readonly<Record<string, Landing>>, rows: readonly HubRow[] | null, nowMs: number, acts?: readonly AddRecord[] | null): { moving: Record<string, Landing>; landed: string[]; stopped: Record<string, string> } {
  const out: Record<string, Landing> = {};
  const landed: string[] = [];
  const stopped: Record<string, string> = {};
  // an Add fills the Solana wallet: it landed when that wallet holds more (review ST13 M2)
  const has = (site: string) => solOf(rows?.find((r) => r.site === site)) ?? null;
  for (const a of onItsWay) {
    if (!a.site) continue;
    const prev = out[a.site] ?? was[a.site];
    // the wallet's dollars when it started; not read yet: taken at the first read that has them (review L1: never 0)
    // AgentZero's only when every Add on its way there says so (review L5): his own Add beside it is never credited away
    const by = a.by === "agentzero" && (out[a.site] ? out[a.site]!.by === "agentzero" : true) ? { by: "agentzero" as const } : {};
    out[a.site] = { usd: Math.max(out[a.site]?.usd ?? 0, Number(a.usd)), from: prev?.from ?? has(a.site), sinceMs: prev?.sinceMs ?? nowMs, ...by };
  }
  for (const [site, w] of Object.entries(was)) {
    if (out[site]) continue;
    // a clock that went back (sinceMs ahead of now) never keeps a site "on its way" (re-review Low 1)
    if (w.sinceMs > nowMs) continue;
    const now = has(site);
    // no start was ever read, Spending's record has ended and the wallet holds money: show it, quietly (re-review Low 2)
    if (w.from === null && now !== null && now >= 0.01) continue;
    // landed only when the wallet holds more than it did when it started (a start never read can't say so: review M3)
    const grew = now !== null && w.from !== null && now >= w.from + 0.01;
    if (grew) landed.push(site);
    else {
      // finding 61: Spending's own record says this Add stopped short (refused, failed, sent back, or its move on to the
      // site didn't go): it ends now, with that record's words, never "on its way" for five minutes more
      const why = addStopped(acts, site, w.sinceMs);
      if (why !== null) stopped[site] = why;
      else if (nowMs - w.sinceMs < LANDING_MS) out[site] = w;
    }
    // past five minutes without landing: it stops saying "on its way", and says nothing it doesn't know
  }
  return { moving: out, landed, stopped };
}

/** What landing() reads of Spending's record (spending.activity): an Add for a site, or its move on to it. */
export interface AddRecord { kind: string; site?: string; of?: string; status: string; atIso: string; note?: string; stoppedShort?: true }
/** The words an Add's stop is said with when its record has none. */
export const ADD_STOPPED = "It didn't reach the wallet. Your money is safe. See Activity.";

/**
 * Finding 61: did the newest Add for this site (its Top up, or its move on to the site's wallet) end short of the
 * wallet? Only a record from this Add's own time (from five minutes before it was first seen on its way): an older
 * Add's stop never ends a newer one. Its words (the record's note), or null when it didn't stop or nothing says so.
 */
export function addStopped(acts: readonly AddRecord[] | null | undefined, site: string, sinceMs: number): string | null {
  const newest = (acts ?? [])
    .filter((a) => a.site === site && !a.of && (a.kind === "top-up" || a.kind === "ready") && Date.parse(a.atIso) >= sinceMs - LANDING_MS)
    .sort((a, b) => b.atIso.localeCompare(a.atIso))[0];
  if (!newest) return null;
  const ended = newest.status === "failed" || newest.status === "refused" || newest.status === "refunded" || newest.stoppedShort === true;
  return ended ? newest.note || ADD_STOPPED : null;
}

/** An Add's task (its id ends in the moment it was made, site-tasks.ts addTask): that moment, or null. */
export const addTaskAt = (taskId: string): number | null => {
  const at = Number(/-(\d{10,})$/.exec(taskId)?.[1]);
  return Number.isFinite(at) ? at : null;
};

/**
 * Sim crawl recheck (5 Nov): an Add whose task was made after it was no longer on its way (the sheet's Done tapped
 * once the money had landed) ended "Not seen yet" beside "In your pump.fun wallet.". With nothing on its way for the
 * site, Spending's own record of its newest Add says how it ended: "done" (it landed), the stop's words (addStopped), or
 * null when the record says neither (then "Not seen yet" stays true).
 */
export function addEnded(acts: readonly AddRecord[] | null | undefined, site: string, sinceMs: number): { landed: true } | { stopped: string } | null {
  const newest = (acts ?? [])
    .filter((a) => a.site === site && !a.of && (a.kind === "top-up" || a.kind === "ready") && Date.parse(a.atIso) >= sinceMs - LANDING_MS)
    .sort((a, b) => b.atIso.localeCompare(a.atIso))[0];
  if (!newest) return null;
  if (newest.status === "done" && newest.stoppedShort !== true) return { landed: true };
  const why = addStopped(acts, site, sinceMs);
  return why !== null ? { stopped: why } : null;
}

const LANDING_KEY = "zf.hub.landing.v1";
/** What is on its way, kept on this device so a relaunch doesn't offer the same Add again (review L1). */
export function readLanding(store: Pick<Storage, "getItem"> | undefined = globalThis.localStorage, now = Date.now()): Record<string, Landing> {
  try {
    const v = JSON.parse(store?.getItem(LANDING_KEY) ?? "{}") as Record<string, Partial<Landing>>;
    const out: Record<string, Landing> = {};
    for (const [site, l] of Object.entries(v ?? {})) {
      if (!SITE_WALLETS.some((s) => s.site === site) || typeof l?.usd !== "number" || !Number.isFinite(l.usd) || l.usd < 0 || l.usd >= 1e9 || typeof l.sinceMs !== "number") continue;
      // only a record from the last five minutes, and never one from the future (a clock that went back)
      if (!(l.sinceMs <= now && now - l.sinceMs < LANDING_MS)) continue;
      out[site] = { usd: l.usd, from: typeof l.from === "number" ? l.from : null, sinceMs: l.sinceMs };
    }
    return out;
  } catch {
    return {};
  }
}
export function saveLanding(m: Readonly<Record<string, Landing>>, store: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    store?.setItem(LANDING_KEY, JSON.stringify(m));
  } catch {
    // storage blocked
  }
}

/** F5: the line when an Add lands, naming who did it from Spending's record: the person's own Add is never AgentZero's. */
/** `site`: the row's own site, its owner data: AgentZero's own wallet (site-wallets.ts isAgentPocket) is AgentZero's
 *  money, so the line says whose wallet it is in (copy review, 5 Nov); "your" only for the person's own wallet. */
export function landedLine(by: "agentzero" | undefined, name: string, site?: string): string {
  // no figure (crawl F9: the line said $24.85 while the page said $27.47): the page's one figure says how much
  const whose = isAgentPocket(site) ? "AgentZero's" : "your";
  return `${by === "agentzero" ? "AgentZero's Add done." : "Add done."} It's in ${whose} ${name} wallet.`;
}

/** QA (3 Nov): the wallet sheet's title is the person's: "Your pump.fun wallet". AgentZero's sign-in narration (D75)
 *  stays in the lines, never the title. */
export const walletTitle = (name: string): string => `Your ${name} wallet`;
