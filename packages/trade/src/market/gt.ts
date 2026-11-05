// GeckoTerminal client (api.geckoterminal.com answers browser CORS with access-control-allow-origin: *; no key). What it adds to fetch:
//  - a TTL cache and ONE request in flight per path (twenty rows asking for the same token make one call);
//  - a call budget: GeckoTerminal's free tier is about 30 calls a minute per IP, so a sliding window of 25 (cache hits do not count).
//    Background work ("low") may use only LOW_SHARE of the window, so a busy list never starves the screen the person is looking at ("high");
//    the screen's own calls may wait a few seconds for room (a coin page's chart right after Discover) instead of failing at once;
//  - after a 429 nobody asks again until its retry-after has passed;
//  - on any failure or an used-up budget, an answer up to STALE_MAX_MS old is served instead of nothing;
//  - the last answers and the budget's record survive a reload (the device's storage), because the limit is per IP and
//    doesn't restart with the page: opening Discover again a minute later paints the last list instead of nothing.
// GeckoTerminal's 429 carries no access-control-allow-origin (checked 25 Oct 2026: after 7 quick calls, "retry-after: 0",
// no CORS header), so a browser can't read it: it arrives as a failed fetch. A failed fetch is treated as that 429.
// Third-party data is never an input to money: this module cannot produce a balance, an amount or a minimum.
import type { ChainId } from "../types.ts";

export const GT_BASE = "https://api.geckoterminal.com/api/v2";
export const GT_ACCEPT = "application/json;version=20230302";
/** GeckoTerminal's network id of each chain (checked on 25 Oct 2026 from /networks/{id}/dexes: solana, bsc, robinhood;
 *  2 Nov 2026: near, with the dexes rhea-finance and near-intents). */
export const GT_NETWORK: Record<ChainId, string> = { sol: "solana", bsc: "bsc", hood: "robinhood", near: "near" };
export const CHAIN_OF_NETWORK: Record<string, ChainId> = { solana: "sol", bsc: "bsc", robinhood: "hood", near: "near" };
export const CHAINS: readonly ChainId[] = ["sol", "hood", "bsc", "near"];

export class MarketError extends Error {
  code: "rate" | "unreachable" | "not_found" | "bad_response" | "unsupported";
  constructor(code: MarketError["code"], message: string) { super(message); this.name = "MarketError"; this.code = code; }
}

export const GT_BUDGET = { calls: 25, perMs: 60_000 };
/** And no more than this in any 10 s: GeckoTerminal answered 429 after 7 quick calls from one IP (25 Oct 2026). */
export const GT_BURST = { calls: 6, perMs: 10_000 };
/** Background work may use this share of the window; the rest is kept for what the person just asked for. */
export const LOW_SHARE = 0.6;
/** ...and never the last calls of the 10 s cap either: these are kept for the screen, a coin page right after a busy list:
 *  its token answer, its info and its chart's candles, all three at once (test, 4 Nov: with two kept, the chart waited for
 *  the 10 s window, a spinner for ~5 s on LIVE and 1D). */
export const BURST_RESERVE = 3;
/** After a 429 with no retry-after, nobody asks for this long. */
export const BLOCK_MS = 10_000;
export const MIN_CAP = 6;
export const GROW_EVERY_MS = 20_000;
export const STALE_MAX_MS = 15 * 60_000;
/** What the device keeps across reloads: this many answers (the newest), up to a day old. */
export const KEEP_ANSWERS = 40, KEEP_MS = 24 * 3600_000, MAX_BLOCK_MS = 120_000;
const KEY = "zerofee-trade-gt:v1:";
export type Priority = "high" | "low";

