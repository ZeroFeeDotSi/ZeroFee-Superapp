// Buy and Sell a native coin from the Safe: ONE path, the swap-in-place builder's (feat/swap-inplace): ledger.swapQuote
// (dry, display only: 1Click's price, fee and own time) then ledger.swap {quoteId} (the job at once; the Safe signs one
// mt_transfer in the core, Face ID there), its updates on ledger.movementUpdated. Nothing here builds, signs or sizes a
// transfer beyond the amount the person typed: the core checks the signed quote. Buy pays with the Safe's USDC; Sell
// returns USDC to it. The job is published at the tap, names the protocol, and carries 1Click's own time, never ours.
import type { Bridge } from "@zerofee/core/bridge";
import type { Tasks } from "@zerofee/shell-api/tasks.ts";
import { SAFE_CASH } from "./assets.ts";

export const PROTOCOL = "NEAR Intents";
export const QUOTER = "NEAR Intents";

/** ledger.swapQuote's answer (the swap-in-place builder's shape, 5 Nov). Amounts are decimal strings in the coin's units. */
export interface SafeQuote { id: string; from: string; to: string; amountIn: string; amountOut: string; minOut: string; feeUsd?: number | string; feeNote?: string; etaSeconds?: number; expiresAtIso: string; source: "safe" | "private" }
/** A swap job as ledger.swap and ledger.movementUpdated give it. */
export interface SwapMove { id: string; kind: "swap"; status: "moving" | "waiting" | "done" | "problem" | "refunded"; from: string; to: string; amount: string; amountOut?: string; startedAtIso?: string; etaSeconds?: number; settledMs?: number; problem?: { whatHappened?: string } }

/** The words (copywriter, 5 Nov). */
export const NATIVE_WORDS = {
  doing: `${PROTOCOL} is swapping it`,
  done: `${PROTOCOL} swapped it`,
  landed: "It's in your Safe.",
  refunded: `${QUOTER} didn't swap it. Refunded, nothing lost. It's back in your Safe.`,
  checking: `${PROTOCOL} hasn't finished. Your money is with them until it lands.`,
  lost: `${PROTOCOL} didn't answer. Check your Safe to see if it swapped.`,
  noPrice: "No price came back. Nothing left your Safe.",
  declined: "Nothing left your Safe.",
  expired: "That price is too old. Nothing left your Safe. Tap again.",
} as const;
/** The same ends on the sheet, where the person never reads the protocol's name (the look, 5 Nov). */
export const SHEET_WORDS = {
  refunded: "It didn't swap. Refunded, nothing lost. Your money is back in your Safe.",
  checking: "Not done yet. Activity shows when it lands.",
  lost: "No answer came back. Check your Safe to see if it swapped.",
} as const;

export const buyTitle = (usd: string, symbol: string) => `Buy ${usd} of ${symbol}`;
export const sellTitle = (usd: string, symbol: string) => `Sell ${usd} of ${symbol}`;
/** 1Click's own time, said as theirs: "1Click says about 12 s". None when it gave none. */
export const etaLine = (eta?: number): string | undefined => (eta && eta > 0 ? `${QUOTER} says about ${Math.round(eta)} s` : undefined);
export const tookLine = (ms: number): string => `Took ${(Math.max(0, ms) / 1000).toFixed(1)} s.`;
const feeOf = (q: SafeQuote): number => { const f = Number(q.feeUsd); return Number.isFinite(f) && f > 0 ? f : 0; };
/** Under the amount: where it happens, who prices it, the fee (1Click's), and 1Click's own time. */
export function quoteLine(q: SafeQuote): string {
  const fee = feeOf(q) >= 0.01 ? `fees $${feeOf(q).toFixed(2)}` : "fees under $0.01";
  const eta = etaLine(q.etaSeconds);
  return `${PROTOCOL} swaps it in your Safe. ${QUOTER} prices it, ${fee}.${eta ? ` ${eta}.` : ""}`;
}

