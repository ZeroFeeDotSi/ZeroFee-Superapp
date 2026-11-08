// QA's ledger re-walk (6 Nov, $ZEROFEE_HOME/sim-crawls/2026-11-06-ledger-rewalk): every figure on Send's money sheets is
// what will be signed or held. S1: over funds, no coin figure worked from a sum that can't go, and the "at most" line names
// the tap. S6: the fill's Check this says the amount once and why more leaves the Safe. S3: From names the Safe coin it is.
// Each failure path with its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OVER_MAX_TAP, heldWords, overLine, underAmount, partShown, sendFigure } from "./send-cap.ts";
import { SEND_LEG_WORDS, roundFill, stayWhy } from "@zerofee/core/private-route";
import { amountLine } from "@zerofee/core/sheet-amount";
import { sendFillWords } from "@zerofee/core/send-fill";
import type { IntentsFacts, QuoteFacts, SendPayout } from "@zerofee/core/intents";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";

const max = "0.0106 ETH goes to them. The rest stays in Private.";
const at = (o: Partial<Parameters<typeof underAmount>[0]>) => underAmount({ over: false, exact: null, amount: "0", symbol: "ETH", place: "your Robinhood wallet", maxLine: null, ...o });

test("S1 (b/21): over what can go, the slot under the amount says no coin figure and no Max line (controls: under it, both as before; a request's coin; nothing typed)", () => {
  const rows: [string, Parameters<typeof at>[0], ReturnType<typeof underAmount>][] = [
    ["a $90 ask over the $27.93 a wallet can send", { over: true, amount: "0.0383", maxLine: max }, { coins: null, max: null }],
    ["over, with no Max line", { over: true, amount: "0.0383" }, { coins: null, max: null }],
    ["control: under the most", { amount: "0.0042" }, { coins: "0.0042 ETH from your Robinhood wallet", max: null }],
    ["Max picked: its line alone, one line in the slot (copy review, 6 Nov)", { amount: "0.012", maxLine: max }, { coins: null, max }],
    ["control: a request's exact coin", { exact: { amount: "12.5", symbol: "USDC" }, amount: "12.5", maxLine: max }, { coins: "They asked for 12.5 USDC.", max: null }],
    ["control: nothing typed", {}, { coins: null, max: null }],
  ];
  for (const [name, o, want] of rows) assert.deepEqual(at(o), want, name);
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /const under = underAmount\(\{ over, stable, exact: exact \?\? null, amount: atMax \? can : amount, symbol: source\?\.symbol \?\? "", place: source\?\.place \?\? "", maxLine: null \}\);/, "the form's slot reads it with the same `over` that turns Send off");
  assert.equal((form.match(/maxLine\b/g) ?? []).filter(Boolean).length, 1, "QA 16 (7 Nov): Max's line is gone from the slot; the rest is said once, under From");
});

test("S1: the at-most line names the next tap, Max, while Max can set something (control: a coin that can send nothing names no tap)", () => {
  assert.equal(overLine("your Robinhood wallet", "$27.93", true), "You can send at most $27.93 from your Robinhood wallet. Tap Max to send that.");
  assert.equal(overLine("your Safe", "$0.00", false), "You can send at most $0.00 from your Safe.", "control: nothing Max could set");
  assert.equal(overLine("your SOL wallet", "$144.27"), "You can send at most $144.27 from your SOL wallet.", "control: the old two-argument call");
  assert.ok(!/→|->/.test(OVER_MAX_TAP), "no arrow glyphs");
});

test("S3 (b/09): a Safe coin's From row names its coin and what of it can go now (controls: a wallet keeps its coin and dollars; Private's row its own line)", () => {
  // the copy review's B+ (8 Nov): two short lines, never clipped; where the rest is goes in the From list (send-rest.test.ts)
  assert.equal(heldWords({ row: null, symbol: "NEAR", amount: "326.9", usd: "1448.16", max: "312.39" }), "NEAR · $1,383.88 ready");
  assert.equal(heldWords({ row: null, symbol: "USDC", amount: "30", usd: "30", max: "12.5" }), "USDC · $12.50 ready");
  assert.equal(heldWords({ row: "hood", symbol: "ETH", amount: "0.012", usd: "28.17", max: "0.0119" }), "0.012 ETH · $28.17", "control: a wallet as before");
  assert.equal(heldWords({ row: null, symbol: "NEAR", amount: "2", max: "2" }), "2 NEAR", "control: no price, its coin");
});

