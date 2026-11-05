// D146: which app is on screen, as the shell's own sheets need it (the approve sheet sits outside AppHost). AppHost says
// each change; a sheet that belongs to the app the person just left is put away (the approve sheet answers Not now:
// nothing is signed).
import { iosHost } from "../host/ios.ts";

const fns = new Set<(app: string) => void>();
let current = "";

/** AppHost: the app on screen now. Told only on a change. The phone's own sheet hears it too (Host.screenChanged). */
export function screenApp(app: string): void {
  if (app === current) return;
  const was = current;
  current = app;
  void iosHost()?.call("shell.screenApp", { screen: app, money });
  if (was) for (const f of [...fns]) f(app);
}
/** The app on screen now ("" before the first). */
export const screenAppNow = (): string => current;
let money = false;
/** AppHost: is a money sheet up now (review M5: a relay's Face ID sheet shows only while its money step is open). The phone
 *  hears it with the app on screen. */
export function screenMoney(open: boolean): void {
  if (open === money) return;
  money = open;
  void iosHost()?.call("shell.screenApp", { screen: current, money });
}
export const moneyOpenNow = (): boolean => money;
/** Told each time the person moves to another app; returns its own off. */
export function onScreenLeft(fn: (app: string) => void): () => void {
  fns.add(fn);
  return () => { fns.delete(fn); };
}
