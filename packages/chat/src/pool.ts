// ZeroFee Chat's connection to the relays: one socket per relay, one subscription at a time: a place (BitChat's geohash
// subscription: kinds [20000], #g [place], the last hour, at most 200) or one key's private messages (kind 1059, #p, the
// last day). Every event is checked (cheap checks, a per-relay rate, then id and signature, nostr.ts verifyEvent) before
// it is shown, each event once however many relays carry it. Reconnects with a growing wait. Sends a signed event to
// every relay and says how many took it.
import { GEOHASH_MESSAGE, verifyEvent, type NostrEvent } from "@zerofee/core/nostr";
import { CHAT_NAME_D, CHAT_NAME_KIND, ROOM_MESSAGE } from "@zerofee/core/chat-near";
import { relaySockets } from "./relay-sockets.ts";

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((e: unknown) => void) | null;
  onclose: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
}
export type SocketMaker = (url: string) => SocketLike;

export interface PoolStatus {
  /** Relays with an open socket now. */
  open: number;
  total: number;
}

/** BitChat's first look back: an hour, 200 events (TransportConfig.nostrGeohashInitialLookbackSeconds, …Limit). */
const LOOKBACK_SECONDS = 3600;
const LIMIT = 200;
const MAX_FRAME = 256 * 1024;
const SEEN_CAP = 4096;
/** How far past this device's clock an event's time may be (relays' own usual allowance, 15 minutes). */
export const MAX_AHEAD_SECONDS = 900;
/** Events one relay may hand over in a second (its first answer is up to LIMIT at once). */
export const PER_RELAY_PER_SECOND = LIMIT + 50;
/** BitChat's private-message subscription (GeohashSubscriptionManager, NostrFilter.giftWrapsFor): kind 1059 to one key,
 *  the last day (nostrDMSubscribeLookbackSeconds), at most 100 (nostrRelayDefaultFetchLimit). A wrap's time is jittered
 *  ±15 minutes, so it may sit up to 15 minutes past the clock plus the relays' own 15. */
export const GIFT_WRAP_KIND = 1059;
const DM_LOOKBACK_SECONDS = 86_400 + 900;
const DM_LIMIT = 100;
const DM_MAX_AHEAD_SECONDS = 1800;
/** A NEAR room's first look back: a week (a room keeps talking longer than a place's hour). */
const ROOM_LOOKBACK_SECONDS = 7 * 86_400;
const MAX_NAME_AUTHORS = 100;
/** A name record's most: an ML-DSA-65 key and signature in base58, and the rest. */
const MAX_NAME_CONTENT = 9000;

/** What one pool listens for: its filter, and the cheap checks an event must pass before its signature is checked. */
interface Want {
  filter: (nowSeconds: number) => Record<string, unknown>;
  fits: (e: NostrEvent, nowSeconds: number) => boolean;
}

const hasTag = (e: NostrEvent, name: string, value: string) => Array.isArray(e.tags) && e.tags.some((t) => Array.isArray(t) && t[0] === name && t[1] === value);
const timely = (e: NostrEvent, nowSeconds: number, ahead: number) => Number.isSafeInteger(e.created_at) && e.created_at >= 0 && e.created_at <= nowSeconds + ahead;

export class RelayPool {
  private sockets = new Map<string, SocketLike>();
  private waits = new Map<string, number>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private seen = new Set<string>();
  private rate = new Map<string, { second: number; count: number }>();
  private want: Want | null = null;
  private sub = 0;
  /** Events waiting for a socket that is still opening. */
  private queued = new Map<string, string[]>();
  private closed = false;
  private pending = new Map<string, { relays: Set<string>; ok: Set<string>; answered: Set<string>; done: (r: { ok: number; of: number }) => void; timer: ReturnType<typeof setTimeout> }>();

  private readonly relays: readonly string[];
  private readonly onEvent: (e: NostrEvent, relay: string) => void;
  private readonly onStatus: (s: PoolStatus) => void;
  private readonly make: SocketMaker;
  private readonly now: () => number;

