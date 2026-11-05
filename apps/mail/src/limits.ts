// In-memory limits: a fixed window per key ("ip:1.2.3.4", "box:lena.river"), and the used-proof cache. Both are
// bounded maps in least-recently-used order: a new key past the cap drops the oldest one, so every call is O(1) and
// a flood of fresh keys can't grow memory or slow a call down.
/**
 * The key an address is limited under: an IPv4 address as is (an IPv4-mapped IPv6 address too), an IPv6 address by
 * its /64, since one subscriber is routinely given a whole /64 and could otherwise take a fresh address per try.
 */
export function ipKey(address: string): string {
  const a = address.replace(/%.*$/, "").replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
  if (!a.includes(":")) return a;
  const width = (parts: string[]) => parts.reduce((n, p) => n + (p.includes(".") ? 2 : 1), 0);
  const [head = "", tail] = a.split("::");
  const front = head ? head.split(":") : [];
  const back = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups = tail === undefined ? front : [...front, ...Array<string>(Math.max(0, 8 - width(front) - width(back))).fill("0"), ...back];
  return `${groups
    .slice(0, 4)
    .map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16).toString(16) : "0"))
    .join(":")}::/64`;
}

export class Limiter {
  private hits = new Map<string, { n: number; until: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now, maxKeys = 20_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.maxKeys = maxKeys;
  }

  get size(): number {
    return this.hits.size;
  }

  /** True when the key has used its window (counts nothing). */
  spent(key: string): boolean {
    const h = this.hits.get(key);
    return h !== undefined && h.until > this.now() && h.n >= this.limit;
  }

  /** True when the key may go ahead (and counts it); false once it has used its window. */
  take(key: string): boolean {
    const t = this.now();
    let h = this.hits.get(key);
    if (h) this.hits.delete(key); // re-inserted below: most recently used last
    if (!h || h.until <= t) h = { n: 0, until: t + this.windowMs };
    const ok = h.n < this.limit;
    if (ok) h.n++;
    this.hits.set(key, h);
    if (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value!);
    return ok;
  }
}

/** Signatures already used, kept for their proof window so a proof works once. */
export class UsedProofs {
  private seen = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor(ttlMs: number, now: () => number = Date.now, maxKeys = 100_000) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.maxKeys = maxKeys;
  }

  /** True the first time a signature is seen within its window; false on a replay. */
  first(signature: string): boolean {
    const t = this.now();
    const until = this.seen.get(signature);
    if (until !== undefined && until > t) return false;
    this.seen.delete(signature);
    this.seen.set(signature, t + this.ttlMs);
    // Expired entries sit at the front (insertion order); drop a few per call, and the oldest past the cap.
    for (let i = 0; i < 4; i++) {
      const first = this.seen.entries().next().value;
      if (!first || first[1] > t) break;
      this.seen.delete(first[0]);
    }
    if (this.seen.size > this.maxKeys) this.seen.delete(this.seen.keys().next().value!);
    return true;
  }
}
