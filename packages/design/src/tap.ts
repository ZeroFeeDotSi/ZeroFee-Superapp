// The tap (UI concept v3.1, product decision, 5 Nov): the one lit button answers the finger itself, with nothing fetched. It gives
// (.zf-btn:active, 80 ms), a mint ring leaves its edge (.zf-tapring, 550 ms) and the hand feels a light tap. The app
// passes its own haptic (the bridge's device.haptic); this file never reaches the bridge.
export const TAP_RING_MS = 550;

/** A crawl's clock (QA, 5 Nov): every step of the tap leaves a performance.mark and a line in window.__zfTap,
 *  so a late screenshot can still grade the 1-frame steps. Names: tap, ring-on, ring-off, approved (the Safe's yes), away, checking, landed, refused. */
export type TapMark = "tap" | "ring-on" | "ring-off" | "approved" | "away" | "checking" | "landed" | "refused";
export function mark(name: TapMark): void {
  const g = globalThis as { performance?: Performance; __zfTap?: { mark: TapMark; t: number }[] };
  const t = g.performance?.now?.() ?? 0;
  try { g.performance?.mark?.(name); } catch { /* a page without the mark API */ }
  (g.__zfTap ??= []).push({ mark: name, t });
}

/** Draw the ring from `el` (a .zf-btn or any positioned box). Returns the ring's node, removed by itself. */
export function tapBurst(el: HTMLElement, haptic?: (kind: "tap") => void): HTMLElement {
  mark("tap");
  const doc = el.ownerDocument;
  const ring = doc.createElement("span");
  ring.className = "zf-tapring";
  ring.setAttribute("aria-hidden", "true");
  // the ring outlives the button: the sheet becomes the receipt 80 ms later and the button goes with it (the 5 Nov walk:
  // no ring in the 150 ms frame), so it sits on the page, fixed at the button's centre. A box with no geometry (a test's
  // fake) gets it as a child.
  const r = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : undefined;
  const host = r && doc.body ? doc.body : el;
  if (host !== el && r) { ring.style.position = "fixed"; ring.style.left = `${r.left + r.width / 2}px`; ring.style.top = `${r.top + r.height / 2}px`; ring.style.zIndex = "1000"; }
  host.appendChild(ring);
  mark("ring-on");
  haptic?.("tap");
  setTimeout(() => { ring.remove(); mark("ring-off"); }, TAP_RING_MS + 50);
  return ring;
}
