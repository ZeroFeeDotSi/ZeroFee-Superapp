// The "it went" line counts its seconds only while the page is in sight (break row, 2 Nov: a NEAR buy that landed while
// the phone was locked said its line to a hidden page, and the line was gone before the person came back).
import { test } from "node:test";
import assert from "node:assert/strict";

/** A page whose visibility the test sets, as the browser does: the property, then the event. */
const page = Object.assign(new EventTarget(), { visibilityState: "visible" as "visible" | "hidden" });
(globalThis as { document?: unknown }).document = page;
const sight = (s: "visible" | "hidden") => { page.visibilityState = s; page.dispatchEvent(new Event("visibilitychange")); };
const { sayWent, onWent, WENT_MS } = await import("./money.ts");
let shown: string | null = null;
onWent((l) => { shown = l?.text ?? null; });

test("in sight: the line stays its few seconds, then goes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sayWent("Bought 0.36 QTC for $25.00");
  t.mock.timers.tick(WENT_MS - 1);
  assert.equal(shown, "Bought 0.36 QTC for $25.00");
  t.mock.timers.tick(1);
  assert.equal(shown, null);
});

test("said while out of sight: it waits, and stays its full seconds once the person is back", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sight("hidden");
  sayWent("Bought 0.36 QTC for $25.00");
  t.mock.timers.tick(60_000);
  assert.equal(shown, "Bought 0.36 QTC for $25.00", "a minute away: still there");
  sight("visible");
  t.mock.timers.tick(WENT_MS - 1);
  assert.equal(shown, "Bought 0.36 QTC for $25.00", "seen for its few seconds after coming back");
  t.mock.timers.tick(1);
  assert.equal(shown, null);
});

test("hidden part-way through: the seconds start again when it is back in sight", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sayWent("Sold QTC for $24.85");
  t.mock.timers.tick(WENT_MS - 100);
  sight("hidden");
  t.mock.timers.tick(10_000);
  assert.equal(shown, "Sold QTC for $24.85");
  sight("visible");
  t.mock.timers.tick(WENT_MS - 1);
  assert.equal(shown, "Sold QTC for $24.85");
  t.mock.timers.tick(1);
  assert.equal(shown, null);
});

test("a busy line stays until the next one, in sight or not; a new line replaces an old one", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sayWent("Getting it ready…", "busy");
  t.mock.timers.tick(60_000);
  sight("hidden"); sight("visible");
  t.mock.timers.tick(60_000);
  assert.equal(shown, "Getting it ready…");
  sayWent("Bought 0.36 QTC for $25.00");
  assert.equal(shown, "Bought 0.36 QTC for $25.00");
  t.mock.timers.tick(WENT_MS);
  assert.equal(shown, null);
});
