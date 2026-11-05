// The tray (Job 1, the spine, 2 Nov): every app ZeroFee has, one swipe up from the app bar. Tap an app to open it; press
// and hold one to keep it in the bottom row (or take it out); swipe the tray down, tap outside it, or Escape to close.
// It comes up 24 px while it fades in, and goes the same way (ease-out, 240 ms: spring.ts runTween), and follows the finger while it is dragged down; Reduce Motion
// shows and hides it at once. One sheet at a time: it covers the app bar while it is up.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useBack } from "./back.ts";
import { reducedMotion, runTween } from "./spring.ts";
import { RISE_MS, RISE_PX } from "./sheet-rise.ts";
import { Close } from "./icons.tsx";
import "./sheet.css";
import "./tray.css";

export interface TrayApp {
  id: string;
  label: string;
  icon: () => ReactNode;
  /** Not open yet (product decision, 3 Nov: Earn, Perps, Predict): quiet ink, and the shell says what it will do on a tap. */
  locked?: boolean;
}

/** How long a press is held before it pins (the same as the app bar's hold). */
export const PIN_HOLD_MS = 450;
/** A drag down past this share of the tray's height, or a flick, closes it. */
export const CLOSE_SHARE = 0.28;
const FLICK_PX_PER_S = 650;

/** Does a drag down end in a close? `dy` how far down (px), `height` the tray's, `velocity` px/s down at release. */
export function closesOnRelease(dy: number, height: number, velocity: number): boolean {
  if (velocity > FLICK_PX_PER_S) return true;
  if (velocity < -FLICK_PX_PER_S) return false;
  return dy > height * CLOSE_SHARE;
}

/** An icon lifted for a drag (D147): where each place is, which icon sits in each, and where it would land now. */
interface Lift {
  id: number;
  from: number;
  to: number;
  x0: number;
  y0: number;
  rects: DOMRect[];
  els: HTMLElement[];
}

/** The place nearest to (x, y) among `rects` (each place's box when the icon was lifted). Pure (tray-drag.test.ts). */
export function nearestPlace(rects: readonly { left: number; top: number; width: number; height: number }[], x: number, y: number): number {
  let best = 0, d = Infinity;
  rects.forEach((r, i) => {
    const dd = (r.left + r.width / 2 - x) ** 2 + (r.top + r.height / 2 - y) ** 2;
    if (dd < d) (d = dd), (best = i);
  });
  return best;
}

/** Where each icon sits while one is dragged from `from` to `to`: for each icon's place now, its place in the preview. */
export function previewPlaces(count: number, from: number, to: number): number[] {
  const order = [...Array(count).keys()];
  const [it] = order.splice(from, 1);
  order.splice(to, 0, it!);
  const at: number[] = [];
  order.forEach((was, now) => (at[was] = now));
  return at;
}

/** The tray's hint: a finger holds and drags; a mouse just drags (restore crawl, 4 Nov: "Hold and drag" on a mouse page;
 *  the Copywriter's words). Here, not in the shell, so its words load with the tray, never in Home's first load. */
export const TRAY_HINT = { touch: "Hold and drag. The top five are your bottom row.", mouse: "Drag an app. The top five are your bottom row." } as const;
const trayHint = () => (typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches ? TRAY_HINT.mouse : TRAY_HINT.touch);

