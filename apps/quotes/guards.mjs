// What the relay's routes share to guard themselves (audit 28 Oct, NF-08/NF-18): counters that hold across instances
// when the self-hoster has a Redis, the caller's address only from a header a trusted proxy set, and ed25519 checks.
import { createHmac, createPublicKey, verify } from "node:crypto";

/**
 * Counters in this instance's memory: `hit(key, windowMs)` counts one and answers how many in the key's window
 * (fixed, from its first hit). Used only when no Redis is configured at all, never as a stand-in for a Redis that fails.
 */
export function memoryCounter(now = Date.now) {
  const hits = new Map();
  /** `add(key, n, windowMs)`: counts `n` (0 reads the count) and answers the key's total in its window. */
  const add = async (key, n, windowMs) => {
    const t = now();
    const e = hits.get(key);
    if (!e || t >= e.reset) {
      hits.set(key, { n, reset: t + windowMs });
      if (hits.size > 20_000) for (const [k, v] of hits) if (t >= v.reset) hits.delete(k);
      return n;
    }
    e.n += n;
    return e.n;
  };
  /** Values set once (AgentZero's credit, agentzero-credit.mjs), each until its own time: `{ value, reset }`. */
  const once = new Map();
  const live = (key) => {
    const e = once.get(key);
    if (e && now() >= e.reset) once.delete(key);
    return once.get(key);
  };
  /** Credit balances: plain sums with no window. Refund records and their index. */
  const sums = new Map();
  const records = new Map();
  const sets = new Map();
  return {
    hit: (key, windowMs) => add(key, 1, windowMs),
    add,
    /** `setOnce(key, value, ttlMs)`: true when this call set it, false when it was already set (Redis's SET NX PX). */
    setOnce: async (key, value, ttlMs) => {
      ttlOk(ttlMs);
      if (live(key)) return false;
      once.set(key, { value: String(value), reset: now() + ttlMs });
      return true;
    },
    get: async (key) => live(key)?.value ?? null,
    del: async (key) => void once.delete(key),
    /** `incr(key, n)`: adds `n` (0 reads) to a sum that never expires, and answers it (Redis's INCRBY). */
    incr: async (key, n) => {
      if (!Number.isSafeInteger(n)) throw new Error("not a whole number");
      const t = (sums.get(key) ?? 0) + n;
      sums.set(key, t);
      return t;
    },
    /** A sum's value without creating it (0 when there is none). */
    sum: async (key) => sums.get(key) ?? 0,
    /** `onceThenAdd(once, value, ttlMs, [a, b], n)`: setOnce, and only if it set, `n` added to both sums, all at once. */
    onceThenAdd: async (onceKey, value, ttlMs, [a, b], n) => {
      ttlOk(ttlMs);
      if (!Number.isSafeInteger(n) || n <= 0) throw new Error("not an amount");
      if (live(onceKey)) return null;
      once.set(onceKey, { value: String(value), reset: now() + ttlMs });
      sums.set(b, (sums.get(b) ?? 0) + n);
      const t = (sums.get(a) ?? 0) + n;
      sums.set(a, t);
      return t;
    },
    /** `takeIf(key, n)`: takes `n` from a sum only if it holds all of it (→ what's left), else null; never creates it. */
    takeIf: async (key, n) => {
      if (!Number.isSafeInteger(n) || n <= 0) throw new Error("not an amount");
      const v = sums.get(key) ?? 0;
      if (v < n) return null;
      sums.set(key, v - n);
      return v - n;
    },
    /** `refundAll(credit, record, index, to, id)`: REFUND_ALL, below. → the micros moved (0 when there were none). */
    refundAll: async (creditKey, recordKey, indexKey, to, id) => {
      const have = sums.get(creditKey) ?? 0;
      if (have <= 0) return 0;
      sums.delete(creditKey);
      const r = records.get(recordKey) ?? { micros: 0, to };
      records.set(recordKey, { micros: r.micros + have, to: String(to) });
      if (!sets.has(indexKey)) sets.set(indexKey, new Set());
      sets.get(indexKey).add(String(id));
      return have;
    },
    /** A refund record ({micros, to}), or null. */
    record: async (recordKey) => {
      const r = records.get(recordKey);
      return r ? { micros: r.micros, to: r.to } : null;
    },
    members: async (indexKey) => [...(sets.get(indexKey) ?? [])],
    /** `payoutDone(record, index, paidOut, marker, micros, to, id)`: PAYOUT_DONE, below. */
    payoutDone: async (recordKey, indexKey, paidOutKey, markerKey, micros, to, id) => {
      if (!Number.isSafeInteger(micros) || micros <= 0) throw new Error("not an amount");
      if (live(markerKey)) return -1;
      const r = records.get(recordKey);
      if (!r || r.micros < micros || r.to !== to) return null;
      once.set(markerKey, { value: "1", reset: now() + PAYOUT_MARKER_MS });
      const left = r.micros - micros;
      if (left === 0) {
        records.delete(recordKey);
        sets.get(indexKey)?.delete(String(id));
      } else r.micros = left;
      sums.set(paidOutKey, (sums.get(paidOutKey) ?? 0) + micros);
      return left;
    },
    shared: false,
  };
}

