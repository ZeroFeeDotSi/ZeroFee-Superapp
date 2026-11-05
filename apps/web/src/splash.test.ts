import test from "node:test";
import assert from "node:assert/strict";
import { SPLASH_MAX_MS, splashIsLate, whileTitle } from "./splash.ts";

test("the splash is never up longer than a second", () => {
  assert.ok(SPLASH_MAX_MS <= 1000);
});

test("D134: a core that answers at once ends the title at once: no floor for the drawing (control: a slow one is late)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // no time passes at all: the answer is back without a single timer firing
  assert.equal(await whileTitle(Promise.resolve("ready")), "ready");
  const never = new Promise<string>(() => {});
  const slow = whileTitle(never);
  t.mock.timers.tick(SPLASH_MAX_MS - 1);
  let settled = false;
  void slow.then(() => (settled = true));
  await Promise.resolve();
  assert.equal(settled, false, "still waiting just under the cap");
  t.mock.timers.tick(1);
  assert.equal(await slow, "late");
});

test("a core slower than the cap hands over to the working screen", () => {
  assert.equal(splashIsLate(SPLASH_MAX_MS - 1), false);
  assert.equal(splashIsLate(SPLASH_MAX_MS), true);
});
