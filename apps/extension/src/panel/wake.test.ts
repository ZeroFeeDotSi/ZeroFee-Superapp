import { test } from "node:test";
import assert from "node:assert/strict";
import { sendWaking, WAKE_WAITS_MS } from "./wake.ts";

const notDelivered = () => new Error("Could not establish connection. Receiving end does not exist.");

test("a message that found no listener while the worker was stopping is sent again, and answered", async () => {
  let calls = 0;
  const waited: number[] = [];
  const r = await sendWaking(async () => { if (++calls < 3) throw notDelivered(); return { ok: "unlocked" }; }, async (ms) => { waited.push(ms); });
  assert.deepEqual(r, { ok: "unlocked" });
  assert.equal(calls, 3);
  assert.deepEqual(waited, WAKE_WAITS_MS.slice(0, 2));
});

test("it gives up after a few quick tries, never in a loop", async () => {
  let calls = 0;
  assert.equal(await sendWaking(async () => { calls++; throw notDelivered(); }, async () => {}), undefined);
  assert.equal(calls, WAKE_WAITS_MS.length + 1);
});

test("a message the worker took and then lost is never sent twice (it could be a signature)", async () => {
  let calls = 0;
  const r = await sendWaking(async () => { calls++; throw new Error("The message port closed before a response was received."); }, async () => {});
  assert.equal(r, undefined);
  assert.equal(calls, 1);
});
