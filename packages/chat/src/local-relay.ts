// The sample-money pages' relay: Nostr's relay protocol (REQ, EVENT, CLOSE; EVENT, EOSE, OK back) in this page's memory.
// Every relay URL Chat asks for answers from the same store, so a post shows in its place as on the real relays, and
// nothing leaves the page: no socket, no host. Events are kept as they were signed; Chat's pool checks them as always.
import type { SocketLike, SocketMaker } from "./pool.ts";

type Filter = Record<string, unknown>;
interface Ev { id: string; pubkey: string; kind: number; created_at: number; tags: string[][] }

/** Does an event fit one filter (NIP-01: ids, authors, kinds, #<tag>, since, until; limit is the caller's)? */
export function fits(e: Ev, f: Filter): boolean {
  const list = (k: string) => (Array.isArray(f[k]) ? (f[k] as unknown[]) : null);
  const ids = list("ids"), authors = list("authors"), kinds = list("kinds");
  if (ids && !ids.includes(e.id)) return false;
  if (authors && !authors.includes(e.pubkey)) return false;
  if (kinds && !kinds.includes(e.kind)) return false;
  if (typeof f.since === "number" && e.created_at < f.since) return false;
  if (typeof f.until === "number" && e.created_at > f.until) return false;
  for (const [k, v] of Object.entries(f)) {
    if (!k.startsWith("#") || !Array.isArray(v)) continue;
    const name = k.slice(1);
    if (!e.tags.some((t) => Array.isArray(t) && t[0] === name && v.includes(t[1]))) return false;
  }
  return true;
}

/** One in-memory relay for the page: `make` is a SocketMaker for RelayPool (relay-sockets.ts). */
export function localRelay(): { make: SocketMaker; events: () => readonly Ev[] } {
  const events: Ev[] = [];
  const subs = new Set<{ socket: LocalSocket; id: string; filters: Filter[] }>();
  class LocalSocket implements SocketLike {
    readyState = 0;
    onopen: ((e: unknown) => void) | null = null;
    onclose: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    constructor() {
      setTimeout(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1;
        this.onopen?.({});
      }, 0);
    }
    private say(msg: unknown[]) {
      setTimeout(() => this.readyState === 1 && this.onmessage?.({ data: JSON.stringify(msg) }), 0);
    }
    send(data: string): void {
      if (this.readyState !== 1) return;
      let m: unknown;
      try { m = JSON.parse(data); } catch { return; }
      if (!Array.isArray(m)) return;
      if (m[0] === "REQ" && typeof m[1] === "string") {
        const filters = m.slice(2).filter((f): f is Filter => !!f && typeof f === "object");
        for (const s of subs) if (s.socket === this && s.id === m[1]) subs.delete(s);
        subs.add({ socket: this, id: m[1], filters });
        const limit = Math.min(...filters.map((f) => (typeof f.limit === "number" ? f.limit : Infinity)));
        const hits = events.filter((e) => filters.some((f) => fits(e, f))).sort((a, b) => b.created_at - a.created_at).slice(0, limit);
        for (const e of hits.reverse()) this.say(["EVENT", m[1], e]);
        this.say(["EOSE", m[1]]);
      } else if (m[0] === "CLOSE" && typeof m[1] === "string") {
        for (const s of subs) if (s.socket === this && s.id === m[1]) subs.delete(s);
      } else if (m[0] === "EVENT" && m[1] && typeof m[1] === "object") {
        const e = m[1] as Ev;
        if (typeof e.id !== "string") return;
        if (!events.some((x) => x.id === e.id)) {
          events.push(e);
          for (const s of subs) if (s.filters.some((f) => fits(e, f))) s.socket.say(["EVENT", s.id, e]);
        }
        this.say(["OK", e.id, true, ""]);
      }
    }
    close(): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      for (const s of subs) if (s.socket === this) subs.delete(s);
      setTimeout(() => this.onclose?.({}), 0);
    }
  }
  return { make: () => new LocalSocket(), events: () => events };
}
