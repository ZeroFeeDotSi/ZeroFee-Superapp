// the copy review's grade of fix/one-faceid (6 Nov, B, two MUSTs) and the audit's notes on it: the Safe's "Check this" is an opaque sheet from
// its first frame (a-send-02: the Send form showed through it), its Getting-ready state shows no bound figure, Swap's
// headline has two decimals, Send's typed headline only gains its source when bound, and the copy review's final words for the one
// Face ID's refusals. Each with its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sendFillWords } from "@zerofee/core/send-fill";
import type { IntentsFacts, QuoteFacts, SendPayout } from "@zerofee/core/intents";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { walletProblems } from "../../wallet-problems.ts";
import { sendHeadline } from "./send-cap.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../../../../../apps/web/src/shell/approval.css");
const view = read("../../../../../apps/web/src/shell/ApprovalSheetView.tsx");
const host = read("../../../../../apps/web/src/shell/ApprovalSheet.tsx");

test("the copy review's MUST 1: the sheet is opaque from its first frame; only its content rises in (control: the rise fades from 0, so on the sheet it would show the page through)", () => {
  const sheet = /\.approval__sheet \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(sheet, /background: var\(--bg\);/, "an opaque --bg");
  assert.doesNotMatch(sheet, /animation/, "the sheet itself never fades");
  assert.doesNotMatch(css, /\.approval__sheet( *,[^{]*)? *\{[^}]*animation/, "no other rule animates the sheet");
  assert.match(css, /\.approval__sheet > \* \{ animation: appr-rise var\(--dur-sheet\) var\(--ease-out\) both; \}/, "its content rises in");
  assert.match(css, /@keyframes appr-rise \{ from \{ transform: translateY\(24px\); opacity: 0; \}/, "control: the rise starts see-through");
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.approval__sheet > \*, \.approval__scrim \{ animation: none; \} \}/, "Reduce Motion: no rise");
});

test("the copy review's MUST 1: Getting ready shows the labels with Checking, the sub-line and Approve off, and no bound figure (control: the bound sheet draws the core's lines)", () => {
  // the Getting-ready sheet is drawn from the typed headline alone: no line, no warning, no effect of the core's
  assert.match(host, /<ApprovalSheetView key=\{`getting-\$\{getting\.at\}`\} words=\{\{ title: getting\.headline, lines: \[\], warnings: \[\], effect: \[\] \}\}/);
  assert.match(view, /\{PENDING_WORDS\.labels\.map\(\(l\) => <div key=\{l\} className="approval__kv"><span>\{l\}<\/span><span className="approval__checking">\{PENDING_WORDS\.checking\}<\/span><\/div>\)\}/);
  assert.match(view, /\{pending && <p className="approval__more" role="status">\{pending\.failed \? PENDING_WORDS\.failed : PENDING_WORDS\.sub\}<\/p>\}/);
  assert.match(view, /const canApprove = !pending && armed/, "Approve present and off");
  assert.match(css, /\.approval__kv span\.approval__checking \{ color: var\(--mute\); \}/, "Checking in --mute, past the value column's --ink");
  assert.ok(css.indexOf(".approval__kv span.approval__checking") > css.lastIndexOf(".approval__kv span:last-child {"), "after it, so it wins");
  assert.match(view, /\{words\.lines\.slice\(costsMoreHead\(words\.lines\)\)\.map\(/, "control: the bound sheet draws the core's lines");
});

const USDC_C = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", SOL_C = "sol.omft.near", USDC = `nep141:${USDC_C}`, SOL = `nep141:${SOL_C}`;
const facts = { tokens: new Map([[USDC_C, { symbol: "USDC", decimals: 6 }], [SOL_C, { symbol: "SOL", decimals: 9 }]]) } as unknown as IntentsFacts;
const leg1 = (amountIn: string) => ({ originAsset: USDC, destinationAsset: USDC, amountIn, amountOut: amountIn }) as unknown as QuoteFacts;
const payout = (amountIn: string) => ({ originAsset: USDC, amountIn, destinationAsset: SOL, recipient: "payee.test", recipientType: "DESTINATION_CHAIN", amountOutUsd: "24.75" }) as unknown as SendPayout;

test("53: Send's typed headline only gains its source when bound, the same figure (real core and the Sim; control: another figure is not that)", async () => {
  assert.equal(sendHeadline("$25.00"), "Send $25.00");
  for (const [fill, pays] of [["30000000", "25000000"], ["25000000", "25000000"]] as const) {
    assert.equal(sendFillWords(leg1(fill), payout(pays), facts)!.title, `${sendHeadline("$25.00")} to payee.test`, `the real core, fill ${fill}`);
  }
  assert.notEqual(sendFillWords(leg1("30000000"), payout("24990000"), facts)!.title, `${sendHeadline("$25.00")} from your Safe`, "control: $24.99 is another figure");
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, safeFillOpen: true, hiddenStart: { usdc: "0", near: "0" } });
  const titles: string[] = [];
  mock.on<{ id: string; words: { title: string } }>("approval.needed", (e) => { titles.push(e.words.title); void mock.call("approval.answer", { id: e.id, approve: false }); });
  await mock.call("ledger.sendFromSafe", { app: "wallet", tokenId: USDC, amount: "25", to: { kind: "ledger", accountId: "bob.near" }, fill: true });
  assert.deepEqual(titles, [`${sendHeadline("$25.00")} to bob.near`], "the Sim's bound sheet (J2-2: a short name in the title)");
  const sheet = read("./SendSheet.tsx");
  assert.match(sheet, /\.\.\.\(fromSafe \? \{ headline: sendHeadline\(shown\) \} : \{\}\),/, "the Safe's Send passes it as Getting ready's headline");
  assert.match(sheet, /const shown = cash !== null \? cash :/, "two decimals (M1: the form's own figure), with its commas (QA 16)");
});