test("S6: a fill step is a whole $10 within 1 % (the quote's dollars at its own price); slippage room alone is not (control: null, under $10)", () => {
  const rows: [bigint | null, boolean][] = [[3000n, true], [30000n, true], [5000n, true], [2999n, true], [19998n, true], [2950n, false], [500n, false], [999n, false], [4975n, true], [4900n, false], [null, false], [0n, false]];
  for (const [c, want] of rows) assert.equal(roundFill(c), want, String(c));
});

const USDC_C = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", SOL_C = "sol.omft.near", USDC = `nep141:${USDC_C}`, SOL = `nep141:${SOL_C}`;
const facts = { tokens: new Map([[USDC_C, { symbol: "USDC", decimals: 6 }], [SOL_C, { symbol: "SOL", decimals: 9 }]]) } as unknown as IntentsFacts;
const leg1 = (amountIn: string, amountOut: string) => ({ originAsset: USDC, destinationAsset: USDC, amountIn, amountOut }) as unknown as QuoteFacts;
const payout = (amountIn: string, out: string) => ({ originAsset: USDC, amountIn, destinationAsset: SOL, recipient: "payee.test", recipientType: "DESTINATION_CHAIN", amountOutUsd: out }) as unknown as SendPayout;

test("S6, the real core's fill rows: a $25 Send stepped to $30 says why right under what stays (controls: an exact Send's slippage room, no why; nothing stays, no why)", () => {
  const stepped = sendFillWords(leg1("30000000", "30000000"), payout("25000000", "24.75"), facts)!.lines;
  // J2-2 (copy review, 8 Nov): no why sentence on the sheet (the rest row says it); the Fees row right under
  assert.deepEqual(stepped.slice(0, 3), ["From your Safe · $30.00", "Private keeps the rest · about $5.00", "Fees · about $0.25"]);
  assert.ok(!stepped.includes(SEND_LEG_WORDS.why), stepped.join(" | "));
  assert.equal(SEND_LEG_WORDS.why, "Your Safe sends a round sum, so this send is harder to trace.");
  const exact = sendFillWords(leg1("25000000", "25000000"), payout("24750000", "24.50"), facts)!.lines;
  assert.deepEqual(exact.slice(0, 2), ["From your Safe · $25.00", "Private keeps the rest · about $0.25"]);
  assert.ok(!exact.includes(SEND_LEG_WORDS.why), "control: $25.00 is no step, the $0.25 is the payout's room");
  const none = sendFillWords(leg1("30000000", "30000000"), payout("30000000", "29.70"), facts)!.lines;
  assert.ok(!none.some((l) => l.startsWith("Stays in Private")) && !none.includes(SEND_LEG_WORDS.why), "control: nothing stays, nothing said");
});

test("the one line under Stays in Private (the copy review's ruling, 6 Nov; the audit's MUST): a dollar coin's whole step says the round sum, a dollar coin off a step says nothing, any other coin says the Safe sends a little more; never both", () => {
  const table: [boolean, bigint, string[]][] = [
    [true, 3000n, [SEND_LEG_WORDS.why]],
    [true, 10000n, [SEND_LEG_WORDS.why]],
    [true, 2500n, []],
    [false, 3000n, [SEND_LEG_WORDS.more]],
    [false, 677n, [SEND_LEG_WORDS.more]],
  ];
  for (const [dollar, sends, want] of table) assert.deepEqual(stayWhy(dollar, sends), want, `${dollar} ${sends}`);
  assert.equal(SEND_LEG_WORDS.more, "Your Safe sends a little more than you typed; the rest stays in Private.");
  assert.equal(SEND_LEG_WORDS.seen("NEAR"), "Public on NEAR: anyone can see the Safe's part.");
  // the audit (6 Nov): the Safe's part is public on NEAR; another network is where the payout lands, said apart
  assert.equal(SEND_LEG_WORDS.seen("Solana"), "Public on Solana. Anyone can see the Safe's part on NEAR.");
});

