// AgentZero's plans (product decision, 3 Nov: "It can do anything for the user, just say the word. If the user gets stuck, or bugs
// or errors happen, it starts again and gets the job done"). Pure: node tests it; turn.ts and use-chat-turn.ts use it.
//
// THREE THINGS, all in our own code (never a model's arithmetic or a model's word that money went):
//   1. Know the person's state before acting: a send, swap or move is checked against what the wallet it comes from
//      holds (fit). Short: ZeroFee's own facts and the shortest fix, as a numbered plan ("Move $21.00 from your Safe to
//      your SOL wallet, then Send $20.00 in SOL to Do1R…7vcy"), or Add when there's no money anywhere.
//   2. Run a plan step by step: each step is Home's own sheet, filled in, on the person's own tap and Face ID; the next
//      shows only after the one before LANDED (the MoneyCard's follow on Activity), never before.
//   3. Recover: a step that closed, stopped, came back or is held pauses the plan, says why, and waits for the person's
//      new words ("again", another way, or "stop"). A money step is never opened twice without them; nothing loops.
//
// A plan the person asked for ("swap, then send half, then tell me what's left") holds their asks as steps in words
// (made: "asked"); Claude does each one with its own tool when it's next, and ZeroFee carries on after each landing.
import { PLACE_WORD, moveLeast, type HomeAsk, type HomePlace, type HomeSheet } from "./home-ask.ts";

/** What each place holds now, in dollars (skills.ts balances, read on the phone); null: couldn't be read. */
export interface Balances {
  safe: number | null;
  sol: number | null;
  hood: number | null;
  near: number | null;
}
export const PLACES: readonly (keyof Balances)[] = ["safe", "sol", "hood", "near"];

export type StepStatus =
  /** not shown yet */
  | "waiting"
  /** its card is in the chat, waiting for the person's tap */
  | "shown"
  /** its sheet is open */
  | "open"
  | "landed"
  /** it went; Activity hadn't shown it landing yet */
  | "went"
  /** closed before it went: nothing moved */
  | "closed"
  | "stopped"
  | "came-back"
  | "held"
  /** ZeroFee closed while its sheet was open or it was on its way: not known; Activity says */
  | "unknown"
  | "skipped"
  /** a step in words only, answered */
  | "done";
export interface PlanStep {
  /** ZeroFee's own line for a sheet step; the person's ask in words for an asked step */
  line: string;
  /** Home's own sheet, filled in and checked by our code (home-ask.ts); none for a step Claude does when it's next */
  sheet?: HomeSheet;
  status: StepStatus;
  why?: string;
}
export type PlanState = "proposed" | "running" | "paused" | "done" | "dropped";
export interface Plan {
  id: string;
  /** what it's for, in ZeroFee's words or the person's */
  goal: string;
  /** the facts it was made from ("Your SOL wallet has $0.00. Your Safe has $25.00."): ZeroFee's own read */
  facts?: string;
  steps: PlanStep[];
  /** the step it's on */
  at: number;
  state: PlanState;
  /** "zerofee": made by our code from the facts (every step a sheet); "asked": the person's own asks, in order */
  made: "zerofee" | "asked";
  /** The step before went (Home's sheet said so) and the step it's on waits for its wallet to have the money: since
   *  when (ms). The plan runner (plan-runner.ts) opens it once the wallet covers it. */
  wait?: number;
  /** waited past the runner's limit: said, with Check again and Stop */
  late?: true;
}
/** A Home sheet that is one step of a plan: the card reports its end to the plan. */
export type PlanTag = { id: string; step: number };
export type TaggedSheet = HomeSheet & { plan?: PlanTag };

/** How one step's sheet ended, as the MoneyCard read it from Activity (money-ask.ts followLine / Home's MoneyEnd). */
export type StepEnd =
  | { kind: "opened" }
  | { kind: "landed" }
  | { kind: "went" }
  | { kind: "closed"; why?: string }
  | { kind: "stopped"; why?: string }
  | { kind: "came-back" }
  | { kind: "held" };

const usdText = (n: number): string => `$${n.toFixed(2)}`;
const PLACE_NAME: Record<HomePlace, string> = { safe: "Your Safe", sol: "Your SOL wallet", hood: "Your Robinhood wallet", near: "Your NEAR wallet" };
let seq = 0;
export const planId = (nowMs: number = Date.now()): string => `p-${nowMs.toString(36)}-${(seq++).toString(36)}`;

