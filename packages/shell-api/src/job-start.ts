// The one way a money action that runs as a job starts (product decision, 5 Nov: "I click move and then bam, a job is created, a
// slight animation on top right, Home shows the job and the popup shows job created"). The tap makes the job's row at
// once (Home's "Now" and the Activity centre, from the shared task store) and pulses the bell; the sheet says JOB_WORDS
// and its work goes on after. When the core answers, the row the live watch publishes (its own id) takes over: this
// starting row is dropped the moment that row is in the store (or after HANDOFF_MS). A refusal ends this row with its
// words: a failed job is its row, never a lost sheet. Trade's buys and sells don't come here: they are instant.
import type { Bridge } from "@zerofee/core/bridge";
import { TASKS_KEY, TASK_APP_HOME, taskStore, type Task, type Tasks } from "./tasks.ts";
import { JOB_CARRY_KEY, SEALED_CARRY, carryTo, jobCarry } from "./job-carry.ts";
import { approveStep } from "./job-steps.ts";

export const JOB_WORDS = {
  /** The sheet's line the moment the job exists (the product's own words). */
  created: "Job created.",
  /** Under it (copywriter, 5 Nov). */
  watch: "You can close this. It keeps going.",
  /** The row's step until the core answers. */
  starting: "Getting ready",
  /** A Safe job's first step until its Face ID yes, then done (QA's SHOULD, 5 Nov; the look builder's words):
   *  made at the tap, its row never suggests money moving before the approval. */
  /** the copy review's ruling (5 Nov): "Approve with Face ID." in the iPhone app, "Approve on your iPhone." on the web (approveStep) */
  get approve(): string { return approveStep().doing; },
  approved: "Approved",
  /** A starting row with no news for STALE_MS (it can't know where the money is; Home can). */
  stale: "No news for 10 minutes. Home shows your money.",
  /** A starting row whose page closed before the core answered (a reload in the second after "Job created"; QA's
   *  Jobs re-crawl F2): nothing will tell it more, so it ends at once, never 10 minutes of "Getting ready". */
  closed: "The page closed as it started. Home shows your money.",
} as const;

/** A starting row with no news this long ends with JOB_WORDS.stale. */
export const STALE_MS = 10 * 60_000;
/** The live watch's own row normally replaces the starting one at once; past this, the starting one goes anyway. */
export const HANDOFF_MS = 5_000;
/** The starting rows' ids: Home's "Now" draws them until their real rows come. */
export const STARTING = "job:";

export interface JobHandle {
  id: string;
  /** A Safe job's Face ID said yes (heard on the web; the phone's own sheet is never heard, so its core row says it):
   *  "Approve on your iPhone" becomes "Approved" with its tick. */
  approved(): void;
  /** The core made it: `ids` are the rows the live watch publishes for it ("move:<id>"); `missed`, a part that didn't go. */
  made(ids: readonly string[], missed?: string): void;
  /** Refused before anything moved, or the Face ID said no: the row ends with these words. */
  failed(words: string): void;
  /** Nothing was made and nothing needs saying (the person said no on the Safe's sheet). */
  gone(): void;
}

const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Makes the job's row now, pulses the bell, and hands back how its end is told. `title` starts with its verb
 *  ("Move $30.00"): Home's row says it going ("Moving $30.00"). */
/** `id`: the job's own row id when it is known at the tap (a Safe Move's `move:mv-<key>`, the core's row from its start):
 *  one row, never a second. `etaSec`: how long the protocol takes (its quote, or the route's measured time): the row
 *  counts down from the tap. */
export function startJob(tasks: Tasks | undefined, job: { title: string; usd?: string; id?: string; etaSec?: number; /** a Safe job: its first step is its approval */ approve?: boolean }, o: { now?: () => number; store?: { list(): { id: string }[]; subscribe(fn: () => void): () => void } } = {}): JobHandle {
  const now = o.now ?? Date.now;
  const id = job.id ?? `${STARTING}${rand()}`;
  const endsAt = job.etaSec && job.etaSec > 0 ? now() + job.etaSec * 1000 : undefined;
  tasks?.publish({ id, title: job.title, ...(job.usd ? { usd: job.usd } : {}), steps: job.approve ? [{ label: JOB_WORDS.approve, state: "doing", at: now() }, { label: JOB_WORDS.starting, state: "waiting", at: now() }] : [{ label: JOB_WORDS.starting, state: "doing", at: now() }], ...(endsAt !== undefined ? { endsAt } : {}), staleMs: STALE_MS, staleDetail: JOB_WORDS.stale, open: { route: "activity" } });
  tasks?.pulse?.();
  // its own row id known at the tap (a Safe Move's): the core's row keeps its dollars from its first read, never only
  // once the core answered (the copy review's Sim walk, 5 Nov: the sheet $5.01, the job $5.20 while the Safe's Approve was up)
  if (job.id && (job.usd || endsAt !== undefined)) carryTo([job.id], { ...(job.usd ? { usd: job.usd } : {}), ...(endsAt !== undefined ? { endsAt } : {}) });
  let over = false;
  const drop = () => { if (!tasks?.drop?.(id)) tasks?.end(id, "done"); };
  let yes = false;
  return {
    id,
    approved() {
      if (over || !job.approve || yes) return;
      yes = true;
      tasks?.update(id, { steps: [{ label: JOB_WORDS.approved, state: "done", at: now() }, { label: JOB_WORDS.starting, state: "doing", at: now() }] });
    },
    made(ids, missed) {
      if (over) return;
      over = true;
      if (missed) { tasks?.end(id, "failed", missed); return; }
      // the rows that take its place keep its dollars and its time left (job-carry.ts; Jobs hunt, 5 Nov)
      carryTo(ids, { ...(job.usd ? { usd: job.usd } : {}), ...(endsAt !== undefined ? { endsAt } : {}) });
      // the core's row IS this row (the same id): it carries on in place
      if (ids.includes(id)) return;
      // the real rows are in the store: this one goes in the same change, so the row never blinks out
      const store = o.store ?? taskStore();
      const there = () => ids.every((x) => store.list().some((t) => t.id === x));
      if (!ids.length || there()) return drop();
      let off = () => {};
      const t = setTimeout(() => { off(); drop(); }, HANDOFF_MS);
      off = store.subscribe(() => { if (!there()) return; off(); clearTimeout(t); drop(); });
    },
    failed(words) {
      if (over) return;
      over = true;
      tasks?.update(id, { steps: job.approve && !yes ? [{ label: JOB_WORDS.approve, state: "failed", at: now() }] : [...(job.approve ? [{ label: JOB_WORDS.approved, state: "done" as const, at: now() }] : []), { label: JOB_WORDS.starting, state: "failed", at: now() }] });
      tasks?.end(id, "failed", words);
    },
    gone() {
      if (over) return;
      over = true;
      drop();
    },
  };
}

