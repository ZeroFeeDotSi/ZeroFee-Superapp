// D157: the extension's manifest as built. The extension's pages (the app in the side panel, its approval window, the
// trading panel) share one Content-Security-Policy: no remote code at all (script-src 'self', MV3), and connect-src made
// from the phone's own approved list as apps/ios/build-web.sh makes the phone's ('self', the relay's origin
// (apps/ios/relay-url.txt), apps/ios/connect-hosts.txt and build-web.sh's WSS_HOSTS), less what a mainnet-only build
// never calls (connectSources). Images: the extension itself, data:,
// blob:, the relay (every coin logo), plus the trading panel's two coin-image hosts it already used (kept so it keeps
// working; both are in the gate's host list). Node only: read by vite.app.config.ts and the tests.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectSrc as webConnectSrc } from "../../web/src/hosting.ts";
import { LIVE_IN_RELEASE } from "../../web/src/shown-apps.ts";

export const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

/** The trading panel's coin images (src/panel, before D157): its own, kept. */
export const PANEL_IMG_HOSTS = ["https://coin-images.coingecko.com", "https://assets.geckoterminal.com"] as const;

/** The relay's https URL (ZEROFEE_RELAY_URL in the build's environment when set, else apps/ios/relay-url.txt), or ""
 *  when unset. Anything else is refused. */
export function relayUrl(text = process.env.ZEROFEE_RELAY_URL ?? read("apps/ios/relay-url.txt")): string {
  const r = text.replace(/\s+/g, "");
  if (r !== "" && !/^https:\/\/[a-z0-9.-]+(\/.*)?$/i.test(r)) throw new Error("apps/ios/relay-url.txt must be empty or an https:// URL");
  return r;
}
export const relayOrigin = (relay: string) => (relay ? new URL(relay).origin : "");

/** apps/ios/connect-hosts.txt: one origin per line, never a bare scheme or a wildcard. */
export function connectHosts(text = read("apps/ios/connect-hosts.txt")): string[] {
  const hosts = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  for (const h of hosts) if (h === "https:" || h === "wss:" || h.includes("*") || !/^(https|wss):\/\/[a-z0-9.-]+(:\d+)?$/i.test(h)) throw new Error(`connect-hosts.txt: not an origin: ${h}`);
  return hosts;
}

/** build-web.sh's WSS_HOSTS line: the phone's websocket origins, read from the one place they're written. */
export function wssHosts(script = read("apps/ios/build-web.sh")): string[] {
  const m = /^WSS_HOSTS="([^"]*)"$/m.exec(script);
  if (!m) throw new Error("apps/ios/build-web.sh has no WSS_HOSTS line");
  const hosts = m[1]!.trim().split(/\s+/);
  if (hosts.length !== 4 || hosts.some((h) => !/^wss:\/\/[a-z0-9.-]+$/i.test(h))) throw new Error("WSS_HOSTS must list exactly four wss origins");
  return hosts;
}

/**
 * The connect-src sources (review M6: mainnet only): the phone's, in its order ('self', the relay, the listed hosts, the
 * websockets), less what this mainnet-only build never calls, by the public web build's own rule (apps/web/src/hosting.ts
 * connectSrc): every testnet host, Anthropic's API, the archival nodes, and Chat's relay sockets while Chat isn't live
 * (LIVE_IN_RELEASE). Agent IS live here and talks to a real account, so its model host (NEAR AI Cloud) stays.
 */
export function connectSources(relay = relayUrl(), hosts = connectHosts(), wss = wssHosts()): string[] {
  const phone = ["'self'", ...(relay ? [relayOrigin(relay)] : []), ...hosts, ...wss];
  const kept = new Set(webConnectSrc(hosts, relay ? relayOrigin(relay) : null, LIVE_IN_RELEASE, true, true));
  return phone.filter((h) => kept.has(h) || wss.includes(h));
}

/** The extension pages' policy. */
export function extensionCsp(relay = relayUrl(), hosts = connectHosts(), wss = wssHosts()): string {
  const ro = relayOrigin(relay);
  return [
    "default-src 'self'",
    "script-src 'self'",
    `connect-src ${connectSources(relay, hosts, wss).join(" ")}`,
    `img-src 'self' data: blob:${ro ? ` ${ro}` : ""} ${PANEL_IMG_HOSTS.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "media-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** One directive's sources, from a policy string. */
export const directive = (csp: string, name: string): string[] | undefined =>
  csp.split(";").map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name)?.slice(1);

/**
 * Chrome's extension id for a public key (manifest `key`: base64 of its DER SubjectPublicKeyInfo): the first 32 hex
 * digits of its SHA-256, each digit 0-f written as a-p. With `key` pinned, every Load-unpacked install and every update
 * has this one id, so the passkeys (RP ID chrome-extension://<id>) and the vault (its IndexedDB) stay.
 */
export function extensionIdOf(derBase64: string): string {
  const der = Buffer.from(derBase64.trim(), "base64");
  if (der.length < 64 || der.toString("base64") !== derBase64.trim()) throw new Error("the key is not one base64 DER line");
  return createHash("sha256").update(der).digest("hex").slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

type Manifest = Record<string, unknown> & { content_security_policy?: { extension_pages?: string }; side_panel?: { default_path?: string } };
/** The source manifest (public/manifest.json) as shipped: the policy above, the app as the side panel. */
export function builtManifest(source: Manifest, csp = extensionCsp()): Manifest {
  return { ...source, side_panel: { default_path: "app.html" }, content_security_policy: { extension_pages: csp } };
}
