// The app bar (J2, 2 Nov; the tray, Job 1; the capsule, product decision, 4 Nov): ZeroFee's bottom row, a floating capsule above the
// phone's home indicator. An icon per app the person keeps there (five at most; its name is its aria-label and is read by
// screen readers), a 44 pt target each, one tap to switch. A lighter pill sits behind the app on screen and slides to the
// next one, a little wider mid-way: the shell moves it with the page (glideBar), so it follows a swipe under the finger,
// and a tap's flight slides it on its own spring (slide.ts); an app that isn't in the row has no pill. The tab on screen
// shows its filled icon, popping in. It eases out while a page scrolls down and comes back on the way up or on a switch
// (bar-scroll.ts); a tab whose app has work going has a quiet dot. A swipe up on the bar, a tap on its grab bar, or a
// press held on it opens the tray (every app, Tray.tsx).
import { memo, useEffect, useRef, type CSSProperties, type ReactNode, type Ref } from "react";
import { stretchAt } from "./bar-scroll.ts";
import "./appbar.css";

export interface AppBarItem {
  id: string;
  label: string;
  icon: () => ReactNode;
  /** The filled icon, shown on the tab on screen (an app without one keeps its outline there, in ink). */
  iconOn?: () => ReactNode;
}

const HOLD_MS = 450;
/** A drag up of this many points on the bar opens the tray. */
export const SWIPE_UP_PX = 18;

/** Moves the marker to `at` (an item's index; between two while a page is between them) and lights the item under it.
 *  Writes the bar's style directly: no render, so it can run on every frame of a swipe. */
export function glideBar(el: HTMLElement | null, at: number, count?: number): void {
  if (!el) return;
  const v = String(Math.round(at * 1000) / 1000);
  // a page on the move (a swipe, a switch) brings a bar that stepped aside back; a repaint in place never does
  if (v !== el.style.getPropertyValue("--at") && el.hasAttribute("data-hidden")) el.removeAttribute("data-hidden");
  el.style.setProperty("--at", v);
  // the pill stretches a little between two tabs (bar-scroll.ts)
  el.style.setProperty("--stretch", String(Math.round(stretchAt(at) * 1000) / 1000));
  // past the row's last app (an app opened from the tray): no marker
  const off = at < -0.5 || (count !== undefined && at > count - 0.5);
  if (off !== el.hasAttribute("data-off")) el.toggleAttribute("data-off", off);
  const on = off ? -1 : Math.round(at);
  const items = el.querySelectorAll<HTMLElement>(".zf-appbar__item");
  items.forEach((b, i) => {
    if ((i === on) !== b.hasAttribute("data-on")) b.toggleAttribute("data-on", i === on);
  });
}

export const AppBar = memo(function AppBar({ items, current, onPick, onPress, onHold, onOpenTray, hint, news, label = "Your apps", barRef }: {
  items: readonly AppBarItem[];
  /** The item on screen (for the marker's first place and for screen readers); -1: an app not in the row. */
  current: number;
  onPick: (i: number) => void;
  /** A finger (or a pointer) down on a tab: the phone's light tap, as the icon gives. */
  onPress?: (i: number) => void;
  /** Press and hold anywhere on the bar. */
  onHold?: () => void;
  /** A swipe up on the bar, or a tap on its grab bar: the tray. */
  onOpenTray?: () => void;
  /** The All apps button nudges now and then (product decision, 5 Nov), until the tray has been opened once. */
  hint?: boolean;
  /** The apps (ids) with work going (shell-api tasks.ts newsApps): a quiet dot on each one's tab. */
  news?: ReadonlySet<string>;
  label?: string;
  barRef?: Ref<HTMLElement>;
}) {
  const hold = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const clear = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
  };
  // product decision, 5 Nov: the whole tray sometimes opened when an app was tapped. A tap switches the app, the bar can re-render
  // or leave, and its pointerup lands elsewhere, so the hold's timer outlived the tap. A hold now ends on ANY pointerup
  // or cancel (the window's), when the finger leaves the bar, on a plain click, and when the bar goes.
  useEffect(() => clear, []);
  return (
    <nav
      ref={barRef}
      className="zf-appbar"
      aria-label={label}
      style={{ "--n": items.length, "--at": Math.max(0, current) } as CSSProperties}
      data-off={current < 0 ? "" : undefined}
      onPointerDown={onHold ? (e) => {
        clear();
        const h = { x: e.clientX, y: e.clientY, fired: false, timer: 0 };
        h.timer = window.setTimeout(() => {
          h.fired = true;
          onHold();
        }, HOLD_MS);
        hold.current = h;
        window.addEventListener("pointerup", clear, { once: true });
        window.addEventListener("pointercancel", clear, { once: true });
      } : undefined}
      onPointerMove={onHold ? (e) => {
        const h = hold.current;
        if (!h || h.fired) return;
        const dx = e.clientX - h.x, dy = e.clientY - h.y;
        // a swipe up opens the tray (it counts as the hold: the click that ends it is no switch)
        if (onOpenTray && -dy > SWIPE_UP_PX && -dy > Math.abs(dx)) {
          clear();
          h.fired = true;
          return onOpenTray();
        }
        if (Math.hypot(dx, dy) > 10) clear();
      } : undefined}
      onPointerUp={onHold ? clear : undefined}
      onPointerCancel={onHold ? clear : undefined}
      onPointerLeave={onHold ? clear : undefined}
      // the tap that ends a hold is not also a switch
      onClickCapture={(e) => {
        if (hold.current?.fired) {
          e.stopPropagation();
          e.preventDefault();
          hold.current = null;
        } else clear();
      }}
      onContextMenu={onHold ? (e) => e.preventDefault() : undefined}
    >
      {onOpenTray && <button type="button" className={`zf-appbar__grab${hint ? " zf-appbar__all--hint" : ""}`} aria-label="All apps" onClick={onOpenTray}><span /></button>}
      <div className="zf-appbar__in">
        <span className="zf-appbar__marker" aria-hidden="true"><span className="zf-appbar__pill" /></span>
        {items.map(({ id, label: name, icon: Icon, iconOn: IconOn }, i) => (
          <button key={id} type="button" className="zf-appbar__item zf-press" aria-label={name} data-on={i === current ? "" : undefined} aria-current={i === current ? "page" : undefined} onPointerDown={onPress ? () => onPress(i) : undefined} onClick={() => onPick(i)}>
            <span className="zf-appbar__icon" aria-hidden="true">
              <span className="zf-appbar__glyph"><Icon /></span>
              {IconOn && <span className="zf-appbar__glyph zf-appbar__glyph--on"><IconOn /></span>}
              {news?.has(id) && <span className="zf-appbar__news" aria-hidden="true" />}
            </span>
            <span className="zf-appbar__label">{name}</span>
          </button>
        ))}
      </div>
    </nav>
  );
});
