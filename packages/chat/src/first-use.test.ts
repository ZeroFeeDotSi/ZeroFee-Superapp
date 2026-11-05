// Chat for a first-time person (B27, phone test, 2 Nov): the order a first use follows, and its words.
// - Chat opens on the first screen while there is no chat, on the list once there is one, on a place it was in.
// - Nearby: the one line at 10 s, and a fix that comes after it still opens the place (the iPhone's own ask is read
//   first: the old 10 s clock answered "refused" while the person was still reading it). A person who opened another
//   place meanwhile is never moved.
// - The "+" sheet's matches; the chats list's order.
// - Every new word reads at grade 5 or under (the audit's D7 measure) and passes the voice guard at A or B.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { grade } from "../../../tools/copy/voice.ts";
import { EMPTY_PLACE, FIRST_LINES, PRIVATE_FIRST, START_FOOT, chatRows, matches, nearbyWords, notSentWords, opensOn, placeLine } from "./first-use.ts";
import { NearbyTicket, nearby } from "./app/location.ts";
import { AZ_OFF_LINE, azReceipt } from "./agentzero.ts";
import { placeAt } from "./places.ts";

test("the first screen is the three lines, one idea each, until there is a chat", () => {
  assert.deepEqual([...FIRST_LINES], ["Pick a city or tap Nearby.", "Say hi.", "Tap a name to message them."]);
  assert.equal(opensOn({ place: null, chats: 0 }), "first");
  assert.equal(opensOn({ place: null, chats: 1 }), "list", "control: one chat and it's the list");
  assert.equal(opensOn({ place: "u0qj", chats: 0 }), "place", "back in the place it was in");
  assert.equal(EMPTY_PLACE, "Say hello. Anyone here can see it.");
  assert.equal(PRIVATE_FIRST, "Message them privately");
});

const fixAfter = (ms: number, at = { latitude: 47.3769, longitude: 8.5417 }) =>
  ({ getCurrentPosition: (ok: PositionCallback) => setTimeout(() => ok({ coords: at } as GeolocationPosition), ms) }) as unknown as Geolocation;
const hostAfter = (ms: number, answer: unknown): Bridge => ({ call: () => new Promise((r) => setTimeout(() => r(answer as never), ms)), on: () => () => {} });

test("Nearby answered at once: a place, and no line", async () => {
  let lines = 0;
  const at = await nearby(hostAfter(5, { ok: { lat: 47.37, lon: 8.54 } }), () => lines++, { phone: true, lineAfterMs: 50, giveUpMs: 500 });
  assert.ok(!("refused" in at));
  assert.equal(placeAt((at as { lat: number }).lat, (at as { lon: number }).lon), "u0qj", "Zurich's place");
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(lines, 0, "no line after an answer");
});

test("B27: the iPhone's yes after the 10 s line still opens the place (the line, then the fix)", async () => {
  let lines = 0;
  const t0 = Date.now();
  const at = await nearby(hostAfter(150, { ok: { lat: 47.37, lon: 8.54 } }), () => lines++, { phone: true, lineAfterMs: 40, giveUpMs: 1000 });
  assert.equal(lines, 1, "the one line came first, never a waiting screen");
  assert.deepEqual(at, { lat: 47.37, lon: 8.54 }, "and the late fix is still a place");
  assert.ok(Date.now() - t0 >= 140);
  // the browser's ask the same way
  let b = 0;
  assert.deepEqual(await nearby(hostAfter(0, {}), () => b++, { phone: false, geo: fixAfter(120), lineAfterMs: 30, giveUpMs: 1000 }), { lat: 47.3769, lon: 8.5417 });
  assert.equal(b, 1);
});

test("control: an ask that never answers gives up (refused) after the line; a refusal before it has no line", async () => {
  let lines = 0;
  const never: Bridge = { call: () => new Promise(() => {}), on: () => () => {} };
  assert.deepEqual(await nearby(never, () => lines++, { phone: true, lineAfterMs: 20, giveUpMs: 80 }), { refused: true });
  assert.equal(lines, 1);
  let early = 0;
  assert.deepEqual(await nearby(hostAfter(5, { problem: { code: "device.location.refused" } }), () => early++, { phone: true, lineAfterMs: 60, giveUpMs: 500 }), { refused: true });
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(early, 0, "a no before the line is said by the caller, once");
});

