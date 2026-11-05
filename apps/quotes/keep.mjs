// The relay's sealed keep (product decision, 4 Nov, decision G: a site's two-factor codes are backed up WITH the 24 words, so a
// lost phone never locks anyone out of a site's money). One route:
//
//   POST /v0/keep/<id>   {op: "put", t, sig, sealed} → 200 {kept: true}
//                        {op: "get", t, sig}         → 200 {sealed} | 404
//
// `id` is an ed25519 public key (64 lowercase hex) the core makes from the hot root (packages/core/src/site-2fa-backup.ts:
// HKDF of the words' seed), so the same words find the same keep on a new phone and nobody else can name it. `sig` is
// that key's signature over "zerofee-keep-<op>:<id>:<sha256 hex of sealed, or empty for get>:<t>", `t` milliseconds
// since 1970 within a minute of the relay's clock: only the words' holder can write or read it. `sealed` is
// XChaCha20-Poly1305 under a second key from the same words, made on the phone: the relay holds ciphertext only and
// can't open it. One keep per id, replaced on each put; at most 4096 characters (base64url).
//
// Never logged: an id, a signature or a sealed value. No route lists keeps. Keyed by the HMAC of the id with the
// relay-only AGENTZERO_STORE_KEY when that key is set (like pair.mjs), else by its sha256.
//
// Abuse (security review, QA, MUST 2): anyone can make keys, so the keep is bounded and kept apart:
// - its OWN Redis (KEEP_REDIS_URL / KEEP_REDIS_TOKEN, api/relay.mjs), never the shared store the relay's limiters fail
//   closed on: filling or losing it fails /v0/keep alone (503 keep.off / quotes.guard.unavailable), no other route;
//   with none set on a deployed relay the keep is off;
// - every keep lives KEEP_TTL_S (about 400 days), refreshed on each put and each get: a keep nobody uses goes;
// - at most KEEP_NEW_PER_DAY new ids a day across the whole relay (replacing an existing keep doesn't count).
import { createHash } from "node:crypto";
import { addressBucket, ed25519Verify } from "./guards.mjs";
import { readCapped } from "./agentzero.mjs";

export const KEEP_MAX = 4096;
const BODY_MAX = KEEP_MAX + 512;
export const KEEP_WINDOW_MS = 60_000;
const RATE_WINDOW_MS = 10 * 60_000;
export const KEEP_PUT_MAX = 20;
export const KEEP_GET_MAX = 60;
/** About 400 days, refreshed on every put and get. */
export const KEEP_TTL_S = 400 * 86_400;
/** New keep ids a day across the relay. */
export const KEEP_NEW_PER_DAY = 2_000;
const ID = /^[0-9a-f]{64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const SIG = /^[0-9a-f]{128}$/;
/** Keeps one instance's memory holds at most (a relay with no Redis); past it, 503. */
const MEMORY_MAX = 5_000;

const plainKeyOf = (id) => `keep:${createHash("sha256").update(`zerofee-keep:${id}`).digest("hex")}`;
const hexBytes = (h) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

/** What the key signs, for a put (with the sealed value's sha256) or a get. The core signs exactly this. */
export function keepMessage(op, id, t, sealed = "") {
  const digest = op === "put" ? createHash("sha256").update(sealed).digest("hex") : "";
  return new TextEncoder().encode(`zerofee-keep-${op}:${id}:${digest}:${t}`);
}

/** The keep in this instance's memory: only for a relay run by hand or in tests (api/relay.mjs never on Vercel). */
export function memoryKeep(now = Date.now) {
  const keeps = new Map();
  const live = (key) => {
    const had = keeps.get(key);
    if (had && now() >= had.until) keeps.delete(key);
    return keeps.get(key) ?? null;
  };
  return {
    /** Replaces an existing keep (refreshing its time); true when it was there. */
    replace: async (key, sealed, ttlS) => {
      if (!live(key)) return false;
      keeps.set(key, { sealed, until: now() + ttlS * 1000 });
      return true;
    },
    /** Adds a new keep; false when one appeared meanwhile. */
    add: async (key, sealed, ttlS) => {
      if (live(key)) return false;
      if (keeps.size >= MEMORY_MAX) throw Object.assign(new Error("keeps full"), { guardUnavailable: true });
      keeps.set(key, { sealed, until: now() + ttlS * 1000 });
      return true;
    },
    /** The keep, its time refreshed; null when there's none. */
    get: async (key, ttlS) => {
      const had = live(key);
      if (!had) return null;
      had.until = now() + ttlS * 1000;
      return had.sealed;
    },
  };
}

/** The same in the keep's OWN Redis (Upstash's REST API): SET … XX / NX with EX, and GETEX … EX. A Redis that fails
 *  answers this route 503 only (never memory, never another route's store). */
export function redisKeep({ url, token, fetchFn = (...a) => fetch(...a) }) {
  const cmd = async (...args) => {
    try {
      const r = await fetchFn(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(5_000) });
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json())?.result ?? null;
    } catch {
      throw Object.assign(new Error("keep store unavailable"), { guardUnavailable: true });
    }
  };
  return {
    replace: async (key, sealed, ttlS) => (await cmd("SET", key, sealed, "EX", String(ttlS), "XX")) === "OK",
    add: async (key, sealed, ttlS) => (await cmd("SET", key, sealed, "EX", String(ttlS), "NX")) === "OK",
    get: async (key, ttlS) => {
      const v = await cmd("GETEX", key, "EX", String(ttlS));
      return typeof v === "string" ? v : null;
    },
  };
}

