// The plan runner (phone test, 3 Nov: a plan opened Move, the tester approved it, and AgentZero forgot step 2). A plan's
// next step is gated by the money being there, not by "landed": a Safe → SOL or ETH (RH) wallet Move is two legs and
// AgentZero can't read the onward one, so it waited for a landing it could never see. And the card that heard the end
// lived in the chat screen, which can go away while the person approves in Home's sheet.
//
// So the runner lives outside the screen (one per bridge, for the app's life). When a step's sheet says it went, the
// runner says one line and reads the wallet the next step pays from (every few seconds, only while the page is in
// sight, backing off when a read fails). The moment that wallet covers the next step, it opens its card itself (no model
// call), once. Past ten minutes it says so, with Check again and Stop the plan; never silent. Each change goes to the
// chat on screen, or, with no chat on screen, straight into that chat's saved state, so coming back shows where it is.
// Pure apart from the timer and the reads it is handed: node tests it.
import { fit, fundsArrived, fundsLate, live, needOf, stepEnded, waitForFunds, type Balances, type Plan, type PlanMove, type PlanTag, type StepEnd, type TaggedSheet } from "./plan.ts";

/** What the runner tells the chat: the plan as it now is, ZeroFee's line, a step's card, or the late card. */
export interface RunnerMove {
  plan: Plan;
  line?: string;
  sheet?: TaggedSheet;
  /** Waited past the limit: Check again and Stop the plan. */
  late?: true;
}
export interface RunnerDeps {
  balances(): Promise<Balances | null>;
  apply(chatId: string, m: RunnerMove): void;
  now?(): number;
  /** the page is in sight (no reads while the phone is locked or another app is up) */
  visible?(): boolean;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(t: unknown): void;
}
export const POLL_MS = 5_000;
export const WAIT_MAX_MS = 10 * 60_000;
const BACKOFF_MAX_MS = 60_000;

export function planRunner(d: RunnerDeps) {
  const now = d.now ?? Date.now;
  const visible = d.visible ?? (() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const setTimer = d.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = d.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const watching = new Map<string, { plan: Plan; timer: unknown; delay: number }>();

  const stopWatch = (chatId: string) => {
    const w = watching.get(chatId);
    if (w?.timer !== undefined) clearTimer(w.timer);
    watching.delete(chatId);
  };
  const tell = (chatId: string, m: RunnerMove) => {
    if (watching.has(chatId)) watching.get(chatId)!.plan = m.plan;
    d.apply(chatId, m);
  };

  /** One look at the wallet the waiting step pays from: open it if covered, say so if late, else look again. */
  async function look(chatId: string): Promise<void> {
    const w = watching.get(chatId);
    if (!w) return;
    const p = w.plan;
    if (!live(p) || p.wait === undefined) return stopWatch(chatId);
    if (p.late) return; // waits for Check again or Stop
    if (!visible()) return void (w.timer = setTimer(() => void look(chatId), w.delay));
    const bal = await d.balances().catch(() => null);
    const cur = watching.get(chatId);
    if (cur !== w || w.plan !== p) return; // stopped, checked again or moved on meanwhile
    const sheet = p.steps[p.at]?.sheet;
    const need = needOf(p);
    // a read that failed is no answer: look again later, slower
    if (!bal || !sheet) w.delay = Math.min(BACKOFF_MAX_MS, w.delay * 2);
    else {
      w.delay = POLL_MS;
      if (fit(sheet, bal).kind === "ok") {
        const m = fundsArrived(p, need ? bal[need.place as keyof Balances] ?? null : null);
        stopWatch(chatId);
        if (m) d.apply(chatId, { plan: m.plan, line: m.line, ...(m.sheet ? { sheet: m.sheet } : {}) });
        return;
      }
    }
    if (now() - p.wait >= WAIT_MAX_MS) {
      const l = fundsLate(p);
      return tell(chatId, { plan: l.plan, line: l.line, late: true });
    }
    w.timer = setTimer(() => void look(chatId), w.delay);
  }
  const watch = (chatId: string, plan: Plan) => {
    stopWatch(chatId);
    watching.set(chatId, { plan, timer: undefined, delay: POLL_MS });
    void look(chatId);
  };

  return {
    /** The plan the runner holds for this chat while it waits (newer than any saved copy), or null. */
    plan: (chatId: string): Plan | null => watching.get(chatId)?.plan ?? null,
    /**
     * A step's sheet ended. Went or landed with a sheet step next: that step waits for its money (said once) and the
     * runner watches; anything else is the plan's own move (plan.ts stepEnded), returned for the chat to show.
     */
    ended(chatId: string, plan: Plan, tag: PlanTag, end: StepEnd): PlanMove | null {
      const m = stepEnded(plan, tag.step, end);
      if (!m) return null;
      if ((end.kind === "went" || end.kind === "landed") && m.sheet) {
        const w = waitForFunds(m.plan, now());
        d.apply(chatId, { plan: w.plan, line: w.line });
        watch(chatId, w.plan);
        return null;
      }
      return m;
    },
    /** A chat opened again (a reload, or back to the tab): a plan saved while it waited is watched again. */
    resume(chatId: string, plan: Plan | null): void {
      if (plan && live(plan) && plan.wait !== undefined && !plan.late && !watching.has(chatId)) watch(chatId, plan);
    },
    /** Check again (after the late line): the wait starts over. */
    check(chatId: string, plan: Plan): void {
      if (!live(plan) || plan.wait === undefined) return;
      const q: Plan = { ...plan, wait: now() };
      delete q.late;
      tell(chatId, { plan: q, line: "Checking again." });
      watch(chatId, q);
    },
    /** Stop the plan: no more reads, nothing else opens. */
    stop(chatId: string): void {
      stopWatch(chatId);
    },
  };
}
export type PlanRunner = ReturnType<typeof planRunner>;
