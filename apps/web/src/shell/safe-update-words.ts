// The Safe update's words (the design review's spec, SU1–SU11), every time from the contract's own ready
// time (account.safeUpdate's readyAtIso: waiting_requests, the switch held behind its listing), never a typed number.
// The spec's table runs to hours; the contract's waits run to days (7 phone-only on the 48-hour account, 3 with a
// laptop's yes), so the same table goes on: "about N days".

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const SAFE_UPDATE_WORDS = {
  cardTitle: "Your Safe has an update", // SU1
  update: "Update", // SU3
  faceId: "Update your Safe", // SU4 (the core's sheet title)
  heldTitle: "Updating your Safe", // SU5
  stays: "Your money stays put.",
  doneTitle: "Your Safe is up to date.", // SU9
  done: "Done", // SU10
  finish: "Finish",
  cancel: "Cancel update",
  close: "Close",
  // the audit's words: the backup words drop an update the phone asked alone; one the laptop said yes to stays.
  wordsCancel: "A move to a new phone with your backup words stops it.",
  coSigned: "Your laptop said yes. Backup words can't stop it now.",
  sooner: "Your laptop can say yes to make it faster.",
  unknownTitle: "Unknown code. Say no.",
  unknownLine: "This code is not ZeroFee's. It could change your Safe's rules. Tap Cancel.",
  unknownCancel: "Cancel",
} as const;

/** How long, in the spec's words ("about 2 minutes", "about 7 days"): `ms` from now. */
export function span(ms: number): string {
  if (ms < MIN) return "under a minute";
  if (ms < 2 * MIN) return "about 1 minute";
  if (ms < HOUR) return `about ${Math.ceil(ms / MIN)} minutes`;
  if (ms < 2 * HOUR) return "about 1 hour";
  if (ms < 2 * DAY) return `about ${Math.round(ms / HOUR)} hours`;
  return `about ${Math.round(ms / DAY)} days`;
}

/** SU6: the "when" line. `readyAtMs` null: not known. */
export function whenLine(readyAtMs: number | null, now: number): string {
  if (readyAtMs === null || !Number.isFinite(readyAtMs)) return "Ready soon";
  const left = readyAtMs - now;
  if (left <= 0) return "Almost ready";
  return `Ready in ${span(left)}`;
}

/** SU7: "Ready at 11:42." / "Ready tomorrow at 9:05." / "Ready on Fri at 9:05." / "Ready on Fri 13 Nov at 9:05.", the
 *  phone's own clock and 12/24-hour setting; then "Your money stays put." Unknown: that line alone. */
export function atLine(readyAtMs: number | null, now: number, locale?: string): string {
  if (readyAtMs === null || !Number.isFinite(readyAtMs)) return SAFE_UPDATE_WORDS.stays;
  const at = new Date(readyAtMs);
  const time = at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(at) - day(new Date(now))) / DAY);
  const when = days <= 0 ? `at ${time}` : days === 1 ? `tomorrow at ${time}` : days < 7 ? `on ${at.toLocaleDateString(locale, { weekday: "short" })} at ${time}` : `on ${at.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" })} at ${time}`;
  return `Ready ${when}. ${SAFE_UPDATE_WORDS.stays}`;
}

/** SU2, from the contract's waits (the spec's "Unsure": a long wait says how long): "Takes about 7 days. Your money
 *  stays put." `withLaptopSeconds`: sooner with a second device's yes, said only when the account has one. */
export function cardLine(phoneOnlySeconds: number, withLaptopSeconds: number | null, hasSecondDevice: boolean): string {
  const takes = `Takes ${span(phoneOnlySeconds * 1000)}.`;
  const sooner = hasSecondDevice && withLaptopSeconds !== null ? ` With your laptop's yes, ${span(withLaptopSeconds * 1000)}.` : "";
  return `${takes}${sooner} ${SAFE_UPDATE_WORDS.stays}`;
}

/** SU8: Home's quiet line while it waits. */
export const homeLine = (readyAtMs: number | null, now: number): string => (readyAtMs !== null && readyAtMs <= now ? "Your Safe's update is ready. Tap Finish." : `${SAFE_UPDATE_WORDS.heldTitle}. ${whenLine(readyAtMs, now)}.`);

/** The held screen's lines under the time: who can still stop it, in the audit's words. */
export function stopLines(coSigned: boolean, hasSecondDevice: boolean): string[] {
  if (coSigned) return [SAFE_UPDATE_WORDS.coSigned];
  return [SAFE_UPDATE_WORDS.wordsCancel, ...(hasSecondDevice ? [SAFE_UPDATE_WORDS.sooner] : [])];
}
