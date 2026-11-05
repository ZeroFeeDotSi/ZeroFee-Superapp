// Time in words, never as a clock (ACTIVITY-MOTION, 4 Nov): "13:35:01" read as 1:35 in the afternoon on a test
// phone, where it meant thirteen hours since the start. Every live row says how long in words.

/** How long something has been going: "now", "12 s", "4 min", "13 h", "1 day", "2 days". */
export function shortElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "1 day" : `${d} days`;
}

/** When something happened, from now: "now", "4 min", "2 h", "Yesterday", then the date ("3 Nov"). */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 2 * 86400) return "Yesterday";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** How often a going row's words change: every second while under a minute, then every 15 s. */
export const tickEvery = (ms: number): number => (ms < 60_000 ? 1000 : 15_000);
