// A coin page holds the app bar (product decision, 5 Nov: "Buy should hover and stay at the bottom so no matter where you're scrolling
// you can always buy"): the floor sits 4 px above the bar; a scroll down used to ease the bar away (bar-scroll.ts) and leave
// an empty band under Buy. While the page is up its scroll area is [data-bar-stay], which bar-scroll skips, and a bar
// already hidden when the page opens comes back.
import { useEffect, type RefObject } from "react";

export function useBarStay(page: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    // a test's DOM may have no closest() (coin-page-loop.test): nothing to hold there
    const main = typeof page.current?.closest === "function" ? page.current.closest<HTMLElement>(".af-main") : null;
    if (!main || typeof main.setAttribute !== "function") return;
    const had = main.hasAttribute("data-bar-stay");
    main.setAttribute("data-bar-stay", "");
    main.ownerDocument?.querySelector?.(".zf-appbar[data-hidden]")?.removeAttribute("data-hidden");
    return () => { if (!had) main.removeAttribute("data-bar-stay"); };
  }, []);
}
