// How Earn says numbers and times. Amounts are rounded DOWN for display, so a screen never shows more NEAR than there
// is; the amount that moves is always the exact decimal string. Forecasts are always worded as forecasts.
import type { Wait } from "../epoch.ts";
import type { Idle } from "../types.ts";
import type { Rate } from "../rate.ts";

/** "112.4031…" → "112.40"; under 1 NEAR, up to 4 decimals ("0.0518"). Grouped ("6,384,397.12"), rounded down. */
export function nearText(amount: string): string {
  const [whole, frac = ""] = amount.split(".");
  if (whole === "0") {
    const small = frac.slice(0, 4).replace(/0+$/, "");
    return small ? `0.${small}` : "0";
  }
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac.slice(0, 2).padEnd(2, "0")}`;
}

/** Dollars for an amount of NEAR at a price, rounded down to cents: "$493.43". Undefined without a price. */
export function usdText(amount: string, priceUsd?: number): string | undefined {
  if (priceUsd === undefined || !Number.isFinite(priceUsd)) return undefined;
  const v = Math.floor(Number(amount) * priceUsd * 100) / 100;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The span a rate was measured over, in the words a person reads: "today's rate" or "the last 30 days' rate". */
export function rateSpan(rate: Rate): { at: string; over: string } {
  if (rate.days < 1.5) return { at: "today's rate", over: `last ${Math.max(1, Math.round(rate.days * 24))} hours` };
  if (rate.days >= 25) return { at: "the last 30 days' rate", over: "last 30 days" };
  const d = Math.round(rate.days);
  return { at: `the last ${d} days' rate`, over: `last ${d} days` };
}

/** "At today's rate: about $26.47 a year" (or in NEAR without a price). A forecast, never a promise. */
export function forecastText(amount: string, rate: Rate, priceUsd?: number): string {
  const yearly = (Number(amount) * Number(rate.percent)) / 100;
  const money = usdText(String(yearly), priceUsd) ?? `${nearText(String(Math.floor(yearly * 1e4) / 1e4))} NEAR`;
  return `At ${rateSpan(rate).at}: about ${money} a year`;
}

/** "in about 19 hours", "in about 2 days", "in less than an hour". Never earlier than it can be. */
export function whenText(iso: string, nowMs: number): string {
  const ms = Date.parse(iso) - nowMs;
  if (!(ms > 0)) return "now";
  const hours = Math.ceil(ms / 3.6e6);
  if (hours <= 1) return "in less than an hour";
  if (hours < 36) return `in about ${hours} hours`;
  return `in about ${Math.ceil(hours / 24)} days`;
}

/** "9 h", "2 days", "3 weeks": how long ago. */
export function agoText(iso: string, nowMs: number): string {
  const m = Math.max(0, (nowMs - Date.parse(iso)) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${Math.floor(m)} min`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} h`;
  const d = Math.floor(m / 60 / 24);
  if (d < 14) return d === 1 ? "1 day" : `${d} days`;
  return `${Math.floor(d / 7)} weeks`;
}

/** A share of an amount, rounded down to 4 decimals, for the 25/50/75/All presets. */
export function shareOf(amount: string, percent: number): string {
  const [w, f = ""] = amount.split(".");
  const units = BigInt(w + f.padEnd(24, "0").slice(0, 24));
  const part = percent === 100 ? units : (units * BigInt(percent)) / 100n;
  const s = part.toString().padStart(25, "0");
  const frac = s.slice(-24, -20).replace(/0+$/, "");
  return `${s.slice(0, -24).replace(/^0+(?=\d)/, "")}${frac ? `.${frac}` : ""}`;
}

/** How long NEAR asked back waits, from the live epoch: "about a day (21 to 28 hours)"; "about a day" until it's read. */
export function waitSpan(wait?: Wait): string {
  if (!wait) return "about a day";
  const min = Math.round(wait.minHours);
  const max = Math.round(wait.maxHours);
  return `${max < 36 ? "about a day" : `about ${Math.round(max / 24)} days`} (${min} to ${max} hours)`;
}

/**
 * Where the stake amount starts (UI's ruling, 26 Oct): all of the NEAR on the account itself, after what it must keep,
 * to 4 decimals rounded down. Never wNEAR in NEAR Intents: that is Wallet's spending balance. One tap on a preset
 * changes it.
 */
export function startAmount(idle: Idle): string {
  return shareOf(idle.account, 100);
}
