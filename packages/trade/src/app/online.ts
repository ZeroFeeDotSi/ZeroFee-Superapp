// Offline (TRADE-JOURNEYS A10 / 23.9): Trade says it plainly, once, instead of "busy". The browser's (and the phone's web
// view's) own online state, and its online / offline events. While offline nothing can be signed or sent, so the sheet's
// pill rests; what's on screen stays, and nothing has moved.
import { useEffect, useState } from "react";

/** True mid-trade too (break row, 2 Nov): a trade already handed over finishes (or comes back) without the phone, so the
 *  line never says "nothing moves" beside its "Bought". */
export const OFFLINE_WORDS = "You're offline. Your money is safe: a trade already sent still finishes, and nothing new moves until you're back.";
/** What a failed read says while offline, in place of "busy". */
export const OFFLINE_SHORT = "You're offline.";

export const isOnline = (): boolean => typeof navigator === "undefined" || navigator.onLine !== false;

export function useOnline(): boolean {
  const [on, setOn] = useState(isOnline);
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false);
    addEventListener("online", up); addEventListener("offline", down);
    setOn(isOnline());
    return () => { removeEventListener("online", up); removeEventListener("offline", down); };
  }, []);
  return on;
}
