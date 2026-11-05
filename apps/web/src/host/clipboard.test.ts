import { test } from "node:test";
import assert from "node:assert/strict";
import type { BridgeResult } from "@zerofee/core/bridge";
import { iosDevice, type IosHost } from "./ios.ts";
import { CLIPBOARD_UNAVAILABLE } from "./clipboard.ts";

const apps = new Set(["pay", "earn"]);

function phone(text: string | null) {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const host: IosHost = {
    async call<T>(method: string, params?: Record<string, unknown>) {
      calls.push({ method, params });
      return { ok: { text } } as BridgeResult<T>;
    },
    on: () => () => {},
  };
  return { host, calls };
}

test("on the phone the clipboard read goes to Swift and its text, or null, comes back as is", async () => {
  for (const text of ["bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", null]) {
    const { host, calls } = phone(text);
    assert.deepEqual(await iosDevice(host, apps).call("device.clipboard.read", { app: "pay" }), { ok: { text } });
    assert.deepEqual(calls, [{ method: "device.clipboard.read", params: { app: "pay" } }]);
  }
});

test("a clipboard read from an unknown app, or with no app, never reaches Swift", async () => {
  const { host, calls } = phone("secret");
  const device = iosDevice(host, apps);
  for (const app of ["evil", ""]) assert.ok("problem" in (await device.call("device.clipboard.read", { app })));
  assert.equal(calls.length, 0);
});

test("in a browser the answer is a plain Problem that says to use Paste, with no money involved", () => {
  assert.equal(CLIPBOARD_UNAVAILABLE.code, "device.clipboard.unavailable");
  assert.equal(CLIPBOARD_UNAVAILABLE.whatHappened, "Use Paste instead.");
  assert.deepEqual(CLIPBOARD_UNAVAILABLE.money, { state: "not-involved" });
});

test("device.haptic: on the phone it goes to Swift as asked; any app, no data back", async () => {
  const { host, calls } = phone(null);
  assert.ok("ok" in (await iosDevice(host, apps).call("device.haptic", { app: "pay", kind: "success" })));
  assert.deepEqual(calls, [{ method: "device.haptic", params: { app: "pay", kind: "success" } }]);
});