/** The keep id a request names: from Vercel's rewrite (?route=keep&id=<id>) or the original (/v0/keep/<id>).
 *  `undefined`: not a keep request; null: a keep request with no valid id (a 404). */
export function keepIdOf(url) {
  if (url.searchParams.get("route") === "keep") {
    const id = url.searchParams.get("id") ?? "";
    return ID.test(id) ? id : null;
  }
  const m = url.pathname.match(/^\/v0\/keep(?:\/(.*))?$/);
  if (!m) return undefined;
  return ID.test(m[1] ?? "") ? m[1] : null;
}

/** The route. `counter.hit` is the relay's (guards.mjs); `store` is memoryKeep or redisKeep, or null: the keep is off. */
export function createKeep({ store, counter, now = Date.now, newPerDay = KEEP_NEW_PER_DAY }) {
  const keyOf = typeof counter?.keyOf === "function" ? (id) => counter.keyOf(`keep:${id}`) : plainKeyOf;
  const over = async (name, ip, max) => (await counter.hit(`rate:keep-${name}:${addressBucket(ip)}`, RATE_WINDOW_MS)) > max;

  return async function keep(request, id, ip, { answer, problem }) {
    const nothing = () => answer(problem(404, "keep.empty", "There's nothing here."));
    const refused = () => answer(problem(403, "keep.refused", "That keep's key didn't sign this."));
    if (request.method !== "POST" || !id) return nothing();
    if (!store) return answer(problem(503, "keep.off", "Backups aren't set up on this relay."));
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
    if (!body || typeof body !== "object" || Array.isArray(body)) return answer(problem(400, "quotes.request.refused", "That isn't a keep request."));
    const { op, t, sig, sealed } = body;
    if (op !== "put" && op !== "get") return answer(problem(400, "quotes.request.refused", "That isn't a keep request."));
    if (await over(op, ip, op === "put" ? KEEP_PUT_MAX : KEEP_GET_MAX)) return answer(problem(429, "quotes.rate.limited", "Too many requests just now. Try again in a minute."));
    if (!Number.isSafeInteger(t) || Math.abs(now() - t) > KEEP_WINDOW_MS) return answer(problem(400, "keep.late", "This phone's clock is off. Set it to automatic and try again."));
    if (typeof sig !== "string" || !SIG.test(sig)) return refused();
    if (op === "put" && (typeof sealed !== "string" || sealed.length === 0 || sealed.length > KEEP_MAX || !B64URL.test(sealed))) return answer(problem(400, "quotes.request.refused", "That isn't a sealed keep."));
    if (!ed25519Verify(hexBytes(id), keepMessage(op, id, t, op === "put" ? sealed : ""), hexBytes(sig))) return refused();
    // A store that fails answers this route 503 alone (the relay's own catch of guardUnavailable)
    if (op === "put") {
      const key = keyOf(id);
      if (await store.replace(key, sealed, KEEP_TTL_S)) return answer({ status: 200, body: { kept: true } });
      // a new id: the relay's daily cap first
      if ((await counter.hit(`keep-new:${Math.floor(now() / 86_400_000)}`, 86_400_000)) > newPerDay) return answer(problem(503, "keep.full", "Backups are full for today. Try again tomorrow."));
      if (!(await store.add(key, sealed, KEEP_TTL_S))) await store.replace(key, sealed, KEEP_TTL_S);
      return answer({ status: 200, body: { kept: true } });
    }
    const got = await store.get(keyOf(id), KEEP_TTL_S);
    return got ? answer({ status: 200, body: { sealed: got } }) : nothing();
  };
}
