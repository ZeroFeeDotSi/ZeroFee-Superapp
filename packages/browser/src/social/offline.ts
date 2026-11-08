// Audit 16's S16-4 (SB-4): offline, the Browser (Social trading's hub with its address bar) said nothing while no site
// could open. Its status line says so once, under the address bar, and goes when the phone is back.
import { useEffect, useState } from "react";
import { shortTime } from "@zerofee/core/clock";

export const BROWSER_OFFLINE = "You're offline. Your money is safe. Sites open again when you're back.";
/** Builder 22's item 3: offline, the tiles' dollars are the last read, said once with its time ("As of 7:40 AM", Home's form). */
export const hubAsOf = (at: number): string => `As of ${shortTime(at)}`;

/** The phone's connection, as the browser (or the phone's web view) says it, with its online / offline events. */
export function useOnline(): boolean {
  const [on, setOn] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false);
    addEventListener("online", up); addEventListener("offline", down);
    setOn(typeof navigator === "undefined" || navigator.onLine !== false);
    return () => { removeEventListener("online", up); removeEventListener("offline", down); };
  }, []);
  return on;
}
