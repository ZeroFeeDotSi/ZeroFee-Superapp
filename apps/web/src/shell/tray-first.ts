// Product decision, 3 Nov: the first time the person ever opens the app, the grab bar glows a little stronger (the tray never opens by
// itself, the P0); once, kept on the phone (device.store), never after. Loaded after Home's first paint (speed budget), never in its first load.
export const TRAY_FIRST_KEY = "tray.first-open";
type Store = { call<T>(method: string, params?: Record<string, unknown>): Promise<{ ok: T } | { problem: unknown }> };
/** Is this the first time ever? Yes only on the store's plain "never" (no value kept): it is marked at once, so it is
 *  never shown twice. A store that can't be read says no (never a tray that opens on every start). */
export async function trayFirstTime(store: Store): Promise<boolean> {
  try {
    const r = await store.call<{ value?: string | null }>("device.store.get", { key: TRAY_FIRST_KEY });
    if (!("ok" in r) || r.ok?.value !== null) return false;
    const w = await store.call("device.store.set", { key: TRAY_FIRST_KEY, value: "1" });
    return "ok" in w;
  } catch {
    return false;
  }
}
