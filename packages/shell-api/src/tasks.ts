// D144 (product decision, 3 Nov): one Activity centre for the whole app. Every app publishes what it is doing (an Add, a Send, a
// trade, AgentZero's errand) as a task with numbered steps; the shell shows them all, top right of every app's header,
// grouped by app. Local only: the tasks live on this phone, nothing leaves it: in Home's sealed store (device.store, as
// Home's own copy; job-start.ts sealJobs, QA's SHOULD, 5 Nov), never plain localStorage. A pending task survives
// a restart; a task that ended (done, failed, stopped) is kept 24 h, then dropped, and never goes back to pending.
//
// An app reads it as useShell().tasks: publish, update and end its OWN tasks only. The shell stamps the app from the
// caller (forApp), as prefill's asker is stamped: an app can't write, update or end another app's task.
import { tookIn } from "./job-steps.ts";

/** The apps the centre groups by. "perps": Trade's perpetuals, or the Browser's host of them; either may name it. */
export type TaskApp = "home" | "trade" | "agentzero" | "browser" | "chat" | "perps";
export type TaskStepState = "waiting" | "doing" | "done" | "failed";
/** One numbered step: "Left your Safe", its state, and when it reached it (ms since the epoch). */
export type TaskStep = { label: string; state: TaskStepState; at?: number };
export type TaskState = "pending" | "done" | "failed" | "stopped";

export interface Task {
  /** The app's own id for it (unique within the app). */
  id: string;
  /** Stamped by the shell from the caller; what an app passes is checked against what it owns. */
  app: TaskApp;
  /** What the person asked, in their words: "Move $5.00 to your SOL wallet". */
  title: string;
  steps: TaskStep[];
  state: TaskState;
  startedAt: number;
  endedAt?: number;
  /** One more line: why it stopped, what it's waiting for. */
  detail?: string;
  /** Where the money is now: "In your NEAR wallet". */
  where?: string;
  /** Its dollars, as said ("$5.00"; AgentZero's small sums to the tenth of a cent, "$0.045"): the row's right column. */
  usd?: string;
  /** Where a tap takes the person: the app's own route (its tab, as openApp's). */
  open?: { route?: string };
  /** Set by the store on every publish and update. */
  updatedAt?: number;
  /** A hard end (product decision, 3 Nov: tasks stuck "…" for hours): a pending task with no update for this long ends failed, with
   *  `staleDetail`. An app sets it only where it knows what such an end means (a sign-in: nothing moved); a money task
   *  ends by its own reads, never by this (the store can't know where the money is). */
  staleMs?: number;
  staleDetail?: string;
  /** When it should be done (ms since the epoch), from the protocol's own quote or the route's measured time: the row
   *  counts down to it from the tap (product decision, 5 Nov). Display only. */
  endsAt?: number;
  /** Its public transactions (S3, 4 Nov: a trade's row had no signature, so nobody could check it on chain): each with
   *  its chain, drawn under the row with Copy, and View where the chain has an explorer people know. */
  proof?: TaskTx[];
}
/** One public transaction of a task: its chain ("sol", "bsc", …) and its id as the chain writes it. */
export type TaskTx = { chain: string; hash: string };

/** What an app hands publish: the task without its app (the shell stamps it), or naming one the app owns. */
export type TaskInput = Omit<Task, "app" | "state" | "startedAt"> & { app?: TaskApp; state?: TaskState; startedAt?: number };
export type TaskPatch = Partial<Omit<Task, "id" | "app">>;

/** What every app gets on useShell().tasks. Each call answers whether it was taken (false: not this app's task). */
export interface Tasks {
  publish(task: TaskInput): boolean;
  update(id: string, patch: TaskPatch): boolean;
  end(id: string, state: Exclude<TaskState, "pending">, detail?: string): boolean;
  /** Opens the Activity centre on the app on screen, all of it or only one app's tasks (a chip at its top clears that):
   *  AgentZero's "Jobs" row opens the one centre. Reading only: any app may open it on any app's group. `back`: opened
   *  from a list one step up (Home's Your account sheet): the centre's ‹ goes back there (k-security crawl, 4 Nov). */
  open(o?: { app?: TaskApp; back?: () => void }): void;
  /** A job was just made (job-start.ts): the bell, top right, gives one short pulse. */
  pulse?(): void;
  /** Drops one of the app's own tasks (a starting job its real row now stands for). */
  drop?(id: string): boolean;
}

