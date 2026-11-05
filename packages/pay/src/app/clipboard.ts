// What the person just copied in a partner's own page, read once when they tap "Use the … you copied": the tap is the
// permission. On the phone the host reads it (device.clipboard.read; iOS shows its own paste banner); in a browser,
// navigator.clipboard. Null when there's nothing, or nothing may be read: the screen then offers pasting by hand.
import type { Bridge } from "@zerofee/core/bridge";

export async function readCopied(bridge: Bridge): Promise<string | null> {
  const host = await bridge.call<{ text: string | null }>("device.clipboard.read", {});
  // The phone answered: its word stands, empty included. Anything else (a browser) falls back to the page's own read.
  if ("ok" in host) return host.ok.text?.trim() || null;
  try {
    const text = await navigator.clipboard.readText();
    return text.trim() || null;
  } catch {
    return null;
  }
}

/** Puts the person's own address on the clipboard before a partner's page opens, so they only paste it there. */
export async function copyFor(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
