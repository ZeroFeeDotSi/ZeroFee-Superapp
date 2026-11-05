// Which app the shell shows first (D31b). The order of the cards never changes (Security, Wallet, Pay, Trade, ...):
// only the one on screen at the start does. A person who opens the app wants to see their money, so it opens on
// Wallet; an explicit start (a hand-off, a deep link, a child's first journey) still wins.
export const DEFAULT_START_APP = "wallet";

/** The index of the app to show at the start: `start`'s app if this build shows it, else Wallet, else the first. */
export function startAppIndex(apps: ReadonlyArray<{ id: string }>, start?: { id: string }): number {
  const asked = start ? apps.findIndex((a) => a.id === start.id) : -1;
  if (asked >= 0) return asked;
  return Math.max(0, apps.findIndex((a) => a.id === DEFAULT_START_APP));
}
