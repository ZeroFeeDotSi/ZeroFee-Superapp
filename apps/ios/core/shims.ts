// What a browser gives the core and a bare JavaScriptCore context doesn't (S1.6 phase 2): fetch, crypto.getRandomValues,
// timers, TextEncoder/TextDecoder, atob/btoa, AbortSignal, performance.now and console. Each is built on the few
// functions Swift puts on `globalThis.__native` (CoreContext.swift), and installed only where the context lacks it.
//
// Not here on purpose: crypto.subtle, URL, structuredClone, WebSocket and the rest of WebKit. The core's code in this
// bundle uses none of them (opening the laptop extension's box is @noble/ciphers' AES-GCM since 2 Nov), and
// tools/ios/core-no-url.test.ts keeps it so: the bundle runs there in exactly a bare JSContext's globals plus these.
// (JavaScriptCore has its own `console`, so the one below is installed only where a context has none.)

interface Native {
  /** One HTTPS request: init is JSON { method, headers, body (base64 | null) }. done gets JSON { status, headers, body (base64) } | { error }. */
  fetch(url: string, init: string, done: (result: string) => void): void;
  /** n random bytes from the system's generator (SecRandomCopyBytes). */
  random(n: number): number[];
  setTimer(ms: number, fire: () => void): number;
  clearTimer(id: number): void;
  log(level: string, text: string): void;
  /** scrypt off the core's queue (CoreContext.swift's Scrypt): spec is JSON { password, salt (base64), N, r, p, dkLen };
   *  done gets JSON { key (base64) } | { error }. Absent from a Swift that predates it. */
  scrypt?(spec: string, done: (result: string) => void): void;
}

const g = globalThis as any;
const native: Native = g.__native;
if (!native) throw new Error("the core's context has no __native: CoreContext.swift installs it before this script");

// ── Text ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

class Utf8Encoder {
  readonly encoding = "utf-8";
  encode(text = ""): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < text.length; i++) {
      let c = text.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
        const d = text.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
        }
      }
      if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd; // a lone surrogate
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }
}

class Utf8Decoder {
  readonly encoding = "utf-8";
  readonly fatal: boolean;
  constructor(label = "utf-8", options: { fatal?: boolean } = {}) {
    if (!/^utf-?8$/i.test(label)) throw new RangeError(`only utf-8 is available here, not ${label}`);
    this.fatal = !!options.fatal;
  }
  decode(input?: ArrayBuffer | ArrayBufferView): string {
    const b = !input ? new Uint8Array(0) : input instanceof Uint8Array ? input : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
    let out = "";
    const bad = () => {
      if (this.fatal) throw new TypeError("The encoded data was not valid utf-8");
      out += "�";
    };
    for (let i = 0; i < b.length; ) {
      const c = b[i];
      if (c < 0x80) {
        out += String.fromCharCode(c);
        i++;
        continue;
      }
      const need = c >= 0xc2 && c <= 0xdf ? 1 : c >= 0xe0 && c <= 0xef ? 2 : c >= 0xf0 && c <= 0xf4 ? 3 : -1;
      if (need < 0 || i + need >= b.length) {
        bad();
        i++;
        continue;
      }
      let cp = c & (need === 1 ? 0x1f : need === 2 ? 0x0f : 0x07);
      let ok = true;
      for (let k = 1; k <= need; k++) {
        const n = b[i + k];
        if ((n & 0xc0) !== 0x80) ok = false;
        cp = (cp << 6) | (n & 63);
      }
      // Overlong forms, surrogates and anything past U+10FFFF are not utf-8.
      if (!ok || (need === 2 && cp < 0x800) || (need === 3 && (cp < 0x10000 || cp > 0x10ffff)) || (cp >= 0xd800 && cp <= 0xdfff)) {
        bad();
        i++;
        continue;
      }
      out += String.fromCodePoint(cp);
      i += need + 1;
    }
    return out;
  }
}

// ── Base64 ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function btoaShim(binary: string): string {
  let out = "";
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i), b = binary.charCodeAt(i + 1), c = binary.charCodeAt(i + 2);
    if (a > 255 || b > 255 || c > 255) throw new Error("btoa: a character outside Latin-1");
    const n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < binary.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < binary.length ? B64[n & 63] : "=");
  }
  return out;
}

