// The spring a finger's release uses (J2, 2 Nov; toned down 5 Nov: critically damped and quick): it carries the finger's
// speed into the landing and never bounces. Everything else that moves uses runTween below, ease-out, 240 ms at most (BRAND.md, Monument: "springs with weight… nothing bounces"). A small solver, driven by
// requestAnimationFrame, stoppable at any frame so a new touch catches the moving page where it is.
//
// `response` is the time (seconds) the spring takes to swing most of the way (SwiftUI's term); `damping` is the damping
// ratio (1 = no overshoot at rest; 0.94 lets a hard flick land without a visible wobble).

export interface SpringParams {
  response: number;
  damping: number;
}

/** Moving between apps, and anything that moves a whole screen. */
export const SWITCH_SPRING: SpringParams = { response: 0.3, damping: 1 };
/** Small things that follow a choice: a marker, a segmented control's thumb. */
export const MARKER_SPRING: SpringParams = { response: 0.3, damping: 1 };

const SUBSTEP = 1 / 240;

/** One step of the spring toward `target` over `dt` seconds (semi-implicit Euler in fixed substeps: stable at any frame
 *  rate, and a 200 ms frame after a stall is taken in small steps, never one wild jump). Returns [position, velocity]. */
export function springStep(x: number, v: number, target: number, dt: number, p: SpringParams): [number, number] {
  const w = (2 * Math.PI) / p.response;
  const k = w * w;
  const c = 2 * p.damping * w;
  let left = Math.min(dt, 0.25);
  while (left > 1e-9) {
    const h = Math.min(SUBSTEP, left);
    v += (-k * (x - target) - c * v) * h;
    x += v * h;
    left -= h;
  }
  return [x, v];
}

/** Close enough to stop: within `tol` of the target and barely moving. */
export const springAtRest = (x: number, v: number, target: number, tol = 0.0015): boolean => Math.abs(x - target) < tol && Math.abs(v) < tol * 20;

/**
 * Runs the spring from `from` to `to`, starting at `velocity` (units per second), calling `frame` with each position.
 * Returns stop(): the motion halts where it is (the caller reads the last position it was given). `done` runs once, at
 * rest, after a last frame exactly on `to`. `tol` is in the caller's units (default: a page width's 0.15%).
 */
export function runSpring(o: { from: number; to: number; velocity?: number; params?: SpringParams; tol?: number; frame: (x: number) => void; done?: () => void }): () => void {
  const raf = globalThis.requestAnimationFrame?.bind(globalThis);
  const caf = globalThis.cancelAnimationFrame?.bind(globalThis);
  const p = o.params ?? SWITCH_SPRING;
  let x = o.from;
  let v = o.velocity ?? 0;
  let last = -1;
  let id = 0;
  let stopped = false;
  const finish = () => {
    stopped = true;
    o.frame(o.to);
    o.done?.();
  };
  if (!raf) {
    finish();
    return () => {};
  }
  const tick = (now: number) => {
    if (stopped) return;
    const dt = last < 0 ? 1 / 60 : (now - last) / 1000;
    last = now;
    [x, v] = springStep(x, v, o.to, dt, p);
    if (springAtRest(x, v, o.to, o.tol)) return finish();
    o.frame(x);
    id = raf(tick);
  };
  id = raf(tick);
  return () => {
    stopped = true;
    caf?.(id);
  };
}

/**
 * The same spring as a CSS easing (`linear(…)`), for motion CSS runs itself (a marker's or a thumb's transition), and
 * its duration in ms. Sampled from the solver from rest to rest, so CSS and the solver move alike.
 */
export function springEasing(p: SpringParams = MARKER_SPRING, points = 32): { easing: string; ms: number } {
  const xs: number[] = [];
  let x = 0;
  let v = 0;
  const dt = 1 / 120;
  let t = 0;
  while (t < 3) {
    [x, v] = springStep(x, v, 1, dt, p);
    t += dt;
    xs.push(x);
    if (springAtRest(x, v, 1, 0.002)) break;
  }
  const ms = Math.round(t * 1000);
  const out: string[] = ["0"];
  const at = (f: number) => {
    // xs[j] is the position at (j + 1) * dt; interpolate between samples so the points are evenly spaced in time
    const s = f * xs.length - 1;
    if (s <= 0) return xs[0]! * Math.max(0, s + 1);
    const j = Math.min(xs.length - 2, Math.floor(s));
    return xs[j]! + (xs[j + 1]! - xs[j]!) * (s - j);
  };
  for (let i = 1; i < points; i++) out.push(String(Math.round(at(i / points) * 1000) / 1000));
  out.push("1");
  return { easing: `linear(${out.join(", ")})`, ms };
}

/** The person asked their phone for less motion: moves become a short crossfade. */
export function reducedMotion(): boolean {
  try {
    return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
}

/** The one easing, ease-out: tokens.css --ease-out, cubic-bezier(0.2, 0, 0, 1). No control point leaves 0..1, so no overshoot. */
export const EASE_OUT: readonly [number, number, number, number] = [0.2, 0, 0, 1];

/** The cubic-bezier curve's progress (0..1) at time fraction `t`, solved by bisection. */
export function bezierAt(t: number, [x1, y1, x2, y2]: readonly [number, number, number, number] = EASE_OUT): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const at = (a: number, b: number, u: number) => 3 * a * (1 - u) * (1 - u) * u + 3 * b * (1 - u) * u * u + u * u * u;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < t) lo = mid;
    else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
}

/**
 * Moves a value from `from` to `to` in `ms` (240 at most) on ease-out, calling `frame` with each position; the end is
 * exactly `to`, then `done`. Returns stop(): it halts where it is. Without requestAnimationFrame it lands at once.
 */
export function runTween(o: { from: number; to: number; ms?: number; frame: (x: number) => void; done?: () => void }): () => void {
  const raf = globalThis.requestAnimationFrame?.bind(globalThis);
  const caf = globalThis.cancelAnimationFrame?.bind(globalThis);
  const ms = Math.min(o.ms ?? 200, 240);
  let stopped = false;
  let id = 0;
  const finish = () => {
    stopped = true;
    o.frame(o.to);
    o.done?.();
  };
  if (!raf) {
    finish();
    return () => {};
  }
  let last = -1;
  let spent = 0;
  const tick = (now: number) => {
    if (stopped) return;
    spent += last < 0 ? 1000 / 60 : now - last;
    last = now;
    if (spent >= ms) return finish();
    o.frame(o.from + (o.to - o.from) * bezierAt(spent / ms));
    id = raf(tick);
  };
  id = raf(tick);
  return () => {
    stopped = true;
    caf?.(id);
  };
}
