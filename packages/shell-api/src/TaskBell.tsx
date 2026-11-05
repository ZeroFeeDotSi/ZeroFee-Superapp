// D144: the Activity centre's way in, top right of every app's header: an icon, and a badge counting what is still going
// (a soft live pulse while anything runs; still under Reduce Motion). A tap opens the centre, the whole screen; its code
// loads on the first tap (TaskCentre.tsx), so no app's first load carries it.
import { useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ShellContext } from "./shell-context.ts";
import { taskStore, type TaskApp } from "./tasks.ts";

type Centre = typeof import("./TaskCentre.tsx").TaskCentre;
/** A pulse line: what is going on (never the menu's lines, top left). */
const Pulse = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h4l2.5-6 5 12 2.5-6h4" /></svg>
);
let loaded: Centre | null = null;

/** The bell for the header and the centre's sheet (drawn by the frame outside its header, so it takes the whole screen). */
export function useTaskCentre(): { bell: ReactNode; sheet: ReactNode } {
  const store = taskStore();
  const n = useSyncExternalStore(store.subscribe, store.pending, store.pending);
  // a job just made (job-start.ts): the icon is drawn again under a new key, so its one short pulse (appframe.css, 450 ms;
  // none under Reduce Motion) plays once per job
  const made = useSyncExternalStore(store.subscribe, store.added, store.added);
  const [open, setOpen] = useState(false);
  const [only, setOnly] = useState<TaskApp | undefined>(undefined);
  // opened from a list one step up (Your account): its ‹ goes back there; the bell's own tap has none
  const [back, setBack] = useState<(() => void) | null>(null);
  const [Centre, setCentre] = useState<Centre | null>(() => loaded);
  const show = (app?: TaskApp, from?: () => void) => {
    setOnly(app);
    setBack(() => from ?? null);
    setOpen(true);
    if (!Centre) void import("./TaskCentre.tsx").then((m) => { loaded = m.TaskCentre; setCentre(() => m.TaskCentre); }, () => setOpen(false));
  };
  const bell = (
    <button type="button" className={`zf-icon-btn af-tasks${made ? " af-tasks--bump" : ""}`} onClick={() => show()} aria-label={n ? `Activity: ${n} going` : "Activity"} data-testid="task-bell">
      <Pulse key={made} />
      {n > 0 && <span className="af-tasks__n" aria-hidden="true">{n > 9 ? "9+" : n}</span>}
    </button>
  );
  // tasks.open(): the frame on screen opens the centre, once per ask (never one asked before it was drawn)
  const { active } = useContext(ShellContext);
  const ask = useSyncExternalStore(store.subscribe, store.openAsk, store.openAsk);
  const seen = useRef(ask.seq);
  useEffect(() => {
    if (ask.seq === seen.current) return;
    seen.current = ask.seq;
    if (active) show(ask.app, ask.back);
  }, [ask.seq]);
  return { bell, sheet: open && Centre ? <Centre onClose={() => setOpen(false)} {...(back ? { onBack: () => { setOpen(false); back(); } } : {})} {...(only ? { only, onAll: () => setOnly(undefined) } : {})} /> : null };
}
