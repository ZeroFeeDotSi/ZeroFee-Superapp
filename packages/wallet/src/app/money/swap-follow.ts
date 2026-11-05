// After Home's Swap from the Safe (spending.topUp): its one line follows the Top up underneath until it lands. Kept apart
// from the sheet, which loads on first tap, so Home's "On its way" row and the money host need only this.
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingActivity, SpendingStatus } from "@zerofee/core/spending";
import { sayWent } from "@zerofee/shell-api/money.ts";
import { carried } from "@zerofee/shell-api/job-carry.ts";

/** A Swap's name by its Spending row's id: Home's "On its way" row says "Swap $8.22 of NEAR for USDC", not the Top up it
 *  is underneath (one verb for one move). Named by its sheet (job-carry.ts nameSwap, kept with the job rows in Home's
 *  sealed store), so a reload still reads it. */
export const swapLabel = (id: string): string | undefined => carried(`move:${id}`)?.words;

/** How often, and for how long, the wallets are read again once a swap went (a UI re-test, 4 Nov: the SOL wallet
 *  showed the swap only after a reload, about a minute after it went on from the NEAR wallet). */
export const LANDING_READ_MS = 5_000;
export const LANDING_READ_FOR_MS = 3 * 60_000;

interface Timers {
  every(fn: () => void, ms: number): () => void;
  after(fn: () => void, ms: number): () => void;
}
const realTimers: Timers = {
  every: (fn, ms) => { const t = setInterval(fn, ms); return () => clearInterval(t); },
  after: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
};

/** The wallets' figures, one string, so a change in any of them is seen. */
const walletsOf = (s: SpendingStatus): string => s.networks.map((n) => `${n.network}:${n.cashUsd}:${n.coinsUsd}`).join("|");

/**
 * After the sheet: the one line stays "working on it" until Spending has the swap, then says it went. Spending tells on
 * every change (spending.changed); the row is read again then, and every 5 s besides, for at most 15 minutes.
 * Once it went, the money is still on its way to the wallet it was swapped to: spending.status (a fresh read of every
 * wallet, which tells Home through spending.changed) is asked again every 5 s until a wallet's figure moves, for at
 * most 3 minutes, so Home shows it there without a reload.
 */
export function followSwap(bridge: Bridge, f: { id: string; words: string; lands?: string }, t: Timers = realTimers): () => void {
  let over = false;
  let stopLanding: (() => void) | undefined;
  const landing = () => {
    let first: string | undefined;
    let stopped = false;
    const stopAll: (() => void)[] = [];
    const stop = () => { stopped = true; for (const s of stopAll) s(); };
    const read = async () => {
      if (stopped) return;
      const r = await bridge.call<SpendingStatus>("spending.status").catch(() => null);
      if (stopped || !r || !("ok" in r) || !r.ok || !Array.isArray(r.ok.networks)) return;
      const now = walletsOf(r.ok);
      if (first === undefined) first = now;
      else if (now !== first) stop();
    };
    stopAll.push(t.every(() => void read(), LANDING_READ_MS), t.after(stop, LANDING_READ_FOR_MS));
    void read();
    return stop;
  };
  const look = async () => {
    if (over) return;
    const r = await bridge.call<SpendingActivity[]>("spending.activity").catch(() => null);
    const row = r && "ok" in r && Array.isArray(r.ok) ? r.ok.find((m) => m.id === f.id) : undefined;
    if (over || !row || row.status === "on-its-way" || row.status === "waiting") return;
    end();
    if (row.status === "done") {
      sayWent(f.words.replace(/^Swap /, "Swapped "));
      stopLanding = landing();
    } else sayWent(row.note ?? "The swap didn't happen. Activity shows where the money is.", "quiet");
  };
  const off = bridge.on("spending.changed", () => void look());
  const stopTick = t.every(() => void look(), 5_000);
  const stopCap = t.after(() => { end(); sayWent("Still on its way. Activity shows where it is.", "quiet"); }, 15 * 60_000);
  function end() {
    over = true;
    off();
    stopTick();
    stopCap();
  }
  return () => { end(); stopLanding?.(); };
}