test("S6, the amount once: the Amount line goes when a line says the signed dollars, \"about\" or exact (controls: no flag; no line says them; a different sum)", () => {
  const lines = ["From your Safe · $30.00", "Private keeps the rest · about $5.00"];
  assert.equal(amountLine({ amount: "$30.00 (30 USDC)", amountSaid: true, lines }), null, "a dollar coin");
  assert.equal(amountLine({ amount: "about $30.00 (6.7731 NEAR)", amountSaid: true, lines }), null, "a priced coin: the same $30.00");
  assert.equal(amountLine({ amount: "about $30.00 (6.7731 NEAR)", lines }), "about $30.00 (6.7731 NEAR)", "control: no flag, it stays");
  assert.equal(amountLine({ amount: "about $30.00 (6.7731 NEAR)", amountSaid: true, lines: ["From your Safe · 6.7731 NEAR"] }), "about $30.00 (6.7731 NEAR)", "control: no line says the dollars (the real core's coin rows)");
  assert.equal(amountLine({ amount: "about $25.00 (5.6433 NEAR)", amountSaid: true, lines }), "about $25.00 (5.6433 NEAR)", "control: a sum no line says");
  const intents = readFileSync(new URL("../../../../core/src/intents.ts", import.meta.url), "utf8");
  const branch = intents.slice(intents.indexOf("const sent = own === PRIVATE_POCKET"), intents.indexOf("const legs = legsBlock(quote, facts);"));
  assert.match(branch, /amountSaid: true as const/, "the real core's Send fill sheet sets the flag (its Amount is the bytes' amountIn, the Safe's)");
  const swift = readFileSync(new URL("../../../../../apps/ios/ZeroFee/SheetWords.swift", import.meta.url), "utf8");
  assert.match(swift, /replacingOccurrences\(of: "\^about ", with: "", options: \.regularExpression\)/, "the phone's sheet reads the same dollars");
});

test("S6, the Sim's Check this for a $25 NEAR Send from the Safe: title once, no Amount line, the coin's line under what stays, never the round sum (copy review, 6 Nov; control: a Send Private pays whole has no split, no line)", async () => {
  const WNEAR = "nep141:wrap.near";
  const sheetOf = async (near: string, usd: number) => {
    const mock = createMockBridge({ latencyMs: 0, settleMs: 5, safeFillOpen: true, hiddenStart: { usdc: "0", near } });
    let words: { title: string; lines: string[]; amount?: string; amountSaid?: true } | null = null;
    mock.on<{ id: string; words: NonNullable<typeof words> }>("approval.needed", (e) => { words = e.words; void mock.call("approval.answer", { id: e.id, approve: false }); });
    await mock.call("ledger.sendFromSafe", { app: "wallet", tokenId: WNEAR, amount: (usd / 4.43).toFixed(9), to: { kind: "ledger", accountId: "bob.near" }, fill: true });
    return words as unknown as { title: string; lines: string[]; amount?: string; amountSaid?: true };
  };
  const w = await sheetOf("0", 25);
  assert.equal(w.title, "Send $25.00 to bob.near", "J2-2: a short name in the title");
  const i = w.lines.indexOf("Private keeps the rest · about $5.00");
  assert.ok(i > 0 && w.lines[i - 1] === "From your Safe · $30.00" && /^Fees · /.test(w.lines[i + 1] ?? "") && !w.lines.includes(SEND_LEG_WORDS.more), w.lines.join(" | "));
  assert.ok(!w.lines.includes(SEND_LEG_WORDS.why), "NEAR isn't dollars: no round-sum claim (the audit's MUST)");
  assert.equal(amountLine({ amount: w.amount ?? null, amountSaid: w.amountSaid, lines: w.lines } as Parameters<typeof amountLine>[0]), null, `the amount once: ${w.amount}`);
  assert.match(w.amount ?? "", /^about \$30\.00 \(/, "the Sim's Amount is what the Safe's bytes move, as the real core's");
  assert.equal([w.title, ...w.lines].filter((l) => l.includes("$25.00")).length, 1, "$25.00 said once");
  const whole = await sheetOf("50", 25);
  assert.ok(!whole.lines.includes(SEND_LEG_WORDS.why) && !whole.lines.includes(SEND_LEG_WORDS.more) && !whole.lines.some((l) => l.startsWith("Stays in Private")), `control: ${whole.lines.join(" | ")}`);
});

test("the copy review's ruling: \"Up to $X can go in one send.\" only when its figure isn't the From row's own (control: a lower cap stays)", () => {
  const part = "Up to $1,300.50 can go in one send.";
  assert.equal(partShown(part, "USDC · $1,300.50 ready to send"), null);
  assert.equal(partShown(part, "USDC · $1,383.92 ready to send"), part, "control: the cap is lower than the row");
  assert.equal(partShown(null, "USDC · $1,300.50 ready to send"), null);
  assert.equal(partShown(undefined, "x"), null);
});

test("83: after Max the keypad and the button never say a cent over the at-most line (control: typed dollars stay as typed)", () => {
  // the Sim walk's ETH (RH) Max: 0.0119 ETH worth $27.9365 beside "at most $27.93"
  const table: [string | null, boolean, number, string][] = [
    [null, false, 27.9365, "27.93"],
    [null, false, 27.93, "27.93"],
    [null, true, 27.9399, "27.93"],
    ["25", false, 24.996, "25.00"],
    ["6.85", false, 6.8598, "6.85"],
  ];
  for (const [typed, exact, usd, want] of table) assert.equal(sendFigure({ typed, exact, usd }), want, `${typed} ${exact} ${usd}`);
});