  constructor(
    relays: readonly string[],
    onEvent: (e: NostrEvent, relay: string) => void,
    onStatus: (s: PoolStatus) => void = () => {},
    // the sample-money pages' in-memory relay when they set one (relay-sockets.ts), else the real relay
    make: SocketMaker = (url) => (relaySockets.make ? relaySockets.make(url) : (new WebSocket(url) as unknown as SocketLike)),
    now: () => number = () => Date.now(),
  ) {
    this.relays = relays;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.make = make;
    this.now = now;
  }

  /** Listen to one place (and only it): the last hour first, then live. */
  join(place: string): void {
    this.listen({
      filter: (now) => ({ kinds: [GEOHASH_MESSAGE], "#g": [place], since: now - LOOKBACK_SECONDS, limit: LIMIT }),
      // Only this place's messages, and only real ones: kind, the place's own tag and a sane time first (cheap), then
      // id and signature. A time past the clock (security review 2 Nov, Medium): one event dated after the year 275760
      // made toISOString throw while the list drew, and the whole app went blank on joining the place; one dated next
      // year sat under every new message and 200 of them hid the place's real ones for good (they pass every "since").
      fits: (e, now) => e.kind === GEOHASH_MESSAGE && hasTag(e, "g", place) && timely(e, now, MAX_AHEAD_SECONDS),
    });
  }

  /** Listen to one NEAR room (J3 part 2, chat-near.ts): kind 9 with its ["h", room], the last week, at most 200. */
  room(room: string): void {
    this.listen({
      filter: (now) => ({ kinds: [ROOM_MESSAGE], "#h": [room], since: now - ROOM_LOOKBACK_SECONDS, limit: LIMIT }),
      fits: (e, now) => e.kind === ROOM_MESSAGE && hasTag(e, "h", room) && timely(e, now, MAX_AHEAD_SECONDS),
    });
  }

  /** Listen for the NEAR names (chat-near.ts: kind 30078, d = zerofee-chat-name) of these keys, checked like any event;
   *  whose they are and what they say is the reader's (readNameEvent). At most 100 keys. */
  names(pubkeys: readonly string[]): void {
    const authors = [...new Set(pubkeys)].filter((k) => /^[0-9a-f]{64}$/.test(k)).slice(0, MAX_NAME_AUTHORS);
    if (authors.length === 0) return this.leave();
    const wanted = new Set(authors);
    this.listen({
      filter: () => ({ kinds: [CHAT_NAME_KIND], authors, "#d": [CHAT_NAME_D], limit: authors.length * 2 }),
      fits: (e, now) => e.kind === CHAT_NAME_KIND && wanted.has(e.pubkey) && hasTag(e, "d", CHAT_NAME_D) && timely(e, now, MAX_AHEAD_SECONDS) && typeof e.content === "string" && e.content.length <= MAX_NAME_CONTENT,
    });
  }

  /** Listen for private messages to one key (this person's key in the place): BitChat's kind-1059 wraps, the last day. */
  inbox(pubkey: string): void {
    this.listen({
      filter: (now) => ({ kinds: [GIFT_WRAP_KIND], "#p": [pubkey], since: now - DM_LOOKBACK_SECONDS, limit: DM_LIMIT }),
      fits: (e, now) => e.kind === GIFT_WRAP_KIND && hasTag(e, "p", pubkey) && timely(e, now, DM_MAX_AHEAD_SECONDS),
    });
  }

  private listen(want: Want): void {
    if (this.want) this.leave();
    this.want = want;
    this.sub += 1;
    this.seen.clear();
    for (const url of this.relays) {
      const s = this.sockets.get(url);
      if (s && s.readyState === 1) this.request(s);
      else if (!s) this.connect(url);
    }
  }

  leave(): void {
    this.want = null;
    for (const s of this.sockets.values()) if (s.readyState === 1) s.send(JSON.stringify(["CLOSE", `zf${this.sub}`]));
  }

