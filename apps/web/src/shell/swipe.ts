// The shell's swipe between apps (J2, 2 Nov), as plain decisions, apart from the DOM so they can be tested:
// - which way a drag goes (a vertical scroll is never taken: the first 10 px decide, and a near-diagonal stays vertical);
// - where a release lands (a quarter of the width, or a quick flick, moves one app; a reversed drag comes back);
// - where a swipe may start: only from the screen's left or right edge (bug report, 4 Nov; a drag
//   across the page's own content never moves the app's frame);
// - that the pages stop at the first and the last app (firm, no rubber band).
// Positions are in pages (2.3 = a third of the way from the third app to the fourth); speeds in pages per second.

/** How far (px) a finger moves before the drag's direction is decided. */
export const SLOP_PX = 10;
/** A drag is horizontal only when it is clearly more across than down (|dx| > |dy| × this). */
export const AXIS_BIAS = 1.2;
/** Past this share of the width, a slow release moves to the next app. */
export const SWITCH_AT = 0.25;
/** A release at least this fast (pages per second, about 350 px/s on a phone) moves to the next app in its direction. */
export const FLICK = 0.9;

/** Which way the finger is going: null while it hasn't moved SLOP_PX yet. */
export function lockAxis(dx: number, dy: number, slop = SLOP_PX): "x" | "y" | null {
  if (Math.hypot(dx, dy) < slop) return null;
  return Math.abs(dx) > Math.abs(dy) * AXIS_BIAS ? "x" : "y";
}

/**
 * Where a release lands. `start`: the app the drag began on; `pos`: where the pages are now; `velocity`: pages per
 * second, positive toward the next app. Always `start`, or one app either side of it, within 0…count−1.
 * - a flick picks the app on the side it flicks to, of the two the pages are between (so a drag reversed with a flick
 *   comes back, never past where it started);
 * - otherwise a quarter of the width decides.
 */
export function releaseTarget({ start, pos, velocity, count }: { start: number; pos: number; velocity: number; count: number }): number {
  const progress = pos - start;
  let to: number;
  if (Math.abs(velocity) >= FLICK && Math.abs(progress) > 0.01) to = velocity > 0 ? Math.ceil(pos - 1e-6) : Math.floor(pos + 1e-6);
  else if (progress >= SWITCH_AT) to = start + 1;
  else if (progress <= -SWITCH_AT) to = start - 1;
  else to = start;
  to = Math.max(start - 1, Math.min(start + 1, to));
  return Math.max(0, Math.min(count - 1, to));
}

/** How close to the screen's left or right edge (px) a finger must land for its drag to move between apps. */
export const EDGE_PX = 24;

/** May a drag that lands at `x` (px from the app's left) on an app `width` wide move between apps? Only from an edge. */
export function fromEdge(x: number, width: number, edge = EDGE_PX): boolean {
  return x <= edge || x >= width - edge;
}

/** The pages never go past the first or the last app: a drag there holds still (firm, bug report, 4 Nov). */
export function clampPos(pos: number, count: number): number {
  return Math.max(0, Math.min(count - 1, pos));
}

/** The finger's speed at release (px per ms), from its last moves: those in the last 100 ms before its last move (or,
 *  when moves come sparsely, the one move before it, up to 150 ms back). A finger that stopped before letting go (no
 *  move in the last 80 ms) has no speed. */
export function fingerVelocity(samples: readonly { t: number; x: number }[], now: number): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1]!;
  if (now - last.t > 80) return 0;
  let first = samples.findIndex((s) => last.t - s.t <= 100);
  if (first === samples.length - 1 && last.t - samples[first - 1]!.t <= 150) first -= 1;
  const a = samples[first]!;
  const dt = last.t - a.t;
  return dt > 0 ? (last.x - a.x) / dt : 0;
}
