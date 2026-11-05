// The one context the shell hands every app (read it with useShell() from ./AppFrame.tsx).
//
// One per page, kept on globalThis: a second copy of this module (an app's code reached through another checkout's
// node_modules, or a dev server's hot reload re-running it) gets the very same context, never a fresh one whose default
// throws "useShell() is only available inside an app…" for an app the shell IS rendering (?demo, 2 Nov: opening Trade
// mounted its neighbour ZeroFee Chat from such a copy, and every bridge call it made threw).
import { createContext, type Context } from "react";
import type { AppContext } from "./app-module.ts";

const outside = (): never => {
  throw new Error("useShell() is only available inside an app the shell is rendering");
};
const KEY = Symbol.for("zerofee.shell-context");
const g = globalThis as { [KEY]?: Context<AppContext> };

export const ShellContext: Context<AppContext> = (g[KEY] ??= createContext<AppContext>({
  bridge: { call: outside, on: outside },
  openApp: outside,
  showProblem: outside,
  showWaiting: outside,
  openMoney: outside,
  openSwitcher: outside,
  openMenu: outside,
  active: false,
  index: 0,
  count: 1,
}));
