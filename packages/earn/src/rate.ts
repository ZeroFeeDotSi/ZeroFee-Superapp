// A pool's real rate: how much its stakers' NEAR grew, read from the pool itself at two blocks. A staker who neither
// added nor took out anything grows exactly as the pool's share price does, so we read up to 10 stakers at both blocks,
// keep those whose growth agrees, and turn the agreed growth into a yearly rate. It is a measurement of the past, never a
// promise: the app words it from how many days it spans ("at today's rate", "at the last 12 days' rate").
// Each measurement is a window the phone keeps (option (c)): the rate over several windows is their growth multiplied,
// over the time they cover, so it grows toward 30 days of this phone's own measurements.
import type { Block, Chain } from "@zerofee/core/chain";
import { units } from "./near.ts";
import type { StampedBlock } from "./network.ts";

export interface Rate {
  /** Yearly, compounded, after the pool's fee: "5.37". */
  percent: string;
  /** How many days the measurement spans. */
  days: number;
}

const SAMPLE = 10;
const MIN_AGREEING = 3;
/** Stakers below 1 NEAR are skipped: rounding in the pool's share math is too large a part of them. */
const MIN_STAKE = 10n ** 24n;
const YEAR_NS = 365.25 * 86400e9;

/** One measured stretch of a pool's growth, kept on the device. */
export interface RateWindow {
  fromHeight: number;
  toHeight: number;
  /** The two blocks' times, in nanoseconds since 1970, as text. */
  fromNs: string;
  toNs: string;
  /** How much a staker who did nothing grew over the window: 1.000123… (1 when nobody pinged the pool in it). */
  growth: number;
}

export async function measureRate(chain: Chain, poolId: string, now: StampedBlock, then: StampedBlock): Promise<Rate | null> {
  const w = await measureWindow(chain, poolId, now, then);
  return w ? rateOver([w]) : null;
}

/** A window read back from the device: well formed, and no more growth than a real measurement would accept. */
export function isRateWindow(w: any): w is RateWindow {
  if (!Number.isInteger(w?.fromHeight) || !Number.isInteger(w?.toHeight) || w.toHeight <= w.fromHeight) return false;
  if (typeof w.fromNs !== "string" || typeof w.toNs !== "string" || !/^\d+$/.test(w.fromNs) || !/^\d+$/.test(w.toNs)) return false;
  const spanNs = Number(BigInt(w.toNs) - BigInt(w.fromNs));
  return spanNs > 0 && Number.isFinite(w.growth) && w.growth >= 1 && w.growth - 1 <= 0.5 * (spanNs / YEAR_NS);
}

/** The yearly rate over kept windows: their growth multiplied, over the time they cover. No growth at all is no rate. */
export function rateOver(windows: RateWindow[]): Rate | null {
  const spanNs = windows.reduce((t, w) => t + Number(BigInt(w.toNs) - BigInt(w.fromNs)), 0);
  const growth = windows.reduce((g, w) => g * w.growth, 1);
  // No growth at all means nobody pinged the pool in that time (it shares rewards out only when pinged), not that it
  // earned nothing: a validator that really earns nothing is out of the set, which Earn says separately.
  if (spanNs <= 0 || growth === 1) return null;
  const yearly = Math.pow(growth, YEAR_NS / spanNs) - 1;
  return { percent: (Math.round(yearly * 10000) / 100).toFixed(2), days: Math.round((spanNs / 86400e9) * 10) / 10 };
}

/** The pool's growth between two blocks, from stakers who neither added nor took out anything in between. */
export async function measureWindow(chain: Chain, poolId: string, now: StampedBlock, then: StampedBlock): Promise<RateWindow | null> {
  const spanNs = Number(now.timestampNs - then.timestampNs);
  if (spanNs <= 0) return null;
  const at = (b: StampedBlock): Block => ({ hash: b.hash, height: b.height });
  const listed = await chain.view(poolId, "get_accounts", { from_index: 0, limit: SAMPLE }, at(now));
  if (!Array.isArray(listed)) return null;

  const growth: number[] = [];
  for (const a of listed) {
    const s1 = units(a?.staked_balance);
    const u1 = units(a?.unstaked_balance);
    if (typeof a?.account_id !== "string" || s1 === null || u1 === null) continue;
    const old = (await chain.view(poolId, "get_account", { account_id: a.account_id }, at(then))) as any;
    const s0 = units(old?.staked_balance);
    if (s0 === null || s0 < MIN_STAKE || units(old?.unstaked_balance) !== u1 || s1 < s0) continue;
    // Twelve digits of the ratio, exactly, then as a number.
    growth.push(Number((s1 * 10n ** 12n) / s0) / 1e12);
  }
  if (growth.length < MIN_AGREEING) return null;

  const sorted = [...growth].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)];
  const agreeing = sorted.filter((g) => Math.abs(g - median) <= 1e-9 + (median - 1) * 1e-3);
  // Someone who added or took out NEAR grows differently; a jump of more than half a year's worth is never interest.
  if (agreeing.length < MIN_AGREEING || median - 1 > 0.5 * (spanNs / YEAR_NS)) return null;
  return { fromHeight: then.height, toHeight: now.height, fromNs: then.timestampNs.toString(), toNs: now.timestampNs.toString(), growth: median };
}