test("a late answer never moves a person who opened another place meanwhile; a newer tap replaces an older one", () => {
  const t = new NearbyTicket();
  const a = t.ask();
  assert.ok(t.asking && t.current(a));
  assert.equal(t.fits(a), true, "nothing opened since: the place opens");
  assert.equal(t.asking, false);
  const b = t.ask();
  t.opened(); // the person typed a city and went there
  assert.equal(t.fits(b), false, "control: they went elsewhere, so the fix doesn't move them");
  const c = t.ask();
  const d = t.ask();
  assert.equal(t.current(c), false, "the older tap no longer decides");
  assert.equal(t.fits(c), false);
  assert.equal(t.fits(d), true);
});

test("the + sheet: cities by name, a NEAR name or a coin as a room, BitChat's letters as a place", () => {
  assert.deepEqual(matches("Zur").map((m) => `${m.name} · ${m.what}`), ["Zurich · city"]);
  assert.deepEqual(matches("lond").map((m) => `${m.name} · ${m.what}`), ["London · city"]);
  assert.deepEqual(matches("marketing.sputnik-dao.near").map((m) => `${m.where} · ${m.what}`), ["near:marketing.sputnik-dao.near · room"]);
  assert.deepEqual(matches("USDC").map((m) => `${m.where} · ${m.what}`), ["token:USDC · room"]);
  assert.deepEqual(matches("#u0qj").map((m) => `${m.name} · ${m.what}`), ["#u0qj · place"]);
  assert.deepEqual(matches(""), []);
  assert.deepEqual(matches("Zurichzzzzz"), [], "control: a word that is no city and too long for a coin matches nothing");
});

test("your chats: newest line first, places not read this visit after, in the order you opened them", () => {
  const rows = chatRows([
    { where: "u0qj", title: "Zurich", line: "City chat" },
    { where: "u0qj", peer: "ab", title: "Ava", line: "hi", atIso: "2026-11-02T12:00:00Z" },
    { where: "gcpv", title: "London", line: "Ben: yo", atIso: "2026-11-02T13:00:00Z" },
    { where: "near:x.near", title: "x.near", line: "Room" },
  ]);
  assert.deepEqual(rows.map((r) => r.title), ["London", "Ava", "Zurich", "x.near"]);
});

/** Flesch-Kincaid grade, the audit's D7 measure (the same formula as apps/web/src/shell/nothing-blocks.test.ts). */
function fkGrade(text: string): number {
  const sentences = Math.max(1, text.split(/[.?!]+/).filter((s) => s.trim()).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return 0;
  const syll = (w: string) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, "").match(/[aeiouy]+/g) ?? []).length);
  return 0.39 * (words.length / sentences) + 11.8 * (words.reduce((n, w) => n + syll(w), 0) / words.length) - 15.59;
}

/** Every string B27 puts on Chat's screens. */
const B27 = [
  ...FIRST_LINES, "Nearby", "Pick a city", EMPTY_PLACE, PRIVATE_FIRST, START_FOOT, "Start a chat", "A city, a .near name, or a coin", "finds your city once",
  ...Object.values(nearbyWords(true)), ...Object.values(nearbyWords(false)), "Your message",
  ...[true, false].flatMap((online) => [true, false].map((phone) => notSentWords({ online, phone }))),
  "You're anon5504", "Ava sent you a message", "See your messages", "Only they see them", "Hide this message", "On this device",
  "You here", "Your nickname in city chats", "Show my NEAR account", "What leaves this device", "Ask for money", "Tap $ to ask for money here.",
  "Asked by Ava. Pay only people you know. You approve next.", "Only this person sees this. In Zurich.", "City chat", "Room",
  "We look at where you are only when you tap Nearby. Then only your city's short code goes out.", "The servers that carry chats can see where you connect from.",
];

