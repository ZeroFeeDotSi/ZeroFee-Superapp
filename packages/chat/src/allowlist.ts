// The relays ZeroFee Chat may open: 40 exact hosts (no wildcards), each one the phone's CSP will name. A place's relays
// are picked from them with BitChat's own rule (GeoRelayDirectory.closestRelays: the 5 nearest the place's centre, ties
// by host), so where BitChat posts a place, we post and read on the same relays as far as this list allows.
//
// Picked 1 Nov 2026 (UTC) by tools/chat/pick-relays.ts, READ ONLY: 6 rounds over two sweeps of all 326 relays in BitChat's
// directory (441 entries; host and host:443 as one): open wss with a browser Origin, REQ kinds [20000] over 24 h, EOSE;
// NIP-11 limitation. 215 answered every time (one answer cut short forgiven) with no auth, payment, restricted writes
// or PoW; 84 never opened. Demand: half the places seen in the real kind-20000 traffic (by distinct senders), half 179
// big cities at precisions 2 to 6. Then 3 of BitChat's 4 DM relays (not relay.damus.io, below), and a greedy and swap
// search to 40. Again from the saved sweeps:
//   node tools/chat/pick-relays.ts --from $ZEROFEE_HOME/research/chat-relays-2026-11-01-run1-limit2000.json \
//     --from $ZEROFEE_HOME/research/chat-relays-2026-11-01.json
// Achieved (weighted places; "working" = BitChat's relays for the place that answered from here):
//   all of BitChat's working relays for the place are ours 85.4% (slice 1's eight: 11.0%), at least one shared 97.2%
//   (28.3%), mean relays shared 2.17 (0.37; the best any 40 can do is 2.18). Live places alone: 85.7%, 98.6%, 2.00.
// BitChat's own 5 are rarely all usable: for 92.5% of the weighted places one or more of them failed that bar.
import { BITCHAT_DIRECTORY } from "./directory.ts";
import { center, haversineKm } from "./geohash.ts";

/** BitChat's built-in relays for private messages (NostrRelayManager.defaultRelays), but relay.damus.io: it serves
 *  gift wraps (kind 1059) only after NIP-42 AUTH, which BitChat doesn't do, so a message posted there reaches no one.
 *  All three are in BitChat's directory, so they can also be a place's relays. */
export const DM_RELAYS: readonly string[] = ["wss://nos.lol", "wss://relay.primal.net", "wss://offchain.pub"];

