// A Sell short of its fee goes on with its page closed (QA 16's MUST, 8 Nov): one tap made one job, the fee then the sale;
// once the fee was asked, closing the page never ends it. The job stays in Activity's Now row, the sale goes the moment
// the fee has landed (its quote no longer short of the fee), and the job ends saying how it went. A job ends early only
// before any money moved (the page's own end, sale-gas.ts gasEnd).
import { ProblemError, type Problem } from "@zerofee/core/problem";
import { gasEnd, gasStep, saleEndsAt, withLead, type SaleTasks, type SaleStep } from "./sale-gas.ts";

/** How long the closed page's sale waits for its fee to land before it ends, saying where the coins are. */
export const FEE_SALE_LIMIT_MS = 120_000;
/** How often it asks again while the fee is on its way. */
export const FEE_SALE_EVERY_MS = 1_500;
/** The quote's own "no fee here yet" (the wallet can't pay its network fee). */
export const feeShort = (code: string | undefined): boolean => /^trade\.(sol\.low|wallet\.empty)$/.test(code ?? "");

interface Rec { id: string; status: string; problem?: Problem }

export interface FeeSale<P extends { ready(): Promise<void> }, R extends Rec> {
  /** The sale's quote for the amount the person tapped. */
  quote(): Promise<P>;
  /** The sale itself, on the job's id, timed from the tap. */
  trade(p: P): Promise<R>;
  tasks: SaleTasks | undefined;
  /** The job the tap made, and when (its fee's step). */
  id: string; at: number;
  /** The fee move came back or was refused. */
  feeFailed(): boolean;
  walletName: string; back: string;
  /** The done line the open page would have said (landed-detail.ts). */
  doneDetail(r: R): string;
  /** A sale sent that no read can place yet: followed to its end by the page's own follower. */
  unconfirmed?(p: Problem, end: (r: R) => void): void;
  now?: () => number; sleep?: (ms: number) => Promise<void>; limitMs?: number; everyMs?: number;
}

/** The closed page's sale: waits for the fee, sells once, ends the job. Never two sales: it is called once, when the page
 *  closes, and only when the page's own sale had not started. */
export async function saleAfterFee<P extends { ready(): Promise<void> }, R extends Rec>(o: FeeSale<P, R>): Promise<"done" | "failed" | "following"> {
  const now = o.now ?? Date.now, sleep = o.sleep ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const until = now() + (o.limitMs ?? FEE_SALE_LIMIT_MS);
  const end = (state: "done" | "failed", detail: string) => { o.tasks?.end(o.id, state, detail); return state; };
  while (now() < until) {
    if (o.feeFailed()) return end("failed", gasEnd({ failed: true, walletName: o.walletName }).detail);
    let p: P;
    try {
      p = await o.quote();
      await p.ready();
    } catch (e) {
      // the fee still on its way (or a read that didn't answer): ask again; any other no is the job's end, said
      if (e instanceof ProblemError && !feeShort(e.problem.code)) return end("failed", e.problem.whatHappened);
      await sleep(o.everyMs ?? FEE_SALE_EVERY_MS);
      continue;
    }
    const t0 = now();
    const job = withLead(o.tasks, [{ label: gasStep(), state: "done", at: o.at }]);
    const steps = (sent: SaleStep["state"], landed: SaleStep["state"], back: SaleStep["state"], at?: number): SaleStep[] =>
      [{ label: "Sent", state: sent, at: t0 }, { label: "Landed", state: landed, ...(at ? { at } : {}) }, { label: o.back, state: back, ...(at && back === "done" ? { at } : {}) }];
    job?.update(o.id, { steps: steps("doing", "waiting", "waiting"), endsAt: saleEndsAt(t0) });
    try {
      const r = await o.trade(p);
      if (r.status === "done") { const t = now(); job?.update(o.id, { detail: o.doneDetail(r), steps: steps("done", "done", "done", t) }); return end("done", o.doneDetail(r)); }
      return end("failed", r.status === "declined" ? "You said no. Nothing was sold." : r.problem?.whatHappened ?? "It didn't go through. Nothing was sold.");
    } catch (e) {
      if (e instanceof ProblemError && e.problem.code === "trade.trade.unconfirmed" && o.unconfirmed) {
        job?.update(o.id, { detail: "Not confirmed yet", steps: steps("done", "doing", "waiting") });
        o.unconfirmed(e.problem, (r) => {
          if (r.status === "done") { const t = now(); job?.update(o.id, { detail: o.doneDetail(r), steps: steps("done", "done", "done", t) }); end("done", o.doneDetail(r)); }
          else end("failed", r.problem?.whatHappened ?? "It didn't go through.");
        });
        return "following";
      }
      return end("failed", e instanceof ProblemError ? e.problem.whatHappened : "It didn't go through. Nothing was sold.");
    }
  }
  return end("failed", `The fee didn't reach ${o.walletName} in time, so nothing was sold. Your coins are still in ${o.walletName}.`);
}
