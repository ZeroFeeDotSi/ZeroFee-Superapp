// One bad spell, one notice, one clock (QA, 5 Nov, the bundle: the banner's "since" jumped six times in
// 10 min, and "busy since <a time>" and "slow since <a time>" showed in the same second). StatusBanner.tsx reads the table
// every 30 s and hands each read here.
import type { Fault, Service, ServiceStatus } from "@zerofee/core/services";

/** The services in the order a notice names them when more than one fails (the one that blocks the most first). Never
 *  NEAR AI Cloud (restore crawl, 4 Nov: "NEAR AI Cloud is slow" sat over Home's rows): it holds up AgentZero's chat alone,
 *  and that chat says so itself; the shell's notice is for what money waits on. */
export const FIRST: Service[] = ["near", "bridge", "oneclick", "relay", "solana", "hood", "bsc", "helius", "gecko"];

/** How long every service must have been fine before the notice says "back" and its clock ends (QA, 5 Nov:
 *  the "since" time jumped six times in 10 min as reads flipped between busy, slow and fine). */
export const CLEAR_MS = 90_000;
/** Worse first: a service down, then slow (no answer in time), then busy (answers, rate-limited). */
const WORSE: Record<Fault, number> = { busy: 1, slow: 2, down: 3 };

/** One bad spell, one notice, one clock: `start` is when it first went bad and no re-read moves it; `state` only ever
 *  gets worse within it; `lastBad` is the last read that saw anything wrong; `row` the service it names. */
export interface Spell { row: ServiceStatus; state: Fault; start: number; lastBad: number }
type Bad = ServiceStatus & { state: Fault };

/** The next spell from one read of the table (`list`: the failing services the notice may name, none "up"). `back`: the
 *  service to say is back, once every service has been fine for `clearMs`. Pure, so the clock is tested by hand. */
export function nextSpell(prev: Spell | null, list: readonly ServiceStatus[], now: number, clearMs: number = CLEAR_MS): { spell: Spell | null; back: Service | null } {
  const bad = list as readonly Bad[];
  if (!bad.length) return !prev || now - prev.lastBad < clearMs ? { spell: prev, back: null } : { spell: null, back: prev.row.service };
  // the worst state wins; among equals, the service that blocks the most (FIRST)
  const worst = [...bad].sort((a, b) => WORSE[b.state] - WORSE[a.state] || FIRST.indexOf(a.service) - FIRST.indexOf(b.service))[0]!;
  // a since that isn't a real past time (NaN, ahead of this clock) is now
  const at = Date.parse(worst.since ?? "");
  if (!prev) return { spell: { row: worst, state: worst.state, start: at <= now ? at : now, lastBad: now }, back: null };
  const still = bad.find((x) => x.service === prev.row.service);
  const take = !still || WORSE[worst.state] > Math.max(WORSE[prev.state], WORSE[still.state]) ? worst : still;
  return { spell: { row: take, state: take === still && WORSE[prev.state] > WORSE[still.state] ? prev.state : take.state, start: prev.start, lastBad: now }, back: null };
}
