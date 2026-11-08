// AgentZero's own browser (D79, BR1–BR3): the task it's sent with, the live view's state (AgentZero acting, or the
// person's turn), and every line on its chip. Pure: no network. The lines are ZeroFee's own, written per step, never by
// the model. AgentZero never makes an account, never types a password or card number the person gave it, never pays and
// never trades here (D79, D80; trades live in Trade, the 2 s rule). The cloud browser itself is behind `CloudBrowser`.
import { siteUrl } from "../sites.ts";

export { AGENT_BROWSER, LIVE_ORIGINS } from "./flag.ts";

/**
 * The live view's frame address, or null (audit L30): the server gives it, so only an https address on one of the
 * cloud browser's own origins, with no user name or password in it, is shown; anything else shows no page at all.
 */
export function liveFrameUrl(url: string | null | undefined, allowed: readonly string[]): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  return allowed.includes(u.origin) ? u.href : null;
}

/** Why the page needs the person. */
/** M17: stuck (the page didn't change after 3 tries), refused (the site said no), limit (the task's step limit). */
/** b18: steered (the page gave AgentZero orders), leaves (a link to another site). */
export type NeedsYou = "sign-in" | "person-check" | "code" | "terms" | "create-account" | "money" | "stuck" | "refused" | "limit" | "steered" | "leaves";

/** What AgentZero's cloud browser reports (read from Browser Use's own session, never the model's words). */
export type CloudEvent =
  | { kind: "at"; host: string }
  /** M15: each step in a few words, from AgentZero's own action, never the page's words. */
  | { kind: "step"; line: string; host: string }
  /** audit 17's H9: `usd`, the total the page itself says ("$12.00"), on a page that takes payment. */
  | { kind: "needs-you"; why: NeedsYou; host: string; usd?: string }
  /** E3: `summary`, AgentZero's own reading of the page when it finished (checked, at most 300 characters). Audit 17's
   *  H8: `missed`, it ended without finding what was asked (its summary says what it didn't find). */
  | { kind: "done"; host: string; summary?: string; missed?: true }
  /** M10: the page went to another site on its own; AgentZero works on the task's one site, so it stopped. */
  | { kind: "left"; host: string }
  /** `line`: why it stopped, in ZeroFee's words (a step that timed out, AgentZero's email not on yet). */
  | { kind: "failed"; host: string | null; line?: string };

/** The cloud browser, through the relay (the key never ships in the app). The live-view URL is a bearer secret: shown
 *  only in the view's own frame, never logged, never in a receipt. */
export interface CloudBrowser {
  start(task: string, url: string | null): Promise<{ id: string; liveUrl: string }>;
  /** Read-only (AgentZero acting) or touchable (the person's turn). */
  setInteractive(id: string, on: boolean): Promise<void>;
  stop(id: string): Promise<void>;
  /** Its events, until it's stopped. Returns the unsubscribe. */
  events(id: string, on: (e: CloudEvent) => void): () => void;
  /** Audit 17's H6: a whole run's time as this browser measures it (the Sim's own pace), the first frame's guess before
   *  this device has finished a run of its own; none: the typical run (TYPICAL_STEPS x STEP_GUESS_MS). */
  runGuessMs?: number;
}

/** A start that failed with ZeroFee's own line (only these are shown; any other error keeps the plain line). */
export class SaidLine extends Error {}

/** E5 (audit 14): one clock for a run, from the first frame. `at`: the Start tap; `endsAt`: when it should be done (the
 *  Activity row counts down to the same figure); `endedAt`: when it ended. Set by liveSession, none in liveStep. */
/** Audit 17's H6: `opened`, the run reached its site; `paid`, it came to a page that takes payment (the person's turn). */
export type RunClock = { at?: number; endsAt?: number; endedAt?: number; opened?: true; paid?: true };
export type Live = RunClock & (
  | { phase: "idle" }
  | { phase: "starting"; host: string | null }
  | { phase: "agent"; host: string; steps?: string[] }
  | { phase: "you"; host: string; why: NeedsYou | "took-over"; usd?: string }
  /** `done`: it finished the task (its report in `summary`); `stopped`: the person's Stop (H7); `missed`: it ended without
   *  finding it (H8); else it failed with `line`. */
  | { phase: "ended"; line: string; done?: true; summary?: string; stopped?: true; missed?: true });