// ---- amounts: decimal strings, exact (never through a float where it matters)
const DEC = /^\d{1,30}(?:\.\d{1,36})?$/;
/** A decimal string as integer units of `decimals`, truncated; null when it isn't one. */
export function toUnits(s: string, decimals: number): bigint | null {
  if (!DEC.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return BigInt(w! + f.slice(0, decimals).padEnd(decimals, "0"));
}
export function fromUnits(u: bigint, decimals: number): string {
  const s = u.toString().padStart(decimals + 1, "0");
  const w = s.slice(0, s.length - decimals), f = s.slice(s.length - decimals).replace(/0+$/, "");
  return f ? `${w}.${f}` : w;
}
/** A number as a decimal string of at most `decimals` places (and 12 significant ones), truncated, never "e-7". */
export function decimalOf(x: number, decimals: number): string | null {
  if (!(x > 0) || !Number.isFinite(x)) return null;
  const places = Math.min(decimals, Math.max(0, 12 - Math.floor(Math.log10(x)) - 1), 20);
  const s = x.toFixed(places);
  const u = toUnits(s, decimals);
  return u && u > 0n ? fromUnits(u, decimals) : null;
}

/**
 * What the swap pays (ledger.swapQuote's amountIn): a buy, the dollars typed in USDC; a sale, that many dollars of the coin
 * at the shown price, never more than held; "All", the held row's amount exactly. Null when nothing can be paid.
 */
export function amountIn(o: { side: "buy" | "sell"; usd: number; all?: boolean; price?: number; held?: string; decimals: number }): string | null {
  if (o.side === "buy") return o.usd > 0 ? decimalOf(Math.floor(o.usd * 100) / 100, 6) : null;
  if (!o.held || !DEC.test(o.held)) return null;
  const held = toUnits(o.held, o.decimals);
  if (!held || held <= 0n) return null;
  if (o.all) return o.held;
  if (!(o.price && o.price > 0) || !(o.usd > 0)) return null;
  const want = decimalOf(o.usd / o.price, o.decimals);
  const u = want ? toUnits(want, o.decimals) : null;
  if (!u || u <= 0n) return null;
  return u >= held ? o.held : fromUnits(u, o.decimals);
}

/** The swap's two coins: a buy pays USDC for the coin, a sale the reverse. */
export const pairOf = (side: "buy" | "sell", assetId: string) => (side === "buy" ? { from: SAFE_CASH, to: assetId } : { from: assetId, to: SAFE_CASH });

/** `shown`: the coin as the page shows it (its price, name and symbol); the Sim prices its sample swap at it, the core
 *  ignores it (1Click prices the real one). */
export async function askQuote(bridge: Bridge, side: "buy" | "sell", assetId: string, amount: string, shown?: { priceUsd?: number; symbol?: string; name?: string }): Promise<{ ok: SafeQuote } | { problem: string }> {
  try {
    const r = await bridge.call<SafeQuote>("ledger.swapQuote", { ...pairOf(side, assetId), amountIn: amount, source: "safe", ...(shown ?? {}) });
    if ("problem" in r) return { problem: r.problem.whatHappened };
    const q = r.ok;
    if (!q || typeof q.id !== "string" || typeof q.amountOut !== "string") return { problem: NATIVE_WORDS.noPrice };
    return { ok: q };
  } catch { return { problem: NATIVE_WORDS.noPrice }; }
}
export const quoteLive = (q: SafeQuote, nowMs: number): boolean => Date.parse(q.expiresAtIso) - nowMs > 2_000;

export interface SwapView { state: "doing" | "done" | "failed"; line?: string; checking?: string; tookMs?: number; got?: string; /** the core took it (ledger.swap answered): the job is made */ made?: true }
/** Past this, a job that hasn't ended says once that it is still checking, and keeps following (the ledger's read ends it). */
export const CHECKING_AFTER_MS = 10 * 60_000;

/** The jobs whose swap is still followed, kept on this phone (task id → the ledger's movement id), so a reload ends the
 *  job from the ledger's own record (resumeSwapJobs) and it never stays "on its way" forever (sandbox hunt B3). */
const KEPT_KEY = "zf.trade.native-jobs";
type KeptJob = { moveId: string; tapMs: number };
type Store = Pick<Storage, "getItem" | "setItem">;
const storeOf = (s?: Store | null): Store | null => { try { return s === undefined ? (globalThis as { localStorage?: Storage }).localStorage ?? null : s; } catch { return null; } };
function keptJobs(st: Store | null): Record<string, KeptJob> {
  try { const v = JSON.parse(st?.getItem(KEPT_KEY) ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
function keepJob(st: Store | null, taskId: string, job: KeptJob | null) {
  const all = keptJobs(st);
  if (job) all[taskId] = job; else delete all[taskId];
  try { st?.setItem(KEPT_KEY, JSON.stringify(all)); } catch { /* followed while the page lives */ }
}

type Follow = {
  bridge: Bridge; tasks: Tasks | undefined; taskId: string; tapMs: number; now: () => number; onView?: (v: SwapView) => void;
  timer: (fn: () => void, ms: number) => () => void; store: Store | null;
};
const failWith = (o: Follow, line: string, sheet?: string): "failed" => {
  o.tasks?.update(o.taskId, { steps: [{ label: NATIVE_WORDS.doing, state: "failed", at: o.now() }] });
  o.tasks?.end(o.taskId, "failed", line);
  o.onView?.({ state: "failed", line: sheet ?? line });
  keepJob(o.store, o.taskId, null);
  return "failed";
};
/** A movement that ended, said on the job and the sheet: done with what arrived (the ledger's figure), else refunded. */
function ended(o: Follow, m: SwapMove): "done" | "failed" {
  if (m.status === "refunded") return failWith(o, NATIVE_WORDS.refunded, SHEET_WORDS.refunded);
  if (m.status !== "done") return failWith(o, m.problem?.whatHappened || NATIVE_WORDS.refunded, m.problem?.whatHappened ? undefined : SHEET_WORDS.refunded);
  const at = o.now();
  const took = typeof m.settledMs === "number" && m.settledMs >= 0 ? m.settledMs : at - o.tapMs;
  o.tasks?.update(o.taskId, { steps: [{ label: NATIVE_WORDS.done, state: "done", at }], detail: tookLine(took) });
  o.tasks?.end(o.taskId, "done");
  o.onView?.({ state: "done", line: `${NATIVE_WORDS.landed} ${tookLine(took)}`, tookMs: took, ...(m.amountOut ? { got: m.amountOut } : {}) });
  keepJob(o.store, o.taskId, null);
  return "done";
}
/** Follows a movement to its end, never giving up while the page lives: past CHECKING_AFTER_MS it says so once. */
async function followToEnd(o: Follow, first: SwapMove, seen: Map<string, SwapMove>, wakeUp: (w: (() => void) | undefined) => void, startMs: number): Promise<"done" | "failed"> {
  let m = first, said = false;
  while (m.status === "moving" || m.status === "waiting") {
    const next = seen.get(m.id);
    if (next && next !== m) { m = next; continue; }
    if (!said && o.now() - startMs > CHECKING_AFTER_MS) {
      said = true;
      o.tasks?.update(o.taskId, { detail: NATIVE_WORDS.checking });
      o.onView?.({ state: "doing", checking: SHEET_WORDS.checking });
    }
    await new Promise<void>((res) => { const stop = o.timer(() => res(), 5_000); wakeUp(() => { stop(); res(); }); });
    wakeUp(undefined);
  }
  return ended(o, m);
}

/**
 * The swap behind its job. The task is published FIRST (the tap is the job, with 1Click's own time), then ledger.swap
 * is asked, then its movement followed to its end. `onView` drives the sheet; Home's Activity row says the same. Never throws.
 */
export async function runSwap(o: {
  bridge: Bridge; tasks: Tasks | undefined; taskId: string; title: string; usd: string; quote: SafeQuote; tapMs: number; route?: string;
  now?: () => number; onView?: (v: SwapView) => void; timer?: (fn: () => void, ms: number) => () => void; storage?: Store | null;
}): Promise<"done" | "failed"> {
  const f: Follow = {
    bridge: o.bridge, tasks: o.tasks, taskId: o.taskId, tapMs: o.tapMs, now: o.now ?? Date.now, ...(o.onView ? { onView: o.onView } : {}),
    timer: o.timer ?? ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); }), store: storeOf(o.storage),
  };
  const eta = etaLine(o.quote.etaSeconds);
  o.tasks?.publish({ id: o.taskId, title: o.title, usd: o.usd, where: "In your Safe", steps: [{ label: NATIVE_WORDS.doing, state: "doing", at: o.tapMs }], ...(eta ? { detail: eta } : {}), ...(o.route ? { open: { route: o.route } } : {}) });
  o.onView?.({ state: "doing" });
  // listen before asking, so an update that comes with the answer is never missed
  const seen = new Map<string, SwapMove>();
  let wake: (() => void) | undefined;
  const off = o.bridge.on<{ movement: SwapMove }>("ledger.movementUpdated", ({ movement }) => { if (movement?.id) { seen.set(movement.id, movement); wake?.(); } });
  try {
    if (!quoteLive(o.quote, f.now())) return failWith(f, NATIVE_WORDS.expired);
    let m: SwapMove;
    try {
      const r = await o.bridge.call<SwapMove | { declined: true }>("ledger.swap", { quoteId: o.quote.id });
      if ("problem" in r) return failWith(f, r.problem.whatHappened);
      if (!r.ok || "declined" in r.ok) return failWith(f, NATIVE_WORDS.declined);
      m = r.ok;
    } catch { return failWith(f, NATIVE_WORDS.lost, SHEET_WORDS.lost); }
    keepJob(f.store, o.taskId, { moveId: m.id, tapMs: o.tapMs });
    // the core took it: where the Safe's sheet is heard and no yes came first, the job is made now ("Job created.")
    if (m.status === "moving" || m.status === "waiting") o.onView?.({ state: "doing", made: true });
    return await followToEnd(f, m, seen, (w) => { wake = w; }, f.now());
  } finally { off(); }
}

/**
 * After a reload (B3): every swap job this phone still follows is read back from the ledger's own record and ended as
 * it ended, or followed again until it does. The ledger follows the swap itself (1Click's status by its deposit address).
 */
export async function resumeSwapJobs(o: { bridge: Bridge; tasks: Tasks | undefined; now?: () => number; timer?: (fn: () => void, ms: number) => () => void; storage?: Store | null }): Promise<void> {
  const store = storeOf(o.storage);
  const jobs = Object.entries(keptJobs(store));
  if (!jobs.length) return;
  // listen before reading, so an end that comes with the read is never missed
  const seen = new Map<string, SwapMove>();
  const wakes = new Set<() => void>();
  const off = o.bridge.on<{ movement: SwapMove }>("ledger.movementUpdated", ({ movement }) => { if (movement?.id) { seen.set(movement.id, movement); for (const w of [...wakes]) w(); } });
  try {
    const r = await o.bridge.call<SwapMove[]>("ledger.activity", { limit: 200 }).catch(() => null);
    if (!r || !("ok" in r) || !Array.isArray(r.ok)) return;
    const byId = new Map(r.ok.map((m) => [m.id, m]));
    await Promise.all(jobs.map(async ([taskId, k]) => {
      const f: Follow = { bridge: o.bridge, tasks: o.tasks, taskId, tapMs: k.tapMs, now: o.now ?? Date.now, timer: o.timer ?? ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); }), store };
      const m = byId.get(k.moveId);
      if (!m) return void failWith(f, NATIVE_WORDS.lost);
      let mine: (() => void) | undefined;
      await followToEnd(f, m, seen, (w) => { if (mine) wakes.delete(mine); mine = w; if (w) wakes.add(w); }, k.tapMs);
    }));
  } finally { off(); }
}

