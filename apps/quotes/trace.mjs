// The test flight recorder (product decision, 4 Nov; the app's side is apps/web/src/shell/flight.ts, the reader tools/trace.sh):
// the relay's sealed log of what the test build did, so its reader sees each step within about a second. Two
// routes, on only when TRACE_READ_TOKEN is set (otherwise both are the plain 404):
//
//   POST /v0/trace/<id>          body: one sealed batch, base64url text (text/plain), at most 64 KB. The app's own
//                                origins only (APP_ORIGINS plus ALLOWED_ORIGINS), 120 a minute per address, 8 MB a day
//                                per address and 32 MB relay-wide (TRACE_BYTES_*). Appended to
//                                the trace's list (RPUSH, LTRIM to the last 5,000, EXPIRE 24 h); 201 {n}.
//   GET  /v0/trace/<id>?from=<n> the batches from index n (counted from the trace's first batch, so a trimmed list keeps
//                                its numbers), at most 200 and 3 MB at a time: {from, next, items}. Only with
//                                `authorization: Bearer <TRACE_READ_TOKEN>` (compared in constant time); without it 404.
//
// The relay can't read a batch: each is sealed in the app to the operator's reader key (X25519 + XChaCha20-Poly1305, the
// trace id in its AAD). In the shared store under the HMAC of the id with the relay-only AGENTZERO_STORE_KEY (pair.mjs's
// keyOf); in an instance's own memory under its sha256. There is no route that lists traces. Never logged: a batch, an id.
import { createHash, timingSafeEqual } from "node:crypto";
import { addressBucket } from "./guards.mjs";
import { readCapped } from "./agentzero.mjs";

export const TRACE_TTL_S = 86_400;
export const TRACE_KEEP = 5_000;
export const TRACE_BODY_MAX = 64 * 1024;
export const TRACE_POST_MAX = 120;
export const TRACE_GET_MAX = 120;
export const TRACE_PAGE = 200;
/**
 * The bytes the trace may put in the shared store a UTC day (audit 4 Nov, #7): per caller address, and relay-wide. The
 * POST gate is the Origin header, which a script can make up, and the store is the one the relay's limits count in: an
 * unbounded trace could fill it, every limit's count would then fail, and every route would answer 503 (fail closed).
 * Batches live TRACE_TTL_S, so the trace never holds more than about two days of TRACE_BYTES_DAY. The test
 * recorder sends a few KB a second at most (flight.ts: one batch a second or less), well inside a bucket's day.
 */
export const TRACE_BYTES_PER_BUCKET_DAY = 8 * 1024 * 1024;
export const TRACE_BYTES_DAY = 32 * 1024 * 1024;
const PAGE_BYTES = 3 * 1024 * 1024;
const WINDOW_MS = 60_000;
const ID = /^[0-9a-f]{32}$/;
const BOX = /^[A-Za-z0-9_-]+$/;
/** Traces one instance's memory holds at most (a relay with no Redis); past it, 503. */
const MEMORY_TRACES = 50;

const DAY_MS = 86_400_000;
const plainKeyOf = (what) => `trace:${createHash("sha256").update(`zerofee-trace:${what}`).digest("hex")}`;

/** The trace's list in this instance's memory: tests, or a relay run by hand with no Redis. */
export function memoryTraces(now = Date.now) {
  const lists = new Map();
  const live = (key) => {
    const had = lists.get(key);
    if (had && now() >= had.until) lists.delete(key);
    return lists.get(key);
  };
  return {
    /** Appends one batch; answers the trace's count of batches ever. */
    push: async (key, box, keep, ttlS) => {
      let l = live(key);
      if (!l) {
        if (lists.size >= MEMORY_TRACES) for (const k of [...lists.keys()]) live(k);
        if (lists.size >= MEMORY_TRACES) throw Object.assign(new Error("traces full"), { guardUnavailable: true });
        l = { items: [], total: 0, until: 0 };
        lists.set(key, l);
      }
      l.items.push(box);
      if (l.items.length > keep) l.items.splice(0, l.items.length - keep);
      l.total++;
      l.until = now() + ttlS * 1000;
      return l.total;
    },
    /** From batch number `from` (absolute), at most `count`: {from, next, items}. */
    read: async (key, from, count) => {
      const l = live(key) ?? { items: [], total: 0 };
      const base = Math.max(0, l.total - l.items.length);
      const start = Math.min(Math.max(0, from - base), l.items.length);
      return { from: base + start, next: l.total, items: l.items.slice(start, start + count) };
    },
  };
}

/** Both steps in one Redis script each, so a push and a read never see the list half-trimmed. */
export const TRACE_PUSH = [
  "redis.call('RPUSH', KEYS[1], ARGV[1])",
  "redis.call('LTRIM', KEYS[1], -tonumber(ARGV[2]), -1)",
  "redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))",
  "local t = redis.call('INCR', KEYS[2])",
  "redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))",
  "return t",
].join("\n");
export const TRACE_READ = [
  "local total = tonumber(redis.call('GET', KEYS[2]) or '0')",
  "local len = redis.call('LLEN', KEYS[1])",
  "local base = total - len",
  "if base < 0 then base = 0 end",
  "local start = tonumber(ARGV[1]) - base",
  "if start < 0 then start = 0 end",
  "if start > len then start = len end",
  "local items = {}",
  "if start < len then items = redis.call('LRANGE', KEYS[1], start, start + tonumber(ARGV[2]) - 1) end",
  "return {base + start, total, items}",
].join("\n");

