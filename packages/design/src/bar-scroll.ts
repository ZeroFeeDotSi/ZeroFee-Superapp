// The bottom bar reacts to the person (product decision, 4 Nov: "I really like YouTube's bottom bar… a bit more reactive to what
// the user is doing"): it eases out of the way while a page scrolls down and comes back when it scrolls up; the pill
// stretches a little between two tabs. Plain logic here (tested in node); AppBar.tsx and AppHost apply it. (A tab's
// quiet dot is shell-api tasks.ts newsApps.)

/** A page this near its top always shows the bar. */
export const BAR_HIDE_AFTER_PX = 48;
/** A scroll step smaller than this (a jitter, a finger resting) never moves the bar. */
export const BAR_STEP_PX = 6;
/** How much wider the pill is halfway between two tabs. */
export const PILL_STRETCH = 1.02;

/** Whether the bar shows after a scroll to `top` that moved `dy` (down is positive). `still`: Reduce Motion, never hides. */
export function barShown(shown: boolean, top: number, dy: number, o: { still?: boolean } = {}): boolean {
  if (o.still || top < BAR_HIDE_AFTER_PX) return true;
  if (dy > BAR_STEP_PX) return false;
  if (dy < -BAR_STEP_PX) return true;
  return shown;
}

/** The pill's width at `at` (a tab's index, fractional between two): 1 at rest, PILL_STRETCH halfway. */
export const stretchAt = (at: number): number => 1 + (PILL_STRETCH - 1) * Math.sin(Math.PI * (at - Math.floor(at)));

/** Follows every scroll inside `root` (capture: scroll events don't bubble) and hides or shows the bar; a scroll inside
 *  a dialog (a sheet, the tray) is not the page's. Off under Reduce Motion. Returns its own off. */
export function followScroll(root: HTMLElement, bar: () => HTMLElement | null): () => void {
  const last = new WeakMap<EventTarget, number>();
  const still = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const on = (e: Event) => {
    const el = e.target as HTMLElement | null;
    const b = bar();
    // a sheet's or the tray's own scroll (a dialog over the page) never moves the bar under it; nor a list that scrolls by
    // itself to its newest end ([data-bar-stay]: a chat's messages). sd-chat crawl (5 Nov, c): a long message scrolled
    // Chat's list down, the bar hid, and a chat never scrolls up by itself, so it stayed off screen until a reload.
    if (!el || !b || typeof el.scrollTop !== "number" || b.contains(el) || el.closest?.('[role="dialog"], [data-bar-stay]')) return;
    const top = el.scrollTop, dy = top - (last.get(el) ?? top);
    last.set(el, top);
    // the bar never hides (look 4, 5 Nov, QA's crawl row 10: it slid away and could stay off screen): the class toggle is
    // gone, the scroll still clears a stale data-hidden. barShown stays as the pure rule for a later, deliberate return.
    void barShown; void top; void dy; void still;
    if (b.hasAttribute("data-hidden")) b.removeAttribute("data-hidden");
  };
  root.addEventListener("scroll", on, { capture: true, passive: true });
  return () => root.removeEventListener("scroll", on, { capture: true });
}