/**
 * The two Redis scripts (fixed text; only keys and numbers are passed in). Each runs whole on the Redis server, so a
 * request cut off between its steps can't leave half of it done. A script Redis can't run is an error: the relay
 * answers 503 and nothing is credited or taken.
 */
export const ONCE_THEN_ADD = [
  "if redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX') then",
  "  local total = redis.call('INCRBY', KEYS[2], ARGV[3])",
  "  redis.call('INCRBY', KEYS[3], ARGV[3])",
  "  return total",
  "end",
  "return false",
].join("\n");
export const TAKE_IF = [
  "local have = tonumber(redis.call('GET', KEYS[1])) or 0",
  "if have >= tonumber(ARGV[1]) then return redis.call('DECRBY', KEYS[1], ARGV[1]) end",
  "return false",
].join("\n");

/** A person's whole credit into their refund record (P3): the credit key gone, its micros added to the record. */
export const REFUND_ALL = [
  "local have = tonumber(redis.call('GET', KEYS[1])) or 0",
  "if have <= 0 then return 0 end",
  "redis.call('DEL', KEYS[1])",
  "redis.call('HINCRBY', KEYS[2], 'micros', have)",
  "redis.call('HSET', KEYS[2], 'to', ARGV[1])",
  "redis.call('SADD', KEYS[3], ARGV[2])",
  "return have",
].join("\n");
/**
 * One refund payout counted, once per payout (its marker set NX), only against a record that holds at least that much
 * for that same address: the record goes down (or away), the paid-out total up. → what the record has left, -1 when this
 * payout was already counted, or false (refused, nothing changed) when there is no such record.
 */
export const PAYOUT_DONE = [
  "if not redis.call('SET', KEYS[4], ARGV[2], 'PX', ARGV[3], 'NX') then return -1 end",
  "local have = tonumber(redis.call('HGET', KEYS[1], 'micros')) or 0",
  "local paid = tonumber(ARGV[1])",
  "if have < paid or redis.call('HGET', KEYS[1], 'to') ~= ARGV[5] then redis.call('DEL', KEYS[4]) return false end",
  "if have == paid then redis.call('DEL', KEYS[1]) redis.call('SREM', KEYS[2], ARGV[4]) else redis.call('HINCRBY', KEYS[1], 'micros', -paid) end",
  "redis.call('INCRBY', KEYS[3], paid)",
  "return have - paid",
].join("\n");

/** How long a counted payout's marker is kept: a year (the test journal retries within weeks). */
const PAYOUT_MARKER_MS = 365 * 86_400_000;

/** A time to keep a set-once value: whole milliseconds, at least one, at most a year. */
function ttlOk(ttlMs) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 366 * 86_400_000) throw new Error("not a time to keep");
}

