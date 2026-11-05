// Stale-while-revalidate cache for market data: memory + localStorage, so the UI paints INSTANTLY (a product review graded the Trade tab F on speed).
//  - fresh   : younger than `freshMs`  -> returned, nothing else happens;
//  - stale   : older than freshMs but younger than `staleMs` -> returned AT ONCE and refreshed in the background (one refresh per key at a time);
//  - missing : the only case that waits for the network; if the network fails, anything up to MAX_STALE_MS old is still better than an error.
// Public display data only (trending, coin pages, candles, pool hints, logo urls): nothing here is a balance, a key or an amount of money.
// Every localStorage access is wrapped (private windows, blocked storage, a full quota): the cache then simply lives in memory.
export const MAX_STALE_MS = 24 * 3600_000; // also the life of a token's security verdict (coin.ts)
const PREFIX = "zerofee-trade-market:v1:";
const MAX_KEYS = 160;

export interface Store {
  get<T>(key: string): { v: T; at: number } | undefined;
  set<T>(key: string, v: T): void;
  /** Serves `load()`'s answer through the cache rules above. */
  swr<T>(key: string, freshMs: number, staleMs: number, load: () => Promise<T>): Promise<T>;
  /** Peek without any refresh (tests). */
  peek<T>(key: string, maxAgeMs: number): T | undefined;
}

export function createStore(now: () => number, storage?: Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length"> | null): Store {
  const mem = new Map<string, { v: unknown; at: number }>();
  const inflight = new Map<string, Promise<unknown>>();
  const ls = (() => { try { return storage === undefined ? (globalThis as { localStorage?: Storage }).localStorage ?? null : storage; } catch { return null; } })();

  const read = (key: string): { v: unknown; at: number } | undefined => {
    const m = mem.get(key);
    if (m) return m;
    if (!ls) return undefined;
    try {
      const raw = ls.getItem(PREFIX + key);
      if (!raw) return undefined;
      const e = JSON.parse(raw) as { v: unknown; at: number };
      // dated in the future, it would read as fresh forever: dropped like an old one
      if (typeof e?.at !== "number" || e.at > now() || now() - e.at > MAX_STALE_MS) { ls.removeItem(PREFIX + key); return undefined; }
      mem.set(key, e);
      return e;
    } catch { return undefined; }
  };
  const write = (key: string, v: unknown): void => {
    const e = { v, at: now() };
    mem.set(key, e);
    if (!ls) return;
    try {
      ls.setItem(PREFIX + key, JSON.stringify(e));
    } catch {
      // quota: drop the oldest entries of ours and try once more
      try {
        const mine: { k: string; at: number }[] = [];
        for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k?.startsWith(PREFIX)) { try { mine.push({ k, at: (JSON.parse(ls.getItem(k) ?? "{}") as { at?: number }).at ?? 0 }); } catch { mine.push({ k, at: 0 }); } } }
        mine.sort((a, b) => a.at - b.at).slice(0, Math.max(8, mine.length >> 1)).forEach((x) => ls.removeItem(x.k));
        ls.setItem(PREFIX + key, JSON.stringify(e));
      } catch { /* memory only */ }
    }
    if (mem.size > MAX_KEYS) { const old = [...mem.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, mem.size - MAX_KEYS); old.forEach(([k]) => mem.delete(k)); }
  };

  const refresh = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const running = inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const p = load().then((v) => { write(key, v); return v; }).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };

  return {
    get: (key) => read(key) as never,
    set: (key, v) => write(key, v),
    peek: (key, maxAge) => { const e = read(key); return e && now() - e.at <= maxAge ? (e.v as never) : undefined; },
    async swr<T>(key: string, freshMs: number, staleMs: number, load: () => Promise<T>): Promise<T> {
      const e = read(key);
      const age = e ? now() - e.at : Infinity;
      if (e && age < freshMs) return e.v as T;
      if (e && age < staleMs) { void refresh(key, load).catch(() => {}); return e.v as T; }
      try { return await refresh(key, load); } catch (err) {
        if (e && age < MAX_STALE_MS) return e.v as T; // an old answer beats an error
        throw err;
      }
    },
  };
}
