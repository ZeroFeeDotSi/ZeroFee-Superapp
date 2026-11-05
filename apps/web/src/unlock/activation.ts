// Approve needs a person's own tap (audit K-6, re-audit K2-2). In a browser, a script on the page could otherwise
// answer the approval sheet with a yes through the shell's bridge, click Approve for it (el.click()), or call the
// button's handler itself with a made-up event ({ isTrusted: true }). A yes is taken only when both hold:
//   - the sheet's own DOM handler saw a real click on its Approve button (personTapped: the event is the browser's
//     own, checked with the platform's getters, which refuse any object the browser didn't make; trusted; a click;
//     on that button; just now), and marked this approval (markTap), used once within 2 seconds;
//   - the browser says a person is acting now (navigator.userActivation.isActive).
// Otherwise the approval is answered no, so nothing waits on it, and the caller hears why.
//
// What this does not stop: code on the page that reaches this module itself (markTap) while a person is tapping
// elsewhere. It raises the bar for scripts that only see the page's DOM; the unlock (K-1) is what guards keys at rest.
//
// On the phone the sheet's Approve passes Face ID first (device.confirm), so this wraps only the browser's bridge.
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";

export const NO_TAP: Problem = {
  code: "shell.approval.no-tap",
  whatHappened: "Approve works only when you tap it yourself, so ZeroFee didn't approve this.",
  money: { state: "safe", where: "where it was" },
  next: { kind: "nothing", label: "Go back" },
};

/** The browser's own word on whether a person is acting now. A browser without the API can't say yes. */
export const userIsActing = () => (typeof navigator !== "undefined" && (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive) === true;

/** The platform's own getters: they read the browser's internal record of an event, and throw for anything else. */
const own = (target: object | undefined, name: string): ((this: unknown) => unknown) | null => {
  try {
    return (target && (Object.getOwnPropertyDescriptor(target, name)?.get as (this: unknown) => unknown)) ?? null;
  } catch {
    return null;
  }
};
const probe = typeof Event === "function" ? new Event("probe") : undefined;
const GET = {
  isTrusted: own(probe, "isTrusted"),
  type: own(typeof Event === "function" ? Event.prototype : undefined, "type"),
  target: own(typeof Event === "function" ? Event.prototype : undefined, "target"),
  timeStamp: own(typeof Event === "function" ? Event.prototype : undefined, "timeStamp"),
};
/** How old a click may be when its handler runs. */
const CLICK_MS = 1_000;

/**
 * Was this a person's own click on `button`? `ev` is the DOM's event (React's `e.nativeEvent`), never a flag passed
 * along. A keyboard's Enter or Space on the focused button reaches here as the browser's own click, so it counts too.
 */
export function personTapped(ev: unknown, button: Element | null, now: number = typeof performance === "undefined" ? 0 : performance.now()): boolean {
  if (!button || !GET.isTrusted || !GET.type || !GET.target || !GET.timeStamp) return false;
  if (typeof MouseEvent === "undefined" || !(ev instanceof MouseEvent)) return false;
  try {
    if (GET.isTrusted.call(ev) !== true || GET.type.call(ev) !== "click") return false;
    const target = GET.target.call(ev);
    if (!(target instanceof Node) || !button.contains(target)) return false;
    const at = Number(GET.timeStamp.call(ev));
    return now - at >= 0 && now - at <= CLICK_MS;
  } catch {
    // Not an event the browser made: its getters refuse it.
    return false;
  }
}

/** Answers named here are approvals (the shell's sheet, the laptop's sheet). */
const ANSWERS = new Set(["approval.answer"]);
const TAP_MS = 2_000;
const taps = new Map<string, number>();

/** The sheet's Approve heard a person's own click for approval `id` (only after personTapped said so). */
export function markTap(id: string, now = Date.now()): void {
  taps.set(id, now);
}
/** Was approval `id` tapped by a person just now? Each tap counts once. */
export function takeTap(id: unknown, now = Date.now()): boolean {
  const at = typeof id === "string" ? taps.get(id) : undefined;
  if (typeof id === "string") taps.delete(id);
  return at !== undefined && now - at >= 0 && now - at <= TAP_MS;
}

export function requireActivation(bridge: Bridge, acting: () => boolean = userIsActing, tapped: (id: unknown) => boolean = takeTap): Bridge {
  return {
    async call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
      // Both are asked every time (a tap is used up even when the browser says no one is acting).
      if (ANSWERS.has(method) && params?.approve === true && !(tapped(params.id) && acting())) {
        await bridge.call(method, { ...params, approve: false });
        return { problem: NO_TAP };
      }
      return bridge.call<T>(method, params);
    },
    on: (event, handler) => bridge.on(event, handler),
  };
}
