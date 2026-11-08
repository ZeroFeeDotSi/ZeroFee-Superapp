// AgentZero's browser on the phone (D114): no cloud. The page opens in a ZeroFee site window with the built-in agent
// recipe (PartnerRecipe.agent, iOS); each step Claude picks (`agent.robot.next`, on ZeroFee's paid path from AgentZero's
// wallet: agent robot/service.ts, audit 14 E1) goes back through the
// host's checked robot steps (PartnerRobot: every step checked natively against the latest page, a money or commit step
// always the person's, a bot check the person's, a picture only when the page's words are thin and no secret box shows).
// This side adds the guard (packages/agent guard): nothing read is an order, hidden words are refused, and it checks the
// picture rule again before anything goes to Claude. On the web there's no host: "Open ZeroFee on your iPhone."
import type { Bridge } from "@zerofee/core/bridge";
import { HIDES_ITS_WORDS, authorises, notAnOrder, pageHides } from "@zerofee/agent/guard/index";
import { SaidLine, type CloudBrowser, type CloudEvent, type NeedsYou } from "./live.ts";
import { browsePayReady } from "@zerofee/shell-api/agent-browser.ts";
import { PAY_PAGE_LINE, checkoutPage, leavesSite, pageTotal, selectPriced, steersAgent } from "./pay-guard.ts";

export const OPEN_ON_IPHONE = "Open ZeroFee on your iPhone.";
/** Under this many characters of words, a picture may help (the host's AgentPageRules.thinTextChars). */
export const THIN_TEXT_CHARS = 300;
/** Steps in one task, at most (the host's own limit is 200 actions and 30 minutes). */
export const MAX_STEPS = 200;
/** M16: a task stops at this many steps unless it's given fewer (the host's cap stays the hard one). */
export const TASK_STEPS = 40;
/** M17: steps in a row that left the page as it was. */
export const STUCK_TRIES = 3;
export const STUCK_LINE = "The page didn't change after 3 tries. It's yours.";
export const LIMIT_LINE = (n: number) => `AgentZero stopped after ${n} steps. It's yours.`;
/** Every step has a time limit and a plain line (phone test, 3 Nov: a sign-up froze). Nothing ever waits for ever. */
export const STEP_MS = { open: 30_000, page: 20_000, think: 60_000, act: 20_000, done: 10_000, yours: 10 * 60_000 } as const;
export const SITE_SLOW_LINE = "The site didn't answer. Nothing was sent.";
export const OPEN_SLOW_LINE = "The site didn't load. Nothing was sent.";
export const THINK_SLOW_LINE = "AgentZero didn't answer. Nothing was sent.";
export const WAITED_LINE = "AgentZero stopped waiting for you. Nothing was sent.";
export const STOPPED_LINE = "AgentZero stopped. Nothing was sent.";
/** E4 (audit 14): AgentZero's thinking failed, named as such (the site did open). */
export const THINK_FAILED_LINE = (site: string) => `AgentZero's thinking failed. Nothing was done on ${site}.`;
/** b18 (4b): a run from the Browser tab with AgentZero's chat closed: its wallet isn't on hand to pay, so it never starts. */
export const NO_PAYER_LINE = (site: string) => `AgentZero pays for each step from its wallet. Start this from AgentZero's chat. Nothing was done on ${site}.`;
/** b18: a page that talks to AgentZero instead of the person, and a link off the task's site. */
export const STEERED_LINE = (site: string) => `${site} tries to tell AgentZero what to do. This step is yours.`;
export const LEAVES_LINE = (site: string) => `That link leaves ${site}. It's yours to open.`;
/** E4: the page couldn't be read. */
export const READ_FAILED_LINE = (site: string) => `AgentZero couldn't read ${site}. It did nothing there.`;
/** Claude busy or out of reach: one more ask after this wait. */
export const THINK_AGAIN = new Set(["agent.model.busy", "agent.model.offline"]);
export const THINK_AGAIN_MS = 1_500;
/** Audit 17's H8: a report that says it found nothing ("AgentZero didn't find that on X."): the run didn't finish. The
 *  thinker's shape (robot/think-shape.ts, the relay's schema) has no field for it yet, so its own first words say it. */
