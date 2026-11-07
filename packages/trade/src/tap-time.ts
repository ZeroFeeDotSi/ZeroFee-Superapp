// the audit's Trade audit T4 (8 Nov): one trade, two times. Activity said the record's time (service.ts filledInMs, from
// tradeOnce's own start, after the chip's quote), the row and Jobs the press. Now the screen hands its press into the
// trade (svc.trade's `tapAt`), so the record's time is from the press, and the row, Jobs and the receipt read that same
// figure. Pure.

/** A performance.now() moment as the epoch ms the service keeps. */
export const epochOf = (perfAt: number, nowMs: number = Date.now(), perfNow: number = performance.now()): number => Math.round(nowMs - (perfNow - perfAt));
/** The trade's one time: its record's (from the press), else the screen's own count since the press. */
export const tradeMs = (rec: { filledInMs?: number | undefined }, perfAt: number, perfNow: number = performance.now()): number => rec.filledInMs ?? perfNow - perfAt;
/** How far back a press handed in is believed (a stale or future one is the service's own clock instead). */
export const TAP_BACK_MS = 60_000;
/** The press the service starts its clock at: the screen's, when it is a real moment just past; else `now`. */
export const pressAt = (tapAt: number | undefined, now: number): number =>
  tapAt !== undefined && Number.isFinite(tapAt) && tapAt <= now && now - tapAt <= TAP_BACK_MS ? tapAt : now;