/** Where a sheet's money comes from, when our code can tell: a wallet a send names or its coin's wallet, a swap's coin,
 *  a move's from. null: no money leaves (Add, Request) or Home's Send picks it (a NEAR name, USDC). */
export function sourceOf(a: HomeAsk): HomePlace | null {
  switch (a.kind) {
    case "send":
      if (a.wallet) return a.wallet;
      return a.coin === "SOL" ? "sol" : a.coin === "ETH" ? "hood" : null;
    case "swap": return a.wallet ?? null;
    case "move": return a.from;
    default: return null;
  }
}

/** What a funding move adds on top of the gap, for the move's own fees: 5%, at least $1, in whole dollars. */
export const fundUsd = (gap: number): number => Math.ceil(gap + Math.max(1, gap * 0.05));

/** The coin Add offers for a place (Home's Add on that wallet). */
const ADD_COIN: Record<HomePlace, "SOL" | "ETH" | "NEAR" | "USDC"> = { safe: "USDC", sol: "SOL", hood: "ETH", near: "USDC" };

export type Fit =
  | { kind: "ok" }
  /** short in one place, enough in another: a plan to move it there first */
  | { kind: "plan"; plan: Plan }
  /** short everywhere (or spread too thin): the facts, and Add on the wallet it comes from */
  | { kind: "short"; line: string; facts: string; add: HomeSheet };

/** The facts, in ZeroFee's words: the place it comes from, then every other place that holds money. */
export function factsLine(place: HomePlace, b: Balances): string {
  const have = (p: keyof Balances) => b[p];
  const parts = [`${PLACE_NAME[place]} has ${usdText(have(place as keyof Balances) ?? 0)}.`];
  const others = PLACES.filter((p) => p !== place && (have(p) ?? 0) >= 0.01).sort((x, y) => (have(y) ?? 0) - (have(x) ?? 0));
  for (const p of others) parts.push(`${PLACE_NAME[p]} has ${usdText(have(p)!)}.`);
  if (!others.length) parts.push("Your other wallets are empty.");
  return parts.join(" ");
}

/** A move ZeroFee works out (a funding step): its sheet in Home's move shape, its line ZeroFee's own. */
export function moveStep(from: HomePlace, to: HomePlace, usd: number): HomeSheet {
  return { ask: { kind: "move", from, to, usd: usd.toFixed(2) }, usd, line: `Move ${usdText(usd)} from ${PLACE_WORD[from]} to ${PLACE_WORD[to]}.` };
}
/** Add on a place's coin (Home's Add, a one-time private address). */
export function addStep(place: HomePlace): HomeSheet {
  const coin = ADD_COIN[place];
  const to: HomePlace = coin === "SOL" ? "sol" : coin === "ETH" ? "hood" : coin === "NEAR" ? "near" : "safe";
  return { ask: { kind: "receive", coin, wallet: to }, usd: null, line: `Add ${coin} to ${PLACE_WORD[to]}: a one-time private address.` };
}

/**
 * Can this sheet go from what the person holds now? ok when it can (or when our code can't tell: a place that couldn't be
 * read, a source Home picks); else the shortest fix: one move from the place with the most into the one it comes from,
 * then the sheet; with no single place able to cover it, the facts and Add.
 */
