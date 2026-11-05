// One move per key across every core that could make it (audit RM-4): two windows of the web app, or a core restarted
// while a call still runs. A keyed move runs holding a lock on its key; another core asking with the same key waits for
// it (the move is kept by then, so asking again answers with it).
//
// Speed (D145, 3 Nov): the lock is a real one, so an uncontended move pays nothing. It was a token written to the vault,
// held a FIXED 100 ms and read back (the vault has no compare-and-swap), on every money move.
// - Where the platform has Web Locks (every browser window and WKWebView: `navigator.locks`), the lock is the
//   browser's, held across every window and worker of the app's origin, and freed when one closes.
// - In this realm too, always: one queue per key, so two cores in one JavaScript context (a core restarted while its
//   first call still runs, the phone's one context, tests) never run one key at once even without Web Locks.
// A wait longer than `waitMs` gives up with "this move is still being made elsewhere", as before.

const STALE_MS = 2 * 60_000;
const BUSY = "this move is still being made elsewhere";

/** The keys being made in this realm: each key's last holder, which the next waits for. By the vault's storage
 *  (lockScope: every copy of one vault shares it); a vault with none (in memory) has its own. */
const scoped = new Map<string, Map<string, Promise<void>>>();
const unscoped = new WeakMap<object, Map<string, Promise<void>>>();
function queuesOf(vault: unknown): Map<string, Promise<void>> {
  const scope = (vault as { lockScope?: unknown } | null)?.lockScope;
  if (typeof scope === "string") { let q = scoped.get(scope); if (!q) scoped.set(scope, (q = new Map())); return q; }
  if (vault && typeof vault === "object") { let q = unscoped.get(vault); if (!q) unscoped.set(vault, (q = new Map())); return q; }
  let q = scoped.get(""); if (!q) scoped.set("", (q = new Map())); return q;
}

type Locks = { request<T>(name: string, o: { signal?: AbortSignal }, run: () => Promise<T>): Promise<T> };
const webLocks = (): Locks | null => {
  const l = "navigator" in globalThis ? (globalThis as { navigator?: { locks?: Locks } }).navigator?.locks : undefined; // the phone's context has none
  return l && typeof l.request === "function" ? l : null;
};

/** `p`, or a refusal once `ms` passed. */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, no) => { t = setTimeout(() => no(new Error(BUSY)), ms); })]).finally(() => clearTimeout(t));
}

/** Run holding `name` in this realm: after every earlier holder of it, never beside one. */
async function inRealm<T>(queues: Map<string, Promise<void>>, name: string, run: () => Promise<T>, waitMs: number): Promise<T> {
  const before = queues.get(name) ?? Promise.resolve();
  let free!: () => void;
  const mine = before.then(() => new Promise<void>((r) => { free = r; }));
  queues.set(name, mine);
  try {
    await within(before, waitMs);
  } catch (e) {
    // gave up waiting: our turn passes the moment the earlier holder is done (the next waits on it, never on us)
    void before.then(() => free());
    throw e;
  }
  try {
    return await run();
  } finally {
    free();
    if (queues.get(name) === mine) queues.delete(name);
  }
}

/**
 * Run `run` holding `name`'s key in `vault`'s storage; while another core holds it, wait (at most `waitMs`), then run: the
 * caller's own key record answers with the move the other core kept. Web Locks only for a vault with a lockScope (a
 * storage another window can share); `_now` is kept for the callers' shape.
 */
export async function withMoveKey<T>(vault: unknown, name: string, _now: () => number, run: () => Promise<T>, waitMs = STALE_MS): Promise<T> {
  const queues = queuesOf(vault);
  const scope = (vault as { lockScope?: unknown } | null)?.lockScope;
  const locks = typeof scope === "string" ? webLocks() : null;
  if (!locks) return inRealm(queues, name, run, waitMs);
  const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(waitMs) : undefined;
  let granted = false;
  try {
    return await locks.request(`zf-move-key:${String(scope)}:${name}`, signal ? { signal } : {}, () => { granted = true; return inRealm(queues, name, run, waitMs); });
  } catch (e) {
    // the wait for another window's hold ran out: said as before; anything the move itself threw goes on as it was
    if (!granted) throw new Error(BUSY);
    throw e;
  }
}