// ---- what you hold and how it did: holdings from ledger.balances (held "ledger"), the result only from done
// swaps that carry what arrived; nothing at all without a buy record, never a guessed figure.
export interface HeldRow { tokenId: string; amount: string; held: string; bridged?: boolean }
/** The coin's amount in the Safe (inside NEAR Intents), or null. "account" rows are on the NEAR account, not in place. */
export function heldOf(rows: readonly HeldRow[] | null | undefined, assetId: string): string | null {
  const r = rows?.find((x) => x.held === "ledger" && x.tokenId === assetId && DEC.test(x.amount) && Number(x.amount) > 0);
  return r ? r.amount : null;
}
/** What Send can send of this coin now (Sim re-check, 5 Nov: BTC's "Send this coin" opened a USDC send): Home's Send pays
 *  a Safe coin from Private (ledger.private's rows, ledger.sendFromSafe); the Safe's own part goes only once route B is
 *  open (wallet send-open.ts SAFE_SEND_OPEN, off), so a coin with nothing in Private has no Send here, never a wrong coin.
 *  NEAR's Private row is wNEAR. */
export function privateHas(rows: readonly { tokenId: string; amount: string }[] | null | undefined, assetId: string): boolean {
  const ids = assetId === "near" || assetId === "nep141:wrap.near" ? ["near", "nep141:wrap.near"] : [assetId];
  return !!rows?.some((x) => ids.includes(x.tokenId) && DEC.test(x.amount) && Number(x.amount) > 0);
}
/** Send from the Safe fills Private first (wallet safe-send.ts, the fill open: SAFE_FILL_OPEN), for a coin native to NEAR
 *  (not bridged) that the Safe holds: such a coin can be sent from its page even with nothing in Private. A bridged coin
 *  (BTC) still needs some in Private (privateHas). */
