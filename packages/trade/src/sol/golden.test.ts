// The port against the old engine: fixtures/sol-golden.json holds what the old engine (at its audited build, tested with
// real money) did on captured mainnet state with these exact node answers: every transaction it simulated, the message
// it signed, and its quote. The port must do the same, byte for byte and number for number. One difference is allowed (see
// sameSims): the curve path's quote simulations no longer wait for the blockhash.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { base64 } from "./bytes.ts";
import { ANY_BLOCKHASH } from "./curve-trade.ts";
import { createSolEngine } from "./engine.ts";
import { TradeError } from "../errors.ts";
import { MAX_SLIPPAGE_BPS } from "../slippage.ts";
import { replay, holdingSim, SIM_OK, TEST_OWNER, BLOCKHASH } from "./testing/replay.ts";
import { messageOf } from "./tx.ts";
import { decodeTx } from "./wire.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const golden = load("sol-golden.json");
const rowsFrom: Record<string, any> = { sidepool: load("sol-sidepool.json").rows, pump: load("sol-pump.json").rows, curves: load("sol-curves.json").rows };

/**
 * Every simulated transaction, byte for byte, with one exception. The curve path's quote simulations (the swap with no
 * floor, the round trip) don't wait for the blockhash: they carry ANY_BLOCKHASH, which the node replaces
 * (replaceRecentBlockhash), and match the old engine's in everything else. `proofLast`: the last one is the real
 * transaction's proof, which stays exact (or, `limitMoved`, differs in its one limit word only: oneWordApart).
 */
function sameSims(actual: string[], expected: string[], name: string, proofLast: boolean, limitMoved = false): void {
  assert.equal(actual.length, expected.length, `${name}: as many simulations as the old engine`);
  actual.forEach((a, i) => {
    if (a === expected[i]) return;
    if (limitMoved && oneWordApart(Buffer.from(a, "base64"), Buffer.from(expected[i]!, "base64"))) return;
    assert.ok(!(proofLast && i === actual.length - 1), `${name}: the real transaction's proof, byte for byte`);
    const got = decodeTx(a), want = decodeTx(expected[i]!);
    assert.equal(got.blockhash, ANY_BLOCKHASH, `${name}: simulation ${i + 1} differs from the old engine's beyond its blockhash`);
    assert.deepEqual({ ...got, blockhash: "", message: [] }, { ...want, blockhash: "", message: [] }, `${name}: simulation ${i + 1}, every other byte`);
  });
}

/** The floors the four cases the old engine put at 2,000 bps get now: ZEREBRO's real impact (42 %, 95 %) still needs the
 *  ceiling; MONEYBIZ's tiny impact (0.08 %) shows a deeper pool than its market figure ($1), so the tier, not the share. */
const NOW_BPS: Record<string, number> = { "cpmm buy $1 (ZEREBRO, its market)": MAX_SLIPPAGE_BPS, "cpmm sell all (ZEREBRO)": MAX_SLIPPAGE_BPS, "PumpSwap buy $2.50 (MONEYBIZ)": 1517, "PumpSwap sell all": 1500 };

/** Same length, and every differing byte inside one 8-byte window (one u64 moved). */
function oneWordApart(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  const diff = [...a].map((x, i) => (x !== b[i] ? i : -1)).filter((i) => i >= 0);
  return diff.length > 0 && diff.at(-1)! - diff[0]! < 8;
}

test("the reference vectors are the test wallet's, on the same blockhash", () => {
  assert.equal(golden.blockhash, BLOCKHASH);
  for (const c of golden.cases) assert.equal(c.owner, TEST_OWNER);
  assert.equal(golden.cases.length, 15);
});

for (const c of golden.cases) {
  test(`same as the old engine: ${c.name}`, async () => {
    const rpc = replay({ rows: rowsFrom[c.rowsFrom], coinAta: c.coinAta, coinProgram: c.program, mint: c.mint, held: c.held === undefined ? undefined : BigInt(c.held), sim: () => (c.sim === "ok" ? SIM_OK : holdingSim(BigInt(c.sim.holding))) });
    const engine = createSolEngine({ rpc, owner: TEST_OWNER, solUsd: async () => c.solUsd, meta: c.meta ? async () => c.meta : undefined, now: () => c.now });
    const run = () => (c.path === "direct" ? engine.prepareDirect(c.side, c.mint, c.amount, { attempt: c.attempt }) : engine.prepareCurve(c.side, c.mint, c.amount, { attempt: c.attempt }));
    if (c.error) {
      await assert.rejects(run(), (e: unknown) => e instanceof TradeError && e.kind === c.error.kind && e.message === c.error.message);
      sameSims(rpc.sims, c.sims, c.name, false);
      return;
    }
    const p = await run();
    const q = p.quote, g = c.quote;
    sameSims(rpc.sims, c.sims, c.name, true, g.slippageBps > MAX_SLIPPAGE_BPS);
    // The old engine floored these four thin pools at 2,000 bps; Trade's ceiling is MAX_SLIPPAGE_BPS now (under the core's
    // 80 % session rule), and a market figure that lists a pool thinner than its own impact shows no longer widens it
    // (MKT-2: MONEYBIZ is listed at $1): the same transaction with only its one limit word (the minimum out, or a buy's
    // most in) moved.
    const capped = g.slippageBps > MAX_SLIPPAGE_BPS;
    const mine = messageOf(p.steps[0]!.tx), theirs = Buffer.from(c.message, "base64");
    if (!capped) assert.equal(base64(mine), c.message, "the message the old engine signed");
    else {
      assert.equal(q.slippageBps, NOW_BPS[c.name], c.name);
      assert.ok(oneWordApart(mine, theirs), "only one u64 differs from what the old engine signed");
    }
    for (const k of ["route", "payRaw", "getRaw", "getMinRaw", "slippageBps", "decimals", "symbol", "expiresAt", "payUsd", "getUsd", "feeUsd"] as const) {
      if (capped && (k === "getMinRaw" || k === "slippageBps")) continue;
      assert.equal(q[k], g[k], k);
    }
    if (capped && g.side !== "buy") assert.ok(BigInt(q.getMinRaw) > BigInt(g.getMinRaw), "a higher minimum out");
    assert.equal(q.priceImpactPct ?? null, g.priceImpactPct, "priceImpactPct");
    assert.equal(q.rentUsd ?? null, g.rentUsd, "rentUsd");
    assert.equal(q.rentBackUsd ?? null, g.rentBackUsd, "rentBackUsd");
    assert.equal(q.closesAccount ?? false, g.closesAccount, "closesAccount");
    await p.ready();
  });
}
