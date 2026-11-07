// The Move's ONE fill sheet in the copy review's layout (7 Nov), with the audit's SHOULD 4 (the rows add up) and the fee line (the
// review, 7 Nov: the Send's "Fee · about $X"). Fails on 31472605d / d75192e93: moveSheet doesn't exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { moveSheet, walletsWords } from "./move-plan.ts";

const say = (c: bigint) => `$${(c / 100n).toLocaleString("en-US")}.${String(c % 100n).padStart(2, "0")}`;
const SOL = "your SOL wallet", RH = "your ETH (RH) wallet", NEAR = "your NEAR wallet";

// fix/move-row-truth (QA's rule and the copy review's words, 7 Nov, 04b graded C): no sources sentence (a second Safe figure), no why
// sentence (the Stays row says it); the wallets in the plan's order; "Anyone can see the Safe's part." on every Move fill (the audit's MUST,
// 7 Nov: the caller adds it, whatever stays; move-sheet-seen.test.ts)
test("the copy review's layout: the person's action, then destinations first (the plan's order), the Safe, Private, what stays, the fee, in that order; no sources line, no why", () => {
  const s = moveSheet([{ wallet: SOL, priv: 0n, pay: 8962n }, { wallet: RH, priv: 8500n, pay: 0n }], 10000n, say, { brought: 9975n });
  assert.equal(s.title, "Move $174.62 to your SOL and ETH (RH) wallets");
  assert.deepEqual(s.lines, [
    "Your SOL wallet gets · $89.62",
    "Your ETH (RH) wallet gets · $85.00",
    "From your Safe · $100.00",
    // J2-1 (8 Nov): Private's row is its NET change: it pays $85.00 and gets $99.75 less $89.62 back, so $74.87 out on
    // net, a quote's figure (about); the sum closes on sight: $100.00 + $74.87 = $89.62 + $85.00 + $0.25
    "From Private · about $74.87",
    "Fee · about $0.25",
    "Face ID approves the Safe's part. Private sends on its own.",
  ]);
});

test("04b (QA's rule, 7 Nov): the sheet's wallets in the plan's order whatever order the parts came in; one Safe figure, the signed one; a two-wallet Move is five rows (on cbaddc66d: \"NEAR and SOL\", \"$101.48 from your Safe\", nine lines)", () => {
  const s = moveSheet([{ wallet: NEAR, priv: 0n, pay: 10148n }, { wallet: SOL, priv: 839n, pay: 0n }], 15000n, say);
  assert.equal(s.title, "Move $109.87 to your SOL and NEAR wallets");
  assert.deepEqual(s.lines, ["Your SOL wallet gets · $8.39", "Your NEAR wallet gets · $101.48", "From your Safe · $150.00", "Private keeps the rest · about $40.13", "Fee · $0.00", "Face ID approves the Safe's part. Private sends on its own."]);
  assert.equal(s.lines.filter((l) => /your Safe/.test(l)).length, 1, "one Safe figure: what it signs");
  // control: nothing stays, no Stays row
  const none = moveSheet([{ wallet: SOL, priv: 0n, pay: 4000n }], 4000n, say);
  assert.deepEqual(none.lines, ["Your SOL wallet gets · $40.00", "From your Safe · $40.00", "Fee · $0.00"]);
});

test("one source: \"$X from your Safe.\"; one wallet: its own name and the singular why; nothing stays: no Stays row, no why; no fee: no fee line; what stays always \"about\" (the copy review's one rule: a quote's figure)", () => {
  const s = moveSheet([{ wallet: SOL, priv: 0n, pay: 3000n }, { wallet: NEAR, priv: 0n, pay: 500n }], 4000n, say);
  assert.equal(s.title, "Move $35.00 to your SOL and NEAR wallets");
  assert.deepEqual(s.lines, ["Your SOL wallet gets · $30.00", "Your NEAR wallet gets · $5.00", "From your Safe · $40.00", "Private keeps the rest · about $5.00", "Fee · $0.00"]);
  const one = moveSheet([{ wallet: SOL, priv: 0n, pay: 4000n }], 4000n, say);
  assert.deepEqual([one.title, one.lines], ["Move $40.00 to your SOL wallet", ["Your SOL wallet gets · $40.00", "From your Safe · $40.00", "Fee · $0.00"]]);
  assert.equal(moveSheet([{ wallet: SOL, priv: 0n, pay: 3000n }], 4000n, say).lines.at(-2), "Private keeps the rest · about $10.00");
});

