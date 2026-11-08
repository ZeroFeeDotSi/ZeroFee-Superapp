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
  /** M12-1 (8 Nov): the receipt's head once its job landed (every row done on a chain read): never "Job created." over
   *  a landed figure and how long it took. */
  landed: "Done.",
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
  /** the copy review's W1 (6 Nov): a job Private pays whole (a hot key, D143: no Face ID by design), said on its row and its page, so
   *  no Face ID never reads as nothing signed. */
  fromPrivate: "From Private, so no Face ID.",
  fromPrivatePage: "Private money is already set up to spend, so it pays without Face ID. The Safe always asks.",
  /** the audit's ruling (B), 7 Nov: a job the page said Private pays whole (made at the tap), whose core asks the Safe after all:
   *  its row waits on the Face ID, Signed unlit, until the Safe has signed (job.signed). Provisional (to 53). */
  faceIdWait: "Waiting for your Face ID",
  /** Its Not now (or a Face ID that failed): the job ends, never left waiting (the core's own words for a no). */
  saidNo: "You said no, so nothing moved.",
  /** the audit's ruling (8 Nov): a reopened page can't prove nothing moved (Private's way home, the core's answer not kept, a
   *  move out of Private after its start in the ledger, or the ledger unread): never "nothing moved" without proof. */
  mayHaveMoved: "Check Activity for where this is.",
} as const;

/** The receipt's W1 line (the copy review's W1, 6 Nov; J3, 7 Nov: a $10 Swap from the Safe that Private pays whole went straight to its
 *  receipt with no word of why no Face ID came): a Safe route (`safeRoute`, Swap's topup) whose fill rule says the Safe
 *  signs nothing (`signs` false: Private pays it whole, D143) says JOB_WORDS.fromPrivate; the Safe signing, or its coins
 *  not read (undefined: the sheet comes), or a wallet's own swap: nothing. Pure: a table test. */
export const receiptPrivate = (safeRoute: boolean, signs: boolean | undefined): string | null => (safeRoute && signs === false ? JOB_WORDS.fromPrivate : null);

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
  /** the audit's (B), 7 Nov: a job made at the tap as Private's alone (no Face ID) whose core asks the Safe after all: its row
   *  says JOB_WORDS.faceIdWait, every step not begun (Signed is the checkpoint now, unlit), no "From Private" line, until
   *  approved() (the Safe signed: job.signed) or failed(). */
  asked(): void;
}

/** Each job's own rows, by its id (its starting row, then the ids it was made with): its receipt follows these and no
 *  other job's (QA's finding, 7 Nov; job-steps.ts receiptRows). This page's jobs only: a receipt lives no longer. */
const rowsOfJob = new Map<string, Set<string>>();
/** Whether the row `row` is one of job `job`'s own (its starting row, or one it was made with). */
export const jobRows = (job: string): ((row: string) => boolean) => (row) => rowsOfJob.get(job)?.has(row) ?? false;
/** A job that is its own one row (Trade's Safe Buy and Sell, native/swap.ts runSwap: published at the tap under `id`), so
 *  its receipt follows that row and no other job's (builder 15, 8 Nov). Answers the id. */
export const ownRowJob = (id: string): string => (rowsOfJob.has(id) || rowsOfJob.set(id, new Set([id])), id);

const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Makes the job's row now, pulses the bell, and hands back how its end is told. `title` starts with its verb
 *  ("Move $30.00"): Home's row says it going ("Moving $30.00"). */
/** `id`: the job's own row id when it is known at the tap (a Safe Move's `move:mv-<key>`, the core's row from its start):
 *  one row, never a second. `etaSec`: how long the protocol takes (its quote, or the route's measured time): the row
 *  counts down from the tap. */