/** The button shows when privateHas() || safeFills(): whenever Send can send this coin. */
export function safeFills(rows: readonly HeldRow[] | null | undefined, assetId: string, open: boolean): boolean {
  if (!open) return false;
  const ids = assetId === "near" || assetId === "nep141:wrap.near" ? ["near", "nep141:wrap.near"] : [assetId];
  return !!rows?.some((x) => (x.held === "ledger" || x.held === "account") && ids.includes(x.tokenId) && x.bridged === false && DEC.test(x.amount) && Number(x.amount) > 0);
}
/** The Safe's cash (USDC inside NEAR Intents) Buy pays from, for the sheet's "Pays from" row: ledger.balances' row, or null. */
export const safeCashOf = (rows: readonly HeldRow[] | null | undefined): string | null => heldOf(rows, SAFE_CASH);

/** Sell's shares (the sheet's chips: 25 %, 50 %, All), largest last. */
export const SELL_SHARES = [0.25, 0.5] as const;
/**
 * Where Sell opens (the design review, 5 Nov: it opened on All and was refused at once over the Face ID limit, $1,280 vs
 * $500): All when the whole holding is within the Safe's Face ID band (or the band isn't read: the core checks); else the
 * largest share under it; no share under it: the band itself, in dollars. `band` 0 (every move waits): nothing to start on.
 */