export function Tray({ apps, pinned, current, note, hint = trayHint(), onPick, onPin, onMove, onLift, onClose }: {
  apps: readonly TrayApp[];
  /** The ids in the bottom row, in order. */
  pinned: readonly string[];
  /** The app on screen. */
  current?: string;
  /** What the last hold did ("Jupiter took GMGN's place in your bottom row."), in place of the hint. */
  note?: string;
  /** The line under the icons when nothing has just changed. */
  hint?: string;
  onPick: (id: string) => void;
  /** Held: keep it in the bottom row, or take it out (the shell decides which, and gives the phone's tap). */
  onPin?: (id: string) => void;
  /** D147: given, a held icon lifts and follows the finger, the others slide to make room, and the drop calls this
   *  with its place before and after (the shell keeps the order and gives the phone's tap). In place of onPin. */
  onMove?: (from: number, to: number) => void;
  /** An icon lifted (the shell gives the phone's tap). */
  onLift?: () => void;
  onClose: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  /** The icon lifted for a drag (onMove), while it is. */
  const lifted = useRef<Lift | null>(null);
  const y = useRef(0);
  /** 0..1: the tray's own fade as it opens and goes (a drag leaves it whole). */
  const fade = useRef(1);
  const stop = useRef<(() => void) | null>(null);
  const closing = useRef(false);
  const height = () => body.current?.offsetHeight || 420;
  const paint = () => {
    const el = body.current;
    if (el) {
      el.style.transform = y.current > 0.5 ? `translate3d(0,${Math.round(y.current)}px,0)` : "";
      el.style.opacity = fade.current < 1 ? String(fade.current) : "";
    }
    const s = scrim.current;
    if (s) s.style.opacity = String(Math.max(0, 1 - y.current / height()) * fade.current);
  };
  /** Eases to y = `to` (the finger let go), the tray whole. `velocity` is the finger's, no longer used: nothing flings. */
  const springTo = (to: number, _velocity = 0, done?: () => void) => {
    stop.current?.();
    if (reducedMotion()) {
      y.current = to;
      fade.current = 1;
      paint();
      return done?.();
    }
    stop.current = runTween({ from: y.current, to, ms: RISE_MS, frame: (x) => { y.current = x; paint(); }, done: () => { stop.current = null; done?.(); } });
  };
  /** Opens (`dir` 1: 24 px low and faded, up to its place) or goes (`dir` -1: down 24 px more while it fades out). */
  const glide = (dir: 1 | -1, done?: () => void) => {
    stop.current?.();
    const y0 = y.current;
    if (reducedMotion()) {
      y.current = dir === 1 ? 0 : y0;
      fade.current = 1;
      paint();
      return done?.();
    }
    stop.current = runTween({ from: 0, to: 1, ms: RISE_MS, frame: (p) => { y.current = dir === 1 ? RISE_PX * (1 - p) : y0 + RISE_PX * p; fade.current = dir === 1 ? p : 1 - p; paint(); }, done: () => { stop.current = null; done?.(); } });
  };
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    glide(-1, onClose);
  };
  useBack(() => close(), body);
  // It rises from below the screen the moment it opens.
  useLayoutEffect(() => {
    y.current = reducedMotion() ? 0 : RISE_PX;
    fade.current = reducedMotion() ? 1 : 0;
    paint();
    glide(1);
    return () => stop.current?.();
  }, []);

  // Swipe down to close: the tray follows the finger; a vertical drag on its grid is the tray's (the grid never scrolls
  // sideways), and a drag up past the top is held back.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    let g: { id: number; y0: number; t: number; last: { t: number; y: number }[] } | null = null;
    const down = (e: PointerEvent) => {
      g = { id: e.pointerId, y0: e.clientY, t: performance.now(), last: [] };
    };
    const move = (e: PointerEvent) => {
      if (!g || g.id !== e.pointerId) return;
      // an icon lifted for a drag: the finger is the icon's now, never the tray's
      if (lifted.current) {
        g = null;
        if (y.current !== 0) springTo(0);
        return;
      }
      const dy = e.clientY - g.y0;
      if (Math.abs(dy) < 6 && y.current === 0) return;
      stop.current?.();
      y.current = dy > 0 ? dy : dy / 6;
      g.last.push({ t: performance.now(), y: dy });
      if (g.last.length > 8) g.last.shift();
      paint();
    };
    const up = (e: PointerEvent) => {
      if (!g || g.id !== e.pointerId) return;
      const pts = g.last;
      g = null;
      if (y.current === 0) return;
      const a = pts[0], b = pts[pts.length - 1];
      const v = a && b && b.t > a.t ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0;
      if (closesOnRelease(y.current, height(), v)) close();
      else springTo(0);
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  // A press held on an icon pins it (or takes it out); the click that ends that hold opens nothing.
  const hold = useRef<{ timer: number; x: number; y: number; fired: boolean; id: string } | null>(null);
  const clear = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
  };

  // D147, the iPhone's home screen: with onMove, a held icon lifts and follows the finger; the others slide on the
  // spring (motion.css's --ease-spring, in tray.css) to make room at the nearest place; the drop settles it there and
  // tells the shell. Nothing re-renders while the finger moves: the icons' style is written directly. Reduce Motion:
  // the others snap, and the drop lands at once.
  const lift = (i: number, pointerId: number, x: number, yy: number) => {
    const g = grid.current;
    if (!g) return;
    const els = [...g.querySelectorAll<HTMLElement>(":scope > .zf-tray__app")];
    if (!els[i]) return;
    lifted.current = { id: pointerId, from: i, to: i, x0: x, y0: yy, rects: els.map((e) => e.getBoundingClientRect()), els };
    g.classList.add("is-arranging");
    els[i].classList.add("is-lifted");
    onLift?.();
  };
  const slide = (L: Lift, to: number) => {
    L.to = to;
    const at = previewPlaces(L.els.length, L.from, to);
    L.els.forEach((el, was) => {
      if (was === L.from) return;
      const a = L.rects[was]!, b = L.rects[at[was]!]!;
      const t = b.left === a.left && b.top === a.top ? "" : `translate3d(${b.left - a.left}px,${b.top - a.top}px,0)`;
      if (el.style.transform !== t) el.style.transform = t;
    });
  };
  const settle = useRef(false);
  useEffect(() => {
    if (!onMove) return;
    const move = (e: PointerEvent) => {
      const L = lifted.current;
      if (!L || L.id !== e.pointerId) return;
      e.preventDefault();
      const dx = e.clientX - L.x0, dy = e.clientY - L.y0;
      L.els[L.from]!.style.transform = `translate3d(${dx}px,${dy}px,0)`;
      const r = L.rects[L.from]!;
      const to = nearestPlace(L.rects, r.left + r.width / 2 + dx, r.top + r.height / 2 + dy);
      if (to !== L.to) slide(L, to);
    };
    const up = (e: PointerEvent) => {
      const L = lifted.current;
      if (!L || L.id !== e.pointerId) return;
      const to = e.type === "pointercancel" ? L.from : L.to;
      if (to !== L.to) slide(L, to);
      const el = L.els[L.from]!;
      const a = L.rects[L.from]!, b = L.rects[to]!;
      el.classList.replace("is-lifted", "is-dropping");
      el.style.transform = b.left === a.left && b.top === a.top ? "" : `translate3d(${b.left - a.left}px,${b.top - a.top}px,0)`;
      const done = () => {
        lifted.current = null;
        if (to === L.from) return unset(L.els);
        // the shell's new order re-renders the icons in their new places; their offsets clear in the same frame
        settle.current = true;
        onMove(L.from, to);
      };
      if (reducedMotion()) done();
      else window.setTimeout(done, 260);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [onMove]);
  const unset = (els: readonly HTMLElement[]) => {
    grid.current?.classList.remove("is-arranging");
    for (const el of els) {
      el.classList.remove("is-lifted", "is-dropping");
      el.style.transform = "";
    }
  };
  useLayoutEffect(() => {
    if (!settle.current) return;
    settle.current = false;
    unset([...(grid.current?.querySelectorAll<HTMLElement>(":scope > .zf-tray__app") ?? [])]);
  }, [apps.map((a) => a.id).join()]);
  return (
    <div className="zf-tray" role="dialog" aria-modal="true" aria-label="All apps">
      <div ref={scrim} className="zf-tray__scrim" onClick={() => close()} />
      <div ref={body} className="zf-tray__body">
        {/* D135 (restore crawl, 4 Nov: half a screen, and its only Close was the grab bar): the whole screen, Close in the corner */}
        <button type="button" className="zf-sheet__close zf-tray__close" aria-label="Close" onClick={() => close()}><Close /></button>
        <div className="zf-label zf-tray__title">All apps</div>
        <div ref={grid} className={`zf-tray__grid${onMove ? " zf-tray__grid--arrange" : ""}`}>
          {apps.map(({ id, label, icon: Icon, locked }, i) => {
            const on = pinned.includes(id);
            return (
              <button
                key={id}
                type="button"
                className={`zf-tray__app zf-press${id === current ? " cur" : ""}${locked ? " zf-tray__app--locked" : ""}`}
                aria-label={locked ? `${label}, coming soon` : on ? `${label}, in your bottom row` : label}
                aria-current={id === current ? "page" : undefined}
                onPointerDown={(e) => {
                  clear();
                  const h = { x: e.clientX, y: e.clientY, fired: false, id, timer: 0 };
                  const pointer = e.pointerId;
                  h.timer = window.setTimeout(() => {
                    h.fired = true;
                    if (onMove) lift(i, pointer, h.x, h.y);
                    else onPin?.(id);
                  }, PIN_HOLD_MS);
                  hold.current = h;
                }}
                onPointerMove={(e) => {
                  const h = hold.current;
                  if (h && !h.fired && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 10) clear();
                }}
                onPointerUp={clear}
                onPointerCancel={clear}
                onContextMenu={(e) => e.preventDefault()}
                onClick={() => {
                  if (hold.current?.fired && hold.current.id === id) {
                    hold.current = null;
                    return;
                  }
                  onPick(id);
                }}
              >
                <span className="zf-tray__icon"><Icon /></span>
                <span className="zf-tray__name">{label}</span>
                <span className={`zf-tray__pin${on ? " on" : ""}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <p className="zf-small zf-tray__hint" role="status">{note || hint}</p>
      </div>
    </div>
  );
}
