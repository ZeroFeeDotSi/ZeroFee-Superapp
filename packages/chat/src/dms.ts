// ZeroFee Chat's private messages (D55 slice 2): BitChat's geohash DMs with anyone seen in a place, as plain state the
// app draws. Sealing and opening are the core's (nostr.seal, nostr.open: bitchat-dm.ts); this only keeps what was said.
//
// The same rules as a place's messages (messages.ts): someone's private message is only ever shown. Its one extra is a
// request chip for a message in the request format whose address checks out on its chain, and the chip only FILLS
// Wallet's Send in. Nothing in a private message is read as a command; nothing opens on its own.
//
// Like BitChat (ChatPrivateConversationCoordinator.handlePrivateMessage): a message id is shown once however often it
// comes; a muted sender's messages are dropped before anything answers them (no delivered ack, not even that); every
// other new message is acked "delivered" once. Kept in memory only, like BitChat's geohash DMs: the relays hold a day.
import { readable } from "@zerofee/core/signer";
import type { DmPayload } from "@zerofee/core/bitchat-dm";
import { readRequest, type PayRequest } from "./messages.ts";

export type Delivery = "sending" | "sent" | "delivered" | "read" | "failed";

export interface DmLine {
  /** BitChat's message id (a UUID for ours and BitChat's). */
  id: string;
  mine: boolean;
  text: string;
  atIso: string;
  /** Ours only: how far it got (BitChat's delivery status). */
  status?: Delivery;
  /** Ours only: when it last went out (ms), for the 10-second "not delivered yet" (J3 C4). */
  triedAtMs?: number;
  /** Theirs only: the time (seconds) of the newest copy heard, so a copy sent again is acked once (J3 C4). */
  heardAt?: number;
  /** Theirs only, a valid request: the chip that fills Send in when tapped. */
  request?: PayRequest;
}

export interface Conversation {
  /** Their key in this place. */
  peer: string;
  lines: DmLine[];
  unread: number;
}

export type Dms = Readonly<Record<string, Conversation>>;

const MAX_LINES = 200;
const LONG = 600;
const ORDER: Record<Delivery, number> = { failed: 0, sending: 1, sent: 2, delivered: 3, read: 4 };

const isoOf = (seconds: number) => {
  const d = new Date(seconds * 1000);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
};

const put = (dms: Dms, peer: string, change: (c: Conversation) => Conversation): Dms => {
  const now = dms[peer] ?? { peer, lines: [], unread: 0 };
  return { ...dms, [peer]: change(now) };
};

export interface Incoming {
  dms: Dms;
  /** The message id to ack as delivered, when this was a new message from someone not muted. */
  ack: string | null;
}

/** What one opened wrap changes. `viewing`: the person has this conversation on screen (it doesn't count as unread). */
export function receive(dms: Dms, from: string, atSeconds: number, payload: DmPayload, options: { muted: boolean; viewing: boolean }): Incoming {
  if (options.muted) return { dms, ack: null };
  if (payload.kind === "message") {
    const known = dms[from]?.lines.find((l) => !l.mine && l.id === payload.messageId);
    // Shown once however often it comes. Sent again (a later time: they tapped Send again because our ack never reached
    // them) it is acked again; the same copy read again (the day's messages when the app opens) is not (J3 C4).
    if (known) {
      const heard = known.heardAt ?? Date.parse(known.atIso) / 1000;
      if (!(atSeconds > heard)) return { dms, ack: null };
      return { dms: put(dms, from, (c) => ({ ...c, lines: c.lines.map((l) => (l === known ? { ...l, heardAt: atSeconds } : l)) })), ack: payload.messageId };
    }
    const raw = payload.text;
    const request = readRequest(raw);
    const line: DmLine = { id: payload.messageId, mine: false, text: readable(raw.length > LONG ? `${raw.slice(0, LONG)}…` : raw), atIso: isoOf(atSeconds), ...(request ? { request } : {}) };
    const next = put(dms, from, (c) => ({
      ...c,
      lines: [...c.lines, line].sort((a, b) => a.atIso.localeCompare(b.atIso)).slice(-MAX_LINES),
      unread: options.viewing ? 0 : c.unread + 1,
    }));
    return { dms: next, ack: payload.messageId };
  }
  // An ack moves one of OUR messages forward, never back, and only one we sent to this very key.
  const status: Delivery = payload.kind === "read" ? "read" : "delivered";
  const c = dms[from];
  if (!c || !c.lines.some((l) => l.mine && l.id === payload.messageId)) return { dms, ack: null };
  return {
    dms: put(dms, from, (x) => ({ ...x, lines: x.lines.map((l) => (l.mine && l.id === payload.messageId && ORDER[l.status ?? "sent"] < ORDER[status] ? { ...l, status } : l)) })),
    ack: null,
  };
}

