// The shared spring (J2): lands on its target, carries a release's speed, doesn't bounce, is the same at any frame rate,
// and its CSS form (tokens.css --ease-spring) is the solver's own curve.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MARKER_SPRING, SWITCH_SPRING, springAtRest, springEasing, springStep } from "./spring.ts";

const run = (v0: number, dt: number, p = SWITCH_SPRING) => {
  let x = 0;
  let v = v0;
  let t = 0;
  let peak = 0;
  while (t < 3 && !springAtRest(x, v, 1)) {
    [x, v] = springStep(x, v, 1, dt, p);
    t += dt;
    peak = Math.max(peak, x);
  }
  return { x, t, peak };
};

test("the switch spring lands in about half a second and never visibly overshoots", () => {
  const r = run(0, 1 / 60);
  assert.ok(Math.abs(r.x - 1) < 0.002, `${r.x}`);
  assert.ok(r.t > 0.3 && r.t < 0.8, `${r.t} s`);
  assert.ok(r.peak < 1.003, `peak ${r.peak}`);
});

test("a release's speed is carried: a flick lands sooner than a still release, and a hard flick barely overshoots", () => {
  const still = run(0, 1 / 60);
  const flick = run(4, 1 / 60);
  assert.ok(flick.t <= still.t, `${flick.t} <= ${still.t}`);
  assert.ok(run(12, 1 / 60).peak < 1.06, "nothing bounces (BRAND.md)");
  // control: an underdamped spring does bounce, so the peak check can fail
  assert.ok(run(0, 1 / 60, { response: 0.44, damping: 0.4 }).peak > 1.1);
});

test("the same at 30, 60 and 120 frames a second, and a 200 ms stall is no jump", () => {
  const at = (dt: number) => {
    let x = 0;
    let v = 0;
    for (let t = 0; t < 0.2 - 1e-9; t += dt) [x, v] = springStep(x, v, 1, dt, SWITCH_SPRING);
    return x;
  };
  assert.ok(Math.abs(at(1 / 30) - at(1 / 120)) < 0.01);
  const [x] = springStep(0, 0, 1, 0.2, SWITCH_SPRING);
  assert.ok(Math.abs(x - at(1 / 120)) < 0.01, `${x}`);
});

test("the springs are critically damped (5 Nov: nothing bounces), and springEasing never leaves 0..1", () => {
  assert.equal(SWITCH_SPRING.damping, 1);
  assert.equal(MARKER_SPRING.damping, 1);
  const { easing } = springEasing(MARKER_SPRING, 24);
  const pts = easing.replace(/^linear\(|\)$/g, "").split(",").map(Number);
  assert.ok(pts.every((x) => x >= 0 && x <= 1), "no sample passes its target");
  const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /--ease-spring|--spring-ms/, "the spring tokens are retired: --ease-out is the one easing");
});
