import { test } from "node:test";
import assert from "node:assert/strict";
import type { BridgeResult } from "@zerofee/core/bridge";
import { iosDevice, type IosHost } from "./ios.ts";
import { NOTIFY_UNAVAILABLE } from "./notify.ts";

const apps = new Set(["earn", "pay"]);
const reminder = { app: "earn", id: "wait-ends", title: "Your wait has ended", body: "You can finish the move now.", atIso: "2026-12-01T09:00:00.000Z" };

function phone() {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const host: IosHost = {
    async call<T>(method: string, params?: Record<string, unknown>) {
      calls.push({ method, params });
      return { ok: { ok: true } } as BridgeResult<T>;
    },
    on: () => () => {},
  };
  return { host, calls };
}

test("on the phone both reminder methods go to Swift, unaltered", async () => {
  const { host, calls } = phone();
  const device = iosDevice(host, apps);
  assert.deepEqual(await device.call("device.notify.schedule", reminder), { ok: { ok: true } });
  assert.deepEqual(await device.call("device.notify.cancel", { app: "earn", id: "wait-ends" }), { ok: { ok: true } });
  assert.deepEqual(calls.map((c) => c.method), ["device.notify.schedule", "device.notify.cancel"]);
  assert.deepEqual(calls[0].params, reminder);
});

test("a reminder from an unknown app, or with no app, never reaches Swift", async () => {
  const { host, calls } = phone();
  const device = iosDevice(host, apps);
  for (const app of ["evil", ""]) {
    const r = await device.call("device.notify.schedule", { ...reminder, app });
    assert.ok("problem" in r);
  }
  assert.equal(calls.length, 0);
});

test("in the web demo the answer is a plain Problem, with no money involved", () => {
  assert.equal(NOTIFY_UNAVAILABLE.code, "device.notify.unavailable");
  assert.equal(NOTIFY_UNAVAILABLE.whatHappened, "This browser can't remind you. The phone app can.");
  assert.deepEqual(NOTIFY_UNAVAILABLE.money, { state: "not-involved" });
});
