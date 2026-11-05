// T-2 (master plan Part 1 §4; QA's GO, 3 Nov), landing 1: standing buys ("$5 of SOL every morning"), kept and run on the
// phone, beside the price orders (orders.ts) and under the same rules. QA's terms, each kept here:
// - NOTHING IS PRE-SIGNED: a plan is a rule (coin, dollars a run, daily or weekly, a weekly cap, at most 30 days). When a
//   run falls due while ZeroFee is open and on screen, the ordinary buy runs then (`run`: Trade's own quote and trade:
//   inside Trade's session caps, or the core's sheet).
// - A MISSED RUN ASKS ONCE AND NEVER CATCHES UP: a run that fell due while ZeroFee was closed or hidden is never made by
//   itself; the plan asks once ("Your $5.00 SOL buy was due while ZeroFee was closed. Buy now?") and moves on to its next
//   time. However many were missed, there is one ask, never a pile of buys.
// - A FAILURE PAUSES the plan, with its words (never a retry loop); a "no" on the sheet skips that run only.
// - THE WEEKLY CAP HOLDS ACROSS TABS: each run is written to the store, under the store's lock and on the store as it is
//   now, before it trades; the cap counts every run of the last 7 days that went or may have gone.
// - ONE CAP FOR ALL PLANS (QA, 3 Nov): every plan's own weekly cap multiplied with the number of plans, so all standing
//   buys together spend at most ALL_WEEK_CAP_USD ($100) in any 7 days, every plan's runs counted (paused, cancelled and
//   ended ones' too). Checked in the same claim, under the same store lock, on the store as it is now.
// - Plans cancelled or ended more than 7 days ago (and with no run in the last 7 days) are dropped from the store at its
//   next change: they can't count toward any week any more.
// - The store is the truth and a damaged one is kept aside, never overwritten (as orders.ts); one run per due time across
//   every tab (its own lock, ifAvailable).
import { NOT_RUN, type OrderBookDeps } from "./orders.ts";
import type { ChainId } from "./types.ts";

const DAY = 86_400_000;
export const PLAN_MAX_DAYS = 30;
export const RUN_MIN_USD = 1, RUN_MAX_USD = 50, WEEK_CAP_MAX_USD = 100;
/** The most all standing buys together spend in any 7 days. */
export const ALL_WEEK_CAP_USD = 100;
export const ALL_CAP_LINE = `All your repeat buys: up to $${ALL_WEEK_CAP_USD} a week.`;
export const ALL_CAP_NOTE = `All your repeat buys reached $${ALL_WEEK_CAP_USD} this week, so this run was skipped.`;
/** A plan cancelled or ended this long ago, with no run since, is dropped from the store. */
const KEEP_CLOSED_MS = 7 * DAY;
export const PLAN_RUNS_LINE = "Runs while ZeroFee is open, and the next time you open it.";
export const PLANS_DAMAGED_LINE = "Your repeat buys couldn't be read. None will run until you set them again.";
/** A due run is made by itself only within this long of its time (a later look is a missed run: it asks). */
const DUE_WINDOW_MS = 10 * 60_000;

export type Every = "day" | "week";
export interface PlanRun { at: number; usd: number; status: "running" | "done" | "skipped" | "failed"; recordId?: string }
export interface StandingPlan {
  id: string; chain: ChainId; coin: string; symbol: string; usd: number; every: Every; weekCapUsd: number;
  madeAt: number; endsAt: number; nextAt: number; status: "on" | "paused" | "cancelled" | "ended";
  /** When it was cancelled or ended (older plans without it: their end, or their last run, whichever is later). */
  closedAt?: number;
  note?: string; runs: PlanRun[];
  /** A run that fell due while ZeroFee was closed: asked once, never made by itself. */
  missed?: { dueAt: number };
}