function atobShim(text: string): string {
  const clean = String(text).replace(/[\t\n\f\r ]/g, "").replace(/=+$/, "");
  if (clean.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(clean)) throw new Error("atob: not base64");
  let out = "";
  let bits = 0, n = 0;
  for (const ch of clean) {
    n = (n << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((n >> bits) & 255);
    }
  }
  return out;
}

const toB64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoaShim(s);
};
const fromB64 = (b64: string) => Uint8Array.from(atobShim(b64), (c) => c.charCodeAt(0));

// ── Timers ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const intervals = new Map<number, number>();
let nextInterval = 1;

function setTimeoutShim(fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]): number {
  return native.setTimer(Math.max(0, Number(ms) || 0), () => fn(...args));
}
function clearTimeoutShim(id?: number) {
  if (typeof id === "number") native.clearTimer(id);
}
function setIntervalShim(fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]): number {
  const id = nextInterval++;
  const tick = () => {
    if (!intervals.has(id)) return;
    intervals.set(id, native.setTimer(Math.max(1, Number(ms) || 0), tick));
    fn(...args);
  };
  intervals.set(id, native.setTimer(Math.max(1, Number(ms) || 0), tick));
  return id;
}
function clearIntervalShim(id?: number) {
  if (typeof id !== "number") return;
  const t = intervals.get(id);
  intervals.delete(id);
  if (t !== undefined) native.clearTimer(t);
}

// ── Abort ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

class AbortSignalShim {
  aborted = false;
  reason: unknown = undefined;
  onabort: ((e: unknown) => void) | null = null;
  private readonly listeners = new Set<(e: unknown) => void>();
  addEventListener(type: string, fn: (e: unknown) => void) {
    if (type === "abort") this.listeners.add(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    if (type === "abort") this.listeners.delete(fn);
  }
  throwIfAborted() {
    if (this.aborted) throw this.reason;
  }
  /** @internal */
  fire(reason: unknown) {
    if (this.aborted) return;
    this.aborted = true;
    this.reason = reason;
    const e = { type: "abort", target: this };
    this.onabort?.(e);
    for (const fn of this.listeners) fn(e);
  }
  static timeout(ms: number) {
    const s = new AbortSignalShim();
    setTimeoutShim(() => s.fire(Object.assign(new Error("The operation timed out."), { name: "TimeoutError" })), ms);
    return s;
  }
  static abort(reason?: unknown) {
    const s = new AbortSignalShim();
    s.fire(reason ?? Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
    return s;
  }
}

class AbortControllerShim {
  readonly signal = new AbortSignalShim();
  abort(reason?: unknown) {
    this.signal.fire(reason ?? Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
  }
}

// ── fetch ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

class HeadersShim {
  private readonly map = new Map<string, string>();
  constructor(init?: Record<string, string> | [string, string][] | HeadersShim) {
    if (init instanceof HeadersShim) init.forEach((v, k) => this.map.set(k, v));
    else if (Array.isArray(init)) for (const [k, v] of init) this.map.set(k.toLowerCase(), String(v));
    else if (init) for (const k of Object.keys(init)) this.map.set(k.toLowerCase(), String(init[k]));
  }
  get(name: string) {
    return this.map.get(name.toLowerCase()) ?? null;
  }
  has(name: string) {
    return this.map.has(name.toLowerCase());
  }
  set(name: string, value: string) {
    this.map.set(name.toLowerCase(), String(value));
  }
  forEach(fn: (value: string, key: string) => void) {
    this.map.forEach((v, k) => fn(v, k));
  }
  toObject() {
    return Object.fromEntries(this.map);
  }
}

class ResponseShim {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: HeadersShim;
  readonly statusText = "";
  private readonly bytes: Uint8Array;
  constructor(status: number, headers: Record<string, string>, bytes: Uint8Array) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.headers = new HeadersShim(headers);
    this.bytes = bytes;
  }
  async arrayBuffer() {
    return this.bytes.slice().buffer;
  }
  async text() {
    return new Utf8Decoder().decode(this.bytes);
  }
  async json() {
    return JSON.parse(await this.text());
  }
}

function fetchShim(input: string | { url: string }, init: { method?: string; headers?: any; body?: string | Uint8Array | ArrayBuffer | null; signal?: AbortSignalShim } = {}): Promise<ResponseShim> {
  const url = typeof input === "string" ? input : input.url;
  return new Promise((resolve, reject) => {
    const signal = init.signal;
    if (signal?.aborted) return reject(signal.reason);
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort);
    const body = init.body == null ? null : typeof init.body === "string" ? toB64(new Utf8Encoder().encode(init.body)) : toB64(init.body instanceof Uint8Array ? init.body : new Uint8Array(init.body));
    const headers = new HeadersShim(init.headers).toObject();
    native.fetch(String(url), JSON.stringify({ method: init.method ?? "GET", headers, body }), (result) => {
      signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      const r = JSON.parse(result) as { status?: number; headers?: Record<string, string>; body?: string; error?: string };
      if (r.error !== undefined || typeof r.status !== "number") return reject(new TypeError(`Load failed: ${r.error ?? "no answer"}`));
      resolve(new ResponseShim(r.status, r.headers ?? {}, fromB64(r.body ?? "")));
    });
  });
}

// ── scrypt ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Swift's scrypt, where this context has it (2 Nov: the link's N=2^17 took 21 s in plain JS here, on the core's one
 * queue): the same parameters and bytes as @noble/hashes' scrypt, which the core uses when this is undefined.
 */
