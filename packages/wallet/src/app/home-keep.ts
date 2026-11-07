// Home's kept copy (D134), outside Home's first load (the speed budget): loaded at boot by primeHome, beside the
// account's own read. Reading, checking and writing the copy, starting every Home read, holding a big drop until a
// second read agrees, and filling Home's view from the copy. Never sent anywhere: Wallet's own device.store, sealed to
// the chip on the phone.
import { earlyEpoch } from "./home-stale.ts";
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingStatus, SpendingWallet } from "@zerofee/core/spending";
import type { Balance, Chain, Movement, PrivatePocket, Token } from "../types.ts";
import { rememberSnapshot, startHomeReads, type FreshReads, type HomeReads, type HomeSnapshot, type NearCoin, type Position, type WalletView } from "./home-cache.ts";
import type { HeldCoin } from "./trading.ts";
import { balanceTotal } from "./format.ts";

/** One key for everything Home shows (Wallet's own device.store). */
export const HOME_CACHE_KEY = "home-cache.v1";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isAt = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const isUsd = (v: unknown): v is string => isStr(v) && /^\d+(\.\d+)?$/.test(v);
const listOf = <T>(v: unknown, ok: (x: unknown) => boolean): T[] | undefined => (Array.isArray(v) && v.every(ok) ? (v as T[]) : undefined);
const balanceOk = (b: unknown) => isObj(b) && isStr(b.tokenId) && isStr(b.amount) && isStr(b.symbol);
const chainOk = (c: unknown) => isObj(c) && isStr(c.id) && isStr(c.name) && Array.isArray(c.coins);
const tokenOk = (t: unknown) => isObj(t) && isStr(t.assetId) && isStr(t.symbol) && typeof t.decimals === "number";
const heldOk = (h: unknown) => isObj(h) && isStr(h.chain) && isStr(h.symbol) && isStr(h.amount);
const walletOk = (w: unknown) => isObj(w) && isStr(w.id) && isStr(w.role) && isStr(w.network);
const nearCoinOk = (c: unknown) => isObj(c) && isStr(c.tokenId) && isStr(c.amount);
const spendingOk = (s: unknown): s is SpendingStatus => isObj(s) && s.loaded === true && Array.isArray(s.networks) && s.networks.every((n) => isObj(n) && isStr(n.network));
const pocketOk = (p: unknown): p is PrivatePocket => isObj(p) && typeof p.available === "boolean" && Array.isArray(p.rows) && p.rows.every(balanceOk);

/** The kept copy, checked part by part: a damaged part is no part, a damaged copy is no copy (never a throw). */
export function parseSnapshot(raw: string | null | undefined): HomeSnapshot | null {
  if (!raw) return null;
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(j) || j.v !== 1) return null;
  const s: HomeSnapshot = { v: 1 };
  const b = j.balances;
  if (isObj(b) && isAt(b.at)) {
    const rows = listOf<Balance>(b.rows, balanceOk);
    if (rows) s.balances = { at: b.at, rows };
  }
  const chains = listOf<Chain>(j.chains, chainOk);
  if (chains) s.chains = chains;
  const tokens = listOf<Token>(j.tokens, tokenOk);
  if (tokens) s.tokens = tokens;
  const positions = listOf<unknown>(j.positions, isObj);
  if (positions) s.positions = positions;
  if (pocketOk(j.pocket)) s.pocket = j.pocket;
  if (j.kid === true) s.kid = true;
  const sp = j.spending;
  if (isObj(sp) && isAt(sp.at) && spendingOk(sp.s) && !sp.s.unread) s.spending = { at: sp.at, s: sp.s };
  const held = listOf<HeldCoin>(j.held, heldOk);
  if (held) s.held = held;
  const wallets = listOf<SpendingWallet>(j.wallets, walletOk);
  if (wallets) s.wallets = wallets;
  const nearCoins = listOf<NearCoin>(j.nearCoins, nearCoinOk);
  if (nearCoins) s.nearCoins = nearCoins;
  if (isUsd(j.total)) s.total = j.total;
  return s;
}

/** The copy kept on this phone, or the old total alone (an update from before it), or null. */
export async function readSnapshot(bridge: Bridge): Promise<HomeSnapshot | null> {
  const get = async (key: string) => {
    const r = await bridge.call<{ value: string | null }>("device.store.get", { key });
    return "ok" in r && r.ok && isStr(r.ok.value) ? r.ok.value : null;
  };
  try {
    const s = parseSnapshot(await get(HOME_CACHE_KEY));
    if (s) return s;
    // an update from before this copy: its kept total paints at once ("Updating…" until read)
    const total = await get("last-total");
    return isUsd(total) ? { v: 1, total } : null;
  } catch {
    return null;
  }
}

/** The copy to keep: the address of every wallet left out, and only the coins Home prices with. */
export function snapshotText(s: HomeSnapshot): string {
  const keep: HomeSnapshot = { ...s };
  if (s.wallets) keep.wallets = s.wallets.map((w) => ({ ...w, address: "" }));
  return JSON.stringify(keep);
}

