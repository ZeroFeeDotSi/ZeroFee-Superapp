// Where a Problem's `open` step points. Convention (see Problem.next in core/problem.ts): "<app>/<tab>", for example
// "security/activity". Pure, so the routing is unit-tested (screen.test.ts).

/** "security/activity" → { app: "security", tab: "activity" }; "wallet/" → the app alone. A name with no "/" is an app's
 * own screen (e.g. "receive"), not a place the shell can take the person to: null. */
export function parseScreen(screen: string): { app: string; tab?: string } | null {
  const [app, tab, ...rest] = screen.split("/");
  if (tab === undefined || rest.length > 0 || !app) return null;
  return tab ? { app, tab } : { app };
}

/** The app and tab to open for this screen among the apps the shell hosts, or null when it isn't one of them. */
export function routeScreen(screen: string, appIds: readonly string[]): { app: string; tab?: string } | null {
  const to = parseScreen(screen);
  return to && appIds.includes(to.app) ? to : null;
}