/**
 * The same counters in the self-hoster's Redis (Upstash's REST API, or Vercel KV's), so every instance counts
 * together: one pipelined call, `SET key 0 PX window NX` then `INCR key` (INCR keeps the expiry, so no key outlives its
 * window). When the Redis fails, the count throws a guardUnavailable error and the relay answers 503: it fails closed,
 * never to this instance's memory (memory counting is only for a deployment with no Redis configured at all).
 */
export function redisCounter({ url, token, fetchFn = (...a) => fetch(...a), now = Date.now }) {
  /** `add(key, n, windowMs)`: INCRBY n (0 reads the count), same window rule. */
  const add = async (key, n, windowMs) => {
    try {
      const r = await fetchFn(`${url.replace(/\/$/, "")}/pipeline`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify([["SET", key, "0", "PX", String(windowMs), "NX"], n === 1 ? ["INCR", key] : ["INCRBY", key, String(n)]]),
        signal: AbortSignal.timeout(3_000),
      });
      if (!r.ok) throw new Error(String(r.status));
      const total = Number((await r.json())?.[1]?.result);
      if (!Number.isInteger(total) || (n >= 0 && total < n)) throw new Error("unreadable");
      return total;
    } catch {
      throw Object.assign(new Error("rate guard unavailable"), { guardUnavailable: true });
    }
  };
  /** One pipelined call of `cmds`; each command's own result, or a guardUnavailable error if any of them failed. */
  const run = async (cmds) => {
    let out;
    try {
      const r = await fetchFn(`${url.replace(/\/$/, "")}/pipeline`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(cmds),
        signal: AbortSignal.timeout(3_000),
      });
      if (!r.ok) throw new Error(String(r.status));
      out = await r.json();
      if (!Array.isArray(out) || out.length !== cmds.length || out.some((x) => !x || typeof x !== "object" || "error" in x)) throw new Error("unreadable");
    } catch {
      throw Object.assign(new Error("rate guard unavailable"), { guardUnavailable: true });
    }
    return out.map((x) => x.result);
  };
  return {
    hit: (key, windowMs) => add(key, 1, windowMs),
    add,
    /**
     * `setOnce(key, value, ttlMs)`: `SET key value PX ttl NX`. True only when this call set it; false when the key was
     * already there (AgentZero's credit: an invoice is made once, a payment is credited once).
     */
    setOnce: async (key, value, ttlMs) => {
      ttlOk(ttlMs);
      const [res] = await run([["SET", key, String(value), "PX", String(ttlMs), "NX"]]);
      return res === "OK";
    },
    /** `get(key)`: the value, or null when there is none. */
    get: async (key) => {
      const [res] = await run([["GET", key]]);
      return typeof res === "string" ? res : null;
    },
    del: async (key) => void (await run([["DEL", key]])),
    /** `incr(key, n)`: `INCRBY key n` (0 reads) on a sum with no expiry, and answers it. */
    incr: async (key, n) => {
      if (!Number.isSafeInteger(n)) throw new Error("not a whole number");
      const [res] = await run([["INCRBY", key, String(n)]]);
      const total = Number(res);
      if (!Number.isSafeInteger(total)) throw Object.assign(new Error("rate guard unavailable"), { guardUnavailable: true });
      return total;
    },
    /** A sum's value by GET, without creating it (0 when there is none). */
    sum: async (key) => {
      const [res] = await run([["GET", key]]);
      const v = res === null ? 0 : Number(res);
      if (!Number.isSafeInteger(v)) throw Object.assign(new Error("rate guard unavailable"), { guardUnavailable: true });
      return v;
    },
    /**
     * `onceThenAdd(once, value, ttlMs, [a, b], n)`: in ONE Redis script, so nothing can stop it halfway (SR1 F1): SET once
     * NX PX, and only if that set it, INCRBY n on both sums. → sum a's total, or null when `once` was already set.
     */
    onceThenAdd: async (onceKey, value, ttlMs, [a, b], n) => {
      ttlOk(ttlMs);
      if (!Number.isSafeInteger(n) || n <= 0) throw new Error("not an amount");
      const [res] = await run([["EVAL", ONCE_THEN_ADD, "3", onceKey, a, b, String(value), String(ttlMs), String(n)]]);
      if (res === null) return null;
      const total = Number(res);
      if (!Number.isSafeInteger(total)) throw Object.assign(new Error("rate guard unavailable"), { guardUnavailable: true });
      return total;
    },
    /** `refundAll(credit, record, index, to, id)`: REFUND_ALL in one script. → the micros moved (0 when there were none). */
    refundAll: async (creditKey, recordKey, indexKey, to, id) => {
      const [res] = await run([["EVAL", REFUND_ALL, "3", creditKey, recordKey, indexKey, String(to), String(id)]]);
      const moved = Number(res);
      if (!Number.isSafeInteger(moved) || moved < 0) throw Object.assign(new Error("rate guard unavailable"), { guardUnavailable: true });
      return moved;
    },
    /** A refund record ({micros, to}), or null. */
    record: async (recordKey) => {
      const [res] = await run([["HGETALL", recordKey]]);
      if (!Array.isArray(res) || res.length === 0) return null;
      const h = {};
      for (let i = 0; i + 1 < res.length; i += 2) h[res[i]] = res[i + 1];
      const micros = Number(h.micros);
      return Number.isSafeInteger(micros) && typeof h.to === "string" ? { micros, to: h.to } : null;
    },
    members: async (indexKey) => {
      const [res] = await run([["SMEMBERS", indexKey]]);
      return Array.isArray(res) ? res.filter((x) => typeof x === "string") : [];
    },
    /** `payoutDone(record, index, paidOut, marker, micros, to, id)`: PAYOUT_DONE in one script. */
    payoutDone: async (recordKey, indexKey, paidOutKey, markerKey, micros, to, id) => {
      if (!Number.isSafeInteger(micros) || micros <= 0) throw new Error("not an amount");
      const [res] = await run([["EVAL", PAYOUT_DONE, "4", recordKey, indexKey, paidOutKey, markerKey, String(micros), "1", String(PAYOUT_MARKER_MS), String(id), String(to)]]);
      if (res === null) return null;
      const left = Number(res);
      if (!Number.isSafeInteger(left)) throw Object.assign(new Error("rate guard unavailable"), { guardUnavailable: true });
      return left;
    },
    /** `takeIf(key, n)`: in one Redis script (SR1 F5): DECRBY n only if the sum holds all of it (→ what's left), else null. */
    takeIf: async (key, n) => {
      if (!Number.isSafeInteger(n) || n <= 0) throw new Error("not an amount");
      const [res] = await run([["EVAL", TAKE_IF, "1", key, String(n)]]);
      if (res === null) return null;
      const left = Number(res);
      if (!Number.isSafeInteger(left)) throw Object.assign(new Error("rate guard unavailable"), { guardUnavailable: true });
      return left;
    },
    shared: true,
  };
}