// ---- the job rows, kept in Home's sealed store ----

/** Home's device.store key for the job rows (sealed as Home's own copy; never sent anywhere). */
export const SEALED_TASKS = "job-rows.v1";

/** The writes still going, each writer's own (jobsWritten waits for them). */
const writing = new Set<Promise<void>>();
/** Resolves once every job row and carry written so far is in Home's sealed store (a reload waits for it: chunk-reload.ts). */
export async function jobsWritten(): Promise<void> {
  while (writing.size) await Promise.all([...writing]);
}
/** A job the page alone carries is starting (its "job:" row, which a reload would end as closed: endOrphans). */
export function jobStarting(): boolean {
  return taskStore().list().some((t) => t.state === "pending" && t.id.startsWith(STARTING));
}

/** One writer: the newest text only, one write at a time (an older write never lands after a newer one). */
function writer(bridge: Bridge, key: string): (text: string) => void {
  let next: string | null = null, busy = false;
  const go = async () => {
    busy = true;
    while (next !== null) { const value = next; next = null; await bridge.call("device.store.set", { key, value }).catch(() => undefined); }
    busy = false;
  };
  return (text) => {
    next = text;
    if (busy) return;
    const run = go();
    writing.add(run);
    void run.finally(() => writing.delete(run));
  };
}

let sealed = false;
/** The starting rows ("job:") still going in what a closed page kept: each ends with JOB_WORDS.closed. */
export function endOrphans(text: string | null): void {
  let kept: Partial<Task>[] = [];
  try { const raw = JSON.parse(text ?? "[]") as unknown; if (Array.isArray(raw)) kept = raw as Partial<Task>[]; } catch { return; }
  for (const t of kept) {
    if (typeof t?.id !== "string" || !t.id.startsWith(STARTING) || t.state !== "pending" || !t.app || !TASK_APP_HOME[t.app]) continue;
    const tasks = taskStore().forApp(TASK_APP_HOME[t.app].app);
    tasks.update(t.id, { steps: [{ label: JOB_WORDS.starting, state: "failed", at: Date.now() }] });
    tasks.end(t.id, "failed", JOB_WORDS.closed);
  }
}
/** The job rows and what they carry (job-carry.ts) move into Home's sealed store (QA's SHOULD, 5 Nov): what it kept comes back, the old plain
 *  localStorage copy joins once and is erased, and every change from now on is written there. A store that won't answer
 *  (locked, refused) keeps them in memory for this run, and the plain copy stays for the next. Home calls it once its
 *  bridge is up (LiveTrack.tsx LiveHome). */
export async function sealJobs(bridge: Bridge, plain: Pick<Storage, "getItem" | "removeItem"> | undefined = globalThis.localStorage): Promise<boolean> {
  if (sealed) return true;
  const read = async (key: string): Promise<string | null | undefined> => {
    const r = await bridge.call<{ value: string | null }>("device.store.get", { key }).catch(() => null);
    return r && "ok" in r ? (typeof r.ok?.value === "string" ? r.ok.value : null) : undefined;
  };
  const [rows, carries] = await Promise.all([read(SEALED_TASKS), read(SEALED_CARRY)]);
  if (rows === undefined || carries === undefined || sealed) return false;
  sealed = true;
  const old = (k: string) => { try { return plain?.getItem(k) ?? null; } catch { return null; } };
  const text = rows ?? old(TASKS_KEY), put = writer(bridge, SEALED_TASKS);
  taskStore().keep({ getItem: () => text, setItem: (_k, v) => put(v) });
  // a starting row a closed page left (its own sheet is gone, so its made() never comes): it ends now (F2). A Safe Move's
  // row has the core's own id (move:mv-…) and goes on from the core's record; only "job:" rows are the page's alone.
  endOrphans(text);
  // what each job said at the tap (its dollars, time, a Swap's name), kept with the rows (job-carry.ts)
  jobCarry().keep(carries ?? old(JOB_CARRY_KEY), writer(bridge, SEALED_CARRY));
  try { plain?.removeItem(TASKS_KEY); plain?.removeItem(JOB_CARRY_KEY); } catch { /* nothing more to erase */ }
  return true;
}

/** the copy review's rule (5 Nov): "You can close this. It keeps going." is true only while the job is going; once it landed, it drops. */
export const watchShown = (landed: number | undefined): boolean => landed === undefined;