/** Each shell app and the task apps it may write. */
export const TASK_APPS: Record<string, readonly TaskApp[]> = {
  wallet: ["home"], pay: ["home"], trade: ["trade", "perps"], agent: ["agentzero"], browser: ["browser", "perps"], social: ["browser", "perps"], chat: ["chat"],
};
/** Each task app's shell app and name (the centre's group heading; a tap opens it). */
export const TASK_APP_HOME: Record<TaskApp, { app: string; name: string }> = {
  home: { app: "wallet", name: "Home" }, trade: { app: "trade", name: "Trade" }, perps: { app: "trade", name: "Perps" },
  agentzero: { app: "agent", name: "AgentZero" }, browser: { app: "browser", name: "Browser" }, chat: { app: "chat", name: "Chat" },
};

/** The shell apps whose tab in the bottom row gets a quiet dot (product decision, 4 Nov): something of theirs is going, and they
 *  aren't the app on screen. */
export function newsApps(tasks: readonly Pick<Task, "app" | "state">[], here: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const t of tasks) if (t.state === "pending") for (const [shell, apps] of Object.entries(TASK_APPS)) if (apps.includes(t.app) && shell !== here) out.add(shell);
  return out;
}

export const TASKS_KEY = "zf.tasks.v1";
export const KEPT_MS = 24 * 60 * 60_000;
const MAX = 200;
type Kv = Pick<Storage, "getItem" | "setItem">;
const STATES: readonly TaskState[] = ["pending", "done", "failed", "stopped"];
const STEP_STATES: readonly TaskStepState[] = ["waiting", "doing", "done", "failed"];
const str = (v: unknown, n = 300): string | undefined => (typeof v === "string" && v ? v.slice(0, n) : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** A task's transactions: a known chain's short name and an id as a chain writes it (base58 or 0x hex), four at most. */
const proofOf = (v: unknown): TaskTx[] => (Array.isArray(v) ? v : []).slice(0, 4).flatMap((x) => {
  const chain = typeof x?.chain === "string" && /^[a-z]{2,8}$/.test(x.chain) ? x.chain : undefined;
  const hash = typeof x?.hash === "string" && (/^0x[0-9a-fA-F]{64}$/.test(x.hash) || /^[1-9A-HJ-NP-Za-km-z]{20,100}$/.test(x.hash)) ? x.hash : undefined;
  return chain && hash ? [{ chain, hash }] : [];
});

/** A task as kept: only known fields, of the right kinds (a damaged copy, or an app's extra fields, never reach the UI). */
function clean(t: Partial<Task> & { app: TaskApp }): Task | null {
  const id = str(t.id, 120), title = str(t.title, 200), startedAt = num(t.startedAt);
  if (!id || !title || startedAt === undefined || !STATES.includes(t.state as TaskState)) return null;
  const steps = (Array.isArray(t.steps) ? t.steps : []).slice(0, 12).flatMap((s) => {
    const label = str(s?.label, 120), at = num(s?.at);
    return label && STEP_STATES.includes(s.state) ? [{ label, state: s.state, ...(at !== undefined ? { at } : {}) }] : [];
  });
  const endedAt = num(t.endedAt), detail = str(t.detail), where = str(t.where, 200), usd = typeof t.usd === "string" && /^\$[\d,]+(\.\d{1,3})?$/.test(t.usd) ? t.usd : undefined, route = str(t.open?.route, 200);
  const updatedAt = num(t.updatedAt), staleMs = num(t.staleMs), staleDetail = str(t.staleDetail), proof = proofOf(t.proof), endsAt = num(t.endsAt);
  return { id, app: t.app, title, steps, state: t.state as TaskState, startedAt, ...(updatedAt !== undefined ? { updatedAt } : {}), ...(staleMs !== undefined && staleMs > 0 ? { staleMs } : {}), ...(staleDetail ? { staleDetail } : {}), ...(endedAt !== undefined ? { endedAt } : {}), ...(detail ? { detail } : {}), ...(where ? { where } : {}), ...(usd ? { usd } : {}), ...(t.open ? { open: route ? { route } : {} } : {}), ...(proof.length ? { proof } : {}), ...(endsAt !== undefined ? { endsAt } : {}) };
}

export interface TaskStore {
  /** Every task kept, newest first (those ended over 24 h ago are gone). */
  list(): Task[];
  /** How many are still going (the badge). */
  pending(): number;
  /** Told on every change; returns its own off. */
  subscribe(fn: () => void): () => void;
  /** The facade an app gets: its writes are stamped and checked against what it owns. */
  forApp(shellApp: string): Tasks;
  /** The last ask to open the centre (`seq` counts them; the frame on screen opens it, once per ask). */
  openAsk(): { seq: number; app?: TaskApp; back?: () => void };
  /** How many jobs were made on this page (each one pulses the bell once). */
  added(): number;
  /** The shell's own: drops a task (a parked sheet taken back up, D146). Never on an app's facade. */
  remove(app: TaskApp, id: string): void;
  /** The shell's own (job-start.ts sealJobs): the tasks kept in `next` (Home's sealed store) join this page's (this
   *  page's win), and every change from now on is written there. */
  keep(next: Kv): void;
}

/** b18: an end written ahead, in this tab's own session storage, the moment it happens. Home's sealed store takes a
 *  moment to write (an async call; measured under 200 ms in the Sim), so a reload right after a job ended read the row
 *  back pending, and the row then said the job was cut off. The record holds no words, no site and no figures (the
 *  the review's ruling, 8 Nov): only the job's id as a number (a hash of its app and id), its state, its end time and
 *  how long it took. The next load's keep() applies it to a row still pending: the row's own line comes from the sealed
 *  store when its final line landed there first (it ends "Took N s."), else "Done. Took N s." with no
 *  report (a stop: the plain ended words), never a wrong line. Then the record is dropped. */
export const TASK_ENDS_KEY = "zf.tasks.ends.v1";
type Ahead = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type EndAhead = { jobId: number; state: "done" | "stopped" | "failed"; endedAt: number; tookMs: number };
/** A job's id in the record: FNV-1a of its app and id, a number (no letters leave the sealed store). */
export const jobNumber = (app: string, id: string): number => {
  let h = 0x811c9dc5;
  for (const c of `${app}\u0001${id}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h;
};
const sessionOr = (): Ahead | undefined => {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
};
const readEnds = (ahead: Ahead | undefined): EndAhead[] => {
  try {
    const raw = JSON.parse(ahead?.getItem(TASK_ENDS_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((e): e is EndAhead => !!e && typeof e === "object" && Number.isInteger(e.jobId) && ["done", "stopped", "failed"].includes(e.state) && Number.isFinite(e.endedAt) && Number.isFinite(e.tookMs) && e.tookMs >= 0) : [];
  } catch {
    return [];
  }
};

export function createTaskStore({ kv, now = Date.now, ahead = sessionOr() }: { kv?: Kv | undefined; now?: () => number; ahead?: Ahead | undefined } = {}): TaskStore {
  let tasks: Task[] = [];
  try {
    const raw = JSON.parse(kv?.getItem(TASKS_KEY) ?? "[]") as unknown;
    if (Array.isArray(raw)) tasks = raw.flatMap((t) => (t && TASK_APP_HOME[(t as Task).app] ? [clean(t as Task)].filter((x): x is Task => !!x) : []));
  } catch {
    tasks = []; // a damaged copy is no copy
  }
  const fns = new Set<() => void>();
  /** The hard end: a pending task past its staleMs ends failed. Before staleMs existed, the Browser's sign-ins were left
   *  pending for hours by a frozen warm window (phone test, 3 Nov): those (id "signin-…") get the Browser's own
   *  2 minutes, so the ones already stranded on a phone clear on its next open. */
  const limitOf = (t: Task): { ms: number; detail: string } | null =>
    t.staleMs ? { ms: t.staleMs, detail: t.staleDetail ?? "Didn't finish." }
      : t.app === "browser" && t.id.startsWith("signin-") ? { ms: 2 * 60_000, detail: "Didn't finish signing in. Nothing moved." } : null;
  const fresh = () => {
    const cut = now() - KEPT_MS;
    let ended = false;
    tasks = tasks.map((t) => {
      if (t.state !== "pending") return t;
      const l = limitOf(t);
      if (!l || now() - (t.updatedAt ?? t.startedAt) <= l.ms) return t;
      ended = true;
      return { ...t, state: "failed" as TaskState, endedAt: now(), detail: l.detail, steps: t.steps.map((s) => (s.state === "doing" || s.state === "waiting" ? { ...s, state: "failed" as TaskStepState } : s)) };
    });
    tasks = tasks.filter((t) => t.state === "pending" || (t.endedAt ?? t.startedAt) > cut);
    if (ended) try { kv?.setItem(TASKS_KEY, JSON.stringify(tasks.slice(0, MAX))); } catch { /* kept in memory */ }
    return tasks;
  };
  const save = () => {
    fresh();
    tasks = tasks.slice(0, MAX);
    try { kv?.setItem(TASKS_KEY, JSON.stringify(tasks)); } catch { /* a full or blocked store: kept in memory for this run */ }
    for (const f of [...fns]) f();
  };
  const find = (app: TaskApp, id: string) => tasks.findIndex((t) => t.app === app && t.id === id);
  /** A task that ended stays ended: a write that would make it pending again is refused (core hunt, 5 Nov). */
  const back = (at: number, t: Task) => at >= 0 && tasks[at]!.state !== "pending" && t.state === "pending";
  let ask: { seq: number; app?: TaskApp; back?: () => void } = { seq: 0 };
  let made = 0;
  return {
    list: () => [...fresh()].sort((a, b) => b.startedAt - a.startedAt),
    pending: () => fresh().filter((t) => t.state === "pending").length,
    subscribe: (fn) => { fns.add(fn); return () => { fns.delete(fn); }; },
    openAsk: () => ask,
    added: () => made,
    remove(app, id) {
      const at = find(app, id);
      if (at < 0) return;
      tasks.splice(at, 1);
      save();
    },
    keep(next) {
      tasks = [...tasks, ...createTaskStore({ kv: next, now, ahead: undefined }).list().filter((t) => find(t.app, t.id) < 0)];
      kv = next;
      // b18: ends written ahead (a reload came before the sealed write): a row still pending here had ended
      const ends = readEnds(ahead);
      tasks = tasks.map((t) => {
        const e = ends.find((x) => x.jobId === jobNumber(t.app, t.id));
        if (t.state !== "pending" || !e) return t;
        // its final line (it ends "Took …"), when it reached the sealed store before the end did; else no report, never a
        // wrong line
        const line = e.state === "done" ? (t.detail && /\bTook [^.]+\.$/.test(t.detail) ? t.detail : `Done. ${tookIn(e.tookMs)}`) : undefined;
        const { detail: _old, ...rest } = t;
        return { ...rest, state: e.state, endedAt: e.endedAt, steps: t.steps.map((x) => (x.state === "doing" ? { ...x, state: "waiting" as TaskStepState } : x)), ...(line ? { detail: line } : {}) };
      });
      try { ahead?.removeItem(TASK_ENDS_KEY); } catch { /* nothing to drop */ }
      save();
    },
    forApp(shellApp) {
      const owns = TASK_APPS[shellApp] ?? [];
      // the app a write is for: the one it names if it owns it; else its own first; none for an app that owns none
      const appOf = (asked?: TaskApp): TaskApp | null => (asked ? (owns.includes(asked) ? asked : null) : owns[0] ?? null);
      const mine = (id: string): number => owns.reduce((at, a) => (at >= 0 ? at : find(a, id)), -1);
      return {
        publish(input) {
          const app = appOf(input.app);
          if (!app) return false;
          const t = clean({ ...input, app, state: input.state ?? "pending", startedAt: input.startedAt ?? now(), updatedAt: now() });
          if (!t) return false;
          const at = find(app, t.id);
          if (back(at, t)) return false;
          if (at >= 0) tasks[at] = t; else tasks.unshift(t);
          save();
          return true;
        },
        update(id, patch) {
          const at = mine(id);
          if (at < 0) return false;
          const t = clean({ ...tasks[at]!, ...patch, id: tasks[at]!.id, app: tasks[at]!.app, updatedAt: now() });
          if (!t || back(at, t)) return false;
          tasks[at] = t;
          save();
          return true;
        },
        end(id, state, detail) {
          const at = mine(id);
          if (at < 0 || !STATES.includes(state) || state === ("pending" as TaskState)) return false;
          // an ended task has nothing going on: a step still "doing" waits (no "…" under Done, Stopped or Didn't finish)
          const steps = tasks[at]!.steps.map((x) => (x.state === "doing" ? { ...x, state: "waiting" as TaskStepState } : x));
          tasks[at] = { ...tasks[at]!, state, steps, endedAt: now(), ...(detail ? { detail: detail.slice(0, 300) } : {}) };
          // b18: written ahead, at once (numbers and the state word only), so a reload before the sealed write keeps it
          try {
            const t = tasks[at]!;
            if (state === "done" || state === "stopped" || state === "failed") {
              const rec: EndAhead = { jobId: jobNumber(t.app, t.id), state, endedAt: t.endedAt!, tookMs: Math.max(0, t.endedAt! - t.startedAt) };
              ahead?.setItem(TASK_ENDS_KEY, JSON.stringify([...readEnds(ahead).filter((x) => x.jobId !== rec.jobId), rec].slice(-20)));
            }
          } catch { /* no tab storage: the sealed write alone, as before */ }
          save();
          return true;
        },
        pulse() {
          made++;
          for (const f of [...fns]) f();
        },
        drop(id) {
          const at = mine(id);
          if (at < 0) return false;
          tasks.splice(at, 1);
          save();
          return true;
        },
        open(o) {
          const app = o?.app && TASK_APP_HOME[o.app] ? o.app : undefined;
          ask = { seq: ask.seq + 1, ...(app ? { app } : {}), ...(typeof o?.back === "function" ? { back: o.back } : {}) };
          for (const f of [...fns]) f();
        },
      };
    },
  };
}

// One store per page, kept on globalThis (as the shell's context): every copy of this module shares it.
const KEY = Symbol.for("zerofee.tasks");
const g = globalThis as { [KEY]?: TaskStore };
/** The page's one store (in memory until Home's sealed store joins it: job-start.ts sealJobs). */
export const taskStore = (): TaskStore => (g[KEY] ??= createTaskStore());
