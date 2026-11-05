// Where "Done" on the shell's Waiting screen goes. A held request is shown on the app that asked for it; when another app
// handed the person over (another app's openApp, e.g. Trade's into Home), Done takes them back to the app they
// started in, on its Activity (the hold is listed there as "On hold · nothing has moved yet"), never leaving them in
// the middle of the other app's set-up (UI's robot pass, F3). Without a hand-off, Done stays where it is.
/** The app Done returns to, or null to stay. `openedBy`: the app that opened `current` with openApp, if any. */
export function returnAfterWaiting(current: string, openedBy: string | undefined): { app: string; tab?: string } | null {
  if (!openedBy || openedBy === current) return null;
  return openedBy === "wallet" ? { app: "wallet", tab: "activity" } : { app: openedBy };
}