test("the copy review's MUST 2: Swap's headline always has two decimals (control: cents kept)", () => {
  const swap = read("./SwapSheet.tsx");
  assert.match(swap, /export const swapWords = \(usd: string, from: string, to = "USDC"\) => `Swap \$\$\{Number\(usd\)\.toFixed\(2\)\} of \$\{from\} for \$\{to\}`;/);
  assert.doesNotMatch(swap, /trimCents/);
});

test("the copy review's final words for the one Face ID's refusals: too many steps (Close lit), timed out (Try again a button), mismatch", () => {
  const FACE = "This has more steps than one Face ID covers, so ZeroFee stopped it. Your money hasn't moved.";
  const TIME = "The Face ID approval timed out, so nothing was sent. Your money hasn't moved.";
  const MISMATCH = "What the phone signed didn't match what you approved, so ZeroFee didn't use it. Your money hasn't moved.";
  const p = walletProblems.tooManySteps();
  assert.equal(p.whatHappened, FACE);
  assert.deepEqual(p.next, { kind: "nothing", label: "Close" });
  assert.equal(p.money.state, "safe");
  // changed (fix/safe-steps-one-faceid, 7 Nov): more than 4 refused whether or not the account chains (approvals-apart.test.ts)
  assert.match(read("../../ledger.ts"), /if \(steps\.length > 4\) throw new ProblemError\(walletProblems\.tooManySteps\(\)\);/);
  const chip = read("../../../../../apps/ios/ZeroFee/ChipKey.swift"), native = read("../../../../../apps/ios/ZeroFee/NativeSheet.swift");
  assert.ok(chip.includes(`throw Refused(what: "${FACE}", next: .close)`));
  assert.ok(chip.includes(`throw Refused(what: "${TIME}", next: .tryAgain)`));
  assert.ok(native.includes(`return refused("${FACE}")`));
  assert.ok(!TIME.includes("Try again"), "Try again is a button, never in the sentence");
  assert.match(native, /note\?\.next == \.tryAgain \? "Try again" : "Approve with Face ID"/, "the button says Try again");
  assert.match(native, /if note\?\.next == \.close \{\n\s*Button\(action: notNow\) \{ Text\("Close"\)/, "Close is the one lit button");
  assert.ok(read("../../../../../apps/ios/core/entry.ts").includes(`throw new Error("${MISMATCH}")`));
  for (const old of ["This needs too many steps for one approval.", "too many steps for one Face ID, so ZeroFee didn't approve it", "Face ID's approval ran out", "The phone's answer didn't match"]) {
    assert.ok(![chip, native, read("../../ledger.ts")].some((s) => s.includes(old)), `gone: ${old}`);
  }
});

test("the audit (a): the chip key is built from the handle the defer zeroes, never a second copy of it", () => {
  const chip = read("../../../../../apps/ios/ZeroFee/ChipKey.swift");
  const many = chip.slice(chip.indexOf("static func signMany"), chip.indexOf("final class Unlock"));
  assert.match(many, /defer \{ handle\.resetBytes\(in: 0\.\.<handle\.count\) \}/);
  assert.match(many, /let key = try SecureEnclave\.MLDSA65\.PrivateKey\(dataRepresentation: handle, authenticationContext: context\)/);
  assert.doesNotMatch(many, /= handle\b/, "no copy of the handle");
});
