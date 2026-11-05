// A NEAR room's messages, kept on this device (sd-chat crawl, 5 Nov, b: after a reload the room stayed and its messages
// were gone). The room's servers may not keep a room's messages (kind 9 is a NIP-29 group's, and many servers drop it),
// so the last ones shown are kept here, in Chat's own device.store, as the events they arrived as (each one's signature
// was checked then, pool.ts). Read back, each is checked again for its shape, its id (the hash of what it says), its kind
// and its room, so a changed value shows nothing. Not its signature again: 40 of those held the screen for ~200 ms.
import { sha256 } from "@noble/hashes/sha2.js";
import { MAX_CONTENT, eventHash, type NostrEvent } from "@zerofee/core/nostr";
import { ROOM_MESSAGE } from "@zerofee/core/chat-near";

/** How many of a room's messages are kept. */
export const KEEP_MESSAGES = 40;
/** At most this many characters of JSON per room. */
export const KEEP_CHARS = 48_000;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The store key for a room: device.store takes 1 to 64 of a–z, 0–9, dots and dashes, so the room id is hashed. */
export function roomKeepKey(room: string): string {
  return `room-msgs.${hex(sha256(new TextEncoder().encode(room))).slice(0, 24)}`;
}

const HEX64 = /^[0-9a-f]{64}$/;
/** An event as it was kept: its fields' shape, and its id the hash of them. */
function intact(e: unknown): e is NostrEvent {
  if (!e || typeof e !== "object") return false;
  const x = e as Record<string, unknown>;
  if (typeof x.id !== "string" || !HEX64.test(x.id) || typeof x.pubkey !== "string" || !HEX64.test(x.pubkey)) return false;
  if (typeof x.sig !== "string" || !/^[0-9a-f]{128}$/.test(x.sig) || typeof x.content !== "string") return false;
  if (!Number.isSafeInteger(x.created_at) || !Number.isSafeInteger(x.kind) || !Array.isArray(x.tags) || x.tags.length > 64) return false;
  if (!(x.tags as unknown[]).every((t) => Array.isArray(t) && t.length <= 16 && t.every((v) => typeof v === "string" && v.length <= 1024))) return false;
  try {
    return hex(eventHash(x as unknown as NostrEvent)) === x.id;
  } catch {
    return false;
  }
}

const inRoom = (e: NostrEvent, room: string) => e.kind === ROOM_MESSAGE && e.tags.some((t) => t[0] === "h" && t[1] === room);

/** The kept value for a room's events: the newest KEEP_MESSAGES of this room, oldest first, within KEEP_CHARS. */
export function keepText(events: readonly NostrEvent[], room: string): string {
  const seen = new Set<string>();
  let list = events
    .filter((e) => inRoom(e, room) && e.content.length <= MAX_CONTENT && !seen.has(e.id) && (seen.add(e.id), true))
    .sort((a, b) => a.created_at - b.created_at)
    .slice(-KEEP_MESSAGES);
  let text = JSON.stringify(list);
  while (text.length > KEEP_CHARS && list.length > 0) {
    list = list.slice(1);
    text = JSON.stringify(list);
  }
  return text;
}

/** A room's kept events, each checked again; anything unreadable or not this room's is left out. */
export function readKept(raw: string | null | undefined, room: string): NostrEvent[] {
  if (!raw) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  return v.slice(-KEEP_MESSAGES).filter((e): e is NostrEvent => intact(e) && inRoom(e, room) && e.content.length <= MAX_CONTENT);
}