/** The coins Home prices with: the Safe's and the pocket's, the NEAR wallet's, and NEAR's own (Earn). */
export function tokensHomeUses(tokens: Map<string, Token>, s: Pick<HomeSnapshot, "balances" | "pocket" | "nearCoins">, activity?: Movement[] | null): Token[] {
  const ids = new Set<string>(["nep141:wrap.near"]);
  for (const b of s.balances?.rows ?? []) ids.add(b.tokenId);
  for (const b of s.pocket?.rows ?? []) ids.add(b.tokenId);
  for (const c of s.nearCoins ?? []) ids.add(c.tokenId);
  for (const m of activity ?? []) if (m.to) ids.add(m.to);
  return [...ids].map((id) => tokens.get(id)).filter((t): t is Token => !!t);
}

/**
 * The copy to keep after a fresh read: each part this session read replaces the kept one; a part that didn't answer
 * keeps the copy's. Trading is kept only as a full answer (both chains read). The total only when complete.
 */
export function nextSnapshot(f: FreshReads, was: HomeSnapshot | null, full: { at: number; s: SpendingStatus } | null, kid: boolean | null, total: string | null, activity?: Movement[] | null): HomeSnapshot {
  const c: HomeSnapshot = was ?? { v: 1 };
  const s: HomeSnapshot = { v: 1 };
  const balances = f.balances && f.balancesAt ? { at: f.balancesAt, rows: f.balances } : c.balances;
  if (balances) s.balances = balances;
  const chains = f.chains ?? c.chains;
  if (chains) s.chains = chains;
  const pocket = f.pocket ?? c.pocket;
  if (pocket) s.pocket = pocket;
  const nearCoins = f.nearCoins ?? c.nearCoins;
  if (nearCoins) s.nearCoins = nearCoins;
  const tokens = f.tokens ? tokensHomeUses(f.tokens, { ...(balances ? { balances } : {}), ...(pocket ? { pocket } : {}), ...(nearCoins ? { nearCoins } : {}) }, activity) : c.tokens;
  if (tokens) s.tokens = tokens;
  const positions = f.positions ?? c.positions;
  if (positions) s.positions = positions;
  if (kid === true || (kid === null && c.kid)) s.kid = true;
  else {
    const sp = full ?? c.spending;
    if (sp) s.spending = sp;
    const held = f.held ?? c.held;
    if (held) s.held = held;
    const wallets = f.wallets ?? c.wallets;
    if (wallets) s.wallets = wallets;
  }
  const t = total ?? c.total;
  if (t) s.total = t;
  return s;
}

/** A drop this small shows at once (prices move): under $1, or under 2% of the figure. */
const SMALL = (base: number) => Math.max(1, base * 0.02);

/**
 * Product decision, 3 Nov What Home shows of one source (the
 * Safe's coins, the wallets) after a fresh read: a rise or a small drop shows at once; a big drop only once a second read
 * agrees (`recheck`: read again). `shown` is what Home shows now (the copy's, before this session's first read).
 */
export function confirmDrop<T>(shown: T | null, pending: T | null, next: T, usd: (t: T) => number): { shown: T; pending: T | null; recheck: boolean } | { shown: T | null; pending: T; recheck: true } {
  if (shown === null) return { shown: next, pending: null, recheck: false };
  const n = usd(next);
  if (usd(shown) - n <= SMALL(usd(shown))) return { shown: next, pending: null, recheck: false };
  if (pending !== null && Math.abs(usd(pending) - n) <= SMALL(usd(pending))) return { shown: next, pending: null, recheck: false };
  return { shown, pending: next, recheck: true };
}

/** The copies this one replaced: removed the first time this one is written (never left plain on the phone). */
const OLD_KEYS = ["last-total", "last-balances", "last-balances-at", "last-spending"];

/** Writes the copy when it changed (Wallet's own device.store; sealed to the chip on the phone; never sent anywhere). */
export function keepCopy(bridge: Bridge, written: { current: string | null }, next: HomeSnapshot): void {
  const text = snapshotText(next);
  if (text === written.current) return;
  if (written.current === null) for (const key of OLD_KEYS) void bridge.call("device.store.set", { key, value: null }).catch(() => undefined);
  written.current = text;
  rememberSnapshot(bridge, next);
  void bridge.call("device.store.set", { key: HOME_CACHE_KEY, value: text }).catch(() => undefined);
}

type Steady = { last?: unknown; shown?: unknown; pending?: unknown };
const usdOf = (xs: (string | undefined)[]) => xs.reduce((n, x) => n + (Number(x) || 0), 0);

/**
 * Home's reads with every big drop held until a second read agrees (confirmDrop), per part: the Safe's coins, Trading,
 * the coins bought, the site wallets, the pocket. `state` lives with the page; `recheck` asks for the second read. The
 * money view never comes through here (a held figure never decides an amount).
 */
