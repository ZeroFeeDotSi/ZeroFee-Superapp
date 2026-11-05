// How long the title screen stays up (D134, an instant Home): only while real work needs it. It leaves the moment the
// core has answered (never on balances, which load behind the next screen), with no floor for the drawing; a screen
// the device can paint from what it kept shows at once, with no title at all. If the core is slower than a second, the
// title gives way to a plain "working" screen rather than holding the mark up.
export const SPLASH_MAX_MS = 1000;

/** The splash has been up for `elapsedMs` and the core has not answered: time to show the working screen instead. */
export const splashIsLate = (elapsedMs: number): boolean => elapsedMs >= SPLASH_MAX_MS;

/** The core's answer the moment it comes, or "late" once the title has been up `SPLASH_MAX_MS` without one. */
export function whileTitle<T>(asking: Promise<T>, maxMs = SPLASH_MAX_MS): Promise<T | "late"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), maxMs)));
  return Promise.race([asking, late]).finally(() => clearTimeout(timer));
}
