// The person's own Trade settings, kept on the device (device.store): small, read once, saved on every change.
import type { Bridge } from "@zerofee/core/bridge";

export interface Prefs { v: 1; /** A short sound when a buy or sell fills (on by default; the phone's silent switch still wins). */ sounds: boolean }
export const DEFAULT_PREFS: Prefs = { v: 1, sounds: true };
const KEY = "trade.prefs.v1";

export async function loadPrefs(bridge: Bridge): Promise<Prefs> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: KEY });
  if (!("ok" in r) || !r.ok.value) return { ...DEFAULT_PREFS };
  try { const p = JSON.parse(r.ok.value) as Partial<Prefs>; return { ...DEFAULT_PREFS, ...(typeof p.sounds === "boolean" ? { sounds: p.sounds } : {}) }; }
  catch { return { ...DEFAULT_PREFS }; }
}
export async function savePrefs(bridge: Bridge, p: Prefs): Promise<void> {
  await bridge.call("device.store.set", { key: KEY, value: JSON.stringify(p) });
}