export interface GtOptions {
  fetch: typeof fetch; now: () => number;
  budget?: { calls: number; perMs: number };
  staleMaxMs?: number; timeoutMs?: number;
  /** At most this many calls in a short window (default GT_BURST). */
  burst?: { calls: number; perMs: number };
  /** Where answers and the budget survive a reload. Default: the page's localStorage when there is one; null keeps it all in memory. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  /** How a call that may wait for room waits (default: a real timer). */
  sleep?: (ms: number) => Promise<void>;
}
export interface GtClient {
  /** GET `path` (e.g. "networks/solana/trending_pools?page=1"), cached for `ttlMs`. A "high" call with `waitMs` and nothing
   *  older to show waits up to that long for room (the screen's own chart after a busy list) instead of failing at once. */
  get<T = unknown>(path: string, ttlMs: number, prio?: Priority, opts?: { staleMs?: number; waitMs?: number }): Promise<T>;
  /** Put an answer into the cache as if it had been fetched. Never replaces a fresher entry. */
  seed(path: string, value: unknown): void;
  /** The newest cached answer for a path, whatever its age (up to the stale limit). */
  peek<T = unknown>(path: string): { v: T; at: number } | undefined;
  /** When the answer last served for `path` was fetched (an old one is shown "as of" this time). */
  servedAt(path: string): number | undefined;
  stats(): { calls: number; hits: number; stale: number; errors: number; lowSkipped: number };
  /** Calls still available in the window for this priority (0 while blocked). */
  room(prio?: Priority): number;
}