export function fit(s: HomeSheet, b: Balances | null, nowMs: number = Date.now()): Fit {
  if (!b) return { kind: "ok" };
  const place = sourceOf(s.ask);
  const need = s.usd;
  if (!place) return { kind: "ok" };
  const have = b[place];
  if (have === null) return { kind: "ok" };
  // a move of everything from an empty place, or any amount over what it has
  if (need === null ? have >= 0.01 : have + 1e-9 >= need) return { kind: "ok" };
  const facts = factsLine(place, b);
  const gap = need === null ? 0 : need - have;
  if (need !== null && s.ask.kind !== "move") {
    // the Safe first, then the NEAR wallet, then the fullest other wallet: one move covers it, at least Home's least
    const amountFrom = (p: HomePlace) => Math.max(fundUsd(gap), Math.ceil(moveLeast(p, place) * 100) / 100);
    const from = (["safe", "near", ...PLACES.filter((p) => p !== "safe" && p !== "near").sort((x, y) => (b[y] ?? 0) - (b[x] ?? 0))] as (keyof Balances)[]).find((p) => p !== place && (b[p] ?? 0) >= amountFrom(p));
    const amount = from ? amountFrom(from) : 0;
    if (from) {
      const move = moveStep(from, place, amount);
      return {
        kind: "plan",
        plan: { id: planId(nowMs), goal: s.line, facts, made: "zerofee", state: "proposed", at: 0, steps: [{ line: move.line, sheet: move, status: "waiting" }, { line: s.line, sheet: s, status: "waiting" }] },
      };
    }
  }
  const total = PLACES.reduce((t, p) => t + (b[p] ?? 0), 0);
  const what = need === null ? `${PLACE_NAME[place]} is empty, so there's nothing to move.` : `That needs ${usdText(need)}.${total >= need ? " No one place has enough to move in first." : " That's more than you have in all."}`;
  const smaller = need !== null && have >= 1 ? ` Or ask for ${usdText(Math.floor(have * 100) / 100)} or less.` : "";
  return { kind: "short", facts, line: `${facts} ${what} Add money first: the address is below.${smaller}`, add: addStep(place) };
}

/** The person named where a move comes from ("from my Safe", "out of my SOL wallet"); else ZeroFee picks it. */
export const fromSaid = (words: string): boolean => /\b(?:from|out of)\s+(?:my |the |your )?(?:safe|sol|solana|eth|rh|robinhood|near|wallet)/i.test(words);
/** Where a move the person didn't give a source for comes from (a phone ask, 3 Nov: a $10 move to ETH (RH) with
 *  more in the Safe than in the NEAR wallet went from the NEAR wallet): the Safe first, then the NEAR wallet,
 *  then the fullest wallet, the first that holds it all. null: none does (the check then says what there is). */
export function pickSource(to: HomePlace, usd: number, b: Balances | null): HomePlace | null {
  if (!b) return null;
  const order = (["safe", "near", ...PLACES.filter((p) => p !== "safe" && p !== "near").sort((x, y) => (b[y] ?? 0) - (b[x] ?? 0))] as (keyof Balances)[]).filter((p) => p !== to);
  return order.find((p) => (b[p] ?? 0) + 1e-9 >= usd) ?? null;
}

/** A coin amount the person said ("send 0.02 SOL", "1 NEAR"): that number and that coin, in their own words. */
export function coinAmountSaid(words: string, amount: number, coin: string): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const c = coin.toUpperCase().replace(/\s*\(RH\)$/, "");
  const names: Record<string, string> = { SOL: "sol|solana", NEAR: "near", ETH: "eth|ether", USDC: "usdc" };
  if (!names[c] || !new RegExp(`\\b(?:${names[c]})\\b`, "i").test(words)) return false;
  const nums = [...words.replace(/(?<=\d),(?=\d{3}\b)/g, "").matchAll(/(?<![\d.])\d*\.?\d+/g)].map((m) => Number(m[0]));
  return nums.some((n) => Math.abs(n - amount) < 1e-9);
}

/** A share the person said, in their own words: half, a quarter, a third, all of it, or "N%". */
export function shareSaid(words: string, share: number): boolean {
  if (!Number.isFinite(share) || share <= 0 || share > 100) return false;
  const w = words.toLowerCase();
  if (share === 100 && /\b(?:all|everything|the rest|whole)\b/.test(w)) return true;
  if (share === 50 && /\bhalf\b/.test(w)) return true;
  if (share === 25 && /\b(?:a |one )?quarter\b/.test(w)) return true;
  if (Math.abs(share - 100 / 3) < 0.5 && /\b(?:a |one )?third\b/.test(w)) return true;
  return new RegExp(`(?<![\\d.])${String(share).replace(".", "\\.")}\\s*(?:%|percent\\b|per cent\\b)`).test(w);
}
/** A share of what a place holds, in whole cents, down (ZeroFee works it out; Claude never does). */
export const shareUsd = (have: number, share: number): number => Math.floor(have * (share / 100) * 100 + 1e-6) / 100;

// ── the plan's life ────────────────────────────────────────────────────────────────────────────────────────────────

