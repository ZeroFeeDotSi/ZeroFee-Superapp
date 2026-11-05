// QA's hand crawl on a real account (k-chat, 4 Nov, main@b9935fbf): Chat's request and post flow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cancelText, cancelledIds, displayText, readCancel, requestText } from "./messages.ts";
import { requestRefusal } from "./request-coin.ts";

const app = readFileSync(new URL("./app/ChatApp.tsx", import.meta.url), "utf8");
const R = { amount: "1", coin: "USDC", chain: "near", address: "zf-0000000a03.near" };

test("S2: a request's bubble says it is a request, yours or theirs", () => {
  assert.equal(displayText({ text: requestText(R), mine: true }), "Your request for $1.00 in USDC on NEAR.");
  assert.equal(displayText({ text: requestText(R), mine: false }), "A request for $1.00 in USDC on NEAR.");
});

test("S2: your request can be cancelled; only its own poster's cancel counts, and the cancel reads in words", () => {
  const ask = { id: "a", pubkey: "me", text: requestText(R), atIso: "2026-11-04T13:00:00.000Z" };
  const theirs = { id: "b", pubkey: "them", text: cancelText(R), atIso: "2026-11-04T13:01:00.000Z" };
  assert.deepEqual(readCancel(cancelText(R)), R);
  assert.equal(cancelledIds([ask, theirs]).size, 0, "someone else's cancel cancels nothing");
  const mine = { id: "c", pubkey: "me", text: cancelText(R), atIso: "2026-11-04T13:02:00.000Z" };
  assert.deepEqual([...cancelledIds([ask, theirs, mine])], ["a"]);
  assert.equal(displayText({ text: cancelText(R), mine: true }), "You cancelled your request for $1.00 in USDC on NEAR.");
  assert.match(cancelText(R), /^Cancelled: 1 USDC on NEAR to zf-0000000a03\.near · ZeroFee Chat$/, "a BitChat user reads it as it is");
  // the bubble opens its sheet, and someone's cancelled request offers no Pay
  assert.match(app, /\{m\.mine && !cancelled\.has\(m\.id\) && <MyRequestLine m=\{m\}/, "an open request opens its sheet");
  assert.match(app, /\{!cancelled\.has\(m\.id\) && chipFor\(m, book\.account\(m\.pubkey\)\) && <RequestChip/);
});

test("Copywriter (4 Nov): your request's own line, its sheet and its button say each thing once", () => {
  assert.match(app, /MY_REQUEST_OPEN = "Anyone here can still pay it\."/);
  assert.match(app, /\{`\$\{requestAmount\(request\)\}\.`\}/, "the sheet titled Your request leads with the amount");
  assert.match(app, /"Cancelling…" : "Cancel request"/);
});

test("S3: the beta's limit stays on the request sheet, in a request's words, the amount kept", () => {
  const over = { code: "security.beta.cap-over", whatHappened: "This would take you over the beta's $1,000 limit.", more: "During the beta, an account holds up to $1,000. You can add up to $988 more. This keeps the risk small.", next: { kind: "nothing" } };
  assert.equal(requestRefusal(over, { coin: "USDC", network: "NEAR" }), "You can ask for up to $988 now. In the beta, an account holds up to $1,000. Nothing was asked.");
  assert.equal(requestRefusal({ ...over, code: "security.beta.cap", whatHappened: "Your account has reached the beta's $1,000 limit.", more: "" }, { coin: "USDC", network: "NEAR" }), "Your account is at the beta's $1,000 limit. You can't ask for more now. Nothing was asked.");
  // the limit comes from the core's words, never written here (the Copywriter's builder note)
  assert.match(requestRefusal({ ...over, whatHappened: "This would take you over the beta's $5,000 limit.", more: "During the beta, an account holds up to $5,000. You can add up to $4,988 more." }, { coin: "USDC", network: "NEAR" }) ?? "", /up to \$4,988 now\. In the beta, an account holds up to \$5,000\./);
});

test("S3: a request shows at once as Posting…, and a refusal brings the sheet back with its line", () => {
  // the pending bubble goes up before any read the request needs (the 13 s were the reads, not the post)
  const make = app.slice(app.indexOf("const make = async () => {"));
  assert.ok(make.indexOf("later.onPending(") < make.indexOf('bridge.call<{ assetId: string; chain: string; symbol: string; priceUsd?: string }[]>("ledger.tokens")'));
  assert.match(app, /data-testid="chat-pending"/);
  assert.match(app, /onLater: \(a\) => \{ setPending\(null\); setAgain\(a\); \}/);
  assert.match(app, /\.\.\.\(again \? \{ ask: again\.ask, refusedFirst: again\.line \}/);
});

test("S3: after a reload a place's row says its last line, not \"City chat\"", async () => {
  const { readLastLines } = await import("./app/ChatApp.tsx").catch(() => ({ readLastLines: null }));
  if (readLastLines) {
    const m = readLastLines(JSON.stringify({ u0qj: { line: "You: hi", atIso: "2026-11-04T13:00:00.000Z" }, "not a place!": { line: "x", atIso: "y" } }));
    assert.deepEqual([...m.keys()], ["u0qj"]);
  }
  assert.match(app, /placeLine\(kept\.get\(where\) \?\? \[\], hiddenIds, mutedKeys\) \?\? lastLines\.get\(where\) \?\? null/);
  assert.match(app, /store\.set\("last-lines"/);
});

test("S3/S4: the field says what it's for; Ask for money's privacy line is one string", () => {
  assert.match(app, /placeholder=\{PLACE_FIELD\} label=\{PLACE_FIELD\} action="Post"/);
  assert.match(app, /<button className="zf-btn ch-post" disabled=\{!text\.trim\(\) \|\| busy \|\| tooLong\}>/, "Post is off while the field is empty");
  assert.doesNotMatch(app, /\{audience\.charAt\(0\)\.toUpperCase\(\)\}\{audience\.slice\(1\)\}/, "never two text nodes for one word");
});

test("S4: the NEAR-name sheet says what it does in plain words, with no place code, on the core's sheet and the phone's", () => {
  const core = readFileSync(new URL("../../core/src/chat-keys.ts", import.meta.url), "utf8");
  const phone = readFileSync(new URL("../../../apps/ios/ZeroFee/NativeSheet.swift", import.meta.url), "utf8");
  for (const src of [core, phone]) {
    assert.doesNotMatch(src, /approve a note for ZeroFee Chat only|This only shows your NEAR account/);
    assert.match(src, /It's only for Chat\. No money moves\./);
  }
  assert.doesNotMatch(core, /The place with the letters|stays without your account/);
  assert.match(core, /Your old messages here won't show it\./);
});

test("NEAR rooms get the same request fixes as places", () => {
  const room = readFileSync(new URL("./app/Room.tsx", import.meta.url), "utf8");
  assert.match(room, /<MyRequestLine m=\{m\}/);
  assert.match(room, /later=\{\{ onPending:/);
  assert.match(room, /\{chip && !cancelled\.has\(m\.id\) && <RequestChip/);
});

test("QA (5 Nov): a cancel is said once; the sheet's button sits off its text", () => {
  const room = readFileSync(new URL("./app/Room.tsx", import.meta.url), "utf8");
  for (const [name, src] of [["place", app], ["room", room]] as const) {
    assert.match(src, /\{m\.mine && !cancelled\.has\(m\.id\) && <MyRequestLine /, `${name}: no "You cancelled it." under a cancelled request (the cancel line says it)`);
    assert.doesNotMatch(src, /<MyRequestLine m=\{m\} cancelled=\{cancelled\.has/, `${name}: control, the old twice-said line is gone`);
  }
  assert.match(app, /<div className="zf-floor ch-sheetfloor"><button className="zf-btn" disabled=\{busy\} data-testid="chat-my-request-cancel"/);
  assert.match(readFileSync(new URL("./app/chat.css", import.meta.url), "utf8"), /\.ch-sheetfloor \{ margin-top: 24px; \}/);
});
