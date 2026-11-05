// Chat for a first-time person (B27, phone test, 2 Nov). The design review
// of 2 Nov §9 (change 10): a list of your chats and one "+"; before there is any chat, one screen of three lines and the
// two ways in that its first line names. Nothing here touches the screen: the screens read these words and this order,
// and the tests read them too.
import { roomFor } from "@zerofee/core/chat-near";
import { readPlace } from "./geohash.ts";
import { displayText, type Shown } from "./messages.ts";
import { visible } from "./moderation.ts";
import { findCities } from "./places.ts";
import { whereName } from "./rooms.ts";

/** The first screen: one line each, nothing else (then its two buttons, Nearby and Pick a city). */
export const FIRST_LINES = ["Pick a city or tap Nearby.", "Say hi.", "Tap a name to message them."] as const;
/** A place with nothing in it yet. */
export const EMPTY_PLACE = "Say hello. Anyone here can see it.";
/** A name, tapped: the first thing on its sheet. */
export const PRIVATE_FIRST = "Message them privately";
/** The foot of the "+" sheet: the one privacy line before joining (§9.4). */
export const START_FOOT = "City chats are public.";
/** sd-chat crawl (5 Nov, d): what's typed in Start a chat matches nothing (the Copywriter's words). */
export const NO_MATCH = "Nothing matches that. Type a city, a .near account, or a coin.";
/** Whether typed text could be a place's name (letters, spaces, dashes, dots, apostrophes): only that is named back as a
 *  city ZeroFee doesn't know. */
export const placeLike = (text: string): boolean => /^[\p{L}][\p{L}\p{M} .'’-]{0,63}$/u.test(text.trim());

/** What Chat opens on: a place it was in, the first screen (nothing yet), or the list of chats. */
export function opensOn(s: { place: string | null; chats: number }): "place" | "first" | "list" {
  if (s.place) return "place";
  return s.chats === 0 ? "first" : "list";
}

/** Nearby's words on this device: "your iPhone" in the app, "this browser" on the web (VOICE §4). `slow` at 10 s with no
 *  answer yet (iOS's own ask may still be on screen, so never "didn't"); `refused` once it said no. */
export function nearbyWords(phone: boolean): { asking: string; slow: string; refused: string } {
  return phone
    ? { asking: "Asking your iPhone…", slow: "Your iPhone hasn't shared where you are yet.", refused: "Your iPhone didn't share your location." }
    : { asking: "Asking this browser…", slow: "This browser hasn't shared where you are yet.", refused: "This browser didn't share your location." };
}

export interface Match {
  where: string;
  name: string;
  /** §9.4's match line: "London · city", "marketing · room"; "#u0qj · place" for BitChat's own letters. */
  what: "city" | "room" | "place";
}

/** The "+" sheet's matches as the person types: cities by name (at most three); a NEAR name, or a coin's short name
 *  when no city is called that, as a room; "#" or a digit means BitChat's own letters, opened as typed. */
export function matches(text: string): Match[] {
  const t = text.trim();
  if (!t) return [];
  if (/^#|\d/.test(t)) {
    const g = readPlace(t.replace(/^#/, "").toLowerCase());
    return g ? [{ where: g, name: `#${g}`, what: "place" }] : [];
  }
  const cities = findCities(t).slice(0, 3).map((c): Match => ({ where: c.place, name: c.name, what: "city" }));
  const room = t.includes(".") || (cities.length === 0 && /^\$?[A-Za-z]{2,6}$/.test(t)) ? roomFor(t) : null;
  return room ? [...cities, { where: room, name: whereName(room), what: "room" }] : cities;
}

export interface ChatRow {
  /** Where it opens: a place or room; with `peer`, the private conversation in it. */
  where: string;
  peer?: string;
  title: string;
  line: string;
  atIso?: string;
  unread?: number;
}

/** Why a message didn't go, by name (design review change 2): this device's internet, or Chat's message servers. */
export function notSentWords(o: { online: boolean; phone: boolean }): string {
  return o.online ? "Not sent: Chat's servers didn't answer. Only you see it." : `Not sent: ${o.phone ? "this iPhone" : "this device"} has no internet. Only you see it.`;
}

/** A place's row line: its last message as the place shows it, never a hidden one or a muted person's, and a name keeps
 *  its " (not checked)" (security review of B27, M1 and M2); only BitChat's four letters after the name go. */
export function placeLine(list: readonly Shown[], hidden: ReadonlySet<string>, muted: ReadonlySet<string>): { line: string; atIso: string } | null {
  const last = visible(list, hidden, muted).at(-1);
  if (!last) return null;
  return { line: `${last.mine ? "You" : last.who.replace(/#[0-9a-f]{4}(?= |$)/, "")}: ${displayText(last)}`, atIso: last.atIso };
}

/** "9:41 PM" today, "Mon" this week, "2 Nov" before. */
export function rowTime(atIso: string, now = new Date()): string {
  const at = new Date(atIso);
  if (Number.isNaN(at.getTime())) return "";
  const days = (now.getTime() - at.getTime()) / 86_400_000;
  if (at.toDateString() === now.toDateString()) return at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (days < 6) return at.toLocaleDateString("en-US", { weekday: "short" });
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Your chats, newest first: private conversations and places by their last line; places with nothing read this visit
 *  keep the order you opened them in, after. */
export function chatRows(rows: readonly ChatRow[]): ChatRow[] {
  const dated = rows.filter((r) => r.atIso).sort((a, b) => (b.atIso! < a.atIso! ? -1 : b.atIso! > a.atIso! ? 1 : 0));
  return [...dated, ...rows.filter((r) => !r.atIso)];
}
