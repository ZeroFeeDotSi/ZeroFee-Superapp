// Where ZeroFee Chat talks (D55): a place's relays are BitChat's own pick (GeoRelayDirectory.closestRelays: the 5
// directory relays nearest the place) run over our bounded allow-list (allowlist.ts, 40 exact hosts, slice 2), so where
// BitChat posts a place we post and read on the same relays as often as the list allows. Private messages go on
// BitChat's private-message relays (DM_RELAYS). The phone's CSP lets the page open these and no other socket
// (apps/ios/connect-hosts.txt lists the same 40; tools/ios/csp.test.ts and apps/web/src/hosting.test.ts hold them
// together). `sharedWithBitChat` says how many of a place's relays BitChat itself uses there, so the app can say so.
import { BITCHAT_DIRECTORY } from "./directory.ts";
import { ALLOWED_RELAYS, DM_RELAYS, placeRelays } from "./allowlist.ts";
import { center, haversineKm } from "./geohash.ts";

export { ALLOWED_RELAYS, DM_RELAYS };

/** The relays ZeroFee Chat opens for a place: BitChat's rule over the allow-list. */
export const relaysFor = (place: string): readonly string[] => placeRelays(place);

/** The place for the cross-app check with the BitChat app: Zurich's province cell (#u0qj). BitChat's 5 relays there
 *  are nostr.hifish.org (listed twice in its directory) and three others; ours there share it and more. */
export const CHECK_PLACE = "u0qj";

const host = (url: string) => url.replace(/^wss:\/\//, "").replace(/:443$/, "").replace(/\/$/, "");

/** BitChat's relays for a place: the 5 nearest in its directory, ties by host (closestRelays(toGeohash:count: 5)). */
export function bitchatRelays(geohash: string, count = 5): string[] {
  const c = center(geohash);
  return BITCHAT_DIRECTORY.map(([h, lat, lon]) => ({ h, d: haversineKm(c.lat, c.lon, lat, lon) }))
    .sort((a, b) => a.d - b.d || (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
    .slice(0, count)
    .map((x) => `wss://${x.h}`);
}

/** The place's relays (ours) that BitChat also uses for it (normalised: "host:443" is "host"). Empty: BitChat users
 *  there can't see ZeroFee Chat's messages, nor it theirs. */
export function sharedWithBitChat(geohash: string): string[] {
  const theirs = new Set(bitchatRelays(geohash).map(host));
  return relaysFor(geohash).filter((r) => theirs.has(host(r)));
}

/** A place to open straight away, for the cross-app check on this computer: `?chatplace=u0qj`. Never in the public build. */
export function askedPlace(search: string, publicBuild: boolean): string | null {
  if (publicBuild) return null;
  const v = new URLSearchParams(search).get("chatplace") ?? "";
  return /^[0-9bcdefghjkmnpqrstuvwxyz]{2,12}$/.test(v) ? v : null;
}

/**
 * A local relay for tests on this computer only: `?chatrelay=ws://127.0.0.1:<port>` (or localhost), never in the public
 * build, never any other host. Null otherwise: the pinned relays.
 */
export function localRelay(search: string, publicBuild: boolean): string | null {
  if (publicBuild) return null;
  const v = new URLSearchParams(search).get("chatrelay");
  return v && /^ws:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(v) ? v : null;
}