/** QA's store rule (3 Nov, the product privacy question): the shared store holds NOTHING linkable. */
export const STORE_KEY_MIN = 32;
/** The longest a count lives (counters and day limits: 24 h; per-minute limits pass their own 60 s). */
export const COUNT_MAX_MS = 86_400_000;
/** The longest a set-once value lives (an unpaid reply: until paid, at most 7 days). */
export const ONCE_MAX_MS = 7 * 86_400_000;
/** A stored value is a number or a flag, nothing else (a few digits, ":" or "," between). */
const PLAIN_VALUE = /^[0-9][0-9:,.]{0,127}$/;

/**
 * The shared store as the relay uses it (QA, 3 Nov): every KEY is HMAC-SHA256 under the relay-only secret
 * (AGENTZERO_STORE_KEY, 32+ random bytes) before it leaves this process, so the store's operator sees no IP bucket, no
 * AgentZero id, no transaction hash and no account in any key, and can't brute-force small spaces (an IPv4 /24) without
 * the secret. Every VALUE must be a number or a flag; every count lives at most 24 h and every set-once value at most 7
 * days. Only what the relay uses is passed through: hit, add, setOnce, get, del. `inner`: redisCounter.
 */
export function privateCounter(inner, secret) {
  if (typeof secret !== "string" || secret.length < STORE_KEY_MIN) throw new Error("AGENTZERO_STORE_KEY must be 32+ random bytes");
  const k = (key) => `z:${createHmac("sha256", secret).update(String(key)).digest("base64url").slice(0, 32)}`;
  const count = (ms) => Math.min(Number(ms), COUNT_MAX_MS);
  const once = (ms) => Math.min(Number(ms), ONCE_MAX_MS);
  const plain = (v) => {
    if (!PLAIN_VALUE.test(String(v))) throw new Error("the shared store keeps numbers and flags only");
    return String(v);
  };
  return {
    shared: true,
    private: true,
    /** The same keying for the relay's other shared-store user (pair.mjs's mailbox ids). */
    keyOf: k,
    hit: (key, windowMs) => inner.hit(k(key), count(windowMs)),
    add: (key, n, windowMs) => inner.add(k(key), n, count(windowMs)),
    setOnce: (key, value, ttlMs) => inner.setOnce(k(key), plain(value), once(ttlMs)),
    get: (key) => inner.get(k(key)),
    del: (key) => inner.del(k(key)),
  };
}

