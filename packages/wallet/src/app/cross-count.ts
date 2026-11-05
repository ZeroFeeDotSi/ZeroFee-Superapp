// D140 (product decision, 3 Nov): money moving
// between the Safe and the wallets is counted once. Home reads the Safe and the wallets apart. The engine counts a move
// on its way at once (spending.status totalUsd: an Add until the NEAR wallet has it, a move home until it lands), while
// the Safe's own figure moves only when its read says so, and a big drop in it waits for a second read (home-keep.ts
// confirmDrop, home-reads.ts heldToFloor). Between the two, the same dollars showed twice. Here each move is keyed to the
// Safe as Home showed it when the move began: a move OUT of the Safe counts on its way only for what the Safe already
// shows gone; a move INTO the Safe stops counting on its way for what the Safe already shows arrived. Coins are compared
// by amount at today's price, so a price that moves is never taken for money that moved. Pure but for keepCross/readKept;
// the state lives with the runtime.
// A reload mid-move (QA's Jobs hunt, 5 Nov: Home's total $21 short while a Move ran and 60 s after it landed):
// the new page's first Safe read already showed the drop, so the move was keyed to it and counted nowhere. The state is
// now kept on the phone (Home's own device.store, beside its copy): the Safe as last shown and each move's key come back
// with the page, and the Safe as last shown stays until a new read replaces it, however old.
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Balance } from "../types.ts";
import type { WalletView } from "./home-cache.ts";

type Amounts = Map<string, { amount: number; px: number }>;
export interface CrossState {
  /** What Home showed of the Safe lately (a move out is keyed to the most it held just before): `at` the last time it
   *  showed these amounts (a repeat moves it on, never adds one). */
  seen: { at: number; rows: Amounts }[];
  /** Each move by its id: which way it goes and the Safe it is keyed to (null: begun before this Home saw it). */
  moves: Map<string, { way: "out" | "in"; base: Amounts | null; usd: number; /** left onItsWay at (a move out the Safe hasn't shown gone yet stays keyed) */ gone?: number }>;
  /** When this state first saw the Safe (0: a state kept from before, which saw it then). */
  since?: number;
}
export const newCrossState = (kept?: string | null): CrossState => restore(kept) ?? { seen: [], moves: new Map() };

/** How far back a move out looks for the Safe as it was (the Safe's drop waits for a second read, about 1.5 s). */
export const SEEN_MS = 30_000;
/** A move out that left onItsWay (it landed in the wallets) while the Safe still shows its money: kept this long at most. */
export const GONE_MS = 60_000;
/** A move this old when first seen began before this Home (the app reopened mid-move): its Safe read already says it. */
export const FRESH_MS = 30_000;
/** How long the Safe's figure takes to show a move out (its drop waits for a second read, about 1.5 s). A move that began
 *  longer than this before this state's first read already shows in that read (core hunt, 5 Nov: the app reopened 10 s
 *  into a Move with nothing kept took the $30 off the wallets again). */
export const DROP_MS = 3_000;

const amountsOf = (rows: readonly Balance[]): Amounts => {
  const m: Amounts = new Map();
  for (const r of rows) {
    const amount = Number(r.amount), usd = Number(r.usd);
    if (r.test || r.listed === false || !(amount > 0) || !Number.isFinite(usd)) continue;
    const k = `${r.tokenId}|${r.held}`;
    const was = m.get(k);
    m.set(k, { amount: (was?.amount ?? 0) + amount, px: usd / amount });
  }
  return m;
};
/** `rows`' coins at the prices of `now` (a coin gone since: at its own last price). */
const worth = (rows: Amounts, now: Amounts): number => [...rows].reduce((n, [k, r]) => n + r.amount * (now.get(k)?.px ?? r.px), 0);
const cents = (x: number) => Math.round(x * 100) / 100;

/** Which way a move on its way crosses the Safe: out of it (the Safe's Move, Add, a swap inside it), into it (a move
 *  home), or neither (between the wallets: the engine counts both ends itself). */
function wayOf(m: SpendingActivity): "out" | "in" | null {
  if (m.status !== "on-its-way") return null;
  if (m.kind === "top-up") return "out";
  if ((m.kind === "put-away" || m.kind === "over-cap") && !m.network) return "in";
  return null;
}

/**
 * The dollars Home would count twice now: take them off the wallets' figure. `rows`: the Safe as Home shows it;
 * `onItsWay`: spending.status's. Never more than a move's own dollars, never below 0, so nothing ever dips because of it.
 */