export function startJob(tasks: Tasks | undefined, job: { title: string; usd?: string; id?: string; etaSec?: number; /** a Safe job: its first step is its approval */ approve?: boolean; /** Private pays it whole: no Face ID, said (W1) */ fromPrivate?: boolean }, o: { now?: () => number; store?: { list(): { id: string }[]; subscribe(fn: () => void): () => void } } = {}): JobHandle {
  const now = o.now ?? Date.now;
  const id = job.id ?? `${STARTING}${rand()}`;
  let endsAt = job.etaSec && job.etaSec > 0 ? now() + job.etaSec * 1000 : undefined;
  rowsOfJob.set(id, new Set([id]));
  tasks?.publish({ id, title: job.title, ...(job.usd ? { usd: job.usd } : {}), steps: job.approve ? [{ label: JOB_WORDS.approve, state: "doing", at: now() }, { label: JOB_WORDS.starting, state: "waiting", at: now() }] : job.fromPrivate ? [{ label: JOB_WORDS.fromPrivate, state: "done", at: now() }, { label: JOB_WORDS.starting, state: "doing", at: now() }] : [{ label: JOB_WORDS.starting, state: "doing", at: now() }], ...(job.fromPrivate && !job.approve ? { detail: JOB_WORDS.fromPrivatePage } : {}), ...(endsAt !== undefined ? { endsAt } : {}), staleMs: STALE_MS, staleDetail: JOB_WORDS.stale, open: { route: "activity" } });
  tasks?.pulse?.();
  // its own row id known at the tap (a Safe Move's): the core's row keeps its dollars from its first read, never only
  // once the core answered (the copy review's Sim walk, 5 Nov: the sheet $5.01, the job $5.20 while the Safe's Approve was up)
  if (job.id && (job.usd || endsAt !== undefined)) carryTo([job.id], { ...(job.usd ? { usd: job.usd } : {}), ...(endsAt !== undefined ? { endsAt } : {}) });
  let over = false;
  const drop = () => { if (!tasks?.drop?.(id)) tasks?.end(id, "done"); };
  let yes = false;
  /** A8: when the Approve came (ms), for "Done in". */
  let approvedAt: number | undefined;
  let asking = false;
  return {
    id,
    approved() {
      if (over || !(job.approve || asking) || yes) return;
      yes = true;
      // audit 10's A8 (8 Nov): the clock starts at the Approve. A Safe job waits on its Check sheet (12 s to fill, then the
      // person reads it), so a clock from the tap said "Slower than usual" on its first frame after Approve and "Done in
      // 1 min" for a Move done 6 s after it; now the whole job's time counts from here, and "Done in" too
      approvedAt = now();
      endsAt = job.etaSec && job.etaSec > 0 ? now() + job.etaSec * 1000 : undefined;
      tasks?.update(id, { startedAt: now(), steps: [{ label: JOB_WORDS.approved, state: "done", at: now() }, { label: JOB_WORDS.starting, state: "doing", at: now() }], ...(endsAt !== undefined ? { endsAt } : {}) });
      if (job.id) carryTo([job.id], { ...(job.usd ? { usd: job.usd } : {}), ...(endsAt !== undefined ? { endsAt, whole: true as const } : {}), from: approvedAt });
    },
    made(ids, missed) {
      if (over) return;
      over = true;
      // its rows are known before the store hears of them (drop below re-reads every receipt)
      for (const x of ids) rowsOfJob.get(id)?.add(x);
      if (missed) { tasks?.end(id, "failed", missed); return; }
      // the rows that take its place keep its dollars and its time left (job-carry.ts; Jobs hunt, 5 Nov)
      // and the job they are parts of: two core moves of one Move are its one Activity row (activity-rows.ts foldJobs)
      carryTo(ids, { ...(job.usd ? { usd: job.usd } : {}), ...(endsAt !== undefined ? { endsAt, ...(yes ? { whole: true as const } : {}) } : {}), ...(approvedAt !== undefined ? { from: approvedAt } : {}), ...(new Set(ids).size > 1 ? { job: id } : {}) });
      // the core's row IS this row (the same id): it carries on in place
      if (ids.includes(id)) return;
      // B8: the rows that take its place, kept on its own carry by id, so a reload before the hand-off ends it by them
      if (ids.length) carryTo([id], { parts: [...ids] });
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
      const signs = job.approve || asking;
      tasks?.update(id, { steps: signs && !yes ? [{ label: asking ? JOB_WORDS.faceIdWait : JOB_WORDS.approve, state: "failed", at: now() }] : [...(signs ? [{ label: JOB_WORDS.approved, state: "done" as const, at: now() }] : []), { label: JOB_WORDS.starting, state: "failed", at: now() }] });
      tasks?.end(id, "failed", words);
    },
    asked() {
      if (over || job.approve || asking || yes) return;
      asking = true;
      // nothing begun (checkpointAt: Signed now, unlit); W1's line and page words go: the Safe asks after all
      tasks?.update(id, { steps: [{ label: JOB_WORDS.faceIdWait, state: "waiting", at: now() }, { label: JOB_WORDS.starting, state: "waiting", at: now() }], detail: "" });
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
/** Private's way home's job title (Private.tsx; live-steps HOME_TRACK_WORDS.title): its reopen reads the ledger. */
export const PRIVATE_HOME_TITLE = "Move money from Private to your Safe";
/** What a reopened page does with a starting row it kept: goes on (its parts are in the ledger: live-steps homeTracks
 *  follows them to done), ends it unsure, or ends it closed (today's words). */
export type Reopen = (t: Partial<Task>) => "resume" | "unsure" | "closed" | "handed";
/** A move out of Private as the ledger lists it (private-pay.ts fromPrivate "home:<id>", the Sim's own). */
const outOfPrivate = (m: { kind?: unknown; from?: unknown }) => m.kind === "private" && m.from === "private";
/** The ledger kinds each job's own movements can have, by its title's verb (m3's SHOULD, 7 Nov). A Send pays (a payee's
 *  payment, kind "pay"; the Safe's own NEAR, "transfer"/"withdraw"); a Swap swaps in place, converts, or moves through
 *  Private or Trading; a Move, an Add and a Take out move between the person's own places. Money that came in
 *  ("deposit") and a rules change ("account") are never a job's. A verb not here: any row (no proof either way). */
const JOB_KINDS: Record<string, readonly string[]> = {
  Send: ["pay", "transfer", "withdraw"],
  Swap: ["swap", "convert", "trading", "private"],
  Move: ["trading", "private", "transfer", "convert", "swap"],
  Add: ["trading", "private", "transfer", "convert", "swap"],
  Take: ["trading", "private", "transfer", "convert", "swap"],
};
/** Whether a ledger row could be this job's own (m3's SHOULD, 7 Nov: a reopened job went unsure on ANY row since its
 *  start, money that came in or another payee's Send). Its kind by the title's verb (JOB_KINDS); a Send's payee by name,
 *  whole and in any case, or, shown short ("0x1234…78ab", pay chains.ts shortAddress), by its head and tail. What proves
 *  nothing matches: a row with no kind, a Send's row with no payee, a title of no known verb. */
export function jobMatches(title: string | undefined, m: { kind?: unknown; to?: unknown }): boolean {
  const verb = /^(\w+)/.exec(title ?? "")?.[1] ?? "";
  const kinds = JOB_KINDS[verb];
  if (!kinds || typeof m.kind !== "string") return true;
  if (!kinds.includes(m.kind)) return false;
  if (verb !== "Send" || typeof m.to !== "string" || !m.to) return true;
  const who = / to (\S+)$/.exec(title ?? "")?.[1];
  if (!who) return true;
  const to = m.to.toLowerCase(), w = who.toLowerCase();
  const short = /^(.+)…(.+)$/.exec(w);
  return short ? to.startsWith(short[1]!) && to.endsWith(short[2]!) : to === w;
}
/** How far a ledger row's start may sit before the job's own (the core's clock and the page's). */
export const REOPEN_SLACK_MS = 5_000;
/**
 * the audit's ruling (8 Nov) on a reload while Private's way home goes. Ids kept (the job's carry `parts`, written the moment
 * the core answered): any of them in the ledger, it resumes; none, it ends unsure. No ids kept (closed before the
 * answer): "closed" only when the ledger proves no move out of Private started after the job's start; any such move,
 * or a ledger that won't answer, unsure. Every other job: closed, as before. Rows by id only, never by time or amount
 * alone (the start is only ever a proof of nothing).
 * the audit's Send audit M3 (7 Nov): the same rule for every money job's starting row. A Safe Send or Swap is made on job.signed
 * (job-run.ts), a wallet's at the tap, and neither knows its movement ids before the core answers: reopened in that gap,
 * it said "The page closed as it started." (failed) while its signed leg moved on in Activity. Now "closed" only when the
 * ledger proves no movement started after the job's start (any kind: a Send's, a Swap's, a Move's); any such movement,
 * one whose start isn't readable, or a ledger that won't answer: unsure ("Check Activity for where this is.").
 */
export async function reopenOf(bridge: Pick<Bridge, "call">, text: string | null, parts: (job: string) => readonly string[] | undefined = (job) => jobCarry().get(job)?.parts): Promise<Reopen> {
  let kept: Partial<Task>[] = [];
  // a damaged store proves nothing (the audit's SHOULD, 8 Nov): unsure, never "closed"
  try { const raw = JSON.parse(text ?? "[]") as unknown; if (Array.isArray(raw)) kept = raw as Partial<Task>[]; } catch { return () => "unsure"; }
  const starting = (t: Partial<Task>) => typeof t?.id === "string" && t.id.startsWith(STARTING) && t.state === "pending";
  const home = (t: Partial<Task>) => starting(t) && t.title === PRIVATE_HOME_TITLE;
  if (!kept.some(starting)) return () => "closed";
  const r = await bridge.call<{ id?: unknown; kind?: unknown; from?: unknown; to?: unknown; startedAtIso?: unknown; jobKey?: unknown }[]>("ledger.activity", { limit: 50 }).catch(() => null);
  const rows = r && "ok" in r && Array.isArray(r.ok) ? r.ok : null;
  return (t) => {
    if (!starting(t)) return "closed";
    if (!rows) return "unsure";
    const since = (t.startedAt ?? 0) - REOPEN_SLACK_MS;
    if (home(t)) {
      const ids = parts(t.id!);
      if (ids?.length) return rows.some((m) => typeof m.id === "string" && ids.includes(m.id)) ? "resume" : "unsure";
      return rows.some((m) => outOfPrivate(m) && Date.parse(String(m.startedAtIso)) >= since) ? "unsure" : "closed";
    }
    // audit 11's B8 (8 Nov): the core answered before the page closed (made() kept its rows' ids on its own carry): its own
    // movement in the ledger, by id, IS its end; its core row (send:, move:) says how it ended, so this row goes, never
    // "stopped" over money that moved. Its ids not in the ledger: unsure, as before
    const made = parts(t.id!);
    // M12-5 (8 Nov): a part may be the page's own key for the job, kept at the tap (jobKeyPart) and stamped by the core
    // on its movement (Movement.jobKey): a reload before the core answered finds it by that key, never by time or amount
    if (made?.length) return rows.some((m) => (typeof m.id === "string" && made.some((x) => x === m.id || x.endsWith(`:${m.id}`))) || (typeof m.jobKey === "string" && made.includes(`${JOB_KEY_PART}${m.jobKey}`))) ? "handed" : "unsure";
    // M3: every other job; a start that won't read is no proof it came before (never "nothing moved" without proof);
    // only a row that could be its own (jobMatches: its kind, a Send's payee), never any row since its start
    return rows.some((m) => jobMatches(t.title, m) && !(Date.parse(String(m.startedAtIso)) < since)) ? "unsure" : "closed";
  };
}
/** M12-5: a job's carry part that is the page's own key (Movement.jobKey), not a core row's id. */
export const JOB_KEY_PART = "key:";
/** A new key for a job, made at the tap: passed to the core (its call's `key`) and kept on the job's carry by jobKeyPart. */
export const newJobKey = (): string => `jk-${rand()}`;
/** The job's carry part for its key (reopenOf matches it to a ledger row's jobKey). */
export const jobKeyPart = (key: string): string => `${JOB_KEY_PART}${key}`;
/** The starting rows ("job:") still going in what a closed page kept: each ends with JOB_WORDS.closed, unless `reopen`
 *  says it goes on (resume) or that the ledger can't prove nothing moved (unsure: JOB_WORDS.mayHaveMoved, Activity). */
export function endOrphans(text: string | null, reopen: Reopen = () => "closed"): void {
  let kept: Partial<Task>[] = [];
  try { const raw = JSON.parse(text ?? "[]") as unknown; if (Array.isArray(raw)) kept = raw as Partial<Task>[]; } catch { return; }
  for (const t of kept) {
    if (typeof t?.id !== "string" || !t.id.startsWith(STARTING) || t.state !== "pending" || !t.app || !TASK_APP_HOME[t.app]) continue;
    const tasks = taskStore().forApp(TASK_APP_HOME[t.app].app);
    const how = reopen(t);
    if (how === "resume") continue;
    if (how === "handed") { if (!tasks.drop?.(t.id)) tasks.end(t.id, "done"); continue; }
    if (how === "unsure") { tasks.update(t.id, { where: JOB_WORDS.mayHaveMoved, open: { route: "activity" } }); tasks.end(t.id, "stopped", JOB_WORDS.mayHaveMoved); continue; }
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
  // what each job said at the tap (its dollars, time, a Swap's name, Private's way home's parts), kept with the rows
  // (job-carry.ts); read before the orphans, so a reopened job finds its parts by id
  jobCarry().keep(carries ?? old(JOB_CARRY_KEY), writer(bridge, SEALED_CARRY));
  // a starting row a closed page left (its own sheet is gone, so its made() never comes): it ends now (F2), unless the
  // ledger can't prove nothing moved (reopenOf: any money job, the audit's M3). A Safe Move's row has the core's own id (move:mv-…) and goes on from the
  // core's record; only "job:" rows are the page's alone.
  endOrphans(text, await reopenOf(bridge, text));
  try { plain?.removeItem(TASKS_KEY); plain?.removeItem(JOB_CARRY_KEY); } catch { /* nothing more to erase */ }
  return true;
}

/** the copy review's rule (5 Nov): "You can close this. It keeps going." is true only while the job is going; once it landed, it drops. */
export const watchShown = (landed: number | undefined): boolean => landed === undefined;
