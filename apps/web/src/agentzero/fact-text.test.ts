// H-2 on screen: each {{fN}} is the phone's own figure (a chip opening its rows); in an answer about money a figure Claude
// typed itself reads "Not known" and a stand-in reads "someone". Every test has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { factSegments, hasMarks, ACTIVITY_PRIVACY, SAMPLE_ACTIVITY_NOTE, type Seg } from "./fact-text.ts";
import { applyEvent, asksMoney, narrow, type AzMessage } from "./chat-events.ts";
import { fromItems, sheetLine, sheetUsd } from "./chat-items.ts";

const F = { f1: { mark: "f1", shown: "$19.75", rows: ["u1", "u2"] }, f2: { mark: "f2", shown: "kim.near", rows: ["u1", "u2"] } };
const show = (segs: Seg[]) => segs.map((s) => ("text" in s ? s.text : "fact" in s ? `[${s.fact.shown}]` : "sheet" in s ? `[${s.sheet}]` : "<Not known>")).join("");

test("a mark is the phone's figure, as a chip with its rows", () => {
  const s = factSegments("You sent {{f1}} to {{f2}}.", F, true);
  assert.equal(show(s), "You sent [$19.75] to [kim.near].");
  assert.deepEqual((s[1] as { fact: { rows: string[] } }).fact.rows, ["u1", "u2"]);
});

test("QA: a $ figure Claude typed itself renders Not known (control: outside a money answer it stays)", () => {
  assert.equal(show(factSegments("You spent $340 on food, {{f1}} in all.", F, true)), "You spent <Not known> on food, [$19.75] in all.");
  assert.equal(show(factSegments("About 120 dollars, or 0.5 SOL, or € 12.", F, true)), "About <Not known>, or <Not known>, or <Not known>.");
  assert.equal(show(factSegments("Pay $5 to kim.near?", F, false)), "Pay $5 to kim.near?", "control: not an answer about the person's activity");
  // dates and counts in words are not money
  assert.equal(show(factSegments("On 2026-11-03, 2 days ago.", F, true)), "On 2026-11-03, 2 days ago.");
});

test("review M2: every figure Claude could type reads Not known, however it is written", () => {
  for (const t of ["1,200 baht", "฿500", "USD 340", "$  340", "340$", "forty dollars", "a bare 23.95", "12 ZEC", "1.5k USDC", "＄３４０", "$\u200b340", "about 2 moves", "15%"]) {
    const out = show(factSegments(t, F, true));
    assert.ok(out.includes("<Not known>") && !/\d/.test(out.replace(/<Not known>/g, "")), `${JSON.stringify(t)} -> ${out}`);
  }
});

test("dates and short times are not figures (control for M2)", () => {
  for (const t of ["On 2026-11-03.", "In the last 30 days.", "Since 3 Nov.", "Since Nov 3.", "In 2026.", "On the 3rd.", "2 weeks ago"]) assert.equal(show(factSegments(t, F, true)), t);
  assert.equal(show(factSegments("In 2026 you sent $5.", F, true)), "In 2026 you sent <Not known>.");
});

test("review L7: a long run of digits and commas is read in linear time", () => {
  const t0 = Date.now();
  factSegments("1,".repeat(20_000), F, true);
  factSegments("$ ".repeat(20_000) + "x", F, true);
  // 500 ms: the gate runs six test workers at once (it read 200-230 ms under that load, 3 Nov); quadratic here is seconds
  assert.ok(Date.now() - t0 < 500, `${Date.now() - t0} ms`);
});

test("review M4: a mark written before its figure arrived never fills in later; a later reply may use an earlier mark", () => {
  const ms = fromItems([
    { kind: "you", text: "hi" },
    { kind: "agent", text: "Early {{f1}}." },
    { kind: "facts", facts: [F.f1] },
    { kind: "agent", text: "Now {{f1}}." },
    { kind: "you", text: "and?" },
    { kind: "agent", text: "Still {{f1}}." },
  ] as never, false);
  const texts = ms.flatMap((m) => m.parts).filter((p) => p.type === "text" && p.text.includes("{{")) as { text: string; facts?: Record<string, typeof F.f1> }[];
  assert.deepEqual(texts.map((p) => show(factSegments(p.text, p.facts ?? {}, true))), ["Early <Not known>.", "Now [$19.75].", "Still [$19.75]."]);
});

