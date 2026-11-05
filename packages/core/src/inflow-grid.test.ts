// Audit 3 Nov H1, fix #3: the inflow grid. An explorer-style matcher pairs an inflow and an outflow when their amounts
// are within a few percent and their times within seconds: it links every old Send (leg 1 brought exactly what was
// paid) and none on the grid (leg 1 brings at least 3 % more, on a two-figure grid).
import { test } from "node:test";
import assert from "node:assert/strict";
import { askedShare, gridDown, inflowUp, maxSend } from "./inflow-grid.ts";
import { pairs } from "./testing/explorer-pairs.ts";

test("the grid: two significant figures, at least 3 % over, never less than asked; a source that can't hold it sends exactly as before", () => {
  // 0.04953 SOL (9 decimals) → 0.052 SOL; $17.43 of USDC (6 decimals) → $18; $7.43 → $7.70; 1.0 SOL → 1.1 SOL
  assert.equal(inflowUp(49_530_000n), 52_000_000n);
  assert.equal(inflowUp(17_430_000n), 18_000_000n);
  assert.equal(inflowUp(7_430_000n), 7_700_000n);
  assert.equal(inflowUp(1_000_000_000n), 1_100_000_000n);
  for (const u of [1n, 99n, 12_345n, 999_999_999n, 49_999_999n]) {
    const g = inflowUp(u);
    assert.ok(g >= u + (u * 300n) / 10_000n, `${u} → ${g}: at least 3 % over`);
    assert.equal(g.toString().replace(/0+$/, "").length <= 2, true, `${g}: two figures`);
  }
  assert.equal(inflowUp(49_530_000n, 50_000_000n), 49_530_000n, "the wallet can't send the grid's: exactly as asked");
  assert.equal(askedShare(51_000_000n, 49_530_000n, 52_000_000n), 48_577_500n, "the payment takes the asked share of what leg 1 brought");
});

test("privacy audit (4 Nov, review): Max is a Send like any other: leg 1 brings the grid amount at or under what the source holds, the payment keeps the grid's 3 % under it, and the explorer pairs none (control: paying all of the inflow less fees, as c12a56c4 did, is paired)", () => {
  assert.equal(gridDown(1_420_000_000n), 1_400_000_000n, "1.42 SOL: 1.4 goes in, 0.02 stays");
  assert.equal(gridDown(498_370_000n), 490_000_000n);
  assert.deepEqual(maxSend(1_420_000_000n), { inflow: 1_400_000_000n, asked: 1_359_223_300n, pocketPays: 0n, pays: 1_359_223_300n });
  assert.deepEqual(maxSend(1_442_000_000n, 42_000_000n), { inflow: 1_400_000_000n, asked: 1_317_223_300n, pocketPays: 42_000_000n, pays: 1_359_223_300n }, "the pocket's part counts inside the gap");
  assert.deepEqual(maxSend(2_900_000_000n, 1_500_000_000n), { inflow: 0n, asked: 0n, pocketPays: 1_500_000_000n, pays: 1_500_000_000n }, "a pocket that alone fills it: no inflow to pair with, so the whole pocket share goes; the Safe's part stays in the Safe");
  assert.equal(maxSend(5n, 5n), null, "all of it in the private balance: nothing to round");
  for (const u of [7n, 99n, 100n, 12_345n, 49_530_000n, 999_999_999n, 1_000_000_000n, 498_370_000n]) {
    const m = maxSend(u)!;
    assert.ok(m.inflow <= u && m.inflow.toString().replace(/0+$/, "").length <= 2, `${u}: ${m.inflow} on the grid, under what is held`);
    assert.ok(m.inflow >= m.asked + (m.asked * 300n) / 10_000n, `${u}: at least 3 % over the payment`);
    assert.ok(m.asked + 1n + ((m.asked + 1n) * 300n + 9_999n) / 10_000n > m.inflow, `${u}: ${m.asked} is the most`);
  }
  // 1Click's usual 1 % off leg 1, then the asked share of it out (send-anywhere.test.ts has the real legs)
  const m = maxSend(1_420_000_000n)!;
  const brought = Number(m.inflow) * 0.99;
  assert.equal(pairs([{ amount: Number(m.inflow), at: 0 }], [{ amount: (brought * Number(m.asked)) / Number(m.inflow), at: 2 }]), 0, "Max on the grid: not paired");
  assert.equal(pairs([{ amount: Number(m.inflow), at: 0 }], [{ amount: brought, at: 2 }]), 1, "control: all of the inflow less fees is paired");
});

test("review (4 Nov): the gap holds for the TOTAL payout: a pocket part of 3 % of the inflow on top of the Safe's share is not paired (control: no pocket part; and da1a100f's sum, pocket plus the whole asked share, is paired)", () => {
  const out = (m: { inflow: bigint; asked: bigint; pocketPays: bigint }) => Number(m.pocketPays) + (Number(m.inflow) * 0.99 * Number(m.asked)) / Number(m.inflow);
  const pocket = maxSend(1_442_000_000n, 42_000_000n)!;
  assert.equal(pairs([{ amount: Number(pocket.inflow), at: 0 }], [{ amount: out(pocket), at: 2 }]), 0, "3 % in the pocket: not paired");
  const none = maxSend(1_400_000_000n)!;
  assert.equal(pairs([{ amount: Number(none.inflow), at: 0 }], [{ amount: out(none), at: 2 }]), 0, "control: no pocket part");
  assert.equal(pairs([{ amount: 1_400_000_000, at: 0 }], [{ amount: 42_000_000 + 1_400_000_000 * 0.99 * (1_359_223_300 / 1_400_000_000), at: 2 }]), 1, "control: the pocket on top of the whole share is paired");
});

test("an explorer pairs every old Send by amount and time, and none on the grid (control: the old flow is linked)", () => {
  const asked = [0.04953, 0.0499, 0.1234, 1.0, 2.71828, 0.0102, 9.87];
  const fee = 0.995;                                                     // what reaches the payee of what leg 1 brought
  const old = { ins: asked.map((a, k) => ({ amount: a, at: k * 100 })), outs: asked.map((a, k) => ({ amount: a * fee, at: k * 100 + 2 })) };
  assert.equal(pairs(old.ins, old.outs), asked.length, "control: every old Send is linked");
  const units = (x: number) => BigInt(Math.round(x * 1e9));
  const grid = { ins: asked.map((a, k) => ({ amount: Number(inflowUp(units(a))) / 1e9, at: k * 100 })), outs: old.outs };
  assert.equal(pairs(grid.ins, grid.outs), 0, "on the grid: none");
});