/** One of ours, as it goes out: on screen as "Sending…" before it is posted, so an ack that comes back quickly always
 *  finds it (J3 C4: an ack that beat the relays' answer was dropped, and the message stayed "Sent"). */
export function sending(dms: Dms, to: string, id: string, text: string, nowSeconds: number): Dms {
  return put(dms, to, (c) => ({ ...c, lines: [...c.lines, { id, mine: true, text: readable(text), atIso: isoOf(nowSeconds), status: "sending" as const, triedAtMs: Math.round(nowSeconds * 1000) }].slice(-MAX_LINES) }));
}

/** How long one of ours may go without "Delivered" before the line says so, with Send again (J3 C4). */
export const ACK_WAIT_MS = 10_000;

/** Ours, not sent, or sent and not delivered after ACK_WAIT_MS: the line says so and offers Send again. */
export function late(line: DmLine, nowMs: number): boolean {
  if (!line.mine) return false;
  if (line.status === "failed") return true;
  return line.status === "sent" && nowMs - (line.triedAtMs ?? Date.parse(line.atIso)) >= ACK_WAIT_MS;
}

/** In how many ms the next line of ours turns late, or null when none is waiting for its ack. */
export function nextLate(lines: readonly DmLine[], nowMs: number): number | null {
  const due = lines.filter((l) => l.mine && l.status === "sent" && !late(l, nowMs)).map((l) => (l.triedAtMs ?? Date.parse(l.atIso)) + ACK_WAIT_MS - nowMs);
  return due.length ? Math.max(0, Math.min(...due)) : null;
}

/** Send again: the same message (its id kept), "Sending…" once more, its 10 seconds starting over. */
export function retrying(dms: Dms, to: string, id: string, nowMs: number): Dms {
  if (!dms[to]) return dms;
  return put(dms, to, (c) => ({ ...c, lines: c.lines.map((l) => (l.mine && l.id === id && (l.status === "sent" || l.status === "failed") ? { ...l, status: "sending" as const, triedAtMs: nowMs } : l)) }));
}

/** What a late line says, in one line (its button is "Send again"). */
export const lateWords = (status: Delivery | undefined): string => (status === "failed" ? "Not sent. Check your internet connection." : "Not delivered yet. They may be offline.");

/**
 * A person's name in private messages: the name they use in the place ("Ben#c540"), else, when they haven't posted
 * where this phone could read it, "Someone in Zurich", never a made-up "anon#e6eb" (J3 C3: BitChat's private messages
 * carry no name). Two or more such people are numbered in the order they first wrote.
 */
export function peerName(peer: string, known: (pubkey: string) => string | undefined, dms: Dms, place: string): string {
  const name = known(peer);
  if (name) return name;
  const first = (c: Conversation) => c.lines[0]?.atIso ?? "";
  const unnamed = Object.values(dms)
    .filter((c) => c.lines.length > 0 && !known(c.peer))
    .sort((a, b) => (first(a) < first(b) ? -1 : first(a) > first(b) ? 1 : 0))
    .map((c) => c.peer);
  const n = unnamed.indexOf(peer);
  return unnamed.length > 1 && n >= 0 ? `Someone in ${place} (${n + 1})` : `Someone in ${place}`;
}

/** How far one of ours got (relays took it, or none did). Never moves a delivered or read one back. */
export function delivery(dms: Dms, to: string, id: string, status: Delivery): Dms {
  if (!dms[to]) return dms;
  return put(dms, to, (c) => ({ ...c, lines: c.lines.map((l) => (l.mine && l.id === id && (status === "failed" ? l.status === "sending" : ORDER[l.status ?? "sent"] < ORDER[status]) ? { ...l, status } : l)) }));
}

export const seen = (dms: Dms, peer: string): Dms => (dms[peer]?.unread ? put(dms, peer, (c) => ({ ...c, unread: 0 })) : dms);

export const unreadCount = (dms: Dms): number => Object.values(dms).reduce((n, c) => n + c.unread, 0);

/** BitChat's private messages hold 255 bytes of UTF-8 (PrivateMessagePacket's length byte). */
export const dmBytes = (text: string): number => new TextEncoder().encode(text).length;

/** "Delivered", "Read", … as the line under one of ours says it. */
export const deliveryWords: Record<Delivery, string> = { sending: "Sending…", sent: "Sent", delivered: "Delivered", read: "Read", failed: "Not sent. Check your internet connection." };