export function doubleCounted(s: CrossState, rows: readonly Balance[] | null, onItsWay: readonly SpendingActivity[] | undefined, nowMs: number): number {
  if (!rows) return 0;
  s.since ??= nowMs;
  const now = amountsOf(rows);
  // the Safe as last shown stays, however old (Home idle a minute, then a Move: its read before the drop is that one)
  const last = s.seen.at(-1);
  s.seen = s.seen.filter((x) => x === last || nowMs - x.at <= SEEN_MS).slice(-40);
  if (last && same(last.rows, now)) last.at = Math.max(last.at, nowMs);
  else s.seen.push({ at: nowMs, rows: now });
  const moves = (onItsWay ?? []).map((m) => ({ m, way: wayOf(m) })).filter((x): x is { m: SpendingActivity; way: "out" | "in" } => x.way !== null);
  const live = new Set(moves.map((x) => x.m.id));
  const shown = worth(now, now);
  const movedOf = (k: { way: "out" | "in"; base: Amounts; usd: number }) => Math.min(k.usd, Math.max(0, k.way === "out" ? worth(k.base, now) - shown : shown - worth(k.base, now)));
  let twice = 0;
  // a move out that landed in the wallets before the Safe's drop showed (a slow second read): the wallets count it now,
  // so it stays keyed until the Safe shows it gone (or GONE_MS); any other move that ended is let go
  for (const [id, k] of [...s.moves]) {
    if (live.has(id)) continue;
    k.gone ??= nowMs;
    if (k.way !== "out" || !k.base || nowMs - k.gone > GONE_MS || movedOf({ ...k, base: k.base }) >= k.usd - 0.01) { s.moves.delete(id); continue; }
    twice += k.usd - movedOf({ ...k, base: k.base });
  }
  for (const { m, way } of moves) {
    let k = s.moves.get(m.id);
    if (!k) {
      const at = Date.parse(m.atIso);
      // the Safe as it was: the most it held lately (a move out), or as it is (a move in: it can't have arrived yet)
      const before = way === "out" ? s.seen.reduce((a, b) => (worth(b.rows, now) > worth(a.rows, now) ? b : a)).rows : now;
      k = { way, base: Number.isFinite(at) && nowMs - at <= FRESH_MS && at >= (s.since ?? nowMs) - DROP_MS ? before : null, usd: 0 };
      s.moves.set(m.id, k);
    }
    k.usd = Math.max(0, Number(m.usd) || 0);
    delete k.gone;
    if (!k.base) continue;
    const moved = movedOf({ ...k, base: k.base });
    twice += way === "out" ? k.usd - moved : moved;
  }
  return cents(twice);
}

const same = (a: Amounts, b: Amounts): boolean => a.size === b.size && [...a].every(([k, x]) => b.get(k)?.amount === x.amount);

// ---- kept on the phone (a reload mid-move) ----

/** Home's own device.store key (never sent anywhere; sealed to the chip on the phone, as Home's copy is). */
export const CROSS_KEY = "home-cross.v1";
/** A kept move this old is let go (no Move takes a day). */
const KEPT_MS = 24 * 60 * 60_000;
type KeptAmounts = [string, number, number][];
type Kept = { v: 1; seen: { at: number; rows: KeptAmounts }[]; moves: [string, { way: "out" | "in"; base: KeptAmounts | null; usd: number; gone?: number }][] };
const keptOf = (m: Amounts): KeptAmounts => [...m].map(([k, r]) => [k, r.amount, r.px]);
const amountsBack = (x: unknown): Amounts | null => {
  if (!Array.isArray(x)) return null;
  const m: Amounts = new Map();
  for (const e of x) {
    if (!Array.isArray(e) || typeof e[0] !== "string" || !(Number(e[1]) > 0) || !(Number(e[2]) >= 0)) return null;
    m.set(e[0], { amount: Number(e[1]), px: Number(e[2]) });
  }
  return m;
};

/** The state as text: the Safe as last shown (one entry per amount seen, its first time) and each move's key. A text
 *  that only changes when an amount or a move does, so it is written rarely. */
export function crossText(s: CrossState): string {
  const k: Kept = { v: 1, seen: s.seen.map((x) => ({ at: x.at, rows: keptOf(x.rows) })), moves: [...s.moves].map(([id, m]) => [id, { way: m.way, base: m.base ? keptOf(m.base) : null, usd: m.usd, ...(m.gone !== undefined ? { gone: m.gone } : {}) }]) };
  // `at` moves on every read: kept as when the amounts were first written, so the text (and the write) waits for a change
  return JSON.stringify({ ...k, seen: k.seen.map((x) => ({ rows: x.rows })) });
}

