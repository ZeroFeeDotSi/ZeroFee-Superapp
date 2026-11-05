// The one Activity (D144, the design review §4.7; the review's go, 4 Nov): the Activity centre shows what is going on
// (Now, by app) and, below it, the money history Home keeps. Home puts its history here: a render function that carries
// its own context (the wallet's runtime and shell), drawn by the centre. With none (Home not loaded yet), the centre
// shows the tasks alone, as before. One slot per page, on globalThis like the task store, so every copy of this module
// shares it.
import { useSyncExternalStore, type ReactNode } from "react";

/** `overlay`: where the history's own pages draw (a row's detail, the statement), over the centre; null clears it.
 *  `close`: the centre closes (a row that opens a screen elsewhere). */
export type HistoryRender = (overlay: (node: ReactNode) => void, close: () => void) => ReactNode;

type Slot = { render: HistoryRender | null; seq: number; fns: Set<() => void>; apps?: Map<string, HistoryRender> };
const g = globalThis as { __zfHistorySlot?: Slot };
const slot = (): Slot => (g.__zfHistorySlot ??= { render: null, seq: 0, fns: new Set() });

/** Home sets (or, unmounting, clears) its history; each call also tells the centre to draw again (fresh figures). */
export function setHistory(render: HistoryRender | null): void {
  const s = slot();
  s.render = render;
  s.seq += 1;
  for (const f of [...s.fns]) f();
}

/** The centre's read: the history to draw, or null. */
export function useHistory(): HistoryRender | null {
  const s = slot();
  useSyncExternalStore((fn) => { s.fns.add(fn); return () => { s.fns.delete(fn); }; }, () => s.seq, () => s.seq);
  return s.render;
}

/** Another app's own history (Trade's trades, 4 Nov: its Activity tab went with D144), drawn under Home's in the centre
 *  with the app's name over it, and alone when the centre is opened on that app. Set it while the app is up; null clears. */
export function setAppHistory(app: "trade" | "perps" | "browser" | "agentzero" | "chat", render: HistoryRender | null): void {
  const s = slot();
  const apps = (s.apps ??= new Map());
  if (render) apps.set(app, render);
  else apps.delete(app);
  s.seq += 1;
  for (const f of [...s.fns]) f();
}

/** The centre's read of the other apps' histories, by app. */
export function useAppHistories(): ReadonlyMap<string, HistoryRender> {
  const s = slot();
  useSyncExternalStore((fn) => { s.fns.add(fn); return () => { s.fns.delete(fn); }; }, () => s.seq, () => s.seq);
  return s.apps ?? EMPTY;
}
const EMPTY: ReadonlyMap<string, HistoryRender> = new Map();
