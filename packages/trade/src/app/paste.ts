// The search field's Paste pill (V1 had one; TRADE-JOURNEYS 19.3): the clipboard is read only when the person taps it
// (D33: never on the field's focus, never to guess at its shape). On the phone the host reads it (device.clipboard.read;
// iOS shows its own paste banner); in a browser, the page's own clipboard. Null when there's nothing or it can't be read.
import type { Bridge } from "@zerofee/core/bridge";

export async function readPasted(bridge: Bridge): Promise<string | null> {
  const host = await bridge.call<{ text: string | null }>("device.clipboard.read", {}).catch(() => undefined);
  if (host && "ok" in host) return host.ok.text?.trim() || null;
  try { return (await navigator.clipboard.readText()).trim() || null; } catch { return null; }
}
