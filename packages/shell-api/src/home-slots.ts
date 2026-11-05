// Home (Job 1, the spine): Wallet with Security inside it. The shell owns the account's places (Protection, Devices,
// Recovery, the account's own history) because they use the shell's full bridge and its handlers; Home (the wallet
// package) owns the screen and where each place sits on it. The shell hands them in through this context, so the wallet
// package never imports the shell. Outside the shell (a test, the screens gallery's lone screens) every slot is empty and
// Home is the money alone.
//
// One per page, kept on globalThis, as ShellContext is (shell-context.ts): a second copy of this module gets the same one.
import { createContext, useContext, type Context, type ReactNode } from "react";

/** The account's places, each its own screen inside Home. */
export type AccountPlace = "protection" | "devices" | "recovery" | "quantum";

export interface HomeSlots {
  /** The one thread (the account's five steps), above Home's money while a step is open; `go` opens a place or Home's
   *  Add money, for the steps that live there. */
  thread?: (go: { place: (place: AccountPlace, step?: string) => void; addMoney: () => void }) => ReactNode;
  /** The account's rows (Protection, Devices, Recovery), behind Home's menu glyph (design review §1.1); `open` shows a
   *  place inside Home. */
  rows?: (open: (place: AccountPlace, step?: string) => void) => ReactNode;
  /** What the account holds for the person (a held payment or change), on Home itself while it is true; else nothing. */
  waiting?: () => ReactNode;
  /** A place's own screen; `step` a step in it ("laptop", "new-words"); `back` returns to Home. */
  place?: (place: AccountPlace, step: string | undefined, back: () => void) => ReactNode;
  /** S-2, the Safe's health check: its lines on the Safe sheet. `go` opens a fix (a place, or Wallet's Details); `close`
   *  shuts the Safe sheet first, for a fix that opens outside Home (the words check, Settings). */
  health?: (go: { place: (place: AccountPlace, step?: string) => void; details: () => void; close: () => void }) => ReactNode;
  /** What the account itself did (who approved what), under Activity's "Account". */
  accountActivity?: () => ReactNode;
  /** The web wallet only (no Safe; bug report, 5 Nov late): the account sheet's first card, the phone's rows in its order,
   *  each saying what this browser has (web-account-words.ts). `rows` draws them; `open` closes the account sheet and
   *  shows `sheet` for that row (a sheet can't open inside another: the one under it is hidden), whose `close` goes back
   *  to the account sheet. Set by the shell only on the web wallet; the phone and the Sim never have it. */
  webRows?: { rows: (open: (place: AccountPlace) => void) => ReactNode; sheet: (place: AccountPlace, close: () => void) => ReactNode };
}

const KEY = Symbol.for("zerofee.home-slots");
const g = globalThis as { [KEY]?: Context<HomeSlots> };
export const HomeSlotsContext: Context<HomeSlots> = (g[KEY] ??= createContext<HomeSlots>({}));
export const useHomeSlots = (): HomeSlots => useContext(HomeSlotsContext);

/** "security/<x>" (a Problem's pill, another app's openApp("security", x)) → the place and step inside Home, or "home"
 *  for Home itself, or "activity" for Activity's Account. Anything else: null (not a Security place). */
export function accountPlaceOf(tab: string | undefined): { place: AccountPlace; step?: string } | "home" | "activity" | null {
  if (!tab || (tab !== "security" && !tab.startsWith("security/"))) return null;
  const x = tab.slice("security/".length);
  switch (x) {
    case "": case "overview": return "home";
    case "activity": return "activity";
    case "protection": return { place: "protection" };
    case "recovery": return { place: "recovery" };
    case "quantum": return { place: "quantum" };
    case "new-words": return { place: "recovery", step: "new-words" };
    case "laptop": case "guardian": case "lost": case "guard": return { place: "devices", step: x };
    default: return { place: "devices" };
  }
}
