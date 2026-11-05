// Screens that load later (set-up's, recovery's, the terms': App.tsx), fetched as one set and waited for in place: a view
// that needs them before they land keeps the boot's title up and shows itself the moment they are here. The view itself
// is never changed while it waits, so a screen such as "Was this you?" can't be skipped or closed by its own load.
import { useEffect, useState } from "react";

export function setupGate(load: () => Promise<unknown>) {
  let here = false;
  let asked: Promise<unknown> | null = null;
  /** The set, fetched once (a failed fetch is asked again next time). */
  const fetch = () => (asked ??= load().then(() => { here = true; }, () => { asked = null; }));
  /** True while a view that `needs` the set waits for it (draw the title); false once it is here, or not needed. */
  function useWaiting(needs: boolean): boolean {
    const waiting = needs && !here;
    const [, setLanded] = useState(here);
    useEffect(() => {
      if (waiting) void fetch().then(() => setLanded(here));
    }, [waiting]);
    return waiting;
  }
  return { fetch, here: () => here, useWaiting };
}
