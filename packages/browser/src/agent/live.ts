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
export type NeedsYou = "sign-in" | "person-check" | "code" | "terms" | "create-account" | "money" | "stuck" | "refused" | "limit";

/** What AgentZero's cloud browser reports (read from Browser Use's own session, never the model's words). */
export type CloudEvent =
  | { kind: "at"; host: string }
  /** M15: each step in a few words, from AgentZero's own action, never the page's words. */
  | { kind: "step"; line: string; host: string }
  | { kind: "needs-you"; why: NeedsYou; host: string }
  | { kind: "done"; host: string }
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
}

/** A start that failed with ZeroFee's own line (only these are shown; any other error keeps the plain line). */
export class SaidLine extends Error {}

export type Live =
  | { phase: "idle" }
  | { phase: "starting"; host: string | null }
  | { phase: "agent"; host: string; steps?: string[] }
  | { phase: "you"; host: string; why: NeedsYou | "took-over" }
  | { phase: "ended"; line: string };

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
  if (a.type === "stop") return s.phase === "idle" ? s : { phase: "ended", line: "Stopped. Nothing was sent." };
  if (a.type === "start") return s.phase === "idle" ? { phase: "starting", host: a.host } : s;
  if (a.type === "take-over") return s.phase === "agent" ? { phase: "you", host: s.host, why: "took-over" } : s;
  if (a.type === "hand-back") return s.phase === "you" ? { phase: "agent", host: s.host } : s;
  const e = a.e;
  if (e.kind === "failed") return { phase: "ended", line: e.line ?? `${e.host ?? "The page"} didn't open. Nothing was sent.` };
  if (e.kind === "left") return { phase: "ended", line: leftLine(e.host) };
  if (s.phase === "idle" || s.phase === "you") return s;
  if (e.kind === "step") return s.phase === "agent" ? { ...s, steps: [...(s.steps ?? []), e.line].slice(-5) } : s;
  if (e.kind === "at") return s.phase === "agent" && s.host === e.host ? s : { phase: "agent", host: e.host };
  if (e.kind === "needs-you") return { phase: "you", host: e.host, why: e.why };
  return { phase: "ended", line: `AgentZero is done on ${e.host}.` };
}

/** The chip's one line, present tense. */
export function liveLine(s: Live): string {
  switch (s.phase) {
    case "idle":
      return "";
    case "starting":
      return s.host ? `AgentZero is opening ${s.host}…` : "AgentZero is starting its browser…";
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
        money: `${s.host} asks for money. AgentZero never pays here.`,
        stuck: "The page didn't change after 3 tries. It's yours.",
        refused: `${s.host} refused AgentZero. It's yours.`,
        limit: "AgentZero stopped at its step limit. It's yours.",
      }[s.why];
  }
}

/** The person's turn: the page is touchable and AgentZero takes no screenshots (the brief's hand-over moment). */
export const touchable = (s: Live): boolean => s.phase === "you";

const MONEY = /\b(buy|sell|trade|swap|pay|send (money|\$|\d)|transfer|withdraw|deposit)\b/i;
const SIGN_UP = /\b(sign ?up|create (an |a )?account|register|make (an |a )?account)\b/i;
const SECRET = /\b(password|passcode|pin|cvv|cvc)\b|(?:\d[ -]?){13,19}/i;
export const NEVER_HERE = "AgentZero can sign in and read. It never trades here and never pays here.";

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
export function liveSession(cloud: CloudBrowser, onState: (s: Live) => void, onLiveUrl: (url: string) => void) {
  let s: Live = { phase: "idle" };
  let id: string | null = null;
  let off: (() => void) | null = null;
  const set = (a: LiveAction) => {
    const before = s;
    s = liveStep(s, a);
    if (s !== before) onState(s);
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
