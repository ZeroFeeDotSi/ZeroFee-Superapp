// The one-balance planner: what each chain holds for trading, the background moves, and what's buyable on a chain right now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_POLICY, instantUsd, plan, targets, type FloatPolicy } from "./float.ts";

const P: FloatPolicy = { ...DEFAULT_POLICY, budgetUsd: 300, minMoveUsd: 5 };

test("$1,000 moved into Trading: $100 goes to each chain in the background, the rest waits in the float", () => {
  const s = { onChain: {}, floatUsd: 1000 };
  assert.deepEqual(targets(s, P), { sol: 100, bsc: 100, hood: 100 });
  assert.deepEqual(plan(s, P), [{ kind: "out", chain: "sol", usd: 100 }, { kind: "out", chain: "bsc", usd: 100 }, { kind: "out", chain: "hood", usd: 100 }]);
});

test("buying power on a chain is what is on it, less its fee reserve; nothing on a chain means nothing to buy there yet", () => {
  const s = { onChain: { sol: 100, bsc: 0.2 }, floatUsd: 700 };
  assert.equal(instantUsd(s, P, "sol"), 99);
  assert.equal(instantUsd(s, P, "bsc"), 0);
  assert.equal(instantUsd(s, P, "hood"), 0);
});

test("after a sale lands on one chain, the excess moves back to the float first and pays the chains that are short", () => {
  // sold $80 of a coin on Robinhood: Robinhood holds $180, BNB was spent down to $20
  const s = { onChain: { sol: 100, bsc: 20, hood: 180 }, floatUsd: 0 };
  assert.deepEqual(plan(s, P), [{ kind: "in", chain: "hood", usd: 80 }, { kind: "out", chain: "bsc", usd: 80 }]);
});

test("moves under the minimum aren't worth their fee; a budget bigger than the money is capped at the money", () => {
  assert.deepEqual(plan({ onChain: { sol: 98, bsc: 100, hood: 102 }, floatUsd: 0 }, P), []);
  assert.deepEqual(targets({ onChain: {}, floatUsd: 90 }, P), { sol: 30, bsc: 30, hood: 30 });
});

test("with fewer moves left today than the plan needs, the biggest go and nothing is paid out that isn't there", () => {
  const s = { onChain: { sol: 100, bsc: 20, hood: 180 }, floatUsd: 0, movesLeft: 1 };
  assert.deepEqual(plan(s, P), [{ kind: "in", chain: "hood", usd: 80 }]);
  assert.deepEqual(plan({ ...s, movesLeft: 0 }, P), []);
});

import { nextRound, PRIVATE } from "./float.ts";

/** A fixed sequence for the random parts. */
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]!; };

test("private round: amounts jittered within ±15 % (moves in never above the excess), each with its own wait of 20 s to 8 min", () => {
  const s = { onChain: { sol: 100, bsc: 20, hood: 180 }, floatUsd: 100 };
  const r = nextRound(s, P, { at: 1_000, rng: seq(0, 1, 0.5, 0.25) });
  assert.deepEqual(r.map((m) => [m.kind, m.chain]), [["in", "hood"], ["out", "bsc"]]);
  // the draws in order: Robinhood's amount 0 (the low end, 85 % of its $80 excess), its wait 1 (8 min); BNB's amount 0.5
  // (its $80 need, mid-range), its wait 0.25
  assert.deepEqual(r.map((m) => [m.usd, m.at]), [[68, 1_000 + 480_000], [80, 1_000 + 20_000 + 115_000]]);
  for (const m of r) assert.ok(m.at - 1_000 >= PRIVATE.delayMs[0] && m.at - 1_000 <= PRIVATE.delayMs[1]);
  // the top of the range: a move in never takes more than the excess; a move out never more than the reserve holds, its
  // fee included ($50 held: $48.54 out, the rest its fee room)
  const top = nextRound({ onChain: { sol: 100, bsc: 20, hood: 180 }, floatUsd: 50 }, P, { at: 0, rng: seq(1) });
  assert.deepEqual(top.map((m) => [m.kind, m.usd]), [["in", 80], ["out", 48.54]]);
});

