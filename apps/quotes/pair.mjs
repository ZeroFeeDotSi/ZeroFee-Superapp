// "AgentZero on this computer" (D100, D101): the relay's one-time pairing mailbox. Two routes:
//
//   POST /v0/pair/<id>   {box}: the phone leaves AgentZero's sealed key seed (packages/core/src/pair.ts sealSeed) for
//                        the computer. `id` is the computer's random mailbox id (32 lowercase hex). Kept 10 minutes;
//                        201. A mailbox that already holds a box: 409 (never replaced).
//   GET  /v0/pair/<id>   → 200 {box} ONCE, then it's gone; otherwise 404.
//
// The box is ciphertext sealed to the computer's own X25519 key: the relay can't open it, and it only ever holds it for
// one read. Per caller address: 10 POSTs and 120 GETs every 10 minutes (the relay's counters: Redis when configured).
// Never logged: a box or an id. In the shared store (QA, 3 Nov) under the HMAC of the id with the relay-only
// AGENTZERO_STORE_KEY, like every other key (guards.mjs privateCounter keyOf); in an instance's own memory under its
// sha256. There is no route that lists mailboxes. The box itself is end-to-end sealed between the two devices
// (packages/core/src/pair.ts sealSeed: ML-KEM-768 to the computer's key, then XChaCha20-Poly1305 with the mailbox id in
// its AAD): the relay holds only ciphertext, for 10 minutes at most, read once.
import { createHash } from "node:crypto";
import { addressBucket } from "./guards.mjs";
import { readCapped } from "./agentzero.mjs";

export const PAIR_TTL_S = 600;
export const BOX_MAX = 4096;
const BODY_MAX = BOX_MAX + 64;
const WINDOW_MS = 10 * 60_000;
export const PAIR_POST_MAX = 10;
export const PAIR_GET_MAX = 120;
const ID = /^[0-9a-f]{32}$/;
const BOX = /^[A-Za-z0-9_-]+$/;
/** Mailboxes one instance's memory holds at most (a relay with no Redis); past it, 503. */
const MEMORY_MAX = 5_000;

const plainKeyOf = (id) => `pair:${createHash("sha256").update(`zerofee-pair:${id}`).digest("hex")}`;

/**
 * The mailbox, in this instance's memory: only for a relay with no Redis configured (tests, a relay run by hand). On
 * Vercel without Redis, the phone's POST and the computer's GET may reach different instances: configure Redis.
 */
export function memoryMailbox(now = Date.now) {
  const boxes = new Map();
  const sweep = () => {
    const t = now();
    for (const [k, v] of boxes) if (t >= v.until) boxes.delete(k);
  };
  return {
    /** True when this call stored it; false when the mailbox already holds one. */
    put: async (key, box, ttlS) => {
      const had = boxes.get(key);
      if (had && now() < had.until) return false;
      if (boxes.size >= MEMORY_MAX) sweep();
      if (boxes.size >= MEMORY_MAX) throw Object.assign(new Error("mailboxes full"), { guardUnavailable: true });
      boxes.set(key, { box, until: now() + ttlS * 1000 });
      return true;
    },
    /** The box, removed as it is read; null when there's none (or its time is up). */
    take: async (key) => {
      const had = boxes.get(key);
      boxes.delete(key);
      return had && now() < had.until ? had.box : null;
    },
  };
}

/**
 * The same in the self-hoster's Redis (Upstash's REST API, or Vercel KV's): `SET key box EX 600 NX` and `GETDEL key`,
 * so a box is stored once and read once across every instance. A Redis that fails makes the route answer 503 (fail
 * closed), never memory.
 */
export function redisMailbox({ url, token, fetchFn = (...a) => fetch(...a) }) {
  const cmd = async (...args) => {
    try {
      const r = await fetchFn(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(5_000) });
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json())?.result ?? null;
    } catch {
      throw Object.assign(new Error("mailbox store unavailable"), { guardUnavailable: true });
    }
  };
  return {
    put: async (key, box, ttlS) => (await cmd("SET", key, box, "EX", String(ttlS), "NX")) === "OK",
    take: async (key) => {
      const v = await cmd("GETDEL", key);
      return typeof v === "string" ? v : null;
    },
  };
}

/**
 * The mailbox id a request names: from the address Vercel rewrote (?route=pair&id=<id>) or the original
 * (/v0/pair/<id>). `undefined`: not a pairing request at all; null: a pairing request with no valid id (a 404).
 */
export function pairIdOf(url) {
  if (url.searchParams.get("route") === "pair") {
    const id = url.searchParams.get("id") ?? "";
    return ID.test(id) ? id : null;
  }
  const m = url.pathname.match(/^\/v0\/pair(?:\/(.*))?$/);
  if (!m) return undefined;
  return ID.test(m[1] ?? "") ? m[1] : null;
}

/** The two routes. `counter.hit` is the relay's (guards.mjs); `store` is memoryMailbox or redisMailbox. A private counter
 *  (the shared store) keys the mailbox ids too, by HMAC; otherwise their sha256 (an instance's own memory). */
export function createPair({ store, counter }) {
  const keyOf = typeof counter?.keyOf === "function" ? (id) => counter.keyOf(`pair:${id}`) : plainKeyOf;
  const over = async (name, ip, max) => (await counter.hit(`rate:pair-${name}:${addressBucket(ip)}`, WINDOW_MS)) > max;

  return async function pair(request, id, ip, { answer, problem }) {
    const nothing = () => answer(problem(404, "pair.mailbox.empty", "There's nothing here."));
    if (request.method !== "GET" && request.method !== "POST") return nothing();
    if (request.method === "GET") {
      if (await over("get", ip, PAIR_GET_MAX)) return answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute."));
      if (!id) return nothing();
      const box = await store.take(keyOf(id));
      return box ? answer({ status: 200, body: { box } }) : nothing();
    }
    if (await over("post", ip, PAIR_POST_MAX)) return answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute."));
    if (!id) return nothing();
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return answer(problem(415, "quotes.request.refused", "Send a JSON body."));
    if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) return answer(problem(413, "quotes.request.too-large", "That request is too large."));
    const text = await readCapped(request, BODY_MAX).catch(() => null);
    if (text === null) return answer(problem(413, "quotes.request.too-large", "That request is too large."));
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const box = body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 1 ? body.box : undefined;
    if (typeof box !== "string" || box.length === 0 || box.length > BOX_MAX || !BOX.test(box)) return answer(problem(400, "quotes.request.refused", "That isn't a pairing box."));
    if (!(await store.put(keyOf(id), box, PAIR_TTL_S))) return answer(problem(409, "pair.mailbox.taken", "This pairing is already waiting. Start again on the computer."));
    return answer({ status: 201, body: { stored: true } });
  };
}
