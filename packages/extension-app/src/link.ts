// What the phone needs to know about the panel's link QR without opening it: whether a scanned text is one at all (so a
// payment code or a web link scanned by mistake never reaches the core), and how long the phone's code has left.
// Opening it is the trusted core's job (subwallet.import); the format is in apps/extension/src/vault/link.ts.

/** True when `text` is a panel link QR: base64 of JSON { v: 1, salt, iv, ct }, every field base64, and nothing else. */
export function isPanelCode(text: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length > 600) return false;
  let p: unknown;
  try { p = JSON.parse(atob(text)); } catch { return false; }
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  const b64 = (v: unknown, min: number) => typeof v === "string" && v.length >= min && /^[A-Za-z0-9+/]+={0,2}$/.test(v);
  return Object.keys(o).sort().join() === "ct,iv,salt,v" && o.v === 1 && b64(o.salt, 20) && b64(o.iv, 16) && b64(o.ct, 40);
}

/** "4:52", the time a code has left; "0:00" once it has run out. */
export function timeLeft(expiresAtIso: string, now = Date.now()): string {
  const s = Math.max(0, Math.ceil((Date.parse(expiresAtIso) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