export const MISSED = /^\s*AgentZero (?:didn't|did not|couldn't|could not|can't|cannot) find\b/i;

/** The thinker's own line where it says what to do (no money for the next step), else the plain failure. */
export function thinkFailedLine(p: { code: string; whatHappened: string }, site: string): string {
  if (p.code === "agent.browse.unfunded") return `${p.whatHappened} Nothing was done on ${site}.`;
  if (p.code === "agent.browse.no-payer") return `${p.whatHappened} Nothing more was done on ${site}.`;
  return THINK_FAILED_LINE(site);
}
/** Mail isn't live yet (M14): AgentZero has no inbox, so it can't sign up with one or read a code from it. */
export const NO_MAIL_LINE = "AgentZero's email isn't on yet, so it can't sign up with it. Nothing was sent.";
export const NO_MAIL_CODE_LINE = "AgentZero's email isn't on yet, so it can't get the code. It's yours.";
const WANTS_OWN_MAIL = /\b(your|agentzero'?s|its own|the agent'?s)\s+(own\s+)?(encrypted\s+|private\s+)?(e-?mail|inbox|mailbox)\b/i;
/** Does the task ask AgentZero to use its own email? */
export const wantsOwnMail = (task: string): boolean => WANTS_OWN_MAIL.test(task);

class StepTimeout extends Error {}
const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "the site";
  }
};

type Element = { id?: string; kind?: string; type?: string; autocomplete?: string; label?: string; text?: string; host?: string };
type Shot = { host: string; lang?: string; elements: Element[]; more?: boolean; text?: string; picture?: string; yourTurn?: string };
type Step =
  | { kind: "click" | "check" | "scroll"; id: string }
  | { kind: "select"; id: string; option: string }
  | { kind: "fill"; id: string; value: string }
  | { kind: "wait"; ms: number }
  | { kind: "yourTurn"; reason: string }
  /** audit 17's H8: `missed`, it didn't find what was asked (the summary says so) */
  | { kind: "done"; summary: string; missed?: boolean };

const SECRET_WORDS = /\b(password|passcode|pin|cvc|cvv|csc|security code|card number|card no|expiry|expiration|one[- ]time|otp|verification code|2fa|two[- ]factor)\b/i;
const MONEY = /\b(pay|payment|checkout|check out|buy|place (the |your |an |this )?order|order now|purchase|subscribe|donate|add (a )?card|book now|reserve|confirm (and|&) pay|confirm (the |your |this )?(order|purchase|payment|booking)|complete (the |your |this )?(order|purchase|payment)|start (free )?trial|upgrade|send|transfer|withdraw|delete|agree|accept|consent)\b/i;

/** A box whose contents must never be in a picture (the host's AgentPageRules.isSecretField, again here). */
export function secretBox(e: Element): boolean {
  if (e.kind !== "field") return false;
  const type = String(e.type ?? "").toLowerCase(), ac = String(e.autocomplete ?? "").toLowerCase();
  if (type === "password" || ac.includes("one-time-code") || ac.includes("password") || ac.split(" ").some((w) => w.startsWith("cc-"))) return true;
  return SECRET_WORDS.test(`${e.label ?? ""} ${e.text ?? ""}`);
}

/** The picture goes to Claude only when the words are thin and no secret box is on screen (QA). */
export function pictureAllowed(shot: Shot): boolean {
  return typeof shot.picture === "string" && String(shot.text ?? "").length < THIN_TEXT_CHARS && !shot.elements.some(secretBox);
}

