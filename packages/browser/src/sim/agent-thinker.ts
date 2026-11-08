// The Sim's thinker for AgentZero's browser: no model, no network, no money. Fixed rules over the person's task and the
// page, so the same task on the same page always gives the same step. It stands in for Claude only in the Sim and in
// the browse suite (agent-suite.ts); the phone and every real build think on ZeroFee's paid path (agent robot/service.ts).
// It reads only the task as an order: the page's words are matched against the task, never obeyed.
// Its answers go through the same checks a model's do (think-shape checkStep, then phone.ts and the host).

/** The step shapes a thinker answers with (agent robot/types.ts RobotAction). */
export type SimStep =
  | { kind: "click" | "check" | "scroll"; id: string }
  | { kind: "select"; id: string; option: string }
  | { kind: "fill"; id: string; value: string }
  | { kind: "wait"; ms: number }
  | { kind: "yourTurn"; reason: string }
  | { kind: "done"; summary: string; missed?: boolean };
type El = { id: string; kind: string; type?: string; text?: string; label?: string; filled?: boolean };
/** What it is asked (agent robot/types.ts ThinkInput, the parts it reads). */
export type SimAsk = { task?: string; partner: string; history: string[]; page: { host: string; elements: readonly El[] }; pageText?: string };
export interface SimThinker {
  next(input: SimAsk): Promise<{ ok: SimStep }>;
}

const STOP = new Set("a an the of on in at to for and or is it its my me i you your what whats how much does do find read tell show see get go open look up please there this that with from when where who which page site".split(" "));
const stem = (w: string) => w.replace(/'s$/, "").replace(/ies$/, "y").replace(/([^s])s$/, "$1");
/** The task's own words, small words left out. */
export const taskWords = (task: string): string[] => [...new Set(task.toLowerCase().replace(/https?:\/\/\S+|\b[\w-]+\.example\.com\S*/g, " ").split(/[^a-z0-9']+/).filter((w) => w && !STOP.has(w)).map(stem))];
const wordsOf = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean).map(stem));
const overlap = (task: string[], s: string) => {
  const w = wordsOf(s);
  return task.filter((x) => w.has(x)).length;
};

const PRICE = /\$\s?\d[\d,]*(?:\.\d{2})?/;
const WANTS_PRICE = /\b(price|cost|costs|how much)\b/i;
const WANTS_CART = /\b(cart|basket|checkout|check out)\b/i;
const WANTS_SIGN_IN = /\b(sign|log)\s*in\b/i;
const WANTS_FORM = /\b(fill|form|write to|message)\b/i;
const MISSING = /\b(404|page not found)\b/i;
const LOADING = /^\s*loading\b/i;

/** The rules, in order. */
export function simStep(input: SimAsk): SimStep {
  const task = String(input.task ?? "");
  const want = taskWords(task);
  const els = input.page.elements;
  const text = String(input.pageText ?? "");
  const host = input.page.host;
  const clicked = new Set(input.history.map((h) => /^click (\S+)/.exec(h)?.[1]).filter(Boolean) as string[]);
  const heading = els.find((e) => e.kind === "heading")?.text ?? "";
  // a page that isn't there, and one still loading
  if (MISSING.test(`${heading}\n${text}`)) return { kind: "done", summary: `That page isn't on ${host}. It says 404.` };
  if (LOADING.test(text) && !els.some((e) => e.kind === "link" || e.kind === "button")) return { kind: "wait", ms: 1000 };
  // the person's own sign-in
  if (els.some((e) => e.kind === "field" && e.type === "password" && !e.filled)) return { kind: "yourTurn", reason: "Sign in yourself, then tap Continue." };
  const onTopic = overlap(want, heading) > 0;
  // a price, read off the item's own page
  if (WANTS_PRICE.test(task) && onTopic) {
    const p = els.find((e) => (e.kind === "text" || e.kind === "heading") && PRICE.test(e.text ?? ""));
    if (p) return { kind: "done", summary: `${heading} costs ${PRICE.exec(p.text ?? "")![0].replace(/\s/g, "")} on ${host}.` };
  }
  // the cart: the item in, then on toward checkout
  if (WANTS_CART.test(task)) {
    const add = els.find((e) => e.kind === "button" && /add to (cart|basket)/i.test(e.text ?? ""));
    if (add && onTopic && !clicked.has(add.id)) return { kind: "click", id: add.id };
    const on = els.find((e) => (e.kind === "link" || e.kind === "button") && /\b(next step|checkout|check out|continue|go to cart|cart)\b/i.test(e.text ?? "") && !clicked.has(e.id));
    if (on && (clicked.has("add") || /cart|details|checkout/i.test(heading))) return { kind: "click", id: on.id };
  }
  // a form: its first empty box (AgentZero never types: the phone makes it the person's)
  if (WANTS_FORM.test(task)) {
    const box = els.find((e) => e.kind === "field" && !e.filled);
    if (box) return { kind: "fill", id: box.id, value: "{{profile.name}}" };
  }
  // an answer on this page: a line that says most of what was asked
  if (!WANTS_CART.test(task)) {
    const lines = els.filter((e) => e.kind === "text").map((e) => e.text ?? "");
    const best = lines.map((l) => ({ l, n: overlap(want, `${heading} ${l}`) })).sort((x, y) => y.n - x.n)[0];
    if (best && best.n >= Math.min(2, want.length) && (onTopic || best.n >= 3)) return { kind: "done", summary: best.l };
  }
  // else the link or button that says most of the task, not tapped before
  const go = els
    .filter((e) => (e.kind === "link" || e.kind === "button") && !clicked.has(e.id))
    .map((e, i) => ({ e, i, n: overlap(want, `${e.text ?? ""} ${e.label ?? ""}`) }))
    .filter((x) => x.n > 0)
    .sort((x, y) => y.n - x.n || x.i - y.i)[0];
  if (go) return { kind: "click", id: go.e.id };
  // more pages to look through
  const more = els.find((e) => e.kind === "link" && /\b(next page|more stories|more)\b/i.test(e.text ?? "") && !clicked.has(e.id));
  if (more) return { kind: "click", id: more.id };
  if (WANTS_SIGN_IN.test(task) && /account/i.test(heading)) return { kind: "done", summary: `You're signed in on ${host}.` };
  return { kind: "done", summary: `AgentZero didn't find that on ${host}.`, missed: true };
}

/** The Sim's thinker: `ms` is how long it seems to think (the Sim shows the run's clock). */
export function simThinker(o: { ms?: number; sleep?: (ms: number) => Promise<void> } = {}): SimThinker {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    async next(input) {
      if (o.ms) await sleep(o.ms);
      return { ok: simStep(input) };
    },
  };
}
