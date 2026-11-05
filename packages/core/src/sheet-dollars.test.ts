// Grade 1 Nov, D8: the sheet said "Fee: at most 0.007 NEAR" and "Up to 114.1552 NEAR" after the person picked $500.
// Fees and limits are said in dollars first, NEAR after; with no price, NEAR alone (never a made-up dollar figure).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bandUsd, ownAccountCall } from "./known-contracts.ts";
import { feeUsd } from "./words.ts";
import { BAND_COINS, contractBands } from "./demo-core.ts";

const NEAR = (n: number) => (BigInt(Math.round(n * 1e8)) * 10n ** 16n).toString();

test("D8: a NEAR limit reads in dollars at today's price, a USDC limit exactly", () => {
  assert.equal(bandUsd([["near", NEAR(114.1552)]], 4.38), "about $500");
  assert.equal(bandUsd([["nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "500000000"], ["near", NEAR(114.1552)]], 4.38), "$500");
  assert.equal(bandUsd([["near", NEAR(114.1552)]], null), null);
});

test("D8: Change your protection says $ first, NEAR after; with no price, NEAR alone", () => {
  const bands = [{ up_to: [["near", NEAR(114.1552)]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];
  assert.match(ownAccountCall("set_protection", { bands }, 4.38)!.lines[0]!, /^Payments up to about \$500 \(114\.15\d* NEAR\) go as soon as you approve\.$/);
  assert.match(ownAccountCall("set_protection", { bands })!.lines[0]!, /^Payments up to 114\.15\d* NEAR go/);
  assert.equal(ownAccountCall("set_protection", { bands })!.lines[1], "Bigger ones wait 2 minutes. You can cancel them.");
  assert.equal(ownAccountCall("set_protection", { bands })!.details, undefined, "one coin: nothing to disclose");
});

test("D8: a fee reads in cents, rounded up, and a tiny one says so", () => {
  assert.equal(feeUsd(BigInt(NEAR(0.007)), 3), "about $0.03");
  assert.equal(feeUsd(BigInt(NEAR(0.0001)), 3), "under $0.01");
});

test("product decision, 2 Nov: a band over many coins says its dollars alone, never a wall of coin ids or raw units", async () => {
  const { protectionLines } = await import("./known-contracts.ts").catch(() => ({ protectionLines: undefined as any }));
  const mod: any = await import("./known-contracts.ts");
  const coins: [string, string][] = [["nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "21000000"], ["nep141:usdt.tether-token.near", "21000000"], ["nep141:wrap.near", "4906542056074766355140186"], ["nep141:sol.omft.near", "221192331"], ["near", "4906542056074766355140186"]];
  const usd = mod.bandUsd(coins, 4.28);
  assert.equal(usd, "$21");
  void protectionLines;
});

test("Exhibit A (phone test, 2 Nov): a mainnet band of every coin reads as two sentences, and its coins by name behind 'See which coins count'", () => {
  const bands = contractBands([{ upToUsd: 21, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 120 }], { near: 4.28, coins: Object.fromEntries(BAND_COINS.filter((c) => c.kind === "market").map((c) => [c.id, c.floorUsd! * 1.25])) }, "mainnet");
  const w = ownAccountCall("set_protection", { bands }, 4.28)!;
  assert.deepEqual(w.lines, ["Payments up to $21 go as soon as you approve.", "Bigger ones wait 2 minutes. You can cancel them."]);
  assert.equal(w.details!.length, 1);
  assert.equal(w.details![0].label, "See which coins count");
  const listed = (bands[0] as { up_to: unknown[] }).up_to.length;
  assert.equal(w.details![0].lines.length, listed, "every coin the rule counts is on the sheet, one tap open");
  for (const line of [...w.lines, ...w.details![0].lines]) {
    assert.doesNotMatch(line, /nep141:|\.omft\.near|units of|\d{13,}|another coin/, line);
  }
  assert.ok(w.details![0].lines.includes("SOL: up to " + w.details![0].lines.find((l) => l.startsWith("SOL:"))!.slice("SOL: up to ".length)));
  assert.ok(w.details![0].lines.some((l) => /^USDC on Solana: up to 21 USDC$/.test(l)));
});
