// Trade's own settings: on by default, kept on the device, a damaged record reads as the defaults.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { DEFAULT_PREFS, loadPrefs, savePrefs } from "./prefs.ts";

const store = () => {
  const m = new Map<string, string>();
  const bridge = { call: async (method: string, p: Record<string, string>) => method === "device.store.get" ? { ok: { value: m.get(p.key) ?? null } } : (m.set(p.key, p.value), { ok: {} }), on: () => () => {} } as unknown as Bridge;
  return { m, bridge };
};

test("sounds are on by default; a change is kept; a damaged record reads as the defaults", async () => {
  const { m, bridge } = store();
  assert.deepEqual(await loadPrefs(bridge), DEFAULT_PREFS);
  await savePrefs(bridge, { v: 1, sounds: false });
  assert.equal((await loadPrefs(bridge)).sounds, false);
  m.set("trade.prefs.v1", "{not json");
  assert.deepEqual(await loadPrefs(bridge), DEFAULT_PREFS);
});