/** The prices a step's words name, in dollars ("$49", "$1,200.50", "USD 30"). */
export function pricesIn(text: string): number[] {
  return [...text.matchAll(/(?:\$|\busd\s?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/gi)].map((m) => Number(`${m[1]!.replace(/,/g, "")}.${m[2] ?? "0"}`));
}

/** M15: a step in a few words, from AgentZero's own action and the box's kind, never the page's words. */
export function stepWords(a: { kind: string }, el?: { kind?: string }): string {
  switch (a.kind) {
    case "click":
      return el?.kind === "link" ? "Opening a link" : "Tapping a button";
    case "check":
      return "Ticking a box";
    case "select":
      return "Picking an option";
    case "scroll":
      return "Scrolling the page";
    case "wait":
      return "Waiting for the page";
    default:
      return "Looking at the page";
  }
}

/** M12: forget one site (its sign-in and what it saved on this phone), after the person's yes on the phone's alert. */
export async function forgetSite(bridge: Bridge, host: string): Promise<string> {
  const r = await bridge.call<{ forgot: boolean }>("partner.forgetSite", { host });
  if ("problem" in r) return r.problem.code === "partner.unavailable" || r.problem.code === "host.unavailable" ? OPEN_ON_IPHONE : r.problem.whatHappened;
  return r.ok.forgot ? `ZeroFee forgot ${host}.` : `${host} stays.`;
}

const printOf = (shot: { host: string; text?: string; elements: { id?: string }[] }) => `${shot.host}\u0001${shot.text ?? ""}\u0001${shot.elements.map((e) => e.id ?? "").join(",")}`;

/** Why the person's turn, from the host's words or the step's. */
function whyOf(text: string): NeedsYou {
  const t = text.toLowerCase();
  if (/person|human|robot|captcha/.test(t)) return "person-check";
  if (/sign in|log in|password/.test(t)) return "sign-in";
  if (/code/.test(t)) return "code";
  if (/terms|agree|consent/.test(t)) return "terms";
  if (/account/.test(t)) return "create-account";
  return "money";
}

/**
 * The phone's CloudBrowser over the host's partner.* and Agent's thinker. `liveUrl` is empty: the page is ZeroFee's own
 * site window, on screen, not a stream.
 */
export function phoneBrowser(bridge: Bridge, o: { now?: () => number; sleep?: (ms: number) => Promise<void>; maxSteps?: number; askAboveUsd?: number | null; mailLive?: boolean; /** b18 (4b): AgentZero's wallet is on hand to pay its steps (default: its chat is open) */ payReady?: () => boolean; limits?: Partial<Record<keyof typeof STEP_MS, number>>; timer?: (ms: number) => Promise<void> } = {}): CloudBrowser {
  // M16: the task's step limit (never above the host's), and its money limit: a step naming a price above "Ask me
  // first" (none set: any price) is the person's.
  const maxSteps = Math.min(Math.max(1, o.maxSteps ?? TASK_STEPS), MAX_STEPS);
  const moneyLimit = o.askAboveUsd ?? 0;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const runs = new Map<string, { stopped: boolean; listeners: Set<(e: CloudEvent) => void>; host: string; tab?: string }>();
  let n = 0;
  const emit = (id: string, e: CloudEvent) => runs.get(id)?.listeners.forEach((l) => l(e));
  const mailLive = o.mailLive === true;
  /** A bridge call with its step's time limit: past it, the step is over (StepTimeout), never a hang. The clock is
   *  cleared the moment the step answers. */
  const timed = <T>(p: Promise<T>, step: keyof typeof STEP_MS, line: string): Promise<T> => {
    const ms = o.limits?.[step] ?? STEP_MS[step];
    if (o.timer) return Promise.race([p, o.timer(ms).then((): T => { throw new StepTimeout(line); })]);
    let t: ReturnType<typeof setTimeout> | undefined;
    const clock = new Promise<T>((_, reject) => { t = setTimeout(() => reject(new StepTimeout(line)), ms); });
    return Promise.race([p, clock]).finally(() => clearTimeout(t));
  };
  /** The run ends with its line: the window closes, the chat's card says why, and the chat has control again. */
  const end = (id: string, line: string) => {
    const run = runs.get(id);
    if (!run || run.stopped) return;
    run.stopped = true;
    void Promise.resolve(bridge.call("partner.closeAgent", { tab: run.tab })).catch(() => undefined);
    run.listeners.forEach((l) => l({ kind: "failed", host: run.host, line }));
  };

  async function loop(id: string, task: string): Promise<void> {
    const run = runs.get(id)!;
    const history: string[] = [];
    let acted = false, same = 0, last = "";
    for (let step = 0; !run.stopped; step++) {
      if (step >= maxSteps) {
        await yours(id, LIMIT_LINE(maxSteps), "limit");
        return emit(id, { kind: "done", host: run.host });
      }
      const s = await timed(bridge.call<Shot>("partner.snapshot", { tab: run.tab }), "page", SITE_SLOW_LINE);
      if (run.stopped) return;
      // D131: its tab is in the back: the task waits for the person's Continue there, never fails or reads another page
      if ("problem" in s && s.problem.code === "partner.robot.paused") {
        if (!(await yours(id, s.problem.whatHappened, whyOf(s.problem.whatHappened)))) return;
        continue;
      }
      // E4: the page couldn't be read: said by name (never "didn't open" for a site that opened)
      if ("problem" in s) return emit(id, { kind: "failed", host: run.host, line: READ_FAILED_LINE(run.host) });
      const shot = s.ok;
      if (shot.host !== run.host) {
        run.host = shot.host;
        emit(id, { kind: "at", host: shot.host });
      }
      // The host paused for the person (a bot check, a refusal, a page stuck after 3 tries): wait for Continue or Stop.
      if (shot.yourTurn) {
        const why: NeedsYou = shot.yourTurn === "stuck" ? "stuck" : shot.yourTurn === "refused" ? "refused" : "person-check";
        const line = why === "stuck" ? STUCK_LINE : why === "refused" ? "This site refused AgentZero. It's yours." : "This page wants to check you're a person.";
        same = 0;
        if (!(await yours(id, line, why))) return;
        continue;
      }
      // M17 here too: the page after STUCK_TRIES steps in a row was as before them.
      const print = printOf(shot);
      if (acted) same = print === last ? same + 1 : 0;
      last = print;
      acted = false;
      if (same >= STUCK_TRIES) {
        same = 0;
        if (!(await yours(id, STUCK_LINE, "stuck"))) return;
        continue;
      }
      // Hidden words on the page are never read as the person's (D114, the guard).
      if (pageHides(shot.text ?? "")) {
        if (!(await yours(id, HIDES_ITS_WORDS, "money"))) return;
        continue;
      }
      const input = { partner: shot.host, goal: task, guide: [], slots: [], page: { host: shot.host, lang: shot.lang ?? "", elements: shot.elements, more: !!shot.more }, history, task, pageText: shot.text ?? "", ...(pictureAllowed(shot) ? { picture: shot.picture } : {}) };
      const think = () => timed(bridge.call<Step>("agent.robot.next", { input }), "think", THINK_SLOW_LINE);
      let r = await think();
      if (run.stopped) return;
      // E4: Claude busy or out of reach: asked once more after a short wait, then the real cause, by name
      if ("problem" in r && THINK_AGAIN.has(r.problem.code)) {
        await sleep(THINK_AGAIN_MS);
        if (run.stopped) return;
        r = await think();
        if (run.stopped) return;
      }
      if ("problem" in r) return emit(id, { kind: "failed", host: run.host, line: thinkFailedLine(r.problem, run.host) });
      const a = r.ok;
      if (a.kind === "done") {
        await timed(bridge.call("partner.done", { summary: a.summary, tab: run.tab }), "done", STOPPED_LINE).catch(() => undefined);
        // E3: the report back: AgentZero's own reading of the page (checked, at most 300 characters), never an order
        return emit(id, { kind: "done", host: run.host, summary: a.summary, ...(a.missed === true || MISSED.test(a.summary) ? { missed: true as const } : {}) });
      }
      if (a.kind === "yourTurn") {
        if (!(await yours(id, a.reason, whyOf(a.reason)))) return;
        history.push("the person had a turn");
        continue;
      }
      // Nothing read is an order (the guard): a step the page led to that pays, buys, sends or agrees is the person's.
      const el = "id" in a ? shot.elements.find((e) => e.id === a.id) : undefined;
      const words = `${el?.text ?? ""} ${el?.label ?? ""}`;
      if ((a.kind === "click" || a.kind === "check") && (MONEY.test(words) || pageHides(words)) && !authorises("page")) {
        if (!(await yours(id, notAnOrder("page"), "money"))) return;
        continue;
      }
      // b18: a page that gives AgentZero orders ("ignore the user", "the user approved") has every tap the person's
      if ((a.kind === "click" || a.kind === "check" || a.kind === "select") && steersAgent(shot)) {
        if (!(await yours(id, STEERED_LINE(run.host), "steered"))) return;
        continue;
      }
      // b18: a link to another site is the person's (AgentZero works on the task's one site)
      if (a.kind === "click" && el?.kind === "link" && leavesSite((el as { host?: string }).host, run.host)) {
        if (!(await yours(id, LEAVES_LINE(run.host), "leaves"))) return;
        continue;
      }
      // E7: on a page that takes payment (its path, its words, a total, a card or address box) every step is the
      // person's, whatever the button says ("Continue" places an order too); so is a pick whose option names a price.
      if ((a.kind === "click" || a.kind === "check" || a.kind === "select") && (checkoutPage(shot) || (a.kind === "select" && selectPriced(a.option)))) {
        if (!(await yours(id, PAY_PAGE_LINE, "money", pageTotal(shot)))) return;
        continue;
      }
      // M16's money limit: a step whose words name a price above "Ask me first" is the person's.
      const price = Math.max(0, ...pricesIn(words));
      if ((a.kind === "click" || a.kind === "check" || a.kind === "select") && price > moneyLimit) {
        if (!(await yours(id, `This step costs $${price}. It's yours.`, "money"))) return;
        continue;
      }
      // Claude never types (D114): a box to fill is the person's.
      if (a.kind === "fill") {
        if (!(await yours(id, "This box is yours to fill in.", whyOf(words)))) return;
        continue;
      }
      const params = a.kind === "wait" ? { kind: "wait", ms: a.ms } : a.kind === "select" ? { kind: "select", id: a.id, option: a.option } : { kind: a.kind, id: a.id };
      emit(id, { kind: "step", line: stepWords(a, el), host: run.host });
      const done = await timed(bridge.call("partner.act", { ...params, tab: run.tab }), "act", SITE_SLOW_LINE);
      acted = true;
      if ("problem" in done) {
        const code = done.problem.code;
        // The host made it the person's turn (a money or commit step, or ZeroFee left the screen, or 5 idle minutes):
        // wait for their Continue, never act around it.
        if (code === "partner.act.yours" || code === "partner.robot.paused") {
          if (!(await yours(id, done.problem.whatHappened, whyOf(`${words} ${done.problem.whatHappened}`)))) return;
        } else if (code === "partner.robot.ended" || code === "partner.robot.off" || code === "partner.robot.limit") {
          return emit(id, { kind: "failed", host: run.host });
        }
      }
      history.push(`${a.kind}${"id" in a ? ` ${a.id}` : ""}${"problem" in done ? " (didn't work)" : ""}`);
      if (a.kind !== "wait") await sleep(300);
    }
    if (!run.stopped) end(id, STOPPED_LINE);
  }

  /** The person's turn: the host shows its Continue and Stop; true to go on. */
  async function yours(id: string, why: string, kind: NeedsYou, usd?: string | null): Promise<boolean> {
    const run = runs.get(id)!;
    // A code from AgentZero's own email can't come while mail isn't on: said plainly, and the code is the person's.
    const line = kind === "code" && !mailLive ? NO_MAIL_CODE_LINE : why;
    emit(id, { kind: "needs-you", why: kind, host: run.host, ...(usd ? { usd } : {}) });
    // The person's turn waits for them, but not for ever: after STEP_MS.yours it ends with its line.
    const r = await timed(bridge.call<{ answer: string }>("partner.yourTurn", { why: line.slice(0, 200), tab: run.tab }), "yours", WAITED_LINE);
    if (run.stopped) return false;
    const go = "ok" in r && r.ok.answer === "continue";
    if (go) emit(id, { kind: "at", host: run.host });
    else emit(id, { kind: "done", host: run.host });
    return go;
  }

  return {
    async start(task, url) {
      if (!url) throw new Error("AgentZero needs a site to open.");
      // Mail isn't live: a task that needs AgentZero's own email stops before anything opens.
      if (!mailLive && wantsOwnMail(task)) throw new SaidLine(NO_MAIL_LINE);
      // b18 (4b): every step is paid from AgentZero's wallet as it goes; with no wallet on hand it stops before the first
      if (!(o.payReady ?? browsePayReady)()) throw new SaidLine(NO_PAYER_LINE(hostOf(url)));
      const r = await timed(bridge.call<{ host: string; tab?: string }>("partner.openAgent", { url }), "open", OPEN_SLOW_LINE).catch((e: unknown) => {
        throw new SaidLine(e instanceof StepTimeout ? e.message : OPEN_SLOW_LINE);
      });
      if ("problem" in r) throw new SaidLine(r.problem.code === "partner.unavailable" || r.problem.code === "host.unavailable" ? OPEN_ON_IPHONE : r.problem.whatHappened);
      const id = `phone-${++n}`;
      // D131 review M3: every later call names AgentZero's own tab, so it never drives another page
      runs.set(id, { stopped: false, listeners: new Set(), host: r.ok.host, ...(typeof r.ok.tab === "string" ? { tab: r.ok.tab } : {}) });
      queueMicrotask(() => {
        emit(id, { kind: "at", host: r.ok.host });
        void loop(id, task).catch((e: unknown) => end(id, e instanceof StepTimeout ? e.message : STOPPED_LINE));
      });
      return { id, liveUrl: "" };
    },
    // The page is ZeroFee's own window: the person touches it to take over (the host pauses), Continue to hand back.
    async setInteractive() {},
    async stop(id) {
      const run = runs.get(id);
      if (run) run.stopped = true;
      await bridge.call("partner.closeAgent", { tab: run?.tab });
    },
    events(id, on) {
      const run = runs.get(id);
      if (!run) return () => {};
      run.listeners.add(on);
      // b18: the first "at" goes out in a microtask from start, before the caller's await has subscribed: said again
      // here, so the card moves from "opening" to working (its steps and clock) and never misses the run's start
      if (!run.stopped) on({ kind: "at", host: run.host });
      const off = bridge.on<{ kind?: string; why?: string }>("partner.event", (e) => {
        if (e?.kind === "ended" && !run.stopped) {
          run.stopped = true;
          // M10: the page went to another site on its own (the host keeps AgentZero on the task's one site).
          on(e.why === "done" ? { kind: "done", host: run.host } : e.why === "left-recipe" ? { kind: "left", host: run.host } : { kind: "failed", host: run.host });
        }
      });
      return () => {
        run.listeners.delete(on);
        off();
      };
    },
  };
}
