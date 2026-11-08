// A sale whose wallet can't pay its network fee (the audit's S6, 8 Nov): the fee comes from the NEAR wallet as step one, but
// only once the person taps Sell. Money never moves because a page opened; closing the page leaves nothing moved.
import { usd } from "./format.ts";
import { moveLegSec, timeLeft } from "@zerofee/shell-api/job-steps.ts";

/** The fee a sale with no gas gets: clear of the core's $2 floor for a move (a move's dollars are re-priced in the
 *  chain's coin, so exactly $2 can come out a hair under), and more than any one sale's fee. */
export const GAS_USD = 2.5;

/** Whether the fee move goes now: the sale is short of its fee, it wasn't asked yet, and the person pressed Sell for the
 *  amount on screen (`pressed`: the press kept for this intent). */
export function gasGoes(o: { needed: boolean; asked: boolean; pressed: boolean }): boolean {
  return o.needed && !o.asked && o.pressed;
}

/** The button before the tap, saying what the tap moves first. */
export function gasButton(): string {
  return `Sell · ${usd(GAS_USD)} for fees first`;
}

/** The line above it, before the tap: what moves, from where, to where. */
export function gasLine(walletName: string): string {
  return `When you tap Sell, ${usd(GAS_USD)} moves from your NEAR wallet to ${walletName} for fees.`;
}

export type SaleStep = { label: string; state: "waiting" | "doing" | "done" | "failed"; at?: number };
type Step = SaleStep;
export type SaleTasks = Tasks;
type Tasks = { publish(t: { id: string; steps: Step[] } & Record<string, unknown>): boolean; update(id: string, p: { steps?: Step[] } & Record<string, unknown>): boolean; end(id: string, state: "done" | "failed" | "stopped", detail?: string): boolean };

/** The job's first step while the fee moves (QA 16, 8 Nov: one Sell tap is one job, the fee then the sale). */
export const gasStep = (): string => `Fees first · ${usd(GAS_USD)}`;
/** A sale's own time on its chain, once it goes (the owner's speed bars: Solana under 1 s, NEAR and ETH about 2 s). */
export const SALE_SEC = 2;
/** When the fee job should be done, from its tap (QA 16's MUST, 8 Nov: every job shows time left from its first frame,
 *  never "No time estimate"): the fee's leg is the Move sheet's own NEAR wallet → chain wallet leg, timed by the one Move
 *  estimator (job-steps moveLegSec, the audit's S8), then the sale's. `chain`: the wallet's place (sol, hood, bsc). */
export const gasJobEndsAt = (at: number, chain = "sol"): number => at + (moveLegSec("near", chain) + SALE_SEC) * 1000;
/** When a sale that goes now should be done. */
export const saleEndsAt = (at: number): number => at + SALE_SEC * 1000;
/** The job before the sale goes: the fee moving, then the sale waiting. */
/** Audit 10's A9 (8 Nov): the button while the tapped sale waits for its fee said "Selling as soon as the fee lands…" (an
 *  ellipsis busy line, rule 2). Now what happens and the time left, from the job's own end (gasJobEndsAt): "Sells when
 *  the fee lands · 6 s left"; past it, the words alone. */
export const FEE_WAIT = "Sells when the fee lands";
export const feeWaitLabel = (endsAt: number | undefined, now: number): string => (endsAt !== undefined && endsAt > now ? `${FEE_WAIT} · ${timeLeft(endsAt, now)}` : FEE_WAIT);

export function gasJobSteps(at: number): Step[] {
  return [{ label: gasStep(), state: "doing", at }, { label: "Sell", state: "waiting" }];
}

/** The same Activity tasks, with the fee's step kept first on every write the sale makes to its job (its Sent, Landed,
 *  Back in steps follow it), so the job shows every step from the one tap. No lead: the tasks as they are. */
export function withLead<T extends Tasks>(tasks: T | undefined, lead: readonly Step[]): T | undefined {
  if (!tasks || !lead.length) return tasks;
  return {
    ...tasks,
    publish: (t) => tasks.publish({ ...t, steps: [...lead, ...t.steps] }),
    update: (id, p) => tasks.update(id, p.steps ? { ...p, steps: [...lead, ...p.steps] } : p),
    end: (id, state, detail) => tasks.end(id, state, detail),
  } as T;
}

/** How a fee job ends when its sale never went: what stopped, where the money is, by wallet name (rule 8). */
export function gasEnd(o: { failed: boolean; problem?: string; closed?: boolean; walletName: string }): { state: "failed" | "stopped"; detail: string } {
  if (o.failed) return { state: "failed", detail: `The fee didn't reach ${o.walletName}, so nothing was sold. The ${usd(GAS_USD)} is in your NEAR wallet.` };
  if (o.problem) return { state: "failed", detail: o.problem };
  // QA 16 (8 Nov): a job ends early only before any money moved; once the fee was asked the closed page's sale goes on
  // (fee-sale.ts) and the amount can't change
  if (o.closed) return { state: "stopped", detail: "You closed it before anything moved. Nothing was sold." };
  return { state: "stopped", detail: `You changed the amount, so nothing was sold. The ${usd(GAS_USD)} for fees goes to ${o.walletName}.` };
}
