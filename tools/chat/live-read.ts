// ZeroFee Chat against the real BitChat network, READ ONLY (D55): joins live location channels on each place's
// relays with the app's own RelayPool, and compares every event it gets with what ZeroFee Chat would send:
// - each event's id is our NIP-01 serialization of it, byte for byte, and its signature verifies (nostr.ts);
// - the tags BitChat's apps write (g, n, t, nonce) in their order, the nonce's form and committed difficulty;
// - our own event for the same place, name and teleport has the same tags in the same order (signed here, never sent).
// Posts nothing: no EVENT is ever written to a relay by this script.
//
//   node tools/chat/live-read.ts [seconds=60] [place …]      default places: u0 sp u1 dp dr 9q
import { GEOHASH_MESSAGE, signChat, validatedDifficulty, verifyEvent, type NostrEvent } from "../../packages/core/src/nostr.ts";
import { RelayPool } from "../../packages/chat/src/pool.ts";
import { relaysFor } from "../../packages/chat/src/relays.ts";

const seconds = Number(process.argv[2] ?? 60);
const places = process.argv.slice(3).length ? process.argv.slice(3) : ["u0", "sp", "u1", "dp", "dr", "9q"];

interface Seen { e: NostrEvent; relays: Set<string> }
const seen = new Map<string, Seen>();
const pools: RelayPool[] = [];
const opened = new Map<string, number>();
for (const place of places) {
  const pool = new RelayPool(relaysFor(place), (e, relay) => {
    const s = seen.get(e.id) ?? { e, relays: new Set<string>() };
    s.relays.add(relay);
    seen.set(e.id, s);
  }, (st) => opened.set(place, st.open));
  pool.join(place);
  pools.push(pool);
}
await new Promise((r) => setTimeout(r, seconds * 1000));
for (const p of pools) p.close();

const events = [...seen.values()].map((s) => s.e);
const byPlace: Record<string, number> = {};
for (const e of events) {
  const g = e.tags.find((t) => t[0] === "g")?.[1] ?? "?";
  byPlace[g] = (byPlace[g] ?? 0) + 1;
}
const relayHits: Record<string, number> = {};
for (const s of seen.values()) for (const r of s.relays) relayHits[r] = (relayHits[r] ?? 0) + 1;

// Shapes: the tag names in order, as each client writes them.
const shapes: Record<string, number> = {};
for (const e of events) {
  const shape = e.tags.map((t) => (t[0] === "nonce" ? `nonce(${/^[0-9a-f]{16}$/.test(t[1] ?? "") ? "hex16" : "dec"},${t[2]})` : t[0])).join(",");
  shapes[shape] = (shapes[shape] ?? 0) + 1;
}
// BitChat iOS's own form: g, n, [t], nonce(hex16, 8) (NostrProtocol.createMinedEphemeralGeohashEvent + NostrPoW).
const iosLike = events.filter((e) => /^g,n(,t)?,nonce\(hex16,8\)$/.test(e.tags.map((t) => (t[0] === "nonce" ? `nonce(${/^[0-9a-f]{16}$/.test(t[1] ?? "") ? "hex16" : "dec"},${t[2]})` : t[0])).join(",")));
const pow = iosLike.filter((e) => validatedDifficulty(e.id, e.tags) >= 8).length;

// Ours for the same fields as each iOS-form event: same tags in the same order (never sent).
const seed = globalThis.crypto.getRandomValues(new Uint8Array(32));
let sameShape = 0;
for (const e of iosLike) {
  const g = e.tags.find((t) => t[0] === "g")![1]!;
  if (!/^[0-9bcdefghjkmnpqrstuvwxyz]{2,12}$/.test(g)) continue;
  const n = e.tags.find((t) => t[0] === "n")![1]!;
  const teleport = e.tags.some((t) => t[0] === "t" && t[1] === "teleport");
  try {
    const ours = signChat(seed, { geohash: g, kind: GEOHASH_MESSAGE, content: e.content.slice(0, 2000) || ".", nickname: n.trim() ? n : "anon", teleport }, { nowSeconds: e.created_at });
    const same = ours.tags.length === e.tags.length && ours.tags.every((t, i) => t[0] === e.tags[i]![0] && (t[0] === "nonce" ? t[2] === e.tags[i]![2] && t[1]!.length === e.tags[i]![1]!.length : t.join("\u0000") === e.tags[i]!.join("\u0000")));
    if (same && verifyEvent(ours)) sameShape++;
  } catch {
    // a nickname our core refuses (an invisible character): not a shape question
  }
}

const report = {
  readAtIso: new Date().toISOString(),
  seconds,
  places,
  relaysOpen: opened,
  events: events.length,
  allVerified: events.every((e) => verifyEvent(e) && e.kind === GEOHASH_MESSAGE),
  byPlace,
  relayHits,
  shapes: Object.entries(shapes).sort((a, b) => b[1] - a[1]).slice(0, 12),
  bitchatIosForm: iosLike.length,
  bitchatIosFormMeetingPow8: pow,
  oursSameTagsAsTheirs: `${sameShape}/${iosLike.length}`,
  sample: events.slice(-5).map((e) => ({ id: e.id.slice(0, 12), tags: e.tags.map((t) => t[0]), chars: e.content.length })),
};
console.log(JSON.stringify(report, (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v), 2));
process.exit(0);