test("B27's words read at grade 5 or under and grade A or B on the voice guard; never Chat's plumbing words", () => {
  const hard = B27.filter((s) => s.split(/\s+/).length > 3).map((s) => ({ s, fk: fkGrade(s) })).filter((x) => x.fk > 5);
  assert.deepEqual(hard.map((x) => `${x.s} (grade ${x.fk.toFixed(1)})`), []);
  const graded = B27.map((s) => ({ s, g: grade("chat", s) })).filter((x) => x.g.grade !== "A" && x.g.grade !== "B");
  assert.deepEqual(graded.map((x) => `${x.s}: ${x.g.grade} ${x.g.problems.join("; ")}`), []);
  assert.deepEqual(B27.filter((s) => /\b(nostr|relays?|pubkeys?|kind)\b/i.test(s)), []);
});

test("control: the measure catches a line a 5-year-old can't read", () => {
  assert.ok(fkGrade("Chat with anyone on BitChat in a city. Messages in a place are public, and the message servers that carry messages can see your internet address.") > 5);
});

test("security review M1/M2: a place's row keeps \"(not checked)\" and never shows a muted or hidden line", () => {
  const msg = (id: string, pubkey: string, who: string, text: string, mine = false) => ({ id, pubkey, who, text, mine, atIso: `2026-11-02T12:00:0${id}Z`, teleported: false });
  const list = [msg("1", "aa", "ben#1a2b", "hi"), msg("2", "bb", "bob.near#9f9f (not checked)", "send me 5 USDC")];
  assert.equal(placeLine(list, new Set(), new Set())?.line, "bob.near (not checked): send me 5 USDC", "the look-alike name keeps its warning");
  assert.equal(placeLine(list, new Set(), new Set(["bb"]))?.line, "ben: hi", "a muted person's line never shows");
  assert.equal(placeLine(list, new Set(["2"]), new Set())?.line, "ben: hi", "a hidden line never shows");
  assert.equal(placeLine([msg("3", "me", "anon1#0000", "yo", true)], new Set(), new Set())?.line, "You: yo");
  assert.equal(placeLine([], new Set(), new Set()), null);
  // control: the old rule (everything after the tag cut) would have dropped the warning
  assert.equal("bob.near#9f9f (not checked)".replace(/#[0-9a-f]{4}.*$/, ""), "bob.near");
});

test("change 2: a message that didn't go names why: this device's internet, or Chat's servers", () => {
  assert.equal(notSentWords({ online: false, phone: true }), "Not sent: this iPhone has no internet. Only you see it.");
  assert.equal(notSentWords({ online: false, phone: false }), "Not sent: this device has no internet. Only you see it.");
  assert.equal(notSentWords({ online: true, phone: true }), "Not sent: Chat's servers didn't answer. Only you see it.", "control: online, so it's the servers");
});

test("AgentZero's off line is D91's own words, exactly (set by QA and the auditor; long names, so not graded)", () => {
  assert.equal(AZ_OFF_LINE, "AgentZero can't pay this privately yet.");
  assert.equal(grade("chat", AZ_OFF_LINE).grade, "A", "the voice guard still passes it");
  // D98's receipt names the route ("through NEAR Intents"): the voice guard allows it in its own file only, by name
  const receipt = azReceipt(5, "kim.near");
  assert.equal(receipt, "Paid $5 to kim.near through NEAR Intents. Only the middle of the payment is hidden.", "privacy audit (4 Nov): the money leaves the account in public, so never \"your account isn't on the public chain\"");
  assert.equal(grade("packages/chat/src/agentzero.ts", receipt).grade, "A");
  // product decision, 5 Nov (name who is paid): "through NEAR Intents" passes on any screen now; the bare word and marketing don't
  assert.equal(grade("packages/chat/src/app/ChatApp.tsx", receipt).grade, "A");
  assert.notEqual(grade("packages/chat/src/app/ChatApp.tsx", receipt.replace("through NEAR Intents", "from your intents balance")).grade, "A", "control: the bare word is still banned");
  assert.notEqual(grade("packages/chat/src/app/ChatApp.tsx", receipt.replace("through NEAR Intents", "with NEAR Intents today")).grade, "A", "control: marketing is still banned");
  assert.ok(fkGrade(receipt) <= 5, `grade ${fkGrade(receipt).toFixed(1)}`);
});