/** A kept state back; a damaged one is none. */
function restore(text: string | null | undefined, nowMs = Date.now()): CrossState | null {
  if (!text) return null;
  try {
    const k = JSON.parse(text) as Partial<Kept>;
    if (k.v !== 1 || !Array.isArray(k.seen) || !Array.isArray(k.moves)) return null;
    // the Safe as last shown before the page closed, as if shown now (a move keyed from it for the next SEEN_MS)
    const last = amountsBack(k.seen.at(-1)?.rows);
    const seen = last ? [{ at: nowMs, rows: last }] : [];
    const moves: CrossState["moves"] = new Map();
    for (const e of k.moves) {
      const m = Array.isArray(e) ? e[1] : undefined;
      if (typeof e?.[0] !== "string" || !m || (m.way !== "out" && m.way !== "in") || !(Number(m.usd) >= 0)) continue;
      if (typeof m.gone === "number" && nowMs - m.gone > KEPT_MS) continue;
      const base = m.base === null ? null : amountsBack(m.base);
      if (m.base !== null && !base) continue;
      moves.set(e[0], { way: m.way, base, usd: Number(m.usd), ...(typeof m.gone === "number" ? { gone: m.gone } : {}) });
    }
    return { seen, moves, since: 0 };
  } catch { return null; }
}

/** Per bridge: the text kept (read once, as this code loads) and the text last written by each view. */
const keptText = new WeakMap<Bridge, string | null>();
const written = new WeakMap<Bridge, Map<string, string>>();
/** Reads the kept state once per bridge (Home's provider waits for it before it counts anything). */
export async function readKept(bridge: Bridge): Promise<void> {
  if (keptText.has(bridge)) return;
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: CROSS_KEY }).catch(() => null);
  keptText.set(bridge, r && "ok" in r && typeof r.ok?.value === "string" ? r.ok.value : null);
}
/** `view`'s kept state (Home's provider: "money", "shown"), or none. */
export function keptState(bridge: Bridge, view: string): string | null {
  const t = keptText.get(bridge);
  if (!t) return null;
  try { const all = JSON.parse(t) as Record<string, unknown>; return typeof all[view] === "string" ? (all[view] as string) : null; } catch { return null; }
}
/** Writes `view`'s state when its text changed (the views share one key). */
export function keepCross(bridge: Bridge, view: string, s: CrossState): void {
  const mine = written.get(bridge) ?? new Map<string, string>();
  written.set(bridge, mine);
  const text = crossText(s);
  if (mine.get(view) === text) return;
  mine.set(view, text);
  let all: Record<string, string> = {};
  try { all = JSON.parse(keptText.get(bridge) ?? "{}") as Record<string, string>; } catch { /* a damaged copy is no copy */ }
  const next = JSON.stringify({ ...all, [view]: text });
  keptText.set(bridge, next);
  void bridge.call("device.store.set", { key: CROSS_KEY, value: next }).catch(() => undefined);
}

/** The wallets' figure less what is counted twice (text in, text out; never below 0). */
export function lessTwice(trading: string | null, twice: number): string | null {
  if (trading === null || !(twice > 0)) return trading;
  return Math.max(0, cents((Number(trading) || 0) - twice)).toFixed(2);
}

/** A view whose wallets' figure leaves out what the Safe it shows already counts (runtime.tsx: Home's and the money's). */
export function countOnce<V extends Pick<WalletView, "balances" | "spending" | "trading">>(v: V, s: CrossState, nowMs: number, keep?: { bridge: Bridge; view: string }): V {
  const twice = doubleCounted(s, v.balances, v.spending?.onItsWay, nowMs);
  if (keep && v.balances) keepCross(keep.bridge, keep.view, s);
  return twice > 0 ? { ...v, trading: lessTwice(v.trading, twice) } : v;
}

/** Home's provider's count-once for one view (runtime.tsx): its state made on first use, from the copy kept on the phone
 *  when `bridge` is Home's (null: a money sheet's, kept nowhere). */
export function once<V extends Pick<WalletView, "balances" | "spending" | "trading">>(v: V, ref: { current: CrossState | null }, bridge: Bridge | null, view: string): V {
  ref.current ??= newCrossState(bridge ? keptState(bridge, view) : null);
  return countOnce(v, ref.current, Date.now(), bridge ? { bridge, view } : undefined);
}