export const missedLine = (p: Pick<StandingPlan, "usd" | "symbol">) => `Your $${p.usd.toFixed(2)} ${p.symbol} buy was due while ZeroFee was closed. Buy now?`;
const period = (e: Every) => (e === "day" ? DAY : 7 * DAY);
/** The plan's first time after `t` (its own rhythm from when it was made). */
export const nextAfter = (p: Pick<StandingPlan, "madeAt" | "every">, t: number) => p.madeAt + (Math.floor((t - p.madeAt) / period(p.every)) + 1) * period(p.every);
/** What the last 7 days' runs that went (or may have gone: running, or failed after the buy may have left) spent. */
/** What all the plans' runs of the last 7 days spent (the same count as weekSpent, over every plan). */
export const allWeekSpent = (ps: Pick<StandingPlan, "runs">[], t: number) => ps.reduce((n, p) => n + weekSpent(p, t), 0);
/** A cancelled or ended plan past its 7 days, with no run in them: nothing it did counts any more. */
export function droppable(p: StandingPlan, t: number): boolean {
  if (p.status !== "cancelled" && p.status !== "ended") return false;
  const lastRun = p.runs.reduce((m, r) => Math.max(m, r.at), 0);
  const closed = p.closedAt ?? (p.status === "ended" ? Math.max(p.endsAt, lastRun) : Math.max(p.madeAt, lastRun));
  return t - closed >= KEEP_CLOSED_MS && t - lastRun >= KEEP_CLOSED_MS && !p.runs.some((r) => r.status === "running");
}
export const weekSpent = (p: Pick<StandingPlan, "runs">, t: number) => p.runs.filter((r) => t - r.at < 7 * DAY && (r.status === "done" || r.status === "running" || r.status === "failed")).reduce((n, r) => n + r.usd, 0);