export const nativeScrypt =
  typeof native.scrypt === "function"
    ? (password: Uint8Array, salt: Uint8Array, o: { N: number; r: number; p: number; dkLen: number }): Promise<Uint8Array> =>
        new Promise((resolve, reject) =>
          native.scrypt!(JSON.stringify({ password: toB64(password), salt: toB64(salt), N: o.N, r: o.r, p: o.p, dkLen: o.dkLen }), (result) => {
            const r = JSON.parse(result) as { key?: string; error?: string };
            const key = typeof r.key === "string" ? fromB64(r.key) : null;
            if (key && key.length === o.dkLen) resolve(key);
            else reject(new Error(`scrypt: ${r.error ?? "no key"}`));
          }),
        )
    : undefined;

// ── Install what's missing ────────────────────────────────────────────────────────────────────────────────────────────

const define = (name: string, value: unknown) => {
  if (g[name] === undefined) g[name] = value;
};
define("TextEncoder", Utf8Encoder);
define("TextDecoder", Utf8Decoder);
define("btoa", btoaShim);
define("atob", atobShim);
define("setTimeout", setTimeoutShim);
define("clearTimeout", clearTimeoutShim);
define("setInterval", setIntervalShim);
define("clearInterval", clearIntervalShim);
define("queueMicrotask", (fn: () => void) => void Promise.resolve().then(fn));
define("AbortSignal", AbortSignalShim);
define("AbortController", AbortControllerShim);
define("Headers", HeadersShim);
define("Response", ResponseShim);
define("fetch", fetchShim);
define("performance", { now: () => Date.now() });
define("crypto", {});
if (typeof g.crypto.getRandomValues !== "function") {
  g.crypto.getRandomValues = <T extends ArrayBufferView>(array: T): T => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    if (bytes.length > 65536) throw new Error("getRandomValues: at most 65536 bytes at a time");
    const r = native.random(bytes.length);
    if (r.length !== bytes.length) throw new Error("getRandomValues: the system gave too few bytes");
    bytes.set(r);
    return array;
  };
}
define("console", {
  log: (...a: unknown[]) => native.log("log", a.map(String).join(" ")),
  info: (...a: unknown[]) => native.log("info", a.map(String).join(" ")),
  warn: (...a: unknown[]) => native.log("warn", a.map(String).join(" ")),
  error: (...a: unknown[]) => native.log("error", a.map((x) => (x instanceof Error ? x.stack || String(x) : String(x))).join(" ")),
  debug: () => {},
});