export const ALLOWED_RELAYS: readonly string[] = [
  // BitChat's DM relays
  "wss://nos.lol", // Falkenstein, Germany (a Hetzner site, 19 entries there): private messages; the 5 for a few cells in Saxony and Bohemia
  "wss://relay.primal.net", // Toronto, the geo-IP default of 137 entries: private messages; never in a place's 5 (97 hosts there sort before it)
  "wss://offchain.pub", // Kansas City: private messages; the US Plains (9z)
  // Central and western Europe
  "wss://nostr.hifish.org", // Zurich: #u0, the busiest place (25 senders), and Switzerland's cells; 377 events seen
  "wss://nostr.sathoarder.com", // Strasbourg: #u0 and the Rhine (u0s, u0t); 371 events seen; one answer cut short in 6
  "wss://relay.guggero.org", // Graubuenden: Iberia-Italy (#sp, sr, st) and Swiss cells
  "wss://relay.layer.systems", // Karlsruhe: the Rhine cells (u0sz, u0tk, u0tp) and #u0
  "wss://relay.angor.io", // Munich: Bavaria-Austria (#u2), Italy and the Balkans (sr, st)
  "wss://relay.nostrhub.fr", // Munich: #u2, sr, st, the Adriatic
  "wss://21milionidinostr.duckdns.org", // Rome: #sp, sx, sv, sr, sw (the Mediterranean), the most weight in Europe
  "wss://relay.nostu.be", // Madrid: Iberia (sn, ef, s1, efpep)
  "wss://nostrelay.circum.space", // North Holland: the Low Countries and north Germany (#u1)
  "wss://relay.cyberguy.fyi", // North Holland: #u1
  "wss://nostr-relay.xbytez.io", // Roubaix, France (OVH): Flanders and northern France (u14, u15)
  "wss://nostr.christiansass.de", // Muensterland, Germany: north-west Germany (u1h, u1x)
  "wss://nostr.chaima.info", // London: Great Britain and Ireland (#gc)
  // Eastern and northern Europe
  "wss://nostr.azzamo.net", // Warsaw: Poland (#u3), the Balkans and Greece (sx, sw, sy); 122 events seen
  "wss://relay.dwadziesciajeden.pl", // Warsaw: #u3, sx, sv, sw
  "wss://adre.su", // Saint Petersburg: Finland, the Baltics and north-west Russia (#ud, uc)
  "wss://ec2.f7z.io", // Helsinki (Hetzner, 23 entries there): #ud, uc
  "wss://freelay.sovbit.host", // Helsinki: #ud, uc
  "wss://nostr.quali.chat", // Helsinki: #ud and southern Finland (udt)
  // North America
  "wss://bitchat.nostr1.com", // New York: New York (dr5r) and the North-East (de, dr5)
  "wss://bridge.tagomago.me", // Boston: New England (#dr, drt)
  "wss://relay.nostriot.com", // Ohio: the Great Lakes (#dp)
  "wss://wot.nostr.party", // Nashville: the US South-East (dh, dj, d2g)
  "wss://nostr.liberty.fans", // Missouri: the US South (dh, dj, dn)
  "wss://nostr.overpay.com", // Houston: Texas and Mexico (9v, 9g, dh11)
  "wss://nostr.thebiglake.org", // Dallas: Texas and the Gulf (9v, 9g, dh11)
  "wss://relay.bowlafterbowl.com", // Dallas: Texas (9v, 9g)
  "wss://nostr-relay.zimage.com", // Los Angeles: California (#9q)
  // Central and South America
  "wss://no.str.cr", // Costa Rica: Central America and northern South America (#6g, d1)
  // Asia and the Pacific
  "wss://relay.ru.ac.th", // Ramkhamhaeng University: South-East Asia (tt, te, ws, wh), the most weight in Asia
  "wss://relay.islandbitcoin.com", // Bangalore: India and the Indian Ocean (tt, te)
  "wss://nostr-01.yakihonne.com", // Singapore: Malaysia-Indonesia (#pene, ny), Australia
  "wss://relay-arg.zombi.cloudrodion.com", // Singapore: #pene, ny
  "wss://relay01.lnfi.network", // Tokyo: Japan (xn), China (wt, ws)
  "wss://relay02.lnfi.network", // Tokyo: xn, wt, ws
  "wss://staging.yabu.me", // Tokyo: xn, wt
  "wss://yabu.me", // Tokyo: wt, Tokyo's own cells (xn76)
];

/** A relay address or directory host as one relay: "wss://host:443" and "host" are the same. */
export const relayHost = (r: string): string => r.replace(/^wss:\/\//, "").replace(/\/$/, "").replace(/:443$/, "");

/** BitChat's closestRelays run over `relays` only: of the directory entries that are one of them, the `count` nearest
 *  the place's centre, ties by host. A relay listed twice in the directory counts once, at its nearer entry. A relay
 *  not in the directory is never picked. */
export function closestIn(relays: readonly string[], geohash: string, count = 5): string[] {
  const want = new Set(relays.map(relayHost));
  const c = center(geohash);
  const best = new Map<string, number>();
  for (const [h, lat, lon] of BITCHAT_DIRECTORY) {
    const n = relayHost(h);
    if (!want.has(n)) continue;
    const d = haversineKm(c.lat, c.lon, lat, lon);
    const was = best.get(n);
    if (was === undefined || d < was) best.set(n, d);
  }
  return [...best]
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, count)
    .map(([h]) => `wss://${h}`);
}

/** The relays ZeroFee Chat uses for a place: BitChat's rule over the allow-list. */
export function placeRelays(geohash: string, count = 5): string[] {
  return closestIn(ALLOWED_RELAYS, geohash, count);
}
