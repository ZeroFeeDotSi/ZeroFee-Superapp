// Nearby never waits for ever (B22): the phone asks its host, a browser asks the browser, and either way an answer is
// in by the time limit, even when the ask never comes back (the iPhone web view's own geolocation did exactly that).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { locateOnce } from "./location.ts";

const bridgeAnswering = (answer: unknown, asked: string[] = []): Bridge => ({
  call: async (method: string) => (asked.push(method), answer as never),
  on: () => () => {},
});
const never = (): Bridge => ({ call: () => new Promise(() => {}), on: () => () => {} });

test("on the phone: the host's one coarse fix becomes a place; its refusal is 'refused'", async () => {
  const asked: string[] = [];
  assert.deepEqual(await locateOnce(bridgeAnswering({ ok: { lat: 47.37, lon: 8.54 } }, asked), { phone: true }), { lat: 47.37, lon: 8.54 });
  assert.deepEqual(asked, ["device.location.once"]);
  assert.deepEqual(await locateOnce(bridgeAnswering({ problem: { code: "device.location.refused" } }), { phone: true }), { refused: true });
  assert.deepEqual(await locateOnce(bridgeAnswering({ ok: { lat: "x" } }), { phone: true }), { refused: true }, "an answer that isn't a place");
});

test("an ask that never answers ends at the time limit (the iPhone web view's own geolocation, and a host that hangs)", async () => {
  const t0 = Date.now();
  assert.deepEqual(await locateOnce(never(), { phone: true, waitMs: 60 }), { refused: true });
  const silent = { getCurrentPosition: () => {} } as unknown as Geolocation;
  assert.deepEqual(await locateOnce(never(), { phone: false, geo: silent, waitMs: 60 }), { refused: true });
  assert.ok(Date.now() - t0 < 1000);
});

test("in a browser: the browser's ask; none at all is 'refused' at once", async () => {
  const geo = { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 1.29, longitude: 103.85 } } as GeolocationPosition) } as unknown as Geolocation;
  assert.deepEqual(await locateOnce(never(), { phone: false, geo }), { lat: 1.29, lon: 103.85 });
  assert.deepEqual(await locateOnce(never(), { phone: false, geo: undefined, waitMs: 5000 }), { refused: true });
});