test("a mark with no figure reads Not known; a stand-in reads someone", () => {
  assert.equal(show(factSegments("{{f9}} went to p3.", F, true)), "<Not known> went to someone.");
  assert.equal(show(factSegments("p3 then", F, false)), "p3 then", "control: not strict");
});

test("streaming: half a mark is held back until it is whole", () => {
  assert.equal(show(factSegments("You sent {{f", F, true, true)), "You sent ");
  assert.equal(show(factSegments("You sent {{f1}", F, true, true)), "You sent ");
  assert.equal(show(factSegments("You sent {{f1}}", F, true, true)), "You sent [$19.75]", "control: whole");
  assert.equal(show(factSegments("You sent {{f", F, true, false)), "You sent {{f", "control: done, nothing held");
  assert.ok(hasMarks("a {{f12}} b") && !hasMarks("a {f1} b"));
});

test("facts reach the screen: the real chat's items and the demo's events (narrowed)", () => {
  const items = [
    { kind: "you", text: "what did I spend?" },
    { kind: "step", id: "s", tool: "read_activity", line: "Reading your activity", state: "done" },
    { kind: "facts", facts: [F.f1, F.f2] },
    { kind: "agent", text: "You sent {{f1}}." },
    { kind: "you", text: "and to whom?" },
    { kind: "agent", text: "To {{f2}}." },
  ] as never;
  const ms = fromItems(items, false);
  assert.deepEqual(ms.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
  const textOf = (m: AzMessage) => m.parts.find((p) => p.type === "text") as { facts?: Record<string, typeof F.f1> };
  assert.equal(textOf(ms[1]!).facts?.f1?.shown, "$19.75");
  assert.equal(textOf(ms[3]!).facts?.f2?.shown, "kim.near", "a later reply may use an earlier mark");
  assert.equal(ms[1]!.parts.length, 2, "facts have no part of their own");
  // the demo path: narrowed (a bad fact is dropped), then kept on its reply
  const ev = narrow({ kind: "facts", facts: [F.f1, { mark: "bad", shown: "$1", rows: [] }, { mark: "f3" }] });
  assert.deepEqual(ev, { kind: "facts", facts: [F.f1] });
  const t: AzMessage[] = applyEvent([], ev!, "r");
  assert.equal(t[0]!.facts?.f1?.shown, "$19.75");
});

test("said where it's used: the real account names Claude and the free reading; the demo never claims Claude read anything", () => {
  assert.match(ACTIVITY_PRIVACY, /no names or addresses/);
  assert.match(ACTIVITY_PRIVACY, /keeps nothing/);
  assert.match(SAMPLE_ACTIVITY_NOTE, /^Sample money\./);
  const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  assert.match(src("./live-chat.ts"), /activityNote: chat\.via \? activityPrivacy\(chat\.via\) : ACTIVITY_PRIVACY/);
  // the Sim's chat reads no activity (its sample answers, sim-chat.ts): no note, and it never says Claude read anything
  assert.doesNotMatch(src("./sim-chat.ts"), /activityNote|Claude read/);
  // the rows sheet and the reader load with their first use, never with the chat's first paint
  assert.match(src("./AgentZeroChat.tsx"), /const FactRows = lazy\(/);
  assert.match(src("./AgentZeroChatApp.tsx"), /const SimChat = lazy\(\(\) => import\("\.\/SimChat\.tsx"\)/);
});

test("QA: a pay proposal shows the sheet's own amount, never Claude's typed one", () => {
  const sheet = sheetUsd({ kind: "pay", to: "kim.near", usd: 5 });
  assert.equal(sheet, "$5.00");
  assert.equal(show(factSegments("Pay $50 to kim.near?", {}, false, false, sheet)), "Pay [$5.00] to kim.near?", "Claude typed $50, proposed $5");
  // control: a matching $5 also shows the sheet's $5.00 (from the structure, never from the text)
  assert.equal(show(factSegments("Pay $5 to kim.near?", {}, false, false, sheet)), "Pay [$5.00] to kim.near?");
  assert.equal(show(factSegments("Pay five dollars to kim.near?", {}, false, false, sheet)), "Pay [$5.00] to kim.near?");
  // the line under it says the same figure
  assert.match(sheetLine({ kind: "pay", to: "kim.near", usd: 5 } as never), /\$5\.00/);
  assert.equal(sheetUsd({ kind: "act", act: "move", from: "hidden", to: "sol", usd: 5 }), "$5.00");
  assert.equal(sheetUsd({ kind: "job" }), null);
  assert.equal(sheetUsd({ kind: "pay", usd: Number.NaN }), null);
});

test("QA's ruling: Not known only in replies about Activity or balances (control: other replies keep their words)", () => {
  assert.equal(show(factSegments("A trade costs about $1 in fees.", {}, false)), "A trade costs about $1 in fees.");
  assert.ok(asksMoney("What's my balance?") && asksMoney("how much do I have?") && asksMoney("what did I spend?"));
  assert.ok(!asksMoney("copy this wallet") && !asksMoney("open pump.fun"));
  const src = readFileSync(fileURLToPath(new URL("./AgentZeroChat.tsx", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /p\.facts !== undefined/, "a chat that holds figures no longer makes every later reply strict");
});

test("while a reply streams, a typed figure waits for the reply to end (a sheet may follow it)", () => {
  assert.equal(show(factSegments("Pay $50 to kim", {}, false, true, "…")), "Pay […] to kim");
  const src = readFileSync(fileURLToPath(new URL("./AgentZeroChat.tsx", import.meta.url)), "utf8");
  assert.match(src, /const pending = !m\.done && !strict && !proposes;/);
  assert.match(src, /sheet=\{pending \? "…" : sheet\}/);
});

test("quick review: two sheets with different amounts, or one the chat can't show, make every typed figure Not known", () => {
  // AgentMessage: strict={strict || (proposes && !sheet)}
  assert.equal(show(factSegments("Pay $50 and $7", {}, true, false, null)), "Pay <Not known> and <Not known>");
  const src = readFileSync(fileURLToPath(new URL("./AgentZeroChat.tsx", import.meta.url)), "utf8");
  assert.match(src, /strict=\{strict \|\| \(proposes && !sheet\)\}/);
  assert.equal(sheetUsd({ kind: "act", usd: 5.004 }), null, "5.004 would read $5.00");
  assert.equal(sheetUsd({ kind: "act", usd: 1e21 }), null);
  assert.equal(sheetUsd({ kind: "pay", usd: 5.1 }), "$5.10", "control: a whole-cent amount (no float slip)");
  assert.equal(sheetUsd({ kind: "pay", usd: 0.29 }), "$0.29");
});

test("quick review: names, stand-ins and coin words are never rewritten by a sheet's amount", () => {
  const s = "$5.00";
  assert.equal(show(factSegments("Pay $5 to kim2.near?", {}, false, false, s)), "Pay [$5.00] to kim2.near?");
  assert.equal(show(factSegments("Pay p3 $5?", {}, false, false, s)), "Pay someone [$5.00]?");
  assert.equal(show(factSegments("Swap $5 of SOL to USDC.", {}, false, false, s)), "Swap [$5.00] of SOL to USDC.");
  assert.equal(show(factSegments("Swap 0.03 SOL to USDC.", {}, false, false, s)), "Swap <Not known> to USDC.", "a coin amount is not the sheet's dollars");
  // in an Activity answer with a proposal: no typed figure takes the sheet's amount
  assert.equal(show(factSegments("You have $40 left, 3 moves, so pay $5?", {}, true, false, s)), "You have <Not known> left, <Not known> moves, so pay <Not known>?", "an Activity answer: the amount is the line under the sheet's");
  assert.equal(show(factSegments("Pay ๕๐ dollars", {}, true)), "Pay <Not known>", "Thai digits are digits");
});

test("skills walk: 1Click is a name, not a figure, and the screen says it as NEAR Intents (control: a 1 Claude typed beside it still reads Not known)", () => {
  assert.equal(show(factSegments("ZeroFee's check found no problem with 1Click. {{f1}} at 1Click's price.", F, true)), "ZeroFee's check found no problem with NEAR Intents. [$19.75] at NEAR Intents's price.");
  // never "1Click" on screen, checked or not (product decision, 5 Nov); control: its digit still never reads as a figure
  for (const strict of [true, false]) assert.doesNotMatch(show(factSegments("Swapped with 1Click.", F, strict)), /1Click|Not known/);
  assert.equal(show(factSegments("1 Click, 1 coin", F, true)), "<Not known> Click, <Not known> coin");
});

test("skills walk: \"the last 7 or 30 days\" is a time, not a figure (control: \"7 or $30\" still reads Not known)", () => {
  assert.equal(show(factSegments("I can show how SOL moved over the last 7 or 30 days.", F, true)), "I can show how SOL moved over the last 7 or 30 days.");
  assert.equal(show(factSegments("between 2 and 3 weeks", F, true)), "between 2 and 3 weeks");
  assert.equal(show(factSegments("7 or $30", F, true)), "<Not known> or <Not known>");
});

test("100-prompt suite, send-06: an address that starts with a digit is never a figure (it read \"Not knownuqgj…\"); control: a coin amount and a long bare number beside it still read Not known", () => {
  const sol = "Do1RHZV32j5V7oAEb3PKVwzUxc2XQPBGGwpf6MrC7vcy", evm = "0x7D06e272b5305a4b9D40e872C7950D3437547e3D", implicit = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";
  for (const a of [sol, evm, implicit]) assert.equal(show(factSegments(`How many dollars should go to ${a}?`, F, true)), `How many dollars should go to ${a}?`, a);
  assert.equal(show(factSegments(`Send 0.02 SOL to ${sol}, or 10sol, or 1234567890123456.`, F, true)), `Send <Not known> to ${sol}, or <Not known>sol, or <Not known>.`);
});

// product decision, 3 Nov read as broken. A typed figure is now the phone's own when it matches one the
// turn read, the person's own when they said it, or shown as typed with a quiet "(not checked)"; never "Not known".
import { figureOf, matchFact } from "./fact-text.ts";
const view = (segs: Seg[]) => segs.map((s) => ("text" in s ? s.text : "fact" in s ? `[${s.fact.shown}]` : "sheet" in s ? `[${s.sheet}]` : "unchecked" in s ? `${s.unchecked}(not checked)` : "(couldn't read it)")).join("");
test("a typed figure: the turn's own fact when it matches (same value within a cent, same kind); the person's own figure as is; else as typed, not checked (controls)", () => {
  const facts = { f500: { mark: "f500", shown: "$1,360.60", rows: [] }, f501: { mark: "f501", shown: "1.42 SOL", rows: [] }, f502: { mark: "f502", shown: "5%", rows: [] } };
  assert.equal(view(factSegments("Your Safe has $1,360.60 in USDC.", facts, true)), "Your Safe has [$1,360.60] in USDC.");
  assert.equal(view(factSegments("Your SOL wallet holds 1.42 SOL.", facts, true)), "Your SOL wallet holds [1.42 SOL].");
  // the person's own figure, repeated: theirs, shown as is
  assert.equal(view(factSegments("Your $10 of USDC is still there.", {}, true, false, null, "Swap $10 of USDC to SOL")), "Your $10 of USDC is still there.");
  // not read, not said: as typed, quietly not checked (never "Not known" mid-sentence)
  assert.equal(view(factSegments("Your $10 of USDC is still there.", {}, true)), "Your $10(not checked) of USDC is still there.");
  assert.equal(view(factSegments("About forty dollars.", {}, true)), "About forty dollars(not checked).");
  // controls: a different kind or value is no match; the person's $10 doesn't vouch for a 10%
  assert.equal(matchFact("$5", facts), null, "5% is not $5");
  assert.equal(matchFact("$1,360.61", facts), null);
  assert.equal(view(factSegments("Fees were 10%.", {}, true, false, null, "Swap $10 of USDC")), "Fees were 10%(not checked).");
  assert.deepEqual(figureOf("1.5k USDC"), { n: 1500, unit: "USDC" });
  // a mark with no figure: a quiet line, never "Not known"
  assert.equal(view(factSegments("You had {{f9}}.", {}, true)), "You had (couldn't read it).");
});
test("the screen never writes \"Not known\" in AgentZero's words any more (control: the old word is gone from the renderer)", () => {
  const src = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.equal(/>Not known</.test(src), false);
  assert.match(src, /\(not checked\)/);
});

test("QA (5 Nov): the privacy text says Claude sees the sites' wallets (name and dollars, never an address) when asked what you hold; every path says it", async () => {
  const f = await import("./fact-text.ts");
  for (const t of [f.activityPrivacy("own"), f.activityPrivacy("paid"), f.activityPrivacy("free"), f.ACTIVITY_PRIVACY]) {
    assert.match(t, /If you ask what you hold, Claude also sees each site wallet's name and dollar total/);
    assert.match(t, /never an address\.$/);
  }
  assert.doesNotMatch(f.ACTIVITY_SHORT, /site/, "control: the short line is unchanged");
});
