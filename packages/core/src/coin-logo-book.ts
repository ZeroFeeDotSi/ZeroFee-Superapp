// The logos of the coins a person holds, kept on the phone (device.store, its own slot: sealed to the chip on the iPhone,
// apps/ios Bridge.swift), so a cold open draws each one in the first frame with no network at all, and a relay that is
// slow or down never turns a known coin back into a letter. Loaded beside Home, never in its first load.
//
// What is kept: the picture itself as a data url, by "<chain>:<address>". Public display data (the coin's own picture),
// never an amount; but which coins someone holds is theirs, hence the sealed slot. Capped (review, 3 Nov): a picture
// over LOGO_BYTES_MAX isn't kept (it still shows from the relay), at most LOGO_KEEP pictures and LOGO_TOTAL_MAX bytes in
// all, the least recently held dropped first, so the slot never grows into Home's cold read (it is a separate slot anyway).
// Fetched once per coin, by its address alone, from the relay (coin-logo.ts), one at a time.
import type { Bridge } from "./bridge.ts";
import { coinLogoUrl } from "./coin-logo.ts";
import { base64 } from "./sol/bytes.ts";

export const LOGO_STORE_KEY = "coin-logos.v1";
/** One picture's data url, at most (a coin logo is drawn at 40 px: a 64 px CoinGecko image is ~13 KB). */
export const LOGO_BYTES_MAX = 32 * 1024;
export const LOGO_KEEP = 40;
export const LOGO_TOTAL_MAX = 200 * 1024;
/** A coin whose picture couldn't be fetched isn't asked again for this long (this session). */
export const LOGO_RETRY_MS = 10 * 60_000;
const IMAGE = /^image\/(png|jpeg|jpg|webp|gif)$/;

export interface LogoEntry { k: string; d: string; at: number }

/** Newest first; a picture too big is dropped; then at most `keep` pictures and `total` characters in all. */
export function trimLogos(list: readonly LogoEntry[], o: { per?: number; keep?: number; total?: number } = {}): LogoEntry[] {
  const per = o.per ?? LOGO_BYTES_MAX, keep = o.keep ?? LOGO_KEEP, total = o.total ?? LOGO_TOTAL_MAX;
  const out: LogoEntry[] = [];
  let used = 0;
  for (const e of [...list].sort((a, b) => b.at - a.at)) {
    if (out.length >= keep) break;
    if (e.d.length > per || used + e.d.length > total) continue;
    out.push(e);
    used += e.d.length;
  }
  return out;
}

/** A kept list as read back: only well-formed entries of image data urls (anything else is no entry). */
export function parseLogos(raw: unknown): LogoEntry[] {
  try {
    const v = typeof raw === "string" ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(v)) return [];
    return v.filter((e): e is LogoEntry => !!e && typeof e.k === "string" && typeof e.at === "number" && typeof e.d === "string" && /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(e.d));
  } catch {
    return [];
  }
}

export interface LogoBook {
  /** The picture to draw: the kept one (a data url) when there is one, else the relay's url; undefined when neither. */
  src(chain: string, address: string): string | undefined;
  /** These coins are held: fetch and keep any picture not kept yet (in the background), and mark them as recently held. */
  want(coins: readonly { chain: string; address: string }[]): void;
  /** Called when a kept picture arrives. Returns the unsubscribe. */
  subscribe(f: () => void): () => void;
  ready: Promise<void>;
}

export function createLogoBook(bridge: Pick<Bridge, "call">, o: { relay?: string; fetch?: typeof fetch; now?: () => number } = {}): LogoBook {
  const now = o.now ?? Date.now;
  const f = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const book = new Map<string, LogoEntry>();
  const tried = new Map<string, number>();
  const subs = new Set<() => void>();
  const keyOf = (chain: string, address: string) => `${chain}:${chain === "near" ? address.replace(/^nep141:/, "") : address}`;
  const ready = bridge.call<{ value: string | null }>("device.store.get", { key: LOGO_STORE_KEY }).then(
    (r) => { if ("ok" in r) for (const e of parseLogos(r.ok?.value)) book.set(e.k, e); },
    () => undefined,
  );
  let queue: { chain: string; address: string }[] = [];
  let running = false;
  const save = () => {
    const kept = trimLogos([...book.values()]);
    book.clear();
    for (const e of kept) book.set(e.k, e);
    void bridge.call("device.store.set", { key: LOGO_STORE_KEY, value: kept.length ? JSON.stringify(kept) : null }).catch(() => undefined);
  };
  const fetchOne = async (chain: string, address: string): Promise<LogoEntry | null> => {
    const url = coinLogoUrl(o.relay, chain, address);
    if (!url) return null;
    const r = await f(url, { signal: AbortSignal.timeout(8_000) });
    const type = (r.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (r.status !== 200 || !IMAGE.test(type)) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    const d = `data:${type};base64,${base64(bytes)}`;
    return d.length <= LOGO_BYTES_MAX ? { k: keyOf(chain, address), d, at: now() } : null;
  };
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await ready;
      let added = false;
      for (let next = queue.shift(); next; next = queue.shift()) {
        const k = keyOf(next.chain, next.address);
        if (book.has(k) || now() - (tried.get(k) ?? -Infinity) < LOGO_RETRY_MS) continue;
        tried.set(k, now());
        const e = await fetchOne(next.chain, next.address).catch(() => null);
        if (e) { book.set(k, e); added = true; for (const s of subs) { try { s(); } catch { /* a listener's own */ } } }
      }
      if (added) save();
    } finally {
      running = false;
    }
  };
  return {
    ready,
    src: (chain, address) => book.get(keyOf(chain, address))?.d ?? coinLogoUrl(o.relay, chain, address),
    want(coins) {
      for (const c of coins) {
        const e = book.get(keyOf(c.chain, c.address));
        const k = keyOf(c.chain, c.address);
        if (e) e.at = now();                                   // recently held: dropped last
        else if (coinLogoUrl(o.relay, c.chain, c.address) && !(now() - (tried.get(k) ?? -Infinity) < LOGO_RETRY_MS) && !queue.some((q) => keyOf(q.chain, q.address) === k)) queue.push({ chain: c.chain, address: c.address });
      }
      void run();
    },
    subscribe: (fn) => { subs.add(fn); return () => void subs.delete(fn); },
  };
}