export function sellStart(heldUsd: number | undefined, band: number | null | undefined): { all: true } | { all: false; usd: string } {
  if (heldUsd === undefined || !(heldUsd > 0) || band === null || band === undefined || heldUsd <= band) return { all: true };
  if (!(band > 0)) return { all: false, usd: "" };
  const share = [...SELL_SHARES].reverse().find((x) => heldUsd * x <= band);
  return { all: false, usd: (share ? heldUsd * share : Math.floor(band * 100) / 100).toFixed(2) };
}

export interface SwapRecord { kind: string; status: string; from?: string; to?: string; amount: string; amountOut?: string }
/** The result on what is held: average cost of the recorded buys; null unless every coin held came from a recorded buy. */
export function resultOf(records: readonly SwapRecord[], assetId: string, held: number, price: number): { usd: number; pct: number } | null {
  let cost = 0, bought = 0, sold = 0;
  for (const r of records) {
    if (r.kind !== "swap" || r.status !== "done" || !r.amountOut) continue;
    const a = Number(r.amount), out = Number(r.amountOut);
    if (!(a > 0) || !(out > 0)) continue;
    if (r.from === SAFE_CASH && r.to === assetId) { cost += a; bought += out; }
    else if (r.from === assetId && r.to === SAFE_CASH) sold += a;
  }
  const net = bought - sold;
  if (!(bought > 0) || !(held > 0) || !(price > 0) || held > net * 1.001) return null;
  const basis = (cost / bought) * held;
  const usd = held * price - basis;
  return { usd: Math.round(usd * 100) / 100, pct: basis > 0 ? (usd / basis) * 100 : 0 };
}
