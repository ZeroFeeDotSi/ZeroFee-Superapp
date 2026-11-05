// A D135 sheet's rise (Sheet.tsx), apart from its JSX so it is tested as plain TypeScript.
import { runTween } from "./spring.ts";

/** How far below its place a sheet starts: it fades in while it comes up this far (product decision, 5 Nov). */
export const RISE_PX = 24;
/** The rise's time: --dur-sheet in tokens.css. */
export const RISE_MS = 240;

/**
 * The rise: the body comes up RISE_PX on ease-out while it fades in, and the page behind stays in sight under it until it
 * lands (the backdrop comes in with it). `sheet` is the .zf-sheet: its backdrop, then its body. Under Reduce Motion nothing
 * moves: the sheet is simply there. Returns stop().
 */
export function riseSheet(sheet: HTMLElement | null, still: boolean): () => void {
  const [backdrop, body] = (sheet?.children ?? []) as unknown as HTMLElement[];
  if (!body || still) return () => {};
  const paint = (y: number) => {
    body.style.transform = y > 0.5 ? `translate3d(0,${Math.round(y)}px,0)` : "";
    body.style.opacity = y > 0.5 ? String(Math.round((1 - y / RISE_PX) * 100) / 100) : "";
    if (backdrop) backdrop.style.opacity = y > 0.5 ? String(1 - y / RISE_PX) : "";
  };
  paint(RISE_PX);
  const stop = runTween({ from: RISE_PX, to: 0, ms: RISE_MS, frame: paint });
  // stopped mid-rise (a close): the tween lets go and the sheet is left whole, so the fall takes it from the top
  return () => (stop(), paint(0));
}
