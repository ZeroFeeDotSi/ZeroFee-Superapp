// A switch between apps on a tap (decided 5 Nov: subtle, no swoosh): no page sweeps across the
// screen any more. The app you go to fades in, in place, over the one you leave, in --dur-base on ease-out, and the bar's
// pill eases to the tab tapped. Each is animated by the browser itself (Web Animations: opacity, and the pill's transform),
// never a style written per frame from script, so a React render or a read landing mid-fade can't hold a frame. (A finger
// dragging the pages still moves them with the finger: AppHost.) Loaded with the shell after the first paint.
import { glideBar } from "@zerofee/design/AppBar.tsx";

/** A motion token's milliseconds (tokens.css), or `ms` where there is no style to read. */
const num = (css: CSSStyleDeclaration | null, name: string, ms: number): number => parseFloat(css?.getPropertyValue(name) ?? "") || ms;
/** tokens.css --ease-out, for where there is no style to read. */
const EASE_OUT = "cubic-bezier(0.2, 0, 0, 1)";

/** Starts the arriving page's fade and the marker's glide from `from` to `dest` (page units; `map`: a far jump's slots). */
export function slidePages(o: { pages: readonly (HTMLElement | null)[]; map: Map<number, number> | null; from: number; dest: number; W: number; marker?: HTMLElement | null; markFrom: number; markTo: number }): { anims: Animation[]; target: { el: HTMLElement; slot: number } | null } {
  const root = typeof getComputedStyle === "function" && typeof document !== "undefined" ? getComputedStyle(document.documentElement) : null;
  const ms = num(root, "--dur-base", 200);
  const easing = root?.getPropertyValue("--ease-out").trim() || EASE_OUT;
  const anims: Animation[] = [];
  let target: { el: HTMLElement; slot: number } | null = null;
  o.pages.forEach((el, i) => {
    if (!el || typeof el.animate !== "function") return;
    const slot = o.map ? o.map.get(i) : i;
    if (slot === undefined) return;
    // only the page that shows at the end is animated: it comes in over the one that shows now, which stays whole under it
    if (Math.abs(slot - o.dest) >= 0.001) return;
    target = { el, slot };
    el.style.visibility = "";
    const at = `translate3d(${(slot - o.dest) * o.W}px,0,0)`;
    anims.push(el.animate([{ transform: at, opacity: 0, zIndex: 2 }, { transform: at, opacity: 1, zIndex: 2 }], { duration: ms, easing, fill: "forwards" }));
  });
  // the bar's pill (the capsule, product decision, 4 Nov): eases to the tab tapped, in step with the fade
  const m = o.marker;
  if (m && typeof m.animate === "function" && Math.abs(o.markTo - o.markFrom) > 0.001) {
    const css = typeof getComputedStyle === "function" ? getComputedStyle(m) : null;
    anims.push(m.animate([{ transform: `translateX(${o.markFrom * 100}%)` }, { transform: `translateX(${o.markTo * 100}%)` }], { duration: num(css, "--dur-base", 200), easing: css?.getPropertyValue("--ease-out").trim() || EASE_OUT, fill: "forwards" }));
  }
  return { anims, target };
}

/** Where a page stopped mid-flight, in page units: its slot less its offset now. */
export const stoppedAt = (t: { el: HTMLElement; slot: number }, W: number): number => t.slot - new DOMMatrixReadOnly(getComputedStyle(t.el).transform).m41 / W;

/** The whole flight: `start` as it begins, `end` once landed (the final place painted, then the animations go: never a
 *  frame back at the start); the returned stop() halts it, handing `stop` where the arriving page is (null: unknown).
 *  Nothing to animate: `end` at once. */
export function fly(o: { pages: readonly (HTMLElement | null)[]; map: Map<number, number> | null; from: number; dest: number; to: number; W: number; bar: HTMLElement | null; n: number; slotOf: (at: number) => number; start: () => void; end: () => void; stop: (at: number | null) => void }): () => void {
  // the bar's marker from where it shows now to the app it goes to; its item lit at once
  const markFrom = Number(o.bar?.style.getPropertyValue("--at") || o.slotOf(o.from)), markTo = o.slotOf(o.to);
  const { anims, target } = slidePages({ ...o, marker: o.bar?.querySelector<HTMLElement>(".zf-appbar__marker"), markFrom, markTo });
  glideBar(o.bar, markTo, o.n);
  if (!anims.length) {
    o.end();
    return () => {};
  }
  o.start();
  let over = false;
  anims[0]!.onfinish = () => { if (over) return; over = true; o.end(); anims.forEach((x) => x.cancel()); };
  return () => {
    if (over) return;
    over = true;
    o.stop(target ? stoppedAt(target, o.W) : null);
    anims.forEach((x) => x.cancel());
  };
}