const tagged = (p: Plan, i: number): TaggedSheet => ({ ...p.steps[i]!.sheet!, plan: { id: p.id, step: i } });
const withStep = (p: Plan, i: number, s: Partial<PlanStep>): Plan => ({ ...p, steps: p.steps.map((x, n) => (n === i ? { ...x, ...s } : x)) });
export const live = (p: Plan | null | undefined): p is Plan => !!p && (p.state === "proposed" || p.state === "running" || p.state === "paused");
const stepWord = (p: Plan, i: number) => (p.steps.length > 1 ? `Step ${i + 1} of ${p.steps.length}` : "It");

/** What a change to the plan shows: the plan as it now is, a step's sheet (tagged) to show, and ZeroFee's line. */
export interface PlanMove {
  plan: Plan;
  sheet?: TaggedSheet;
  /** a step in words, for Claude to do now (an asked plan) */
  todo?: string;
  line: string;
}

/** Start (the person's yes): the first step's card. */
export function startPlan(p: Plan): PlanMove | string {
  if (p.state !== "proposed") return p.state === "running" ? "This plan is already going." : "There's no plan waiting to start.";
  return showStep({ ...p, state: "running", at: 0 }, 0, "Starting.");
}
/** The step at i, shown: its card for a sheet step, or Claude's turn for a step in words. */
function showStep(p: Plan, i: number, lead: string): PlanMove {
  const s = p.steps[i]!;
  if (!s.sheet) {
    const q = withStep({ ...p, at: i, state: "running" }, i, { status: "waiting" });
    return { plan: q, todo: s.line, line: `${lead} Next: ${s.line}`.trim() };
  }
  const q = withStep({ ...p, at: i, state: "running" }, i, { status: "shown" });
  return { plan: q, sheet: tagged(q, i), line: `${lead} ${stepWord(q, i)} is below: tap Open, then Face ID.`.trim() };
}

/** One step's sheet ended (the MoneyCard's word, read from Activity): the next step, done, or why it paused. null: not
 *  this plan's step now (an old card), so nothing changes. */
