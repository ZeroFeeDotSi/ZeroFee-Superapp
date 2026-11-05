// Browser Back and Escape inside the app (grade 1 Nov, D15, D16): Back from a sub-screen left the app (about:blank,
// then a passcode to get back in), and Escape didn't close a sheet. Whatever is on top (a sheet, a pushed screen, the
// switcher) registers its own way back with useBack; Back and Escape run the newest one. The app keeps one history
// entry of its own, put back after every Back, so Back never leaves ZeroFee; with nothing open, it does nothing.
import { useEffect, useRef, type RefObject } from "react";

/** `live`: whether this way back is on screen now (an app beside the one showing is inert, and so is everything under a
 *  Problem screen): only the newest live one runs. */
const stack: { run: () => void; live: () => boolean }[] = [];
const top = () => stack.findLast((s) => s.live());
let installed = false;

/** Once per page: the history entry Back lands on, and the listeners. Safe to call again. */
export function installBack(): void {
  if (installed || typeof window === "undefined" || typeof history === "undefined") return;
  installed = true;
  const guard = () => {
    try {
      history.pushState({ zf: "in-app" }, "");
    } catch {
      // a sandboxed page without history: Escape still works
    }
  };
  guard();
  window.addEventListener("popstate", () => {
    guard();
    top()?.run();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const now = top();
    if (!now) return;
    e.preventDefault();
    now.run();
  });
}

/** While mounted, Back and Escape run `onBack` (the newest one mounted and on screen wins). None: nothing registered.
 *  `el`: the element it belongs to; inside an inert part of the page (an app not showing) it is skipped. */
export function useBack(onBack: (() => void) | undefined, el?: RefObject<HTMLElement | null>): void {
  const ref = useRef(onBack);
  ref.current = onBack;
  const on = onBack !== undefined;
  useEffect(() => {
    if (!on) return;
    installBack();
    const entry = { run: () => ref.current?.(), live: () => !el?.current || (el.current.isConnected && !el.current.closest("[inert]")) };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [on]);
}

/** How many ways back are open (tests). */
export const backDepth = () => stack.length;
/** Run the way back that Back would (tests). */
export const runBack = () => top()?.run();
