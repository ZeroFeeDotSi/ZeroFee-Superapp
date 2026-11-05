// An https address's origin and host, without the WHATWG URL class. The phone's core runs in JavaScriptCore's own
// context (apps/ios/core), and JavaScriptCore has no URL: that is the browser's (WebKit's), not the language's. On the
// phone test (2 Nov) `new URL` threw "Can't find variable: URL", so the relay's address read as unset (every Top up:
// "Trading moves aren't set up on this phone yet.") and the "Your key" card said "Something went wrong on our side".
// The core's own code reads addresses only through here (tools/ios/core-no-url.test.ts keeps it so).

/** A dotted IPv4 address as URL writes it: four 0-255 numbers, no leading zeros. */
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
/** A DNS name: letters, digits and inner hyphens, each label 1-63 long. */
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * "https://Host.example:8443/a?b#c" → { origin: "https://host.example:8443", host: "host.example:8443", rest: "/a?b#c" }.
 * Null for anything that isn't plainly https with a host name or a dotted IPv4 address: another scheme, a user or
 * password, a space or control character, a backslash, a bad port, an address URL would rewrite (0x7f.1, 127.1). Never
 * looser than URL: what it accepts, URL reads the same way (https-url.test.ts checks against it). Port 443 is dropped
 * and the host is lower case, as URL gives them. `rest` is the path, query and fragment exactly as written.
 */
export function httpsOrigin(raw: unknown): { origin: string; host: string; rest: string } | null {
  if (typeof raw !== "string" || raw.length > 2048 || /[\u0000- \u007f-￿\\"<>`{}|^]/.test(raw)) return null;
  const m = /^https:\/\/([^/?#]*)(.*)$/i.exec(raw);
  if (!m) return null;
  const [, authority, rest] = m as unknown as [string, string, string];
  const hp = /^([^:@]+)(?::(\d{1,5}))?$/.exec(authority);
  if (!hp) return null;
  const name = hp[1]!.toLowerCase();
  const last = name.slice(name.lastIndexOf(".") + 1);
  // URL reads a host whose last label is a number (or 0x…) as an IPv4 address, and rewrites it: only the plain form here
  if (/^(?:\d+|0x[0-9a-f]*)$/.test(last) ? !IPV4.test(name) : !NAME.test(name)) return null;
  const port = hp[2] === undefined ? undefined : Number(hp[2]);
  if (port !== undefined && port > 65535) return null;
  const host = port === undefined || port === 443 ? name : `${name}:${port}`;
  return { origin: `https://${host}`, host, rest };
}
