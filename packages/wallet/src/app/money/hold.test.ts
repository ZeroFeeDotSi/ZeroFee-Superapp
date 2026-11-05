// Hold to send (the Home plan §1.3): the send starts only after the finger stays down HOLD_MS; any let-go before that sends
// nothing. A buzz on press and on the hold's end through the shell's haptic bridge. The timer is driven by hand here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HOLD_MS, buzz, createHold, type HoldTimers } from "./hold.ts";

const handTimers = () => {
  let q: { fn: () => void; ms: number; id: number }[] = [];
  let n = 0;
  const timers: HoldTimers = { set: (fn, ms) => (q.push({ fn, ms, id: ++n }), n), clear: (h) => void (q = q.filter((x) => x.id !== h)) };
  return { timers, fire: () => { const due = q; q = []; due.forEach((d) => d.fn()); }, queued: () => q.map((x) => x.ms) };
};

test("a hold of about 0.6 s sends once, with a tap buzz on press and a success buzz at the end", () => {
  assert.ok(HOLD_MS >= 500 && HOLD_MS <= 700, "about 0.6 s");
  const t = handTimers();
  const felt: string[] = [];
  let sent = 0;
  const h = createHold({ timers: t.timers, feel: (k) => felt.push(k), done: () => sent++ });
  h.start();
  assert.deepEqual(t.queued(), [HOLD_MS]);
  h.start();
  assert.deepEqual(t.queued(), [HOLD_MS], "a second press while holding starts nothing");
  t.fire();
  assert.equal(sent, 1);
  assert.deepEqual(felt, ["tap", "success"]);
  assert.equal(h.holding(), false);
});

test("control: let go before the ring fills, or press a control that is off, and nothing is sent", () => {
  const t = handTimers();
  let sent = 0;
  const felt: string[] = [];
  const h = createHold({ timers: t.timers, feel: (k) => felt.push(k), done: () => sent++ });
  h.start();
  h.stop();
  t.fire();
  assert.equal(sent, 0, "let go early");
  assert.deepEqual(felt, ["tap"], "no success buzz");
  h.start(true);
  t.fire();
  assert.equal(sent, 0, "off: the press does nothing");
});

test("the buzz goes through the shell's own haptic bridge, and a phone without one is silent; the button never starts a send on a plain tap", async () => {
  const calls: unknown[] = [];
  buzz({ call: async (m: string, p?: unknown) => (calls.push([m, p]), { ok: true }) } as never, "success");
  assert.deepEqual(calls, [["device.haptic", { kind: "success" }]]);
  buzz({ call: async () => { throw new Error("no haptics"); } } as never, "tap"); // no throw, no line
  buzz(undefined, "tap");
  const button = readFileSync(new URL("./HoldButton.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(button, /onClick=/, "a tap alone is never a send: only the hold");
  assert.match(button, /onPointerUp=\{\(\) => h\.stop\(\)\}\n\s+onPointerLeave=\{\(\) => h\.stop\(\)\}\n\s+onPointerCancel=\{\(\) => h\.stop\(\)\}/);
  assert.doesNotMatch(button, /apps\/ios/);
  const css = readFileSync(new URL("./send.css", import.meta.url), "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.wl-sent__fly, \.wl-sent__amt \{ animation: none; \}/, "the success arc snaps under Reduce Motion");
});
