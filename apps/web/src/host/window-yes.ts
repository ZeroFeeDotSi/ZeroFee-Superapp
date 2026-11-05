// D157: in the ZeroFee Chrome extension, a sheet's yes comes from the extension's own approval window (host/extension.ts),
// where the person tapped Approve and their iPhone answered the panel's own challenge (verify.ts). The shell's bridge
// then takes a yes for approval `id` only once that happened: marked here, used once, within a short time. It stands in
// for the web's "a person's own tap on this page" (activation.ts), which a panel can't see: the tap was in the window.
const YES_MS = 5_000;
const yeses = new Map<string, number>();

/** The window's sheet for approval `id` said yes, the iPhone's answer checked. */
export function markWindowYes(id: string, now = Date.now()): void {
  yeses.set(id, now);
}
/** Did the window say yes for approval `id` just now? Each yes counts once. */
export function takeWindowYes(id: unknown, now = Date.now()): boolean {
  const at = typeof id === "string" ? yeses.get(id) : undefined;
  if (typeof id === "string") yeses.delete(id);
  return at !== undefined && now - at >= 0 && now - at <= YES_MS;
}