export function createGt(o: GtOptions): GtClient {
  const ls = (() => { try { return o.storage === undefined ? (globalThis as { localStorage?: Storage }).localStorage ?? null : o.storage; } catch { return null; } })();
  const load = <T>(k: string): T | undefined => { try { const raw = ls?.getItem(KEY + k); return raw ? JSON.parse(raw) as T : undefined; } catch { return undefined; } };
  const store = (k: string, v: unknown) => { try { ls?.setItem(KEY + k, JSON.stringify(v)); } catch { /* full or blocked storage: memory only */ } };
  const kept = load<[string, { at: number; v: unknown }][]>("answers") ?? [];
  // a kept answer dated in the future is never fresh (it would be fresh forever): it's dropped like an old one
  const cache = new Map<string, { at: number; v: unknown }>(kept.filter(([, e]) => typeof e?.at === "number" && e.at <= o.now() && o.now() - e.at < KEEP_MS));
  const inflight = new Map<string, Promise<unknown>>();
  const servedAt = new Map<string, number>();
  const budget = o.budget ?? GT_BUDGET;
  const was = load<{ sent: number[]; blockedUntil: number; strikes: number }>("budget");
  const sent: number[] = (was?.sent ?? []).filter((t) => typeof t === "number" && o.now() - t < budget.perMs);
  const staleLimit = o.staleMaxMs ?? STALE_MAX_MS;
  const st = { calls: 0, hits: 0, stale: 0, errors: 0, lowSkipped: 0 };
  let blockedUntil = was?.blockedUntil ?? 0, strikes = was?.strikes ?? 0;
  const keepBudget = () => store("budget", { sent, blockedUntil, strikes });
  const keepAnswers = () => store("answers", [...cache.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, KEEP_ANSWERS));
  /** A 429 (or a fetch the browser blocked, which is how a 429 without CORS headers arrives): wait, longer each time in a row. */
  const limited = (retryAfterS?: number) => {
    strikes++;
    blockedUntil = o.now() + (retryAfterS && retryAfterS > 0 ? Math.min(retryAfterS, 120) * 1000 : Math.min(MAX_BLOCK_MS, BLOCK_MS * 2 ** (strikes - 1)));
    cap = Math.max(MIN_CAP, Math.floor(capNow() * 0.7)); lastCut = o.now();
    keepBudget();
  };
  // The real limit is not always the 30 a minute the free tier states (it is per IP, and other apps on the same connection spend it too: on 25 Oct 2026 one IP got
  // 429s after 2-3 calls in a few seconds). So the budget adapts: each 429 cuts the window's cap to 70% (never under MIN_CAP), and it grows back by one call
  // for every GROW_EVERY_MS without a 429, up to the configured budget.
  let cap = budget.calls, lastCut = -Infinity, lastGrow = 0;
  const capNow = (): number => {
    if (cap < budget.calls) {
      const t = o.now();
      const steps = Math.floor((t - Math.max(lastCut, lastGrow)) / GROW_EVERY_MS);
      if (steps > 0) { cap = Math.min(budget.calls, cap + steps); lastGrow = t; }
    }
    return cap;
  };

  const used = (): number => {
    const t = o.now();
    while (sent.length && t - sent[0]! >= budget.perMs) sent.shift();
    return sent.length;
  };
  const burstCap = o.burst ?? GT_BURST;
  const burst = (): number => { const t = o.now(); return sent.filter((x) => t - x < burstCap.perMs).length; };
  const burstOf = (prio: Priority): number => (prio === "low" ? Math.max(1, burstCap.calls - BURST_RESERVE) : burstCap.calls);
  /** How long until a "high" call would be let through (0 = now): the block, the 10 s cap or the window, whichever ends last. */
  const opensIn = (): number => {
    const t = o.now();
    const inBurst = sent.filter((x) => t - x < burstCap.perMs);
    const n = used();
    return Math.max(0, blockedUntil - t,
      inBurst.length >= burstCap.calls ? inBurst[inBurst.length - burstCap.calls]! + burstCap.perMs - t : 0,
      n >= capNow() ? sent[n - capNow()]! + budget.perMs - t : 0);
  };
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const allowed = (prio: Priority): boolean => {
    if (o.now() < blockedUntil) return false;
    if (burst() >= burstOf(prio)) return false;
    const n = used();
    const c = capNow();
    return prio === "low" ? n < Math.floor(c * LOW_SHARE) : n < c;
  };

  async function fetchOnce(path: string): Promise<unknown> {
    sent.push(o.now()); st.calls++; keepBudget();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 8000);
    try {
      const r = await o.fetch(`${GT_BASE}/${path}`, { headers: { accept: GT_ACCEPT }, signal: ctl.signal });
      if (r.status === 429) {
        const ra = Number(r.headers.get("retry-after"));
        limited(Number.isFinite(ra) ? ra : undefined);
        throw new MarketError("rate", "GeckoTerminal is rate-limiting (429)");
      }
      if (strikes) { strikes = 0; keepBudget(); }
      if (r.status === 404) throw new MarketError("not_found", "not found");
      if (!r.ok) throw new MarketError("unreachable", `HTTP ${r.status}`);
      try { return await r.json(); } catch { throw new MarketError("bad_response", "not JSON"); }
    } catch (e) {
      if (e instanceof MarketError) throw e;
      if ((e as Error)?.name !== "AbortError") { limited(); throw new MarketError("rate", `GeckoTerminal didn't answer (most likely its rate limit): ${String((e as Error)?.message ?? e)}`); }
      throw new MarketError("unreachable", "timeout");
    } finally { clearTimeout(timer); }
  }

  return {
    async get<T>(path: string, ttlMs: number, prio: Priority = "high", opts?: { staleMs?: number; waitMs?: number }): Promise<T> {
      const hit = cache.get(path);
      const staleMax = opts?.staleMs ?? staleLimit;
      if (hit && o.now() - hit.at < ttlMs) { st.hits++; servedAt.set(path, hit.at); return hit.v as T; }
      const running = inflight.get(path);
      if (running) return running as Promise<T>;
      const serveStale = (e: unknown): T => {
        if (hit && o.now() - hit.at < staleMax) { st.stale++; servedAt.set(path, hit.at); return hit.v as T; }
        st.errors++; throw e;
      };
      const full = () => new MarketError("rate", "market data call budget used up, try again in a moment");
      const waitMs = prio === "high" && !(hit && o.now() - hit.at < staleMax) ? opts?.waitMs ?? 0 : 0;
      if (!allowed(prio) && !(waitMs > 0 && opensIn() <= waitMs)) {
        if (prio === "low") st.lowSkipped++;
        return serveStale(full());
      }
      const p = (async () => {
        try {
          // waiting for room: each wake checks again, since other calls may have taken the slot that opened
          const until = o.now() + waitMs;
          const room = async () => {
            while (!allowed(prio)) {
              const w = opensIn();
              const before = o.now();
              if (w <= 0 || before + w > until) throw full();
              await sleep(w + 50);
              if (o.now() === before) throw full(); // a clock that doesn't move (a test's) never waits forever
            }
          };
          if (!allowed(prio)) await room(); // (only then: a call let through must count itself before the next one asks)
          let v: unknown;
          try { v = await fetchOnce(path); } catch (e) {
            // a 429 on a call that may wait: once more, after the pause it set, if that pause ends in time
            if (!(waitMs > 0 && e instanceof MarketError && e.code === "rate" && o.now() + opensIn() <= until)) throw e;
            await room();
            v = await fetchOnce(path);
          }
          cache.set(path, { at: o.now(), v });
          servedAt.set(path, o.now());
          if (cache.size > 400) for (const [k, e] of cache) if (o.now() - e.at > KEEP_MS) cache.delete(k);
          keepAnswers();
          return v;
        } catch (e) {
          if (e instanceof MarketError && e.code === "not_found") { st.errors++; throw e; }
          return serveStale(e);
        } finally { inflight.delete(path); }
      })();
      inflight.set(path, p);
      return p as Promise<T>;
    },
    seed(path, value) {
      const hit = cache.get(path);
      if (!hit || o.now() - hit.at > 0) cache.set(path, { at: o.now(), v: value });
    },
    peek(path) {
      const hit = cache.get(path);
      return hit && o.now() - hit.at < staleLimit ? (hit as { v: never; at: number }) : undefined;
    },
    servedAt: (path) => servedAt.get(path),
    stats: () => ({ ...st }),
    room(prio: Priority = "high") {
      if (o.now() < blockedUntil) return 0;
      const c = capNow();
      return Math.max(0, Math.min(burstOf(prio) - burst(), (prio === "low" ? Math.floor(c * LOW_SHARE) : c) - used()));
    },
  };
}