/** E3: a run that finished its task. */
export const doneLine = (host: string) => `AgentZero is done on ${host}.`;
/** E5: said at Start and while it works (an iPhone pauses a page in the back; leaving the screen ends the run). */
export const KEEP_OPEN_LINE = "Keep this screen open while AgentZero works.";
/** E5: a run that was going when ZeroFee closed (a reload, the app shut): its Activity row ends with this. */
export const CLOSED_LINE = "ZeroFee closed, so AgentZero stopped. It did nothing more.";
/** E5: steps a run takes as a rule (audit 14's bar: a 10-step run in 60 s), and one step's time before any is measured. */
export const TYPICAL_STEPS = 10;
export const STEP_GUESS_MS = 6_000;
const medianOf = (xs: readonly number[]): number | undefined => {
  const sorted = xs.filter((m) => Number.isFinite(m) && m > 0).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : undefined;
};
/**
 * E5 + audit 17's H6 (the measured-legs rule of Move's clock, builders 7 and 12): when a run should be done. The runs this
 * device finished before (`pastMs`, each start to end, from Activity's rows): their median from the Start tap (`at`);
 * once past it, one more of its own steps from now (a second before any is measured). None before: the steps still to go
 * (the typical run's, never under 2 while it works, never over its limit) times its own median step; none measured yet,
 * STEP_GUESS_MS a step (the first frame of a first run is the only set figure; its first step corrects it). Pure.
 */
export function runEndsAt(now: number, stepMs: readonly number[], done: number, maxSteps = 40, pastMs: readonly number[] = [], at = now): number {
  const own = medianOf(stepMs), past = medianOf(pastMs);
  const left = Math.min(Math.max(TYPICAL_STEPS - done, 2), Math.max(maxSteps - done, 1));
  // runs measured before: their median from the Start tap; past it, one more of its own steps (a second before any)
  if (past !== undefined) return Math.max(at + past, now + (own ?? 1_000));
  if (own !== undefined) return now + left * own;
  return now + left * STEP_GUESS_MS;
}

/** Audit 17's H6: a run's plan, said from its first frame, each step ticking on the run's own events (rule 11). */
export type PlanStep = { label: string; state: "waiting" | "doing" | "done" | "failed" | "you" };
export const PLAN_WORDS = {
  open: (host: string | null) => `Open ${host ?? "the site"}`,
  find: "Find what you asked",
  pay: "Your turn to pay",
  tell: "Tell you what it found",
} as const;
export function runPlan(s: Live, host: string | null): PlanStep[] {
  if (s.phase === "idle") return [];
  const where = s.phase === "agent" || s.phase === "you" || s.phase === "starting" ? (s.host ?? host) : host;
  const paid = !!s.paid || (s.phase === "you" && s.why === "money");
  const opened = !!s.opened || s.phase === "agent" || s.phase === "you";
  // what each step is now: open, find, (pay), tell
  let open: PlanStep["state"], find: PlanStep["state"], pay: PlanStep["state"] = "waiting", tell: PlanStep["state"] = "waiting";
  if (s.phase === "starting") (open = "doing"), (find = "waiting");
  else if (s.phase === "agent") (open = "done"), (find = paid ? "done" : "doing"), (pay = paid ? "done" : "waiting");
  else if (s.phase === "you") (open = "done"), s.why === "money" ? ((find = "done"), (pay = "you")) : ((find = "you"), (pay = paid ? "done" : "waiting"));
  else if (s.done) (open = "done"), (find = "done"), (pay = "done"), (tell = "done");
  else {
    // stopped, missed or failed: what was done stays done, the step it ended on says so, the rest never ran
    open = opened ? "done" : "failed";
    find = !opened ? "waiting" : paid ? "done" : "failed";
    pay = paid ? "failed" : "waiting";
    if (s.missed) (find = "failed"), (tell = "done");
  }
  return [
    { label: PLAN_WORDS.open(where), state: open },
    { label: PLAN_WORDS.find, state: find },
    ...(paid ? [{ label: PLAN_WORDS.pay, state: pay }] : []),
    { label: PLAN_WORDS.tell, state: tell },
  ];
}

/** Audit 17's H7: a Stop says what was done and what was not, by the run's own place (never "Nothing was sent." on a
 *  browse: nothing is sent there). */
export function stopLine(s: Live): string {
  // audit 18's I9 (builder 22's item 15): short sentences, one idea each, at grade 5; the site named once, where the
  // person's next step is (paying there), the card's title names it otherwise
  if (s.phase === "starting" || s.phase === "idle") return STOP_WORDS.before;
  if (s.phase === "you" && s.why === "money") return STOP_WORDS.payThere(s.host);
  if (s.phase === "agent" || s.phase === "you") return STOP_WORDS.read;
  return "Stopped.";
}
export const STOP_WORDS = {
  before: "Stopped. AgentZero did not open the site. It did nothing there.",
  read: "Stopped. AgentZero read the page. It did nothing else.",
  payThere: (host: string) => `Stopped. Nothing was paid. You can pay on ${host}.`,
} as const;
/** Audit 17's H8: a run that ended without finding it, in its own words, else this. */
export const missLine = (host: string) => `AgentZero didn't find that on ${host}.`;

