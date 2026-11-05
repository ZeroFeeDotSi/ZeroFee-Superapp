// Hide and mute (D55 slice 2), kept on this device only (device.store: Chat's own storage), never posted or synced.
// Public places are unmoderated: no one can take a message down for everyone, so each person decides what they see.
// - Hide: one message, by its id; it stays hidden in every place.
// - Mute: one person, by their key in that place (BitChat's keys are per place, so that is all one key can name). Their
//   place messages and private messages are dropped before they are shown, and nothing answers them: no delivered ack.
// Each list is bounded, the oldest dropped first; a damaged list reads as empty, never as an error.

export interface Muted {
  pubkey: string;
  /** How they were shown when muted ("anon#1a2b"), so the list can say who. */
  who: string;
}

export const MAX_MUTED = 500;
export const MAX_HIDDEN = 2000;
const HEX64 = /^[0-9a-f]{64}$/;
/** A NEAR account muted in NEAR rooms (J3 part 2): every key it names, "near:<account>" (security review M6). */
const NEAR_MUTE = /^near:[a-z0-9._-]{2,64}$/;

export function readMuted(raw: string | null): Muted[] {
  try {
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((m): m is Muted => !!m && typeof m === "object" && typeof (m as Muted).pubkey === "string" && (HEX64.test((m as Muted).pubkey) || NEAR_MUTE.test((m as Muted).pubkey)) && typeof (m as Muted).who === "string")
      .map((m) => ({ pubkey: m.pubkey, who: m.who.slice(0, 48) }))
      .slice(-MAX_MUTED);
  } catch {
    return [];
  }
}

export function readHidden(raw: string | null): string[] {
  try {
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && HEX64.test(x)).slice(-MAX_HIDDEN) : [];
  } catch {
    return [];
  }
}

export const mute = (list: readonly Muted[], m: Muted): Muted[] => [...list.filter((x) => x.pubkey !== m.pubkey), m].slice(-MAX_MUTED);
export const unmute = (list: readonly Muted[], pubkey: string): Muted[] => list.filter((x) => x.pubkey !== pubkey);
export const hide = (list: readonly string[], id: string): string[] => (list.includes(id) ? [...list] : [...list, id].slice(-MAX_HIDDEN));

/** What a place shows: not hidden, and not from someone muted (one's own messages always show). */
export function visible<T extends { id: string; pubkey: string; mine: boolean }>(messages: readonly T[], hidden: ReadonlySet<string>, muted: ReadonlySet<string>): T[] {
  return messages.filter((m) => m.mine || (!hidden.has(m.id) && !muted.has(m.pubkey)));
}
