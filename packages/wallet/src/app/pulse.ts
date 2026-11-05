// H-1, the pulse (master plan 3 Nov, Part 1 §1): one quiet line under Home's "Safe · Hidden · Trading", what PRICES did
// to the person's coins today: "Your coins rose $4.20 today. SOL is up 3%."
//
// It is a price line, never a balance difference, so money in or out is never called a gain or a loss (QA's GO, 3 Nov):
// each coin, in each place it sits, keeps a price to measure from today: the first price this phone saw for it, and for
// coins that arrive later in the day (an Add, a Send to a row's address, a buy), the price they arrived at, blended by
// amount. Today's move is the coins held now times (price now − that price), so an arrival adds nothing and a coin that
// leaves takes its part with it. Kept on this device only (a price and an amount per place; no address). Dollar coins
// (USDC and the like) never move the line.
// Nothing shows on a flat day, before every part of the money is read, or when nothing was read earlier today.
import { isUsdStable } from "@zerofee/pay/tokens";
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingStatus } from "@zerofee/core/spending";
import type { Balance, PrivatePocket } from "../types.ts";
import type { HeldCoin } from "./trading.ts";

/** One coin in one place: the Safe, Hidden, a row's own coin, a coin held on a row. */
export interface Holding { key: string; symbol: string; amount: number; usd: number }
/** What this phone keeps: the day (the phone's own date) and, per holding, the price to measure from (`p`), the amount
 *  last seen (`a`) and the first price seen today (`f`, for the coin's own "up 3%"). */
export interface PulseDay { day: string; first: Record<string, { p: number; a: number; f: number }> }

export const PULSE_KEY = "pulse.day";
const ROW_COIN: Record<string, string> = { sol: "SOL", hood: "ETH", near: "NEAR", bsc: "BNB" };

const num = (s: string | undefined | null): number => (s && /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN);
/** The phone's own date, "2026-11-03". */
export const dayOf = (now: Date): string => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** Every priced coin the person holds, by place (D111: every chain's row, never NEAR alone). Dollar coins are left out. */
export function holdings(p: { balances: Balance[]; pocket: PrivatePocket | null; spending: SpendingStatus | null; held: HeldCoin[] | null }): Holding[] {
  const out: Holding[] = [];
  const add = (key: string, symbol: string, amount: number, usd: number) => {
    if (isUsdStable(symbol) || !(amount > 0) || !(usd > 0)) return;
    out.push({ key, symbol, amount, usd });
  };
  for (const b of p.balances) add(`safe:${b.tokenId}`, b.symbol, num(b.amount), num(b.usd));
  if (p.pocket?.available) for (const b of p.pocket.rows) add(`hidden:${b.tokenId}`, b.symbol, num(b.amount), num(b.usd));
  for (const n of p.spending?.networks ?? []) if (ROW_COIN[n.network]) add(`row:${n.network}`, ROW_COIN[n.network]!, num(n.nativeAmount), num(n.cashUsd));
  for (const h of p.held ?? []) add(`held:${h.chain}:${h.address}`, h.symbol, num(h.amount), num(h.usd));
  return out;
}

/** Today's prices to measure from, after this read: a holding not seen yet today starts at its price now; more of a
 *  coin arriving blends in at its price now (so it adds nothing); less of it keeps the price. A new day starts over. */
export function remember(kept: PulseDay | null, now: Holding[], day: string): PulseDay {
  const was = kept && kept.day === day ? kept.first : {};
  const first: PulseDay["first"] = {};
  for (const h of now) {
    const price = h.usd / h.amount;
    const k = was[h.key];
    first[h.key] = !k ? { p: price, a: h.amount, f: price } : h.amount > k.a ? { p: (k.a * k.p + (h.amount - k.a) * price) / h.amount, a: h.amount, f: k.f } : { p: k.p, a: h.amount, f: k.f };
  }
  return { day, first };
}

export interface Pulse { usd: number; top?: { symbol: string; pct: number } }

/** What prices did today: the dollars, and the coin that moved them most (its own price's % since its first price today). */
export function pulse(kept: PulseDay, now: Holding[]): Pulse {
  let usd = 0;
  let top: { symbol: string; pct: number; usd: number } | undefined;
  for (const h of now) {
    const k = kept.first[h.key];
    const p0 = k?.p;
    if (!k || !(p0 && p0 > 0)) continue;
    const move = h.usd - h.amount * p0;
    usd += move;
    if (!top || Math.abs(move) > Math.abs(top.usd)) top = { symbol: h.symbol, pct: (h.usd / h.amount / k.f - 1) * 100, usd: move };
  }
  return { usd, ...(top ? { top: { symbol: top.symbol, pct: top.pct } } : {}) };
}

const money = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctText = (p: number) => { const a = Math.abs(p); return `${a >= 10 ? Math.round(a) : Number(a.toFixed(1))}%`; };

/** The line (grade 5, one idea, HOME-VISUAL §3.4): "Up $122.25 today", or null: flat (under a cent). The coin that moved
 *  most stays in `Pulse.top` (a second idea is not on Home's one line). */
export function pulseLine(p: Pulse): string | null {
  if (!(Math.abs(p.usd) >= 0.01)) return null;
  return `${p.usd > 0 ? "Up" : "Down"} ${money(p.usd)} today`;
}
/** The coin that moved the whole the most, said in words ("SOL is up 13%"), for a place with room for a second idea. */
export const topLine = (p: Pulse): string | null => {
  const t = p.top;
  return !t || !(Math.abs(t.pct) >= 0.1) || Math.sign(t.pct) !== Math.sign(p.usd) ? null : `${t.symbol} is ${t.pct > 0 ? "up" : "down"} ${pctText(t.pct)}`;
};

/** The kept day, read back strictly: anything else is "nothing kept". */
export function readKept(value: string | null | undefined): PulseDay | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as PulseDay;
    if (typeof v?.day !== "string" || !v.first || typeof v.first !== "object") return null;
    const first: PulseDay["first"] = {};
    const ok = (n: unknown): n is number => typeof n === "number" && n > 0 && Number.isFinite(n);
    for (const [k, x] of Object.entries(v.first)) if (x && ok(x.p) && ok(x.a) && ok(x.f)) first[k] = { p: x.p, a: x.a, f: x.f };
    return { day: v.day, first };
  } catch {
    return null;
  }
}

/** One read of the pulse: today's kept prices from this device, brought up to this read, kept again, and the line.
 *  The store is the Wallet's own device.store slot; nothing leaves the phone. */
export async function readPulse(bridge: Bridge, now: Holding[], at = new Date(), only?: (key: string) => boolean): Promise<string | null> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: PULSE_KEY });
  const was = "ok" in r ? r.ok?.value : null;
  const kept = remember(readKept(was), now, dayOf(at));
  // written only when it changed: Home reads its money again every few seconds
  const value = JSON.stringify(kept);
  if (value !== was) await bridge.call("device.store.set", { key: PULSE_KEY, value });
  // every holding is kept; the line counts only the part shown (Home's tab: a wallet, the Safe), or all of it
  return pulseLine(pulse(kept, only ? now.filter((h) => only(h.key)) : now));
}
