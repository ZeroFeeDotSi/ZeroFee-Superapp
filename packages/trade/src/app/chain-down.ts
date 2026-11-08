// Audit 13's D3 (8 Nov): with Solana down, the banner said "pump.fun and Solana trades can't go now." while a row's
// "Buy $25" still bought a Solana coin. A row on a down chain is off and says why, as C2 made it offline: one rule, the
// shell notice's own (core noticeShows), read from the same ledger.status, once for the whole list.
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { noticeShows, type Service, type ServiceStatus } from "@zerofee/core/services";
import { shortTime } from "@zerofee/core/clock";

/** Each trading chain's own service (core SERVICES). */
export const CHAIN_SERVICE: Record<string, Service> = { sol: "solana", hood: "hood", bsc: "bsc", near: "near" };
/** The chip's word, sized near "Buy $25" so the price stays whole: "Solana down". */
const SHORT: Record<string, string> = { sol: "Solana", hood: "Robinhood", bsc: "BNB", near: "NEAR" };
export const downChip = (chain: string): string => `${SHORT[chain] ?? "Chain"} down`;
/** The row's second line on a down chain, where the coin's name was (builder 24): "Robinhood is down". */
export const downRowLine = (chain: string): string => `${SHORT[chain] ?? "The chain"} is down`;
/** Its label, the whole line: "Solana is down. Trades on it can't go now." */
export const downLabel = (chain: string): string => `${SHORT[chain] ?? "This chain"} is down. Trades on it can't go now.`;

/** Each chain by the name the shell's notice gives it ("Robinhood Chain is down."). */
const NODE: Record<string, string> = { sol: "Solana", hood: "Robinhood Chain", near: "NEAR" };
/**
 * Audit 18 (S18-4, "What A means": a down chain's wallet figure carries its "As of" time): the line under a kept figure,
 * naming who is down (or didn't answer) and the time the figure is from, in Home's Hot words ("As of 2:25 PM"):
 * "Solana is down. SOL wallet is as of 2:25 PM." `what` is the figure's owner with its verb ("SOL wallet is", "Site
 * wallets are"). Trenches' chips and Social trading's sites say it the same way.
 */
export const keptLine = (chain: string, down: boolean, what: string, at: number, locale?: string): string =>
  `${NODE[chain] ?? "The chain"} ${down ? "is down" : "didn't answer"}. ${what} as of ${shortTime(at, locale)}.`;

/** Is `chain` down as the shell's notice says it (noticeShows)? Pure. */
export function chainDown(rows: readonly Pick<ServiceStatus, "service" | "state" | "seen">[], chain: string): boolean {
  const s = CHAIN_SERVICE[chain];
  return !!s && rows.some((r) => r.service === s && noticeShows(r));
}

/** How often the list asks again (the sheets' own pace, wallet services.ts SERVICES_EVERY_MS). */
export const CHAIN_DOWN_EVERY_MS = 30_000;

// one read for every row on the list: rows subscribe, the first starts the read, the last stops it
let rows: ServiceStatus[] = [];
const subs = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let reading: Bridge | null = null;
function look(bridge: Bridge): void {
  void bridge.call<ServiceStatus[]>("ledger.status").then((r) => {
    if (reading !== bridge) return;
    rows = "ok" in r && Array.isArray(r.ok) ? r.ok : [];
    for (const f of subs) f();
    timer = setTimeout(() => look(bridge), CHAIN_DOWN_EVERY_MS);
  }, () => undefined);
}

/** The chains whose trades can't go now, kept fresh while a list shows. */
export function useDownRows(bridge: Bridge): readonly ServiceStatus[] {
  const [now, setNow] = useState<readonly ServiceStatus[]>(rows);
  useEffect(() => {
    const f = () => setNow(rows);
    subs.add(f);
    if (reading !== bridge) { clearTimeout(timer); reading = bridge; look(bridge); }
    return () => { subs.delete(f); if (subs.size === 0) { clearTimeout(timer); reading = null; } };
  }, [bridge]);
  return now;
}