/** The same in the self-hoster's Redis (Upstash's REST API). A Redis that fails makes the route answer 503 (fail closed). */
export function redisTraces({ url, token, fetchFn = (...a) => fetch(...a) }) {
  const cmd = async (...args) => {
    try {
      const r = await fetchFn(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(5_000) });
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json())?.result ?? null;
    } catch {
      throw Object.assign(new Error("trace store unavailable"), { guardUnavailable: true });
    }
  };
  const bad = () => Object.assign(new Error("trace store unreadable"), { guardUnavailable: true });
  return {
    push: async (key, box, keep, ttlS) => {
      const t = Number(await cmd("EVAL", TRACE_PUSH, "2", key, `${key}:n`, box, String(keep), String(ttlS)));
      if (!Number.isSafeInteger(t)) throw bad();
      return t;
    },
    read: async (key, from, count) => {
      const res = await cmd("EVAL", TRACE_READ, "2", key, `${key}:n`, String(from), String(count));
      if (!Array.isArray(res) || res.length !== 3 || !Array.isArray(res[2])) throw bad();
      const [start, total] = [Number(res[0]), Number(res[1])];
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(total)) throw bad();
      return { from: start, next: total, items: res[2].filter((x) => typeof x === "string") };
    },
  };
}

/**
 * The trace id a request names: from the address Vercel rewrote (?route=trace&id=<id>) or the original
 * (/v0/trace/<id>). `undefined`: not a trace request at all; null: a trace request with no valid id (a 404).
 */
export function traceIdOf(url) {
  if (url.searchParams.get("route") === "trace") {
    const id = url.searchParams.get("id") ?? "";
    return ID.test(id) ? id : null;
  }
  const m = url.pathname.match(/^\/v0\/trace(?:\/(.*))?$/);
  if (!m) return undefined;
  return ID.test(m[1] ?? "") ? m[1] : null;
}

const digest = (s) => createHash("sha256").update(String(s)).digest();
/** The reader's bearer token against TRACE_READ_TOKEN, in constant time (both hashed first, so lengths never show). */
export function tokenMatches(header, readToken) {
  if (typeof readToken !== "string" || readToken.length < 16) return false;
  const got = String(header ?? "").match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
  return timingSafeEqual(digest(got), digest(readToken)) && got.length > 0;
}

/** The two routes. `store`: memoryTraces or redisTraces; `counter`: the relay's (a private one keys the ids too); `now`: the relay's clock. */
export function createTrace({ store, counter, origins, readToken, now = Date.now }) {
  const keyOf = typeof counter?.keyOf === "function" ? (id) => counter.keyOf(`trace:${id}`) : (id) => plainKeyOf(id);
  const over = async (name, ip, max) => (await counter.hit(`rate:trace-${name}:${addressBucket(ip)}`, WINDOW_MS)) > max;
  const day = () => Math.floor(now() / DAY_MS);
  /** Counts a batch's bytes against its caller's day and the relay's; false (nothing stored) once either is spent. */
  const withinBytes = async (ip, bytes) =>
    (await counter.add(`budget:trace-bytes:${addressBucket(ip)}:${day()}`, bytes, DAY_MS)) <= TRACE_BYTES_PER_BUCKET_DAY &&
    (await counter.add(`budget:trace-bytes:day:${day()}`, bytes, DAY_MS)) <= TRACE_BYTES_DAY;
  const on = typeof readToken === "string" && readToken.length >= 16;

  return async function trace(request, id, ip, origin, { answer, problem }) {
    const nothing = () => answer(problem(404, "quotes.route.unknown", "There's nothing here."));
    if (!on || (request.method !== "GET" && request.method !== "POST")) return nothing();
    if (request.method === "GET") {
      if (await over("get", ip, TRACE_GET_MAX)) return answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute."));
      if (!id || !tokenMatches(request.headers.get("authorization"), readToken)) return nothing();
      const raw = new URL(request.url).searchParams.get("from") ?? "0";
      if (!/^\d{1,15}$/.test(raw)) return answer(problem(400, "quotes.request.refused", "from is a batch number."));
      const page = await store.read(keyOf(id), Number(raw), TRACE_PAGE);
      let bytes = 0;
      let n = 0;
      while (n < page.items.length && (n === 0 || bytes + page.items[n].length <= PAGE_BYTES)) bytes += page.items[n++].length;
      const items = page.items.slice(0, n);
      return answer({ status: 200, body: { from: page.from, next: page.from + items.length, items } });
    }
    if (origin === null || !origins.includes(origin)) return answer(problem(403, "quotes.origin.refused", "Only the ZeroFee app can write here."));
    if (await over("post", ip, TRACE_POST_MAX)) return answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute."));
    if (!id) return nothing();
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "text/plain") return answer(problem(415, "quotes.request.refused", "Send one sealed batch as text."));
    if (Number(request.headers.get("content-length") ?? 0) > TRACE_BODY_MAX) return answer(problem(413, "quotes.request.too-large", "That request is too large."));
    const box = await readCapped(request, TRACE_BODY_MAX).catch(() => null);
    if (box === null) return answer(problem(413, "quotes.request.too-large", "That request is too large."));
    if (box.length === 0 || !BOX.test(box)) return answer(problem(400, "quotes.request.refused", "That isn't a sealed batch."));
    if (!(await withinBytes(ip, box.length))) return answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again tomorrow."));
    const n = await store.push(keyOf(id), box, TRACE_KEEP, TRACE_TTL_S);
    return answer({ status: 201, body: { n } });
  };
}