test("the audit's SHOULD 4: the rows add up, a table: From your Safe + From Private = what the wallets get + Stays + Fee; the fee eating into the parts is Private's, said \"about\"", () => {
  const rows: [string, { wallet: string; priv: bigint; pay: bigint }[], bigint, bigint][] = [
    ["the owner's Move, no fee", [{ wallet: SOL, priv: 0n, pay: 3000n }, { wallet: NEAR, priv: 0n, pay: 500n }], 4000n, 4000n],
    ["a fee under the step", [{ wallet: SOL, priv: 0n, pay: 2970n }, { wallet: NEAR, priv: 0n, pay: 495n }], 4000n, 3960n],
    ["Private's own part beside the fill", [{ wallet: NEAR, priv: 500n, pay: 0n }, { wallet: SOL, priv: 0n, pay: 2970n }], 4000n, 3975n],
    ["the fee eats more than the step: Private covers it", [{ wallet: SOL, priv: 0n, pay: 15000n }], 15000n, 14970n],
    ["a part in pieces", [{ wallet: SOL, priv: 45000n, pay: 15000n }], 20000n, 19950n],
  ];
  const fig = (lines: string[], lead: string) => { const l = lines.find((x) => x.startsWith(lead)); return l ? BigInt(l.replace(/^.* · (about )?\$/, "").replace(/[,.]/g, "")) : 0n; };
  for (const [name, parts, safe, brought] of rows) {
    const s = moveSheet(parts, safe, say, { brought });
    const gets = s.lines.filter((l) => / gets · /.test(l)).reduce((n, l) => n + BigInt(l.replace(/^.* · \$/, "").replace(/[,.]/g, "")), 0n);
    const safeRow = fig(s.lines, "From your Safe · "), privRow = fig(s.lines, "From Private · "), stays = fig(s.lines, "Private keeps the rest · "), fee = fig(s.lines, "Fee · ");
    assert.equal(safeRow + privRow, gets + stays + fee, `${name}: ${s.lines.join(" | ")}`);
    assert.equal(s.sums.fromSafe + s.sums.fromPrivate, gets, name);
  }
  const eaten = moveSheet([{ wallet: SOL, priv: 0n, pay: 15000n }], 15000n, say, { brought: 14970n });
  assert.ok(eaten.lines.includes("From Private · about $0.30") && eaten.lines.includes("Fee · about $0.30") && !eaten.lines.some((l) => l.startsWith("Stays")), eaten.lines.join(" | "));
});

test("walletsWords: one, two, three wallets", () => {
  assert.equal(walletsWords([SOL]), "your SOL wallet");
  assert.equal(walletsWords([SOL, RH]), "your SOL and ETH (RH) wallets");
  assert.equal(walletsWords([SOL, RH, NEAR]), "your SOL, ETH (RH) and NEAR wallets");
});

test("the copy review's ruling (7 Nov): the title by count, a comma list with \"and\" before the last and \"wallets\" once; one leg the same layout, its destination first", () => {
  const rows: [string[], string][] = [
    [[SOL], "Move $34.40 to your SOL wallet"],
    [[SOL, NEAR], "Move $34.40 to your SOL and NEAR wallets"],
    // the plan's order (fix/move-row-truth): SOL, ETH (RH), NEAR, whatever order the parts came in
    [[SOL, NEAR, RH], "Move $34.40 to your SOL, ETH (RH) and NEAR wallets"],
  ];
  for (const [names, title] of rows) {
    const pay = 3440n / BigInt(names.length), parts = names.map((wallet, i) => ({ wallet, priv: 0n, pay: i === 0 ? 3440n - pay * BigInt(names.length - 1) : pay }));
    const s = moveSheet(parts, 4000n, say);
    assert.equal(s.title, title);
    assert.match(s.lines[0]!, /^Your SOL wallet gets · /, title);
  }
});
