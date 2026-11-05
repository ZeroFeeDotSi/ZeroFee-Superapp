// The tray's order and the bottom row (D147, product decision, 3 Nov): every app in one order, kept on this device. In "All
// apps" a person holds any icon and drags it to any place, as on the iPhone's home screen; the FIRST FIVE places are the
// bottom row, in that order (no other rule: the row is a straight view of the first five; product decision, 3 Nov: five, not four).
// Pure, so it is tested in node (app-bar.test.ts, tray-order.test.ts, site-apps.test.ts); AppHost reads and writes it.
//
// - The default order: Home, Trade, Browser, AgentZero, Social trading (the bottom row), then Chat, Earn, Perps, Predict,
//   then any other app this build shows, in the build's order. Social trading is ONE entry for every social trading
//   site (S17, 5 Nov: pump.fun, GMGN, more later), never an app per site.
// - An order kept from before (four in the row then, or pump.fun's and GMGN's own places): Social trading takes the
//   fifth place; the old site places are gone (an id this build doesn't show is never in the order).
// - Earn, Perps and Predict are locked tiles (D141): they move like the rest; a tap on one, in the tray or in the bottom
//   row, opens its "Coming soon" sheet, never an app.
// - An app this build doesn't show is never in the order; one it shows that the saved order lacks joins at the end.

/** How many of the first places are the bottom row. */
export const ROW_SIZE = 5;
export const HOME = "wallet";
/** The locked tiles (D141): in the order like any app, never opened. */
export const LOCKED_IDS: readonly string[] = ["earn", "perps", "predict"];
/** Social trading's page (S17): one entry, its sites listed inside it. A "site:" page, so its tasks are the
 *  Browser's (AppHost taskApp), where the sites' Adds always were. */
export const SOCIAL_TRADING = "site:trading";
/** The fifth place's app for an order kept from before it was there. */
const FIFTH = SOCIAL_TRADING;
export const DEFAULT_ORDER: readonly string[] = [HOME, "trade", "social", "agent", FIFTH, "chat", ...LOCKED_IDS];
const KEY = "zf.tray.order";

/** The order for what this build shows (`available`: its apps' ids and the locked tiles'): the saved order (or the
 *  default) with only what exists, then whatever it lacks, the default's first, then the build's. */
export function orderFor(available: readonly string[], saved?: readonly string[] | null): string[] {
  const has = new Set(available);
  const kept = (saved ?? []).filter((id) => has.has(id));
  // kept from before Social trading was there: it fills the fifth place (the bottom row's); the person's four stay
  if (saved?.length && has.has(FIFTH) && !saved.includes(FIFTH)) kept.splice(Math.min(ROW_SIZE - 1, kept.length), 0, FIFTH);
  const out: string[] = [];
  for (const id of [...kept, ...DEFAULT_ORDER, ...available]) if (has.has(id) && !out.includes(id)) out.push(id);
  return out;
}

/** One drag: the item at `from` lands at `to`; the others close up and make room, as on a home screen. */
export function moveItem<T>(order: readonly T[], from: number, to: number): T[] {
  const next = [...order];
  if (from < 0 || from >= next.length) return next;
  const [it] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, it!);
  return next;
}

/** The bottom row: the first five of the order. */
export const rowOf = (order: readonly string[]): string[] => order.slice(0, ROW_SIZE);

/** The pages in swipe order: the apps (never the locked tiles) in the tray's order, then any the order lacks. */
export function pageOrder<T extends { id: string }>(apps: readonly T[], order: readonly string[]): T[] {
  const inOrder = order.map((id) => apps.find((a) => a.id === id)).filter((a): a is T => Boolean(a));
  return [...inOrder, ...apps.filter((a) => !order.includes(a.id))];
}

/** Where the bar's marker sits for page position `at` (fractional while a page moves): the app's place in the row,
 *  between two places while moving between two apps in it, -1 for an app not in the row. */
export function barSlot(at: number, pages: readonly string[], row: readonly string[]): number {
  const lo = Math.floor(at), hi = Math.ceil(at), f = at - lo;
  const a = row.indexOf(pages[lo] ?? ""), b = row.indexOf(pages[hi] ?? "");
  if (a >= 0 && b >= 0) return a + (b - a) * f;
  if (a >= 0 && f < 0.5) return a;
  if (b >= 0 && f >= 0.5) return b;
  return -1;
}

/** The bar's mark when the app on screen was opened by another app with a back link (Home's NEAR row opens Trade's coin
 *  page): the app it came from stays lit while that screen is up. `lit.on` is the app on screen, `lit.as` the one lit. */
export function markSlot(at: number, pages: readonly string[], row: readonly string[], lit: { on: string; as: string } | null): number {
  if (lit && pages[Math.round(at)] === lit.on) {
    const k = row.indexOf(lit.as);
    if (k >= 0) return k;
  }
  return barSlot(at, pages, row);
}

export function savedOrder(): string[] | null {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "null");
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null;
  } catch {
    return null;
  }
}

export function saveOrder(order: readonly string[]): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(order));
  } catch {
    // storage blocked: the order holds for this visit
  }
}

/** What a drag just did to the bottom row, said in the tray ("" when the row is as it was, in the same apps). */
export function arrangeNote(before: readonly string[], after: readonly string[], id: string, name: (id: string) => string): string {
  if (after.includes(id) && !before.includes(id)) {
    const out = before.find((x) => !after.includes(x));
    return out ? `${name(id)} took ${name(out)}'s place in your bottom row.` : `${name(id)} is in your bottom row.`;
  }
  if (!after.includes(id) && before.includes(id)) {
    const inn = after.find((x) => !before.includes(x));
    return inn ? `${name(id)} left your bottom row. ${name(inn)} is in it now.` : `${name(id)} left your bottom row.`;
  }
  return "";
}

// The All apps button hints (product decision, 5 Nov, was the grab bar glow): it nudges now and then until the tray has been opened once in this session.
// With storage blocked it hints again on the next start (the shell turns it off for the visit).
const SEEN = "zf.tray.seen";
/** Does the All apps button still hint? Yes until the tray has been opened once in this session. */
export function trayBeckons(): boolean {
  try {
    return sessionStorage.getItem(SEEN) !== "1";
  } catch {
    return true;
  }
}
/** The tray opened: the hint stops this session. */
export function markTraySeen(): void {
  try {
    sessionStorage.setItem(SEEN, "1");
  } catch {
    // storage blocked: off for this visit only
  }
}

