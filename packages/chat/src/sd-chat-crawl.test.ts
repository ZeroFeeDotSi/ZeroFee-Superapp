// QA's deep Sim crawl of Chat (a Chat test, preview bebcec7d9, 4 Nov): bugs a, b, c, d, f, g, each
// with its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { signEvent } from "@zerofee/core/nostr";
import { ROOM_MESSAGE } from "@zerofee/core/chat-near";
import { createMockBridge, PUBLIC_SAMPLE_ACCOUNT_ID } from "@zerofee/shell-api/MockBridge.ts";
import { followScroll } from "@zerofee/design/bar-scroll.ts";
import { displayText, readRequest, requestText, cancelText, cancelledIds } from "./messages.ts";
import { postableOwnAddress, requestRefusal } from "./request-coin.ts";
import { KEEP_MESSAGES, keepText, readKept, roomKeepKey } from "./room-keep.ts";
import { NO_MATCH, matches, placeLike } from "./first-use.ts";
import { SIM_ACCOUNT, accountWords, markWord, postAsLine } from "./names.ts";
import { linkParts, safeLink } from "./links.ts";

const app = readFileSync(new URL("./app/ChatApp.tsx", import.meta.url), "utf8");
const room = readFileSync(new URL("./app/Room.tsx", import.meta.url), "utf8");