/** M10's line when the page itself goes to another site. */
export const leftLine = (host: string) => `The page left ${host}, so AgentZero stopped. Nothing was sent.`;

export type LiveAction =
  | { type: "start"; host: string | null }
  | { type: "event"; e: CloudEvent }
  | { type: "take-over" }
  | { type: "hand-back" }
  | { type: "stop" };

/** The next state. While it's the person's turn, AgentZero is paused: its events wait (only a failure or Stop ends it). */
export function liveStep(s: Live, a: LiveAction): Live {
  if (s.phase === "ended") return s;
  if (a.type === "stop") return s.phase === "idle" ? s : { phase: "ended", line: stopLine(s), stopped: true };
  if (a.type === "start") return s.phase === "idle" ? { phase: "starting", host: a.host } : s;
  if (a.type === "take-over") return s.phase === "agent" ? { phase: "you", host: s.host, why: "took-over" } : s;
  if (a.type === "hand-back") return s.phase === "you" ? { phase: "agent", host: s.host } : s;
  const e = a.e;
  if (e.kind === "failed") return { phase: "ended", line: e.line ?? `${e.host ?? "The page"} didn't open. Nothing was sent.` };
  if (e.kind === "left") return { phase: "ended", line: leftLine(e.host) };
  // the person took over: AgentZero waits for Hand back. The host's own turn (a sign-in, a bot check) ends with its
  // Continue (the run's "at" again) or the run's end (E3: a report after the person's turn still shows)
  if (s.phase === "idle" || (s.phase === "you" && s.why === "took-over")) return s;
  if (e.kind === "step") return s.phase === "agent" ? { ...s, steps: [...(s.steps ?? []), e.line].slice(-5) } : s;
  if (e.kind === "at") return s.phase === "agent" && s.host === e.host ? s : { phase: "agent", host: e.host };
  if (e.kind === "needs-you") return { phase: "you", host: e.host, why: e.why, ...(e.why === "money" && e.usd ? { usd: e.usd } : {}) };
  if (e.missed) return { phase: "ended", line: e.summary || missLine(e.host), missed: true };
  return { phase: "ended", line: doneLine(e.host), done: true, ...(e.summary ? { summary: e.summary } : {}) };
}

/** The chip's one line, present tense. */
export function liveLine(s: Live): string {
  switch (s.phase) {
    case "idle":
      return "";
    case "starting":
      return s.host ? `AgentZero is opening ${s.host}.` : "AgentZero is starting its browser.";
    case "agent":
      return `AgentZero is on ${s.host}.`;
    case "ended":
      return s.line;
    case "you":
      return {
        "took-over": "You have the wheel. AgentZero waits.",
        "sign-in": "AgentZero can't sign in for you here. Sign in, then tap Hand back.",
        "person-check": `${s.host} wants to check you're a person. Tap the box.`,
        code: `${s.host} sent a code. Type it.`,
        terms: `${s.host} wants you to agree to its rules. Read, then tap Agree.`,
        "create-account": `Make an account on ${s.host}? Tap Create. AgentZero waits.`,
        // audit 17's H9: what to tap, the page's own figure once ("Tap Watch to pay $12.00 yourself, or Stop.")
        money: `${s.host} asks for money. AgentZero never pays. Tap Watch to pay ${s.usd ?? "there"} yourself, or Stop.`,
        stuck: "The page didn't change after 3 tries. It's yours.",
        refused: `${s.host} refused AgentZero. It's yours.`,
        limit: "AgentZero stopped at its step limit. It's yours.",
        steered: `${s.host} tries to tell AgentZero what to do. This step is yours.`,
        leaves: `That link leaves ${s.host}. It's yours to open.`,
      }[s.why];
  }
}

/** The person's turn: the page is touchable and AgentZero takes no screenshots (the brief's hand-over moment). */
export const touchable = (s: Live): boolean => s.phase === "you";

const MONEY = /\b(buy|sell|trade|swap|pay|send (money|\$|\d)|transfer|withdraw|deposit)\b/i;
const SIGN_UP = /\b(sign ?up|create (an |a )?account|register|make (an |a )?account)\b/i;
const SECRET = /\b(password|passcode|pin|cvv|cvc)\b|(?:\d[ -]?){13,19}/i;
export const NEVER_HERE = "AgentZero reads sites for you. It never pays or trades there.";

/**
 * "Send AgentZero": the task as typed, and the site it names (https only, the host shown plainly). Refused by name:
 * a money step, an account to make (the person makes it), a password or card number typed in.
 */
