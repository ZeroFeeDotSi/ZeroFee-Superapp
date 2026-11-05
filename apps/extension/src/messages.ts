// Who may ask the background worker for what. The content script runs beside a trading site's own code, so it may only
// say which page it is on and ask to open the panel. Everything that touches the wallet comes from the panel: this
// extension's own panel.html, with no tab. Anything else, or anything malformed, is ignored.
import type { Purpose } from "./vault/policy.ts";
import { siteOf } from "./site.ts";

export type PageMessage = { t: "page"; href: string } | { t: "open" };
export type PanelMessage =
  | { t: "vault.status" }
  | { t: "vault.create"; passcode: string }
  | { t: "vault.unlock"; passcode: string }
  | { t: "vault.lock" }
  | { t: "vault.limit"; usd: number; passcode?: string }
  | { t: "vault.signSol"; tx: string; purpose: Purpose; passcode?: string }
  | { t: "vault.linkCode"; passcode: string; code: string }
  // Touch ID (Security's ruling, 26 Oct): the PRF output and the salt as base64 of 32 bytes; the credential's id, base64url
  | { t: "vault.unlockTouch"; prf: string }
  | { t: "vault.touchOn"; passcode: string; credId: string; salt: string; prf: string }
  | { t: "vault.touchOff"; passcode: string };

export interface Sender { id?: string; url?: string; frameId?: number; tab?: { id?: number; url?: string } }

export const PANEL_PATH = "/panel.html";
const MAX_TX = 4096, MAX_PASS = 512, MAX_HREF = 2048;

/** "panel" for this extension's own panel page, "page" for the content script in a supported site's top frame. */
export function senderKind(s: Sender, extensionId: string): "panel" | "page" | null {
  if (s.id !== extensionId || !s.url) return null;
  let u: URL;
  try { u = new URL(s.url); } catch { return null; }
  if (!s.tab && u.protocol === "chrome-extension:" && u.hostname === extensionId && u.pathname === PANEL_PATH) return "panel";
  if (s.tab?.id !== undefined && s.frameId === 0 && siteOf(s.url)) return "page";
  return null;
}

const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
/** Base64 of exactly 32 bytes (a PRF output or its salt). */
const b32 = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9+/]{43}=$/.test(v);
const credId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{16,1400}$/.test(v);

export function readPageMessage(m: unknown, sender: Sender): PageMessage | null {
  const x = m as Record<string, unknown> | null;
  if (!x || typeof x !== "object") return null;
  if (x.t === "open" && Object.keys(x).length === 1) return { t: "open" };
  if (x.t === "page" && str(x.href, MAX_HREF)) {
    // the page may only speak for its own site
    const claimed = siteOf(x.href), actual = sender.url ? siteOf(sender.url) : null;
    return claimed && actual && claimed.id === actual.id ? { t: "page", href: x.href } : null;
  }
  return null;
}

export function readPanelMessage(m: unknown): PanelMessage | null {
  const x = m as Record<string, unknown> | null;
  if (!x || typeof x !== "object" || typeof x.t !== "string") return null;
  switch (x.t) {
    case "vault.status": case "vault.lock": return { t: x.t };
    case "vault.create": case "vault.unlock": return str(x.passcode, MAX_PASS) ? { t: x.t, passcode: x.passcode } : null;
    case "vault.linkCode": return str(x.passcode, MAX_PASS) && str(x.code, 32) ? { t: x.t, passcode: x.passcode, code: x.code } : null;
    case "vault.unlockTouch": return b32(x.prf) ? { t: x.t, prf: x.prf } : null;
    case "vault.touchOn": return str(x.passcode, MAX_PASS) && credId(x.credId) && b32(x.salt) && b32(x.prf) ? { t: x.t, passcode: x.passcode, credId: x.credId, salt: x.salt, prf: x.prf } : null;
    case "vault.touchOff": return str(x.passcode, MAX_PASS) ? { t: x.t, passcode: x.passcode } : null;
    case "vault.limit": {
      if (typeof x.usd !== "number" || !(x.usd > 0) || x.usd > 100_000 || (x.passcode !== undefined && !str(x.passcode, MAX_PASS))) return null;
      return x.passcode === undefined ? { t: x.t, usd: x.usd } : { t: x.t, usd: x.usd, passcode: x.passcode as string };
    }
    case "vault.signSol": {
      const p = x.purpose as Record<string, unknown> | undefined;
      const purpose: Purpose | null = p?.kind === "trade" ? { kind: "trade" } : p?.kind === "withdraw" && str(p.to, 64) ? { kind: "withdraw", to: p.to } : null;
      if (!str(x.tx, MAX_TX) || !purpose || (x.passcode !== undefined && !str(x.passcode, MAX_PASS))) return null;
      return x.passcode === undefined ? { t: x.t, tx: x.tx, purpose } : { t: x.t, tx: x.tx, purpose, passcode: x.passcode as string };
    }
  }
  return null;
}
