// When Send reads what was put in To (speed, D145): typing waits for a pause, so a half-typed address never flashes
// "can't be read"; a paste or a scan (many letters at once) is read at once, never 300 ms later.

/** The pause after the last key before a typed To is read. */
export const TYPING_PAUSE_MS = 300;
/** This many letters or more arriving in one change is a paste (or a scan, or a link), never typing. */
export const PASTE_LETTERS = 6;

/** How long to wait before reading `after`, the To field just changed from `before`. */
export function lookupDelayMs(before: string, after: string): number {
  return after.trim().length - before.trim().length >= PASTE_LETTERS ? 0 : TYPING_PAUSE_MS;
}
