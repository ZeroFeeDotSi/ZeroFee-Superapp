// The frame every app lives in: whole-app settings top-left, the app's name, the app's own sections as a segmented
// control under it (J2: Wallet's Balance · Activity, Trade's Home · Trade · Activity), and its content. The shell's app
// bar sits under every app; apps never draw navigation between apps, and no app adds a second bar at the bottom.
import { useContext, useRef, type ReactNode } from "react";
import { Back, Menu } from "@zerofee/design/icons.tsx";
import { useBack } from "@zerofee/design/back.ts";
import { Segmented } from "@zerofee/design/Segmented.tsx";
import { ShellContext } from "./shell-context.ts";
import { useTaskCentre } from "./TaskBell.tsx";
import "./appframe.css";

export { ShellContext };

/** Everything the shell gives the app it is rendering: its own bridge, openApp, and its place among the apps. */
export const useShell = () => useContext(ShellContext);

/** One of the app's own sections. `icon` is kept for the apps that still pass one; the segmented control shows names. */
export interface TrayItem<T extends string = string> {
  id: T;
  label: string;
  icon?: () => ReactNode;
}

/** `top`: what stands at the top in place of the app's name (Home: the ZeroFee mark, B18). `menu`: what the glyph
 *  top-left opens instead of Settings (Home: the account's rows, design review §1.1). `pinned`: a row that stays put
 *  over the scrolling content (Browser's address bar; bug report, 4 Nov: the frame is firm, only the content scrolls). */
export function AppFrame<T extends string>({ name, tray, tab, onTab, top, menu, pinned, children }: { name: string; tray: TrayItem<T>[]; tab: T; onTab: (t: T) => void; top?: ReactNode; menu?: { label: string; open: () => void }; pinned?: ReactNode; children: ReactNode }) {
  const shell = useShell();
  // D144: the Activity centre, top right of every app's header; its sheet takes the whole screen
  const centre = useTaskCentre();
  return (
    <div className="zf-screen af-frame">
      <header className="af-top">
        <button className="zf-icon-btn af-menu" onClick={menu?.open ?? (() => shell.openMenu())} aria-label={menu?.label ?? "Settings"}><Menu /></button>
        {top ?? <span className="zf-label" style={{ color: "var(--ink)" }}>{name}</span>}
        {centre.bell}
      </header>
      {/* One section only (or none): nothing to choose, no control. `af-tray` stays its name for the walk tools. */}
      {tray.length > 1 && <div className="af-seg"><Segmented className="af-tray" label={name} items={tray} value={tab} onChange={onTab} /></div>}
      {pinned && <div className="af-pinned">{pinned}</div>}
      <main className="af-main">{children}</main>
      {centre.sheet}
    </div>
  );
}

/** A screen pushed on top of a tab, for one decision (confirm, paid, a partner hand-off): Back top-left, the app's
 * name, and no sections. The shell's app bar stays below; an app keeps this screen as it was while another app is
 * open, so leaving never loses a payment half-way. `mark`: a small sign after the name (Chat: a dot, green when
 * connected, design review 2 Nov §9). */
export function PushedFrame({ name, mark, onBack, children }: { name: string; mark?: ReactNode; onBack: () => void; children: ReactNode }) {
  // The browser's Back (and Escape) is this Back, never a way out of the app (D15).
  const el = useRef<HTMLDivElement>(null);
  useBack(onBack, el);
  // the design review §2.1 B6: a pushed page carries the back arrow only, never the Activity icon (an app's root header
  // has it); its centre still opens here when an app asks (tasks.open), so nothing is lost
  const centre = useTaskCentre();
  return (
    <div className="zf-screen af-frame" ref={el}>
      <header className="af-top">
        <button className="zf-icon-btn af-menu" onClick={onBack} aria-label="Back"><Back /></button>
        <span className="zf-label" style={{ color: "var(--ink)" }}>{name}{mark ? <> {mark}</> : null}</span>
      </header>
      <main className="af-main af-main--pushed">{children}</main>
      {centre.sheet}
    </div>
  );
}
