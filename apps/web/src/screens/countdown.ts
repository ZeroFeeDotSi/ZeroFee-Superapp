// A ticking "how long is left" (1d 4h, 23h 58m, 4m 05s, 9s), for the Waiting screens and the second device's list.
// Its own module (no screen, no words list), so the second device's site carries only this.
import { useEffect, useState } from "react";

export function useCountdown(untilIso: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, new Date(untilIso).getTime() - now);
  return { left, text: formatLeft(left) };
}

export function formatLeft(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}


/** "7:12 PM", or "Tue 7:12 PM" when it isn't today: when a wait ends (grade 1 Nov, D20). */
export function endsWords(iso: string, now = new Date()): string | null {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return at.toDateString() === now.toDateString() ? time : `${at.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}