export function stepEnded(p: Plan, step: number, end: StepEnd): PlanMove | null {
  if (!live(p) || step !== p.at || !p.steps[step]?.sheet) return null;
  const n = step + 1;
  const name = p.steps.length > 1 ? `Step ${n}` : "It";
  switch (end.kind) {
    case "opened":
      return { plan: withStep(p, step, { status: "open" }), line: "" };
    case "landed":
    case "went": {
      const q = withStep(p, step, { status: end.kind });
      const lead = end.kind === "landed" ? `${name} landed.` : `${name} went.`;
      if (n >= p.steps.length) return { plan: { ...q, state: "done" }, line: p.steps.length > 1 ? `${lead} That was the last step: all done.` : lead };
      return showStep(q, n, lead);
    }
    case "held":
      return { plan: { ...withStep(p, step, { status: "held" }), state: "paused" }, line: `${name} is on hold for your safety. Nothing has moved yet. When the hold is over, say "again".` };
    case "came-back":
      return { plan: { ...withStep(p, step, { status: "came-back" }), state: "paused" }, line: `${name} came back to you, so nothing was lost. Say "again" to try it once more, or "stop" to leave it.` };
    case "closed":
      return { plan: { ...withStep(p, step, { status: "closed" }), state: "paused" }, line: `${name} closed before it went. Nothing moved. Say "again" to open it again, or "stop" to leave it.` };
    case "stopped": {
      const why = (end.why ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
      return { plan: { ...withStep(p, step, { status: "stopped", ...(why ? { why } : {}) }), state: "paused" }, line: `${name} stopped${why ? `: ${why.replace(/\.?$/, ".")}` : "."} Nothing else moved. Say "again" to try it once more, or ask for another way.` };
    }
  }
}

/** "again": the step it's on, shown once more (only on the person's new words; never while its sheet is open or held). */
export function againPlan(p: Plan): PlanMove | string {
  if (!live(p)) return "There's no plan going.";
  const s = p.steps[p.at]!;
  if (s.status === "open") return "Its sheet is open now. Finish it there first.";
  if (s.status === "landed" || s.status === "went") return "That step already went. Ask for the next one.";
  if (!s.sheet) return showStep(p, p.at, "Once more.");
  return showStep(p, p.at, "Once more.");
}
/** "next": past the step it's on (skipped if it never went), to the one after. */
export function nextPlan(p: Plan): PlanMove | string {
  if (!live(p)) return "There's no plan going.";
  const s = p.steps[p.at]!;
  if (s.status === "open") return "Its sheet is open now. Finish it there first.";
  const q = s.status === "landed" || s.status === "went" || s.status === "done" ? p : withStep(p, p.at, { status: "skipped" });
  const n = p.at + 1;
  if (n >= p.steps.length) return { plan: { ...q, state: "done" }, line: "That was the last step." };
  return showStep(q, n, "");
}
export function dropPlan(p: Plan): PlanMove {
  return { plan: { ...p, state: "dropped" }, line: p.steps.some((s) => s.status === "landed" || s.status === "went") ? "OK, the rest of the plan is off. What already went stays." : "OK, the plan is off. Nothing moved." };
}

/** A plan of the person's own asks, in order (Claude's plan tool): each step in words, done by Claude when it's next. */
export function askedPlan(steps: readonly string[], nowMs: number = Date.now()): Plan | string {
  const clean = steps.map((s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "")).filter(Boolean);
  if (clean.length < 2 || clean.length > 6 || clean.some((s) => s.length > 140)) return "A plan is two to six short steps.";
  return { id: planId(nowMs), goal: clean.join(", then "), made: "asked", state: "running", at: 0, steps: clean.map((line) => ({ line, status: "waiting" as const })) };
}

/**
 * A Home sheet Claude asked for while a plan runs: it becomes the step it's on when that step is in words, or replaces
 * that step's sheet when it's the same kind and hasn't gone (a change of mind: "actually $3"). null: it isn't this plan's.
 */
export function attachSheet(p: Plan, s: HomeSheet): { plan: Plan; sheet: TaggedSheet } | null {
  if (!live(p) || p.state === "proposed") return null;
  const cur = p.steps[p.at];
  if (!cur || cur.status === "open" || cur.status === "landed" || cur.status === "went") return null;
  if (cur.sheet && cur.sheet.ask.kind !== s.ask.kind) return null;
  const q = withStep({ ...p, state: "running" }, p.at, { sheet: s, status: "shown", ...(cur.sheet ? { line: s.line } : {}) });
  return { plan: q, sheet: tagged(q, p.at) };
}
/** A step in words that Claude answered with no sheet ("tell me what's left"): done, and the plan moves on or ends. */
export function wordsDone(p: Plan): Plan {
  if (!live(p) || p.state !== "running") return p;
  const s = p.steps[p.at];
  if (!s || s.sheet || s.status !== "waiting") return p;
  const q = withStep(p, p.at, { status: "done" });
  return p.at + 1 >= p.steps.length ? { ...q, state: "done" } : { ...q, at: p.at + 1 };
}

/** Where the step it's on takes its money from, and what that place has to hold (null: nothing to wait for). */
export function needOf(p: Plan): { place: HomePlace; usd: number } | null {
  const s = p.steps[p.at]?.sheet;
  const place = s ? sourceOf(s.ask) : null;
  return s && place && s.usd !== null ? { place, usd: s.usd } : null;
}
/** The step before went: the step it's on waits for its money (the runner opens it). Its line, said once. */
export function waitForFunds(p: Plan, nowMs: number): { plan: Plan; line: string } {
  const need = needOf(p);
  const q: Plan = { ...withStep(p, p.at, { status: "waiting" }), state: "running", wait: nowMs };
  delete q.late;
  return { plan: q, line: `Step ${p.at} is on its way. I'll open step ${p.at + 1} as soon as ${need ? PLACE_WORD[need.place] : "the wallet"} has the money.` };
}
/** The money is there: the step it's on, shown (once: only while it waits). */
export function fundsArrived(p: Plan, have: number | null): PlanMove | null {
  if (!live(p) || p.wait === undefined || p.steps[p.at]?.status !== "waiting" || !p.steps[p.at]?.sheet) return null;
  const need = needOf(p);
  const q: Plan = { ...p };
  delete q.wait;
  delete q.late;
  const lead = need && have !== null ? `${PLACE_WORD[need.place].replace(/^y/, "Y")} has ${usdText(have)} now.` : "";
  return showStep(q, p.at, lead);
}
/** Waited past the limit: said plainly, never silent; Check again starts the wait over. */
export function fundsLate(p: Plan): { plan: Plan; line: string } {
  const need = needOf(p);
  return { plan: { ...p, late: true }, line: `Step ${p.at} hasn't reached ${need ? PLACE_WORD[need.place] : "the wallet"} yet. Nothing else has moved.` };
}

/** A chat opened again (a reload): a step whose sheet was open or on its way is not known now (Activity says), and its
 *  card is gone, so the plan waits for the person's words. */
export function reopened(p: Plan): Plan {
  if (!live(p)) return p;
  const s = p.steps[p.at];
  if (!s) return p;
  if (s.status === "open" || s.status === "went") return { ...withStep(p, p.at, { status: "unknown" }), state: "paused" };
  // a card shown and never opened is shown again (the chat puts it back): nothing to check, it never went
  return p;
}

// ── what the person's words do to a plan, in our own code (no model call) ──────────────────────────────────────────

const YES = /^(?:y|ya|yes|yeah|yep|yup|sure|ok|okay|k|go|go ahead|go for it|do it|start|start it|let'?s go|let'?s do it|please|yes please|ok go|okay go|sounds good|deal|proceed)[.!\s]*$/i;
const NO = /^(?:no|nope|nah|cancel|cancel it|stop|stop it|stop the plan|never ?mind|forget it|don'?t|no thanks|leave it)[.!\s]*$/i;
const AGAIN = /^(?:again|try again|retry|try it again|one more time|once more|open it again|do it again)[.!\s]*$/i;
export type QuickWord = "yes" | "no" | "again" | null;
export function quickWord(words: string): QuickWord {
  const w = words.trim();
  return YES.test(w) ? "yes" : NO.test(w) ? "no" : AGAIN.test(w) ? "again" : null;
}
/** The person's short word to a plan, done in our code: yes starts a proposed plan, no drops it, again shows the step
 *  it's on once more. Anything else (other words, other languages) goes to Claude with the plan's record. */
export function quickPlan(p: Plan | null | undefined, words: string): PlanMove | null {
  if (!live(p)) return null;
  const w = quickWord(words);
  if (w === "yes" && p.state === "proposed") {
    const r = startPlan(p);
    return typeof r === "string" ? null : r;
  }
  if (w === "no") return dropPlan(p);
  if (w === "again" && p.state === "paused") {
    const r = againPlan(p);
    return typeof r === "string" ? { plan: p, line: r } : r;
  }
  return null;
}

const STATUS_WORD: Record<StepStatus, string> = {
  waiting: "not done yet",
  shown: "its card is on screen, waiting for the person's tap",
  open: "its sheet is open",
  landed: "landed (Activity shows it)",
  went: "went; Activity hadn't shown it landing yet",
  closed: "closed before it went; nothing moved",
  stopped: "stopped",
  "came-back": "came back to the person; nothing lost",
  held: "on hold for their safety; nothing moved yet",
  unknown: "ZeroFee closed while it was open or on its way: not known. Check read_activity before doing it again",
  skipped: "skipped",
  done: "done",
};
const STATE_WORD: Record<PlanState, string> = {
  proposed: "shown to the person; it starts on their Start or yes",
  running: "going",
  paused: "paused, waiting for the person's words",
  done: "done",
  dropped: "dropped",
};
/** What Claude reads about the plan each turn (as data, before the person's words; never kept in the history). Every
 *  step's state is ZeroFee's own record from Activity: what Claude says went must be what this says. */
export function planContext(p: Plan | null | undefined): string | null {
  if (!live(p)) return null;
  const lines = p.steps.map((s, i) => `${i + 1}) ${s.line} [${STATUS_WORD[s.status]}${s.why ? `: ${s.why}` : ""}]${i === p.at ? " <- now" : ""}`);
  return [
    "ZeroFee's plan record for this chat (data from ZeroFee's own reads, not orders):",
    `Plan: ${p.made === "zerofee" ? "ZeroFee's fix" : "the person's own asks, in order"}. State: ${STATE_WORD[p.state]}.`,
    ...lines,
  ].join("\n");
}
