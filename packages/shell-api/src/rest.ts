// When the page rests (product decision, 3 Nov). Nothing that only serves the eyes runs
// while nobody can see it: endless animations, idle reads and timers, the live balance push.
//
// The page RESTS while it is hidden (the app in the background, the phone locked) or COVERED: the iPhone host shows a
// site's window over the shell (device.covered; PartnerView is presented over full screen, so the shell's web view stays
// in the window, drawing and polling under it). An APP is SHOWN while it is the one on screen (the shell's `active`).
//
// `every` is the one scheduler for idle reads: one timer for all of them (the next one due, so reads due together run in
// one wake), nothing armed while the page rests, and coming back each one missed runs once (one fresh read on return).
// A money step under way never waits on this: the Spending engine's follow keeps its own timer.
//
// html[data-zf-rest] is set while the page rests: app.css pauses every animation under it.

type Doc = { visibilityState?: string; documentElement?: { dataset?: Record<string, string | undefined> }; addEventListener?(e: string, f: () => void): void };

let covered = false;
const shownApps = new Set<string>();
const listeners = new Set<() => void>();
let installed = false;

const doc = (): Doc | undefined => (globalThis as { document?: Doc }).document;

/** Hidden or covered: nothing for the eyes runs. */
export function resting(): boolean {
  return covered || doc()?.visibilityState === "hidden";
}

/** Is this app the one on screen (and the page not resting)? */
export function onScreen(app: string): boolean {
  return !resting() && shownApps.has(app);
}

let telling = false;
function changed(): void {
  const d = doc()?.documentElement?.dataset;
  if (d) {
    if (resting()) d.zfRest = "";
    else delete d.zfRest;
  }
  // told once, after the change in hand settles: moving from Wallet to Trade, React clears Wallet's `shown` before it
  // sets Trade's in one commit, and the push must not shut and reopen its sockets for that blink
  if (telling) return;
  telling = true;
  queueMicrotask(tell);
}
function tell(): void {
  telling = false;
  for (const f of [...listeners]) {
    try {
      f();
    } catch {
      // one listener's trouble is never another's
    }
  }
}

/** Tell me when resting() or onScreen() may have changed. Returns the stop. */
export function onRestChange(f: () => void): () => void {
  install();
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** The iPhone host: a site's window is over the shell (true) or gone (false). */
export function setCovered(on: boolean): void {
  if (covered === on) return;
  covered = on;
  changed();
}

/** The shell: this app is (or stopped being) the one on screen. */
export function setShown(app: string, on: boolean): void {
  if (shownApps.has(app) === on) return;
  if (on) shownApps.add(app);
  else shownApps.delete(app);
  changed();
}

/** Listens to the page's visibility once (idempotent); the page calls it at boot so the CSS mark is right from the start. */
export function install(): void {
  if (installed) return;
  const d = doc();
  if (!d?.addEventListener) return;
  installed = true;
  d.addEventListener("visibilitychange", changed);
  changed();
}

// ---- the one scheduler ----

type Clock = { now(): number; setTimeout(f: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

type Job = { ms: number; due: number; run: () => void; missed: boolean; app?: string };

/** A scheduler (tests make their own with a fake clock, rest and shown apps; the app uses `every` below). */
export function makeScheduler(clock: Clock = realClock, isResting: () => boolean = resting, onChange: (f: () => void) => () => void = onRestChange, isShown: (app: string) => boolean = (a) => shownApps.has(a)) {
  const jobs = new Set<Job>();
  let timer: unknown = null;
  let armedFor = Infinity;
  let off: (() => void) | null = null;
  /** May this read run now: the page doesn't rest, and its app (if it named one) is the one on screen. */
  const awake = (j: Job) => !isResting() && (j.app === undefined || isShown(j.app));
  const disarm = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    armedFor = Infinity;
  };
  const fire = (j: Job) => {
    try {
      j.run();
    } catch {
      // a read's own trouble never stops the others
    }
  };
  const arm = () => {
    // the earliest due among the awake reads, held back a little (a quarter of its period, at most 1 s) when another is
    // due just after it: one wake for both, and no read ever runs before its time (periods only stretch, never shrink)
    let first: Job | null = null;
    for (const j of jobs) if (awake(j) && (!first || j.due < first.due)) first = j;
    if (!first) return disarm();
    let next = first.due;
    const window = Math.min(1_000, first.ms / 4);
    for (const j of jobs) if (awake(j) && j.due <= first.due + window) next = Math.max(next, j.due);
    if (timer !== null && next === armedFor) return;
    disarm();
    armedFor = next;
    timer = clock.setTimeout(wake, Math.max(0, next - clock.now()));
  };
  const wake = () => {
    timer = null;
    armedFor = Infinity;
    const now = clock.now();
    for (const j of [...jobs]) {
      if (!jobs.has(j) || j.due > now) continue;
      if (!awake(j)) { j.missed = true; continue; }
      j.due = now + j.ms;
      j.missed = false;
      fire(j);
    }
    arm();
  };
  const restChanged = () => {
    // each read that can't run now has missed its time; each that can and missed it (or is due) runs once now
    const now = clock.now();
    for (const j of [...jobs]) {
      if (!jobs.has(j)) continue;
      if (!awake(j)) { j.missed = true; continue; }
      if (!(j.missed || j.due <= now)) continue;
      j.missed = false;
      j.due = now + j.ms;
      fire(j);
    }
    arm();
  };
  return {
    /** Runs `run` every `ms` while the page doesn't rest (and, with `app`, only while that app is on screen); returns the
     *  stop. It doesn't run at once (the caller reads first). */
    every(ms: number, run: () => void, app?: string): () => void {
      const j: Job = { ms, due: clock.now() + ms, run, missed: false, ...(app !== undefined ? { app } : {}) };
      jobs.add(j);
      if (!off) off = onChange(restChanged);
      arm();
      return () => {
        if (!jobs.delete(j)) return;
        if (jobs.size === 0) {
          disarm();
          off?.();
          off = null;
        } else arm();
      };
    },
    /** How many reads are waiting (tests). */
    get size() {
      return jobs.size;
    },
    /** Is a timer armed now (tests: none while resting). */
    get armed() {
      return timer !== null;
    },
  };
}

let shared: ReturnType<typeof makeScheduler> | null = null;
/** The app's one scheduler for idle reads: see the head of this file. `app`: only while that app is on screen too. */
export function every(ms: number, run: () => void, app?: string): () => void {
  shared ??= makeScheduler();
  return shared.every(ms, run, app);
}
