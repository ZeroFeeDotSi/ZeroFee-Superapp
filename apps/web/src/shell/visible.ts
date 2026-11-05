// Whether the page is on screen (grade 01c, P12: about 100 node reads a minute went on with nothing to show them). A
// reader that only serves the screen stops while the page is hidden and reads again the moment it comes back.
import { useEffect, useState } from "react";

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/** True while the page is visible; it changes when the page is hidden or shown. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => !hidden());
  useEffect(() => {
    if (typeof document === "undefined") return;
    const on = () => setVisible(!hidden());
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}
