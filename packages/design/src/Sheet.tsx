// The one sheet every app uses (D135, product decision, 3 Nov): the whole screen, Phantom-style, locked at that size; a fixed head
// with the spaced-capital title and Close, then the content, which scrolls inside it. It never grows, shrinks or jumps.
// Close is always in the top corner (the UX walk, 2 Nov: Top up's sheet had no way out but tapping outside); Escape
// and Back close it too. (The approval sheet is separate: it belongs to the security layer.)
//
// One sheet at a time, and it blocks the page (J3 C6, sheet-stack.ts): a sheet opened over another hides it until it
// closes, and while a sheet is up nothing behind it takes a tap, a key or focus.
import { SCRIM_GUARD_MS } from "./sheet-scrim.ts";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useBack } from "./back.ts";
import { Back, Close } from "./icons.tsx";
import { SheetStack, behind, wrapTab } from "./sheet-stack.ts";
import { riseSheet } from "./sheet-rise.ts";
import "./sheet.css";

/** Each screen's open sheets, and what each screen's sheets made inert (only that is ever given back). */
const stacks = new WeakMap<Element, SheetStack<HTMLElement>>();
const madeInert = new WeakMap<Element, Element[]>();

function refresh(screen: Element): void {
  for (const e of madeInert.get(screen) ?? []) e.removeAttribute("inert");
  madeInert.delete(screen);
  const stack = stacks.get(screen);
  const top = stack?.top();
  if (!stack || !top) return;
  for (const s of stack.under()) s.setAttribute("data-under", "");
  top.removeAttribute("data-under");
  const blocked = behind(top as Element, screen).filter((e) => !e.hasAttribute("inert"));
  for (const e of blocked) e.setAttribute("inert", "");
  madeInert.set(screen, blocked);
}

/** While a sheet is up, a click aimed anywhere else on its screen goes nowhere: `inert` stops taps, keys and focus, and
 *  this stops a click a script sends to something behind it too. */
function guard(e: Event): void {
  const screen = e.currentTarget as Element;
  const top = stacks.get(screen)?.top();
  if (top && e.target instanceof Node && !top.contains(e.target)) {
    e.stopPropagation();
    e.preventDefault();
  }
}

/** What Tab can stop on inside a sheet. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** A sheet falls on close (fall, motion.css) in --dur-base; the page behind takes taps from the first frame of it. */
export const FALL_MS = 200;
const stillMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** One line a sheet says first, set by whoever hosts it (the money host, for a sheet the agent app filled in: "AgentZero
 *  filled this in. Check it before you approve."). A sheet opened inside it doesn't say it again. */
export const SheetNote = createContext<string | null>(null);

/** `closable` false: no Close shown (a payment on its way can't be left half-way; Escape and Back do nothing then too). */
/** `onBack`: a page opened from a list inside another sheet (an Activity row's detail in the Activity centre): ‹ goes back
 *  to the list, ✕ closes everything. */
export function Sheet({ title, onClose, onBack, children, closable = true }: { title?: string; onClose: () => void; onBack?: () => void; children: ReactNode; closable?: boolean }) {
  const note = useContext(SheetNote);
  const el = useRef<HTMLDivElement>(null);
  const rising = useRef<(() => void) | null>(null);
  // Close falls (FALL_MS) before the host takes it away. From the first frame of the fall the sheet is off the stack and
  // takes no tap, so the page behind answers the very next one (finding 11: a first tap after a close must never be
  // lost). Under Reduce Motion it goes at once.
  const [closing, setClosing] = useState(false);
  const release = useRef<(() => void) | null>(null);
  const fall = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (fall.current) clearTimeout(fall.current); }, []);
  // Earn crawl (5 Nov): a double tap on a tile opened the sheet and shut it at once, the second tap landing
  // on the scrim. A scrim tap inside SCRIM_GUARD_MS of the open is that double tap, not a wish to close.
  const openedAt = useRef(performance.now());
  const onScrim = () => { if (performance.now() - openedAt.current < SCRIM_GUARD_MS) return; close(); };
  const close = () => {
    if (closing) return;
    if (stillMotion()) return onClose();
    // a close mid-rise: the spring lets go, and the fall takes the sheet from the top
    rising.current?.();
    setClosing(true);
    release.current?.();
    fall.current = setTimeout(() => { fall.current = null; onClose(); }, FALL_MS);
  };
  // Escape and the browser's Back close it (D15, D16), as tapping outside does.
  useBack(close, el);
  // It rises the moment it opens, before the first paint (no frame of it in place first).
  useLayoutEffect(() => {
    rising.current = riseSheet(el.current, stillMotion());
    return () => rising.current?.();
  }, []);
  // Tab stays inside the sheet (shell audit 15c): the page behind is inert only inside its own screen, so Tab from the
  // sheet's last control went on to the app row behind it. At either end it wraps to the sheet's other end.
  useEffect(() => {
    const me = el.current;
    if (!me) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const parts = [...me.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => !x.closest("[inert]") && x.getClientRects().length > 0);
      const to = wrapTab(parts, document.activeElement instanceof HTMLElement && me.contains(document.activeElement) ? document.activeElement : null, e.shiftKey);
      if (to) { e.preventDefault(); to.focus(); }
    };
    me.addEventListener("keydown", onKey);
    return () => me.removeEventListener("keydown", onKey);
  }, []);
  useLayoutEffect(() => {
    const me = el.current;
    if (!me) return;
    const screen = me.closest(".zf-screen") ?? me.parentElement;
    if (!screen) return;
    let stack = stacks.get(screen);
    if (!stack) {
      stack = new SheetStack<HTMLElement>();
      stacks.set(screen, stack);
      screen.addEventListener("click", guard, true);
      screen.addEventListener("submit", guard, true);
    }
    stack.open(me);
    refresh(screen);
    let released = false;
    const off = () => {
      if (released) return;
      released = true;
      stack.close(me);
      if (stack.size === 0) {
        screen.removeEventListener("click", guard, true);
        screen.removeEventListener("submit", guard, true);
        stacks.delete(screen);
      }
      refresh(screen);
    };
    release.current = off;
    return off;
  }, []);
  return (
    <div ref={el} className="zf-sheet" role="dialog" aria-modal="true" aria-label={title} data-closing={closing || undefined}>
      <div className="zf-sheet__scrim" onClick={onScrim} />
      {/* D135: the whole screen, a fixed head (title, Close) and a content area that scrolls; it never changes size */}
      <div className="zf-sheet__body">
        <div className="zf-sheet__head">
          {onBack && <button className="zf-sheet__back" onClick={onBack} aria-label="Back"><Back /></button>}
          {title && <div className="zf-label zf-sheet__title">{title}</div>}
          {closable && <button className="zf-sheet__close" onClick={close} aria-label="Close"><Close /></button>}
        </div>
        <div className="zf-sheet__content">
          {note && <p className="zf-small zf-sheet__note" role="note" data-testid="sheet-note">{note}</p>}
          <SheetNote.Provider value={null}>{children}</SheetNote.Provider>
        </div>
      </div>
    </div>
  );
}