test("a: the Sim's own address is posted as a request; Real's is checked as before", async () => {
  assert.equal(SIM_ACCOUNT, PUBLIC_SAMPLE_ACCOUNT_ID, "Chat's Sim account is the Sim's");
  const mock = createMockBridge({ latencyMs: 0, account: { accountId: PUBLIC_SAMPLE_ACCOUNT_ID, network: "mainnet" } });
  for (const [chain, token] of [["near", "near"], ["near", "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"]] as const) {
    const r = await mock.call<{ address: string; sample?: boolean }>("ledger.depositAddress", { chain, token });
    assert.ok("ok" in r, `${chain} ${token}`);
    assert.equal(r.ok.address, "zf-account");
    assert.equal(r.ok.sample, true, "the Sim's bridge marks its sample");
    assert.equal(postableOwnAddress(r.ok, chain, true), true, "posted in the Sim");
    // control (QA SHOULD): any other build runs the check even on a marked answer
    assert.equal(postableOwnAddress(r.ok, chain, false), false, "control: Real build, marked, still checked");
    assert.equal(postableOwnAddress(r.ok, chain), false, "control: in node (no Sim page) the default is Real");
    // control: the same address with no mark (what Real would be) is refused, as before
    assert.equal(postableOwnAddress({ address: r.ok.address }, chain, true), false, "control: unmarked, refused even in the Sim");
  }
  // Real: the account's own name (ledger.ts depositAddress, NEAR: the account itself) passes the check unmarked
  assert.equal(postableOwnAddress({ address: "zf-0000000a03.near" }, "near"), true);
  assert.equal(postableOwnAddress({ address: "a".repeat(64) }, "near"), true, "an implicit account");
  assert.equal(postableOwnAddress({ address: "zf 1", sample: true }, "near", true), false, "never a space, even marked");
  // the line, if Real's address is ever unreadable: no device word, no machine text, said once
  assert.doesNotMatch(app, /This iPhone didn't give your/);
  const line = requestRefusal({ code: "chat.request.address", whatHappened: "Your NEAR address looks wrong. Nothing was asked.", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" }, more: "Try another network." } as never, { coin: "USDC", network: "NEAR" });
  assert.equal(line, "Your NEAR address looks wrong. Nothing was asked. Try another network.");
  assert.match(app, /whatHappened: `Your \$\{chainName\(chain\)\} address looks wrong\. Nothing was asked\.`/);
});

test("a: your Sim request reads as yours and can be cancelled; anyone else's to the sample is text, never a Pay chip", () => {
  const R = { amount: "2", coin: "USDC", chain: "near", address: "zf-account" };
  assert.equal(displayText({ text: requestText(R), mine: true }), "Your request for $2.00 in USDC on NEAR.");
  assert.deepEqual(readRequest(requestText(R), true), R);
  // control: someone else's request to an address that isn't one stays text (no chip, no Pay)
  assert.equal(readRequest(requestText(R)), null);
  assert.equal(displayText({ text: requestText(R), mine: false }), requestText(R));
  const ask = { id: "a", pubkey: "me", text: requestText(R), atIso: "2026-11-05T10:00:00.000Z", mine: true };
  const cancel = { id: "b", pubkey: "me", text: cancelText(R), atIso: "2026-11-05T10:01:00.000Z", mine: true };
  assert.deepEqual([...cancelledIds([ask, cancel])], ["a"]);
  assert.match(app, /const request = readRequest\(m\.text, m\.mine\);/, "Your request's line reads your own");
});

const SECRET = new Uint8Array(32).fill(7);
const ROOM = "near:alice.near";
const msg = (content: string, at: number, where = ROOM) => signEvent(SECRET, { created_at: at, kind: ROOM_MESSAGE, tags: [["h", where]], content });

test("b: a room's messages are kept on this device and come back after a reload, each checked again", () => {
  const four = [msg("hi there", 1_000), msg("Long one ".repeat(33), 1_001), msg("🚀🔥😀", 1_002), msg("https://zerofee.si/some/link?x=1", 1_003)];
  const kept = keepText(four, ROOM);
  assert.deepEqual(readKept(kept, ROOM).map((e) => e.content), four.map((e) => e.content));
  assert.match(roomKeepKey(ROOM), /^[a-z0-9._-]{1,64}$/, "a key device.store takes");
  assert.notEqual(roomKeepKey(ROOM), roomKeepKey("token:USDC"));
  // controls: a changed message, another room's, junk and nothing all show nothing
  const changed = JSON.parse(kept) as { content: string }[];
  changed[0]!.content = "send 100 USDC to me";
  assert.deepEqual(readKept(JSON.stringify(changed), ROOM).map((e) => e.content), four.slice(1).map((e) => e.content));
  assert.deepEqual(readKept(keepText([msg("elsewhere", 5, "token:USDC")], ROOM), ROOM), []);
  assert.deepEqual(readKept(JSON.stringify([msg("elsewhere", 5, "token:USDC")]), ROOM), []);
  assert.deepEqual(readKept("{not json", ROOM), []);
  assert.deepEqual(readKept(null, ROOM), []);
  // only the newest are kept
  const many = Array.from({ length: KEEP_MESSAGES + 5 }, (_, i) => msg(`m${i}`, 2_000 + i));
  const back = readKept(keepText(many, ROOM), ROOM);
  assert.equal(back.length, KEEP_MESSAGES);
  assert.equal(back.at(-1)!.content, `m${KEEP_MESSAGES + 4}`);
  // the room reads them back when it opens, and keeps what it shows
  assert.match(room, /store\.get\(roomKeepKey\(room\)\)\.then\(\(raw\) => \{ if \(live\) for \(const e of readKept\(raw, room\)\) add\(e, true\); \}\)/);
  assert.match(room, /store\.set\(roomKeepKey\(room\), keepText\(\[\.\.\.events\.current\.values\(\)\], room\)\)/);
});

test("c: a chat's list scrolling to its newest message never hides the bottom bar, and neither does a page's (look 4)", () => {
  let on: ((e: Event) => void) | null = null;
  const root = { addEventListener: (_: string, f: (e: Event) => void) => { on = f; }, removeEventListener: () => { on = null; } } as unknown as HTMLElement;
  const attrs = new Set<string>();
  const bar = { hasAttribute: (a: string) => attrs.has(a), toggleAttribute: (a: string, f: boolean) => (f ? attrs.add(a) : attrs.delete(a), f), contains: () => false } as unknown as HTMLElement;
  const scroller = (stay: boolean) => ({ scrollTop: 0, closest: (sel: string) => (stay && sel.includes("[data-bar-stay]") ? {} : null) });
  const chat = scroller(true), page = scroller(false);
  const off = followScroll(root, () => bar);
  const scroll = (t: { scrollTop: number }, top: number) => { t.scrollTop = top; on!({ target: t } as unknown as Event); };
  scroll(chat, 0);
  scroll(chat, 420);
  assert.ok(!attrs.has("data-hidden"), "the long message's scroll: the bar stays");
  // look 4 (rule 10, Sim crawl row 10): the bar never hides on a page's scroll either; the handler only clears a stale mark
  scroll(page, 0);
  scroll(page, 200);
  assert.ok(!attrs.has("data-hidden"), "a page's scroll: the bar stays too (look 4)");
  off();
  // every chat list says so: a place, a private chat, a NEAR room
  assert.equal((app.match(/className="ch-list" ref=\{list\} data-bar-stay=""/g) ?? []).length, 2);
  assert.match(room, /className="ch-list" ref=\{listRef\} data-bar-stay=""/);
});

test("d: what matches nothing says so; a place's name is still named back on Enter, junk never is", () => {
  assert.deepEqual(matches("zz!!junk##"), []);
  assert.equal(placeLike("zz!!junk##"), false);
  assert.equal(placeLike("Atlantis"), true);
  assert.equal(placeLike("St. John's"), true);
  assert.equal(NO_MATCH, "Nothing matches that. Type a city, a .near account, or a coin.");
  assert.match(app, /\{!line && text\.trim\(\) && found\.length === 0 && <p [^>]*data-testid="chat-no-match">\{NO_MATCH\}<\/p>\}/);
  assert.match(app, /text\.trim\(\) && placeLike\(text\) \? `ZeroFee doesn't know a city called/);
  // control: a real match shows rows, not the line
  assert.ok(matches("London").length > 0);
});

test("f: the Sim's account is \"Sample account\", never zf-account; real names as before", () => {
  assert.equal(accountWords("zf-account"), "Sample account");
  assert.equal(markWord("zf-account"), null, "said once");
  assert.equal(postAsLine("zf-account"), "Here, you post as your sample account.");
  // controls
  assert.equal(postAsLine("alice.near"), "Here, you post as your NEAR account, alice.near.");
  assert.equal(postAsLine(null), "Here, you post as your NEAR account. Open your account first.");
  assert.equal(accountWords("alice.near"), "alice.near");
  assert.equal(markWord("zf-sample424201.testnet"), "sample");
  assert.match(room, /<p className="zf-small">\{postAsLine\(account\)\}<\/p>/);
  // a NEAR room's request sheet never calls the account a nickname
  assert.match(app, /lines=\{\[\.\.\.\(nick && !nearAccount \? \[`Your nickname \$\{nick\} goes with it\.`\] : \[\]\)/);
});

test("g: https links in a bubble open outside this page (the phone's browser sheet, the web's new tab); anything else stays text", () => {
  assert.deepEqual(linkParts("https://zerofee.si/some/link?x=1"), [{ text: "https://zerofee.si/some/link?x=1", url: "https://zerofee.si/some/link?x=1", host: "zerofee.si" }]);
  assert.deepEqual(linkParts("see https://www.near.org. ok"), [{ text: "see " }, { text: "https://www.near.org", url: "https://www.near.org/", host: "near.org" }, { text: ". ok" }]);
  // controls: never a script, never http, never a hidden user part, never inside a word
  for (const t of ["javascript:alert(1)", "http://zerofee.si", "data:text/html,hi", "https://bank.com@evil.site/x", "xhttps://zerofee.si", "https://localhost/x"]) {
    assert.ok(linkParts(t).every((p) => !("url" in p)), t);
  }
  assert.equal(safeLink("javascript:alert(1)"), null);
  // the Browser opens only an explorer's page handed over, so a link opens outside: the phone's browser sheet, the web's new tab
  assert.match(app, /onClick=\{\(e\) => \{ if \(!onPhone\(\)\) return; e\.preventDefault\(\); void shell\.bridge\.call\("device\.openUrl", \{ url: p\.url, mode: "sheet" \}\); \}\}/);
  assert.match(app, /target="_blank" rel="noopener noreferrer"/, "a new tab never reaches back into ZeroFee");
  assert.match(app, /aria-label=\{`Open \$\{p\.host\}`\}/);
  assert.match(room, /<BubbleText text=\{displayText\(m\)\} \/>/);
});