/** An IPv6 address's /64 (one home or one server's whole block counts as one caller); IPv4 as it is. */
export function addressBucket(ip) {
  const a = String(ip ?? "").trim().toLowerCase();
  if (!a.includes(":")) return a || "unknown";
  if (a.startsWith("::ffff:") && a.includes(".")) return a.slice(7);
  const [head, tail = ""] = a.split("::");
  const left = head ? head.split(":") : [];
  const right = a.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = a.includes("::") ? [...left, ...new Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return a;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * Audit #8: the caller's network for a day's count: an IPv6 /48 (one site's usual allocation, 65,536 /64s), an IPv4
 * address as is. One holder of a /48 can't make each of its /64s a new caller.
 */
export function networkBucket(ip) {
  const b = addressBucket(ip);
  return b.endsWith("::/64") ? `${b.split(":").slice(0, 3).join(":")}::/48` : b;
}

/**
 * The caller's address for the rate limits, only from a header a proxy in front of the relay set (NF-18): on Vercel
 * (its `x-real-ip`, which Vercel overwrites), or with RELAY_TRUST_PROXY=1 (the self-hoster's own proxy: `x-real-ip`,
 * else the first `x-forwarded-for`). Otherwise every caller is "unknown" and shares one count, never a value the
 * caller chose.
 */
export function callerAddress(headers, env = {}) {
  const trusted = env.RELAY_TRUST_PROXY === "1";
  const onVercel = Boolean(env.VERCEL || env.VERCEL_REGION);
  const real = headers.get("x-real-ip")?.trim();
  if ((onVercel || trusted) && real) return real;
  if (trusted) return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return "unknown";
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Base58 (Bitcoin's alphabet) to bytes; null when it isn't. */
export function b58decode(s) {
  if (typeof s !== "string" || s.length === 0 || s.length > 128) return null;
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const out = [];
  while (n > 0n) {
    out.push(Number(n & 255n));
    n >>= 8n;
  }
  for (const c of s) {
    if (c === "1") out.push(0);
    else break;
  }
  return Uint8Array.from(out.reverse());
}

const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");
/** True when `signature` (64 bytes) is `publicKey`'s (32 bytes) ed25519 signature over `message`. Never throws. */
export function ed25519Verify(publicKey, message, signature) {
  try {
    if (publicKey?.length !== 32 || signature?.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, Buffer.from(publicKey)]), format: "der", type: "spki" });
    return verify(null, Buffer.from(message), key, Buffer.from(signature));
  } catch {
    return false;
  }
}