// The slice of GeckoTerminal's JSON:API shape we read (captured 25 Oct 2026).
export interface GtToken {
  id: string; type: "token";
  attributes: {
    address: string; name: string; symbol: string; decimals: number; image_url?: string | null; coingecko_coin_id?: string | null;
    price_usd?: string | null; fdv_usd?: string | null; market_cap_usd?: string | null; total_reserve_in_usd?: string | null; volume_usd?: { h24?: string | null };
  };
  relationships?: { top_pools?: { data?: { id: string }[] } };
}
export interface GtDex { id: string; type: "dex"; attributes?: { name?: string } }
export interface GtTx { buys?: number | string | null; sells?: number | string | null; buyers?: number | string | null; sellers?: number | string | null }
export interface GtPool {
  id: string; type: "pool";
  attributes: {
    address: string; name: string; pool_created_at: string | null; fdv_usd: string | null; market_cap_usd: string | null;
    base_token_price_usd: string | null; quote_token_price_usd: string | null;
    price_change_percentage?: { m5?: string | null; h1?: string | null; h6?: string | null; h24?: string | null };
    transactions?: { h24?: GtTx; h1?: GtTx };
    volume_usd?: { h24?: string | null };
    reserve_in_usd: string | null;
  };
  relationships: { base_token: { data: { id: string } }; quote_token: { data: { id: string } }; dex: { data: { id: string } } };
}
export interface GtList { data: GtPool[]; included?: (GtToken | GtDex)[] }
export interface GtTokenAnswer { data: GtToken; included?: (GtPool | GtDex | GtToken)[] }