/** Why a new plan can't be kept, in plain words, or null. */
export function planRefusal(p: Pick<StandingPlan, "usd" | "weekCapUsd" | "every">, days: number): string | null {
  if (!(Number.isFinite(p.usd) && p.usd >= RUN_MIN_USD && p.usd <= RUN_MAX_USD)) return `Each buy is $${RUN_MIN_USD} to $${RUN_MAX_USD}.`;
  if (p.every !== "day" && p.every !== "week") return "Pick every day or every week.";
  if (!(Number.isFinite(p.weekCapUsd) && p.weekCapUsd >= p.usd && p.weekCapUsd <= WEEK_CAP_MAX_USD)) return `The most a week can be one buy, up to $${WEEK_CAP_MAX_USD}.`;
  if (!(Number.isInteger(days) && days >= 1 && days <= PLAN_MAX_DAYS)) return `A plan lasts 1 to ${PLAN_MAX_DAYS} days.`;
  return null;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function readPlan(x: any): StandingPlan | null {
  if (!x || typeof x !== "object" || typeof x.id !== "string" || !x.id || typeof x.chain !== "string" || typeof x.coin !== "string" || typeof x.symbol !== "string") return null;
  if (x.every !== "day" && x.every !== "week") return null;
  if (!["on", "paused", "cancelled", "ended"].includes(x.status) || !Array.isArray(x.runs)) return null;
  if (!num(x.madeAt) || !num(x.endsAt) || !num(x.nextAt) || x.endsAt <= x.madeAt || x.endsAt - x.madeAt > PLAN_MAX_DAYS * DAY) return null;
  if (planRefusal(x, 1) !== null) return null;
  if (x.runs.length > 30 || !x.runs.every((r: any) => r && num(r.at) && num(r.usd) && r.usd >= 0 && r.usd <= RUN_MAX_USD && ["running", "done", "skipped", "failed"].includes(r.status))) return null;
  if (x.missed !== undefined && !(x.missed && num(x.missed.dueAt))) return null;
  if (x.closedAt !== undefined && !num(x.closedAt)) return null;
  return x as StandingPlan;
}

export type StandingDeps = Omit<OrderBookDeps, "price" | "run"> & { run(p: StandingPlan, usd: number): Promise<Exclude<Awaited<ReturnType<OrderBookDeps["run"]>>, "none-held">>; allWeekCapUsd?: number };

export function createStandingBook(d: StandingDeps) {
  const now = d.now ?? Date.now;
  const allCap = d.allWeekCapUsd ?? ALL_WEEK_CAP_USD;
  const lock = <T>(name: string, ifAvailable: boolean, fn: () => Promise<T>): Promise<T | typeof NOT_RUN> => (d.lock ? d.lock(name, ifAvailable, fn) : fn());
  let plans: StandingPlan[] = [];
  let loaded = false, damaged = false, aside: string | null = null, asideKept = true;
  /** Plans looked at in this on-screen visit, and when: a due time between two looks of the same visit is "due while open". */
  const seen = new Map<string, { visit: number; at: number }>();
  let epoch = 0, ticking = false;
  /** Plans whose last run's end couldn't be written: never run again by this copy. */
  const halted = new Set<string>();
  /** Plans this copy is buying for now (a run "running" here is never an orphan, lock or no lock). */
  const buying = new Set<string>();
  const inflight = new Set<Promise<void>>();
  let queue: Promise<void> = Promise.resolve();
  const one = <T>(f: () => Promise<T> | T): Promise<T> => { const r = queue.then(f); queue = r.then(() => undefined, () => undefined); return r; };

  async function reload(): Promise<void> {
    const raw = await d.load();
    let parsed: unknown = [];
    let bad = false;
    try { parsed = raw ? JSON.parse(raw) : []; } catch { bad = true; }
    if (!Array.isArray(parsed)) bad = true;
    const ids = new Set<string>();
    const list = (Array.isArray(parsed) ? parsed : []).map(readPlan).filter((p): p is StandingPlan => !!p && !ids.has(p.id) && !!ids.add(p.id));
    if (Array.isArray(parsed) && list.length !== parsed.length) bad = true;
    if (bad && raw) {
      damaged = true; plans = [];
      if (raw !== aside) { try { if (!d.keepAside) throw new Error("nowhere"); await d.keepAside(raw); aside = raw; asideKept = true; } catch { asideKept = false; } }
    } else { damaged = false; plans = list; }
    loaded = true;
  }
  const save = () => (damaged ? Promise.resolve() : d.save(JSON.stringify(plans)));
  const change = <T>(f: () => Promise<T> | T): Promise<T | typeof NOT_RUN> => one(() => lock("zf-standing-store", false, async () => {
    await reload();
    try {
      const r = await f();
      if (!damaged) { const t = now(); plans = plans.filter((p) => !droppable(p, t)); } // closed past 7 days: dropped
      await save(); return r;
    } catch (e) { loaded = false; throw e; }
  }));
  const fresh = (id: string) => plans.find((p) => p.id === id);
  const ready = async () => { if (!loaded) await one(() => lock("zf-standing-store", false, reload)); return plans; };

  /** One run of plan `id` for due time `dueAt`, once across every tab: claimed on the store (still on, still due then or
   *  asked for, inside the weekly cap) and written as running before the buy; the end written after. */
  function runOnce(id: string, dueAt: number, asked: boolean, visit?: number): Promise<void> {
    const p = (async () => {
      await lock(`zf-standing-${id}-${dueAt}`, true, () => lock(`zf-standing-${id}-busy`, true, async () => {
        let take: { plan: StandingPlan; usd: number } | undefined;
        const claimed = await change(() => {
          if (visit !== undefined && visit !== epoch) return false;
          const pl = fresh(id);
          if (!pl || pl.status !== "on" || now() >= pl.endsAt) return false; // ended: never a buy after its time (review L3)
          if (asked ? pl.missed?.dueAt !== dueAt : pl.nextAt !== dueAt) return false; // another tab made (or skipped) it
          if (asked) delete pl.missed; else pl.nextAt = nextAfter(pl, now());
          // all plans together first (QA, 3 Nov), on the store as it is now, under its lock: two tabs, two plans, one cap
          if (allWeekSpent(plans, now()) + pl.usd > allCap + 1e-9) { pl.runs = [...pl.runs, { at: now(), usd: pl.usd, status: "skipped" as const }].slice(-30); pl.note = ALL_CAP_NOTE; return false; }
          if (weekSpent(pl, now()) + pl.usd > pl.weekCapUsd + 1e-9) { pl.runs = [...pl.runs, { at: now(), usd: pl.usd, status: "skipped" as const }].slice(-30); pl.note = "This week's most is spent, so this buy was skipped."; return false; }
          pl.runs = [...pl.runs, { at: now(), usd: pl.usd, status: "running" as const }].slice(-30);
          delete pl.note;
          take = { plan: { ...pl }, usd: pl.usd };
          return true;
        }).catch(() => false); // a claim that wasn't saved is no claim: nothing buys (review H1)
        if (claimed !== true || !take) return;
        buying.add(id);
        const at = take.plan.runs[take.plan.runs.length - 1]!.at;
        let end: Partial<PlanRun>, pause: string | undefined;
        try {
          const r = await d.run(take.plan, take.usd);
          end = r === "declined" ? { status: "skipped" } : { status: "done", recordId: r.recordId };
        } catch (e) {
          end = { status: "failed" };
          pause = `Paused: ${String((e as { problem?: { whatHappened?: string } })?.problem?.whatHappened ?? "the buy didn't go").slice(0, 160)}`;
        }
        const write = () => change(() => {
          const pl = fresh(id);
          const run = pl?.runs.find((r) => r.at === at && r.status === "running");
          if (!pl || !run) return;
          Object.assign(run, end);
          if (pause && pl.status === "on") Object.assign(pl, { status: "paused", note: pause }); // a failure pauses (QA)
        });
        // the end not written: once more, then this copy runs the plan no more (its "running" row asks for Activity on the
        // next look of any copy: review M2)
        await write().catch(() => write()).catch(() => void halted.add(id));
        buying.delete(id);
      }));
    })().catch(() => undefined);
    inflight.add(p);
    void p.finally(() => inflight.delete(p));
    return p;
  }

  return {
    damaged: (): boolean => damaged,
    async list(): Promise<StandingPlan[]> { await ready(); return plans.map((p) => ({ ...p, runs: [...p.runs] })).sort((a, b) => b.madeAt - a.madeAt); },
    async add(p: Pick<StandingPlan, "chain" | "coin" | "symbol" | "usd" | "every" | "weekCapUsd">, days: number): Promise<StandingPlan> {
      await ready();
      const why = planRefusal(p, days);
      if (why) throw new Error(why);
      const made = await change(() => {
        if (damaged && !asideKept) throw new Error("Your old price orders (repeat buys) couldn't be backed up, so a new one can't be saved yet.");
        damaged = false;
        const t = now();
        const pl: StandingPlan = { ...p, id: d.newId?.() ?? `s${t.toString(36)}${Math.random().toString(36).slice(2, 8)}`, madeAt: t, endsAt: t + days * DAY, nextAt: t + period(p.every), status: "on", runs: [] };
        plans.push(pl);
        seen.set(pl.id, { visit: epoch, at: t });
        return pl;
      });
      if (made === NOT_RUN) throw new Error("The plan wasn't made. Try again.");
      return made;
    },
    async setStatus(id: string, status: "on" | "paused" | "cancelled"): Promise<boolean> {
      const r = await change(() => {
        const pl = fresh(id);
        if (!pl || pl.status === "cancelled" || pl.status === "ended") return false;
        if (status === "on" && pl.status === "paused") { pl.nextAt = nextAfter(pl, now()); delete pl.note; seen.delete(id); halted.delete(id); } // never makes up the paused runs; the person's own turn-on clears a halt
        pl.status = status;
        if (status === "cancelled") pl.closedAt = now();
        return true;
      });
      return r === true;
    },
    /** One look while Trade is on screen. A run due since the last look of this visit is made; one due before it (ZeroFee
     *  closed or hidden) is asked about once, and the plan moves on to its next time. */
    async tick(): Promise<void> {
      if (ticking) return;
      ticking = true;
      const visit = epoch;
      try {
        await one(() => lock("zf-standing-store", false, reload));
        for (const snap of plans.map((p) => ({ ...p }))) {
          const id = snap.id, t = now(), look = seen.get(id);
          seen.set(id, { visit, at: t });
          // a run left "running" with nobody holding its lock (ZeroFee closed while it bought): it may or may not have gone;
          // the plan pauses and says to check Activity (it still counts toward the week: review M2)
          for (const r of buying.has(id) ? [] : snap.runs.filter((x) => x.status === "running")) {
            const due = r.at;
            await lock(`zf-standing-${id}-orphan-${due}`, true, async () => {
              const busy = await lock(`zf-standing-${id}-busy`, true, async () => true);
              if (busy === NOT_RUN) return; // this or another copy is buying it now
              await change(() => { const pl = fresh(id); const run = pl?.runs.find((x) => x.at === due && x.status === "running"); if (!pl || !run) return; run.status = "failed"; if (pl.status === "on") Object.assign(pl, { status: "paused", note: "Paused: ZeroFee closed while it bought. Check Activity before turning it on." }); });
            });
          }
          if (snap.status !== "on" || halted.has(id)) continue;
          if (t >= snap.endsAt) { await change(() => { const pl = fresh(id); if (pl?.status === "on") Object.assign(pl, { status: "ended", note: "Its time ran out.", closedAt: now() }); }); continue; }
          if (t < snap.nextAt) continue;
          const dueWhileOpen = look !== undefined && look.visit === visit && look.at < snap.nextAt && t - snap.nextAt <= DUE_WINDOW_MS;
          if (dueWhileOpen) void runOnce(id, snap.nextAt, false, visit);
          else await change(() => { const pl = fresh(id); if (pl?.status === "on" && pl.nextAt === snap.nextAt) { pl.missed = { dueAt: pl.nextAt }; pl.nextAt = nextAfter(pl, now()); } });
        }
      } finally {
        ticking = false;
      }
    },
    pause(): void { epoch++; seen.clear(); },
    /** The person's tap on the ask: buy now (once, inside the weekly cap and Trade's caps or the sheet). */
    async runMissed(id: string): Promise<void> { const pl = (await ready()).find((p) => p.id === id); if (pl?.missed) await runOnce(id, pl.missed.dueAt, true); },
    async skipMissed(id: string): Promise<void> { await change(() => { const pl = fresh(id); if (pl) delete pl.missed; }); },
    async settled(): Promise<void> { while (inflight.size) await Promise.all([...inflight]); },
  };
}
export type StandingBook = ReturnType<typeof createStandingBook>;

/** The plan's buy, through Trade's own service (the same quote and trade as a tap on Buy; D143: no sheet, the core
 *  signs it or refuses it, named). Anything but done or declined is a failure (it pauses the plan); one that went but isn't finished is
 *  done with Activity following it. */
export function standingRunner(svc: { quote(side: "buy", chain: ChainId, coin: string, amount: { usd: number }): Promise<unknown>; trade(p: never, origin?: string): Promise<{ id: string; status: string; problem?: { whatHappened: string } }> }): StandingDeps["run"] {
  return async (p, usd) => {
    const rec = await svc.trade((await svc.quote("buy", p.chain, p.coin, { usd })) as never, `standing:${p.id}`);
    if (rec.status === "declined") return "declined";
    if (rec.status === "failed" || rec.status === "expired") throw { problem: rec.problem ?? { whatHappened: "The buy didn't go. Nothing was traded." } };
    return { recordId: rec.id };
  };
}