test("a move out is paid only from what the reserve holds now, never from money still on its way back", () => {
  const r = nextRound({ onChain: { sol: 100, bsc: 20, hood: 180 }, floatUsd: 0 }, P, { at: 0, rng: seq(0.5) });
  assert.deepEqual(r.map((m) => m.kind), ["in"], "BNB waits for the next round");
});

test("no move equals what was just added (within 1 %), so the Add and the move can't be paired", () => {
  // $100 added to an empty Trading: the plan wants $100 per chain; jitter 0.5 → exactly 100, the Add's amount
  const r = nextRound({ onChain: {}, floatUsd: 300 }, P, { at: 0, rng: seq(0.5), avoid: [100] });
  assert.equal(r.length, 3);
  for (const m of r) assert.ok(Math.abs(m.usd - 100) > 1, `${m.usd}`);
});


test("an empty chain's first money waits only 20-45 s (never within 20 s of an Add); a chain that has money keeps the whole range", () => {
  const r = nextRound({ onChain: { sol: 0, bsc: 100, hood: 50 }, floatUsd: 300 }, P, { at: 0, rng: seq(0.5, 1), empty: (c) => c === "sol" });
  const sol = r.find((m) => m.chain === "sol")!, hood = r.find((m) => m.chain === "hood")!;
  assert.ok(sol.at >= 20_000 && sol.at <= 45_000, `${sol.at}`);
  assert.equal(hood.at, PRIVATE.delayMs[1], "the long end for a chain that already has money");
});

test("a round's moves out, jittered to the top, never ask the reserve for more than it holds, each one's fee included (the last isn't refused short)", async () => {
  const { OUT_FEE_ROOM } = await import("./float.ts");
  for (const r of [0.99, 0.75, 0.5]) {
    const moves = nextRound({ onChain: { sol: 0, bsc: 0, hood: 0 }, floatUsd: 25 }, P, { at: 0, rng: () => r });
    const outs = moves.filter((m) => m.kind === "out");
    assert.ok(outs.length >= 2, `${outs.length} moves`);
    const needs = outs.reduce((n, m) => n + m.usd * (1 + OUT_FEE_ROOM), 0);
    assert.ok(needs <= 25 + 1e-9, `rng ${r}: ${needs.toFixed(2)} asked of $25`);
  }
});

test("the crawl (4 Nov): a buy that leaves its wallet under the fee reserve says the gas it sets off, the planner's own figure (controls: room left, nothing; the NEAR wallet short of it, nothing)", async () => {
  const { gasTopUpUsd } = await import("./float.ts");
  const { gasAfterBuy } = await import("./app/gas-after.ts");
  const { gasTopUps } = await import("./float-jobs.ts");
  const usd = gasAfterBuy({ chain: "sol", nativeUsd: 2.1, payUsd: 1, feeUsd: 0.01, floatUsd: 10 });
  assert.equal(usd, 2.1);
  // the same figure the planner moves (one rule)
  assert.equal(usd, gasTopUps([{ chain: "sol", wallet: "w", nativeUsd: 0.5, holdsCoins: true }], { sol: 1 }, new Set())[0]!.usd);
  assert.equal(gasTopUpUsd("hood", { hood: 0.3 }), 2.1);
  assert.equal(gasAfterBuy({ chain: "sol", nativeUsd: 20, payUsd: 1, feeUsd: 0.01, floatUsd: 10 }), null, "control: room left");
  assert.equal(gasAfterBuy({ chain: "sol", nativeUsd: 2.1, payUsd: 1, feeUsd: 0.01, floatUsd: 1 }), null, "control: the NEAR wallet can't pay it, nothing moves");
});
