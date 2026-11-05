// The shared coin picker's rules (bug report, 5 Nov; Send reuses it): a chain tray
// (NEAR · SOL · Robinhood), then any coin on that chain by name or address, from Trade's own market (its search finds a
// pasted mint or contract too), the wallet's own coins first. A coin that can't be picked today stays in the list with its
// one-line reason, never greyed and never a pick that is refused after (drop, don't degrade). Pure: every rule is a test.
import type { SwapPlace } from "./swap-corridor.ts";
import { siteWallet } from "@zerofee/core/site-wallets";

export type PickChain = "near" | "sol" | "hood";
/** The tray, in the product order. */
export const PICK_CHAINS: readonly { id: PickChain; label: string }[] = [
  { id: "near", label: "NEAR" },
  { id: "sol", label: "SOL" },
  { id: "hood", label: "Robinhood" },
];
/** Each chain's own coin, as Trade's lists name it ("native": the coin the wallet pays its fees in). */
export const NATIVE = "native";

/** One row of the picker: a place Home already names (a wallet's own coin, the Safe's), or any coin on a chain. */
export interface PickCoin {
  chain: PickChain;
  /** NATIVE, a coin's mint or contract, or a place's id. */
  address: string;
  symbol: string;
  name: string;
  /** A logo url (Trade's market), or one of the app's own logos by name. */
  logo?: string; icon?: string;
  /** What the person holds of it, in dollars (the row's right side). */
  heldUsd?: number;
  /** A place Home's Swap already moves between (swap-corridor.ts). */
  place?: SwapPlace;
  /** A site's own wallet (pump.fun, GMGN: core/site-wallets.ts), paid from to your Safe (QA, 5 Nov). */
  site?: { id: string; name: string };
}

/** A coin the market found (Trade's CoinRow, the fields the picker reads). */
export interface FoundCoin { chain: string; address: string; symbol: string; name: string; logoUrl?: string }
/** A coin a wallet holds (spending.swap.held). */
export interface HeldCoin { address: string; symbol: string; decimals: number; raw: string; usd?: number }

/** Which chain each of Home's places is on (BNB is not in the tray: its gate is shut). */
export const PLACE_CHAIN: Record<SwapPlace, PickChain | null> = { sol: "sol", hood: "hood", bsc: null, near: "near", "safe-usdc": "near", "safe-near": "near" };

/** A pick's key, one per coin per chain. */
export const pickKey = (c: Pick<PickCoin, "chain" | "address" | "place" | "site">): string => (c.site ? `site:${c.site.id}` : c.place ? `place:${c.place}` : `${c.chain}:${c.chain === "sol" ? c.address : c.address.toLowerCase()}`);

/** Does the text match this coin: its symbol or name begins with it (any case), or it is the coin's address. */
export function matches(c: Pick<PickCoin, "symbol" | "name" | "address">, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return c.symbol.toLowerCase().startsWith(t) || c.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(t)) || c.address.toLowerCase() === t;
}

/** An address on a chain, by its shape (a Solana mint, an 0x contract); the market resolves it. */
export function looksLikeAddress(chain: PickChain, q: string): boolean {
  const t = q.trim();
  return chain === "sol" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t) : chain === "hood" ? /^0x[0-9a-fA-F]{40}$/.test(t) : /^[a-z0-9_.-]{2,64}\.near$|^[0-9a-f]{64}$/.test(t);
}

/**
 * The rows for one chain: Home's places on it first (what it holds), then the coins the wallet holds, then what the market
 * found (a search, or what's trending when nothing is typed), each coin once. `found` only on the "You get" side: what is
 * paid is what is held.
 */
export function pickRows(chain: PickChain, q: string, o: { places: PickCoin[]; held: PickCoin[]; found?: readonly FoundCoin[] }): PickCoin[] {
  const out: PickCoin[] = [], seen = new Set<string>();
  const add = (c: PickCoin) => { const k = pickKey(c); if (seen.has(k)) return; seen.add(k); out.push(c); };
  for (const c of o.places) if (c.chain === chain && matches(c, q)) add(c);
  // a coin held is shown once, as held (never again from the market), with the market's name and logo when it has them
  const fromMarket = new Map<string, PickCoin>();
  for (const f of o.found ?? []) if (f.chain === chain) fromMarket.set(pickKey({ chain, address: f.address }), { chain, address: f.address, symbol: f.symbol, name: f.name, ...(f.logoUrl ? { logo: f.logoUrl } : {}) });
  for (const c of o.held) {
    if (c.chain !== chain) continue;
    const m = fromMarket.get(pickKey(c));
    const row = m ? { ...c, name: m.name, ...(m.logo ? { logo: m.logo } : {}) } : c;
    if (matches(row, q) || m) add(row);
  }
  for (const c of fromMarket.values()) add(c);
  return out;
}

/** The held coins as rows (dollars when known; a coin with no price shows no figure, never $0). */
export const heldRows = (chain: PickChain, held: readonly HeldCoin[]): PickCoin[] =>
  held.map((h) => ({ chain, address: h.address, symbol: h.symbol, name: h.symbol, ...(typeof h.usd === "number" && h.usd > 0 ? { heldUsd: h.usd } : {}) }));

/**
 * The design review's MUST (5 Nov): the rows that can be picked come first, in full; the rest fold into one quiet line at
 * the end ("12 more coins can't swap yet", a tap opens them). A chain with nothing to pick says one line instead (the
 * reason most of its coins share) and draws no rows.
 */
export function splitRows(rows: readonly PickCoin[], why: (c: PickCoin) => string | null): { open: PickCoin[]; shut: { c: PickCoin; why: string }[]; none: string | null } {
  const open: PickCoin[] = [], shut: { c: PickCoin; why: string }[] = [];
  for (const c of rows) { const w = why(c); if (w) shut.push({ c, why: w }); else open.push(c); }
  let none: string | null = null;
  if (!open.length && shut.length) {
    const n = new Map<string, number>();
    for (const s of shut) n.set(s.why, (n.get(s.why) ?? 0) + 1);
    none = [...n.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }
  return { open, shut, none };
}
/** The fold's line. */
export const foldLine = (n: number): string => `${n} more ${n === 1 ? "coin" : "coins"} can't swap yet`;

/** A wallet as spending.wallets lists it (the fields read here). */
export interface ListedWallet { id: string; role: string; site?: string; network: string; current: boolean; cashUsd?: string; coinsUsd?: string; unread?: boolean }
/**
 * QA's real-money check (5 Nov): "Swap never offers the pump.fun wallet". A site's own wallet that holds money
 * (pump.fun, GMGN, any listed site; never AgentZero's pocket) is a row on "You pay", on its own network's tab: it goes to
 * your Safe privately, by the site wallet's own Move to your Safe.
 */
export function siteRows(ws: readonly ListedWallet[]): PickCoin[] {
  const out: PickCoin[] = [];
  for (const w of ws) {
    const s = w.role === "site" && w.current && !w.unread ? siteWallet(w.site) : undefined;
    const usd = (Number(w.cashUsd) || 0) + (Number(w.coinsUsd) || 0);
    if (!s || s.agent || !(w.network === "sol" || w.network === "hood" || w.network === "near") || !(usd >= 0.01)) continue;
    out.push({ chain: w.network, address: w.id, symbol: s.name, name: "Your wallet. Moves to your Safe.", heldUsd: Math.round(usd * 100) / 100, site: { id: w.id, name: s.name } });
  }
  return out;
}
