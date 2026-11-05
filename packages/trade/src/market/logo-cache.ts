// Logos that never flash. Each logo url is loaded and decoded once, before its row needs it (the first screenful of a
// list, a coin pressed on its way to its page), and what came of it is remembered on the device:
//  - "ok": the picture is decoded and in the browser's cache, so the row draws it in the first frame;
//  - "none": the relay had none (404) or refused the coin (400: today's relay predates NEAR's logos), or it didn't decode,
//    so the row draws the monogram at once, and never a broken image first, again and again on every paint.
// A miss is kept 6 hours (a new coin gets its picture), a hit a week. Public display data only: a url, never an amount.
export type LogoState = "ok" | "none" | "loading";

export const LOGO_OK_MS = 7 * 24 * 3600_000;
export const LOGO_MISS_MS = 6 * 3600_000;
/** Pictures fetched at once (the rest wait their turn): a screenful is about 8 rows. */
export const LOGO_PARALLEL = 6;
/** A picture slower than this counts as none for this paint (the monogram); it is tried again next time. */
export const LOGO_WAIT_MS = 4_000;
const KEY = "zerofee-trade-logos:v1";
const KEEP = 400;

export interface LogoCache {
  /** What is known of a url: undefined when it was never tried. */
  state(url: string): LogoState | undefined;
  /** Load and decode these urls (the first ones first), at most LOGO_PARALLEL at a time. Resolves when all are known. */
  preload(urls: readonly (string | undefined)[]): Promise<void>;
  /** Called on every change of a url's state. Returns the unsubscribe. */
  subscribe(f: (url: string) => void): () => void;
}

export interface LogoCacheOptions {
  /** Loads and decodes one picture: true when it can be drawn. In a browser: an Image's decode(). */
  load: (url: string) => Promise<boolean>;
  now?: () => number;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  /** How a slow load is given up on (default: a real timer). */
  timeout?: (ms: number) => Promise<void>;
}

/** The browser's loader: the picture is fetched as an <img> would fetch it (no Origin, the same cache) and decoded off the
 *  main thread, so drawing it later costs nothing. */
export const browserLoad = (url: string): Promise<boolean> => {
  const Img = (globalThis as { Image?: new () => HTMLImageElement }).Image;
  if (!Img) return Promise.resolve(false);
  const img = new Img();
  img.decoding = "async";
  img.src = url;
  return img.decode().then(() => img.naturalWidth > 0, () => false);
};

export function createLogoCache(o: LogoCacheOptions): LogoCache {
  const now = o.now ?? Date.now;
  const ls = (() => { try { return o.storage === undefined ? (globalThis as { localStorage?: Storage }).localStorage ?? null : o.storage; } catch { return null; } })();
  const known = new Map<string, { ok: boolean; at: number }>();
  try {
    const raw = ls?.getItem(KEY);
    for (const [u, e] of raw ? (JSON.parse(raw) as [string, { ok: boolean; at: number }][]) : []) {
      if (typeof u === "string" && typeof e?.at === "number" && e.at <= now() && now() - e.at < (e.ok ? LOGO_OK_MS : LOGO_MISS_MS)) known.set(u, { ok: !!e.ok, at: e.at });
    }
  } catch { /* unreadable: start empty */ }
  const loading = new Map<string, Promise<void>>();
  const subs = new Set<(url: string) => void>();
  const tell = (u: string) => { for (const f of subs) { try { f(u); } catch { /* a listener's own problem */ } } };
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const keep = () => {
    if (!ls || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      try { ls.setItem(KEY, JSON.stringify([...known.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, KEEP))); } catch { /* full: memory only */ }
    }, 500);
  };
  const timeout = o.timeout ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fresh = (u: string) => { const e = known.get(u); return e && now() - e.at < (e.ok ? LOGO_OK_MS : LOGO_MISS_MS) ? e : undefined; };

  const one = (u: string): Promise<void> => {
    const running = loading.get(u);
    if (running) return running;
    const p = Promise.race([o.load(u).catch(() => false), timeout(LOGO_WAIT_MS).then(() => "slow" as const)]).then((r) => {
      loading.delete(u);
      // slow: none for now (the monogram), not remembered, so the next paint tries again
      if (r !== "slow") { known.set(u, { ok: r, at: now() }); keep(); }
      else known.delete(u);
      tell(u);
    });
    loading.set(u, p);
    tell(u);
    return p;
  };

  return {
    state(u) {
      if (loading.has(u)) return "loading";
      const e = fresh(u);
      return e ? (e.ok ? "ok" : "none") : undefined;
    },
    async preload(urls) {
      const todo = [...new Set(urls.filter((u): u is string => typeof u === "string" && /^(https?:|blob:)/.test(u)))].filter((u) => !fresh(u));
      let i = 0;
      const lane = async () => { while (i < todo.length) await one(todo[i++]!); };
      await Promise.all(Array.from({ length: Math.min(LOGO_PARALLEL, todo.length) }, lane));
    },
    subscribe(f) { subs.add(f); return () => { subs.delete(f); }; },
  };
}