/** How soon a part held back for a big drop is read again. */
export const RECHECK_MS = 1500;

export function steadyReads(state: Map<string, Steady>, f: FreshReads, cache: HomeSnapshot | null, recheck: () => void): FreshReads {
  const confirm = <T>(key: string, next: T | null, base: T | null | undefined, usd: (t: T) => number): T | null => {
    if (next === null) return null;
    const s = state.get(key) ?? { last: undefined, shown: base ?? null, pending: null };
    if (s.last !== next) {
      const d = confirmDrop(s.shown as T | null, s.pending as T | null, next, usd);
      Object.assign(s, { last: next, shown: d.shown, pending: d.pending });
      state.set(key, s);
      // read again soon, once (a second read agrees, or the figure stands)
      if (d.recheck && !state.has("again")) { state.set("again", s); setTimeout(() => { state.delete("again"); recheck(); }, RECHECK_MS); }
    }
    return s.shown as T | null;
  };
  const sp = f.spending;
  return {
    ...f,
    balances: confirm("balances", f.balances, cache?.balances?.rows, (b) => usdOf(b.map((x) => x.usd))),
    spending: sp?.loaded && !sp.unread ? confirm("spending", sp, cache?.spending?.s, (s) => Number(s.totalUsd) || 0) : sp,
    held: confirm("held", f.held, cache?.held, (h) => usdOf(h.map((x) => x.usd))),
    wallets: confirm("wallets", f.wallets, cache?.wallets, (w) => usdOf(w.flatMap((x) => [x.cashUsd, x.coinsUsd]))),
    pocket: confirm("pocket", f.pocket, cache?.pocket, (p) => usdOf(p.rows.map((x) => x.usd))),
  };
}

// ---- every Home read at once ----

const early = new WeakMap<Bridge, { at: number; reads: HomeReads; changed: boolean; off: () => void; epoch: number }>();
export { staleEarly } from "./home-stale.ts";
/** How long reads started early stay good for the Home that opens next. */
export const EARLY_FOR_MS = 10_000;

/** Started as the account opens (before Home's first render): Home takes them instead of asking again. The money
 *  changing before Home opens (the core's ledger.balancesChanged) makes them stale: the copy review's A2-3 (8 Nov), the Sim made the
 *  sites' wallets during set-up, after these reads, and Home's Hot said $172.54 without them while set-up said
 *  $5,515.49 with them. */
export function kickEarly(bridge: Bridge, now = Date.now()): void {
  if (early.has(bridge)) return;
  const e = { at: now, reads: startHomeReads(bridge), changed: false, off: () => {}, epoch: earlyEpoch() };
  e.off = bridge.on("ledger.balancesChanged", () => { e.changed = true; });
  early.set(bridge, e);
}

/** The reads started early, once, while they are recent and nothing changed since; else new ones. */
export function takeHomeReads(bridge: Bridge, now = Date.now()): HomeReads {
  const e = early.get(bridge);
  early.delete(bridge);
  e?.off();
  // stale: the core said the money changed, or the page made a wallet since (home-stale.ts staleEarly: the real core's
  // subwallet.create announces nothing Home hears)
  return e && !e.changed && e.epoch === earlyEpoch() && now - e.at <= EARLY_FOR_MS ? e.reads : startHomeReads(bridge);
}

/** The total of a view, once every part is read (else null: never a total short by a part). */
export const totalOf = (v: WalletView): string | null => (v.complete && v.balances ? balanceTotal(v.balances, v.chains, v.earning, v.pocket, v.trading) : null);

/** Home's reads with each part not read yet this session (or whose read failed) as the copy kept on this phone: a
 *  failed part keeps its last known value, never $0 and never left out of the total. Home's view only. */
export function withCopy(f: FreshReads, c: HomeSnapshot): FreshReads {
  return {
    ...f,
    balances: f.balances ?? c.balances?.rows ?? null,
    balancesAt: f.balancesAt ?? c.balances?.at ?? null,
    chains: f.chains ?? c.chains ?? null,
    tokens: f.tokens ?? (c.tokens ? new Map(c.tokens.map((t) => [t.assetId, t])) : null),
    positions: (f.failed?.positions && c.positions ? null : f.positions) ?? (c.positions as Position[] | undefined) ?? null,
    pocket: (f.failed?.pocket && c.pocket ? null : f.pocket) ?? c.pocket ?? null,
    tradingRead: f.tradingRead || !!c.spending || !!c.kid,
    spending: f.tradingRead && !(f.failed?.spending && !f.spending && c.spending) ? f.spending : c.kid ? null : c.spending?.s ?? null,
    held: f.held ?? c.held ?? null,
    wallets: f.wallets ?? c.wallets ?? null,
    nearCoins: f.nearCoins ?? c.nearCoins ?? null,
  };
}