export function readTask(text: unknown): { ok: true; task: string; url: string | null; host: string | null } | { ok: false; line: string } {
  const task = typeof text === "string" ? text.trim() : "";
  if (!task) return { ok: false, line: "Say what AgentZero should do." };
  if (task.length > 300) return { ok: false, line: "Say it in fewer words." };
  const word = task.split(/\s+/).find((w) => /\.[a-z]{2,}/i.test(w) || /^https?:/i.test(w)) ?? null;
  // The words, without the site's own address (axiom.trade isn't a trade).
  const words = word ? task.replace(word, " ") : task;
  if (SECRET.test(task)) return { ok: false, line: "Don't type a password or card number here. AgentZero never types them for you." };
  if (MONEY.test(words)) return { ok: false, line: NEVER_HERE };
  if (SIGN_UP.test(words)) return { ok: false, line: "You make the account yourself. Send AgentZero once it's made." };
  if (!word) return { ok: true, task, url: null, host: null };
  const r = siteUrl(word);
  if ("url" in r) return { ok: true, task, url: r.url, host: new URL(r.url).host };
  return { ok: false, line: r.problem === "insecure" ? "AgentZero opens https sites only." : `${word} isn't a site's address.` };
}

/**
 * One live session over a CloudBrowser: start, the person's turn (Take over / Hand back), Stop. The view is read-only
 * except on the person's turn. The live-view URL goes only to `onLiveUrl` (the view's frame).
 */
export function liveSession(cloud: CloudBrowser, onState: (s: Live) => void, onLiveUrl: (url: string) => void, o: { now?: () => number; /** H6: the runs this device finished before, start to end (ms) */ pastMs?: () => readonly number[] } = {}) {
  const now = o.now ?? Date.now;
  let s: Live = { phase: "idle" };
  let id: string | null = null;
  let off: (() => void) | null = null;
  // E5: one clock from the Start tap; each step's own time (the person's turns never count)
  const clock = { at: 0, last: 0, steps: [] as number[], opened: false, paid: false, past: [] as readonly number[] };
  const timed = (next: Live, before: Live, a: LiveAction): Live => {
    const t = now();
    if (next.phase === "starting" && before.phase === "idle") (clock.at = t), (clock.last = t), (clock.steps = []), (clock.opened = false), (clock.paid = false), (clock.past = ((p) => (p.length ? p : cloud.runGuessMs ? [cloud.runGuessMs] : []))(o.pastMs?.() ?? []));
    if (next.phase === "agent" || next.phase === "you") clock.opened = true;
    if (next.phase === "you" && next.why === "money") clock.paid = true;
    const flags = { ...(clock.opened ? { opened: true as const } : {}), ...(clock.paid ? { paid: true as const } : {}) };
    if (a.type === "event" && a.e.kind === "step") (clock.steps.push(t - clock.last), (clock.last = t));
    if (next.phase === "agent" && before.phase === "you") clock.last = t;
    const at = clock.at || t;
    if (next.phase === "ended") return { ...next, ...flags, at, endedAt: t };
    // the person's turn has no time left (it waits for them)
    if (next.phase === "you") return { ...next, ...flags, at };
    return { ...next, ...flags, at, endsAt: runEndsAt(t, clock.steps, clock.steps.length, 40, clock.past, at) };
  };
  const set = (a: LiveAction) => {
    const before = s;
    const next = liveStep(s, a);
    if (next === before) return;
    s = timed(next, before, a);
    onState(s);
    if (s.phase === "ended") off?.();
    // The page is touchable exactly on the person's turn.
    if (id && touchable(s) !== touchable(before)) void cloud.setInteractive(id, touchable(s)).catch(() => undefined);
  };
  return {
    state: () => s,
    async start(task: string, url: string | null, host: string | null): Promise<void> {
      if (s.phase !== "idle") return;
      set({ type: "start", host });
      try {
        const r = await cloud.start(task, url);
        id = r.id;
        if ((s as Live).phase === "ended") return void cloud.stop(r.id).catch(() => undefined); // stopped while it started
        onLiveUrl(r.liveUrl);
        off = cloud.events(r.id, (e) => set({ type: "event", e }));
      } catch (e) {
        // the start's own line (ZeroFee's words: "The site didn't load.", "AgentZero's email isn't on yet…"), never lost
        set({ type: "event", e: { kind: "failed", host, ...(e instanceof SaidLine ? { line: e.message.slice(0, 200) } : {}) } });
      }
    },
    takeOver: () => set({ type: "take-over" }),
    handBack: () => set({ type: "hand-back" }),
    stop(): void {
      set({ type: "stop" });
      if (id) void cloud.stop(id).catch(() => undefined);
    },
  };
}