  /** Sends one signed event to every relay; resolves with how many said OK within 6 s. A socket still opening (the
   *  first seconds in a place) gets it as soon as it opens, inside the same 6 s (J3 C4: a private message written right
   *  after joining went to no one and read "Not sent"). */
  publish(e: NostrEvent): Promise<{ ok: number; of: number }> {
    return new Promise((done) => {
      const open = [...this.sockets.entries()].filter(([, s]) => s.readyState === 1 || s.readyState === 0);
      if (open.length === 0) return done({ ok: 0, of: this.relays.length });
      const ok = new Set<string>();
      const relays = new Set(open.map(([u]) => u));
      const finish = () => {
        clearTimeout(entry.timer);
        this.pending.delete(e.id);
        done({ ok: ok.size, of: this.relays.length });
      };
      const entry = { relays, ok, answered: new Set<string>(), done: () => finish(), timer: setTimeout(finish, 6000) };
      this.pending.set(e.id, entry);
      for (const [url, s] of open) {
        if (s.readyState === 1) s.send(JSON.stringify(["EVENT", e]));
        else this.queued.set(url, [...(this.queued.get(url) ?? []), JSON.stringify(["EVENT", e])]);
      }
    });
  }

  close(): void {
    this.closed = true;
    for (const t of this.timers.values()) clearTimeout(t);
    for (const s of this.sockets.values()) s.close();
    this.sockets.clear();
    for (const p of this.pending.values()) p.done({ ok: p.ok.size, of: this.relays.length });
  }

  private status(): void {
    this.onStatus({ open: [...this.sockets.values()].filter((s) => s.readyState === 1).length, total: this.relays.length });
  }

  private request(s: SocketLike): void {
    if (!this.want) return;
    s.send(JSON.stringify(["REQ", `zf${this.sub}`, this.want.filter(Math.floor(this.now() / 1000))]));
  }

  private connect(url: string): void {
    if (this.closed) return;
    let s: SocketLike;
    try {
      s = this.make(url);
    } catch {
      return this.retry(url);
    }
    this.sockets.set(url, s);
    s.onopen = () => {
      this.waits.delete(url);
      this.status();
      this.request(s);
      const waiting = this.queued.get(url) ?? [];
      this.queued.delete(url);
      for (const frame of waiting) s.send(frame);
    };
    s.onclose = () => {
      if (this.sockets.get(url) === s) this.sockets.delete(url);
      this.queued.delete(url);
      this.status();
      this.retry(url);
    };
    s.onerror = () => {};
    s.onmessage = (m) => this.message(url, m.data);
  }

  private retry(url: string): void {
    if (this.closed) return;
    const wait = Math.min((this.waits.get(url) ?? 1000) * 2, 60_000);
    this.waits.set(url, wait);
    clearTimeout(this.timers.get(url));
    this.timers.set(url, setTimeout(() => this.connect(url), wait));
  }

  private message(url: string, data: unknown): void {
    if (typeof data !== "string" || data.length > MAX_FRAME) return;
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(msg)) return;
    if (msg[0] === "OK" && typeof msg[1] === "string") {
      const p = this.pending.get(msg[1]);
      if (p && p.relays.has(url)) {
        if (msg[2] === true) p.ok.add(url);
        p.answered.add(url);
        if (p.answered.size === p.relays.size) p.done({ ok: p.ok.size, of: this.relays.length });
      }
      return;
    }
    if (msg[0] !== "EVENT" || msg[1] !== `zf${this.sub}`) return;
    const e = msg[2] as NostrEvent;
    if (!e || typeof e !== "object" || this.seen.has(e.id) || !this.want) return;
    const nowSeconds = Math.floor(this.now() / 1000);
    if (!this.want.fits(e, nowSeconds)) return;
    // A relay flooding events (each one a signature check on the page's one thread) is heard up to a rate, no faster.
    if (!this.within(url, nowSeconds)) return;
    if (!verifyEvent(e)) return;
    if (this.seen.size >= SEEN_CAP) this.seen.clear();
    this.seen.add(e.id);
    this.onEvent(e, url);
  }

  /** At most PER_RELAY_PER_SECOND events checked from one relay in one second (the last hour's 200 fit in one go). */
  private within(url: string, nowSeconds: number): boolean {
    const r = this.rate.get(url);
    if (!r || r.second !== nowSeconds) {
      this.rate.set(url, { second: nowSeconds, count: 1 });
      return true;
    }
    return ++r.count <= PER_RELAY_PER_SECOND;
  }
}
