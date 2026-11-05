// RECHECK (fix review, e72eddd) of MKT-2 / SOL-5. The fix's "measured, once watched" bound (slippage.ts:47-57: after three
// of Trade's own quotes over 20 s the base is no wider than what Trade measured) depends on MoveSamples.note, which only
// sol/jupiter.ts:309 calls. The direct-pool path (sol/direct.ts:242) and the curve path (sol/curve-trade.ts:151) read
// `watched` but never record a quote, so on the tap's main paths a coin is never "watched" and the liquidity tiers (up to
// 15 %) and the market data's widening (up to 4 %) stand however long the sheet has been open. Asserts the documented
// behaviour (SLIPPAGE.md "Measured, once watched"); FAILS today.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSolEngine } from "../../sol/engine.ts";
import { replay, TEST_OWNER } from "../../sol/testing/replay.ts";
import { ataOf, PROGRAM } from "../../sol/keys.ts";
import { autoSlippageBps } from "../../slippage.ts";
import { IMPACT_STEP_PCT } from "../../sol/direct.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../../sol/fixtures/${f}`, import.meta.url), "utf8"));
const side = load("sol-sidepool.json");
const ZEREBRO = side.coins.ZEREBRO.mint;

test("RT-5 (MKT-2 variant): a coin quoted on its own pool three times over 25 s is 'watched' and its floor is what Trade measured", async () => {
  const clock = { t: 1_700_000_000_000 };
  const rpc = replay({ rows: side.rows, mint: ZEREBRO, coinProgram: PROGRAM.token, coinAta: ataOf(TEST_OWNER, ZEREBRO, PROGRAM.token) });
  const noRoute = (async () => new Response(JSON.stringify({ error: "No routes found" }), { status: 400 })) as unknown as typeof fetch;
  // a quiet coin whose market figure is thin (the fixture's own CONTROL uses liquidityUsd 1): the 15 % tier
  const engine = createSolEngine({ rpc, owner: TEST_OWNER, solUsd: async () => side.solUsd, meta: async () => ({ liquidityUsd: 1 }) as never, now: () => clock.t, fetch: noRoute });
  const bps: number[] = [];
  for (let i = 0; i < 3; i++) {
    const p = await engine.prepareDirect("buy", ZEREBRO, { usd: 1 });
    bps.push(p.quote.slippageBps);
    clock.t += 12_500;
  }
  assert.ok(engine.moves.watched(ZEREBRO, clock.t), `after 3 direct quotes over 25 s the coin isn't watched (floors ${bps.join(", ")} bps)`);
});

// RT-6 (MKT-2 variant): the "depth from the trade's own impact" rule (slippage.ts:24-26) needs impactPct > 0, but
// sol/direct.ts quoteOn measures impact in steps of 0.0001 %, so a small trade in a deep pool reads 0 and the market data's
// liquidity figure decides alone again: listed at $1 (a compromised or wrong relay answer), a $1 buy in a $2M pool would be
// signed with the ceiling.
// Trade's note (the fix, 28 Oct): the recheck's own case, a $1 buy on ZEREBRO's derived pool, reads 42.56 % impact, not 0
// (that pool is that thin; golden.test.ts keeps it at the ceiling), so it can't show this. The fix (direct.ts
// IMPACT_STEP_PCT: a 0 reading is an impact under the step) is checked on the rule, and end to end on MONEYBIZ's PumpSwap
// pool, where a $0.001 buy reads 0.
test("RT-6 (MKT-2 variant): an impact that reads 0 still says how deep the pool is, so a $1 listing can't widen the floor", async () => {
  // the rule, as direct.ts feeds it: a $1 buy whose impact is under the step, in a pool listed at $1 and at its real $2M
  assert.equal(autoSlippageBps({ liquidityUsd: 1, tradeUsd: 1, impactPct: IMPACT_STEP_PCT }), autoSlippageBps({ liquidityUsd: 2_000_000, tradeUsd: 1, impactPct: IMPACT_STEP_PCT }));
  // end to end: the floor of a buy whose impact reads 0 is the same listed at $1 as at the depth its step shows ($2,000)
  const pump = JSON.parse(readFileSync(new URL("../../sol/fixtures/sol-pump.json", import.meta.url), "utf8"));
  const M = pump.coins.pumpswap.mint;
  const noRoute = (async () => new Response(JSON.stringify({ error: "No routes found" }), { status: 400 })) as unknown as typeof fetch;
  const floor = async (liquidityUsd: number) => {
    const rpc = replay({ rows: pump.rows, mint: M, coinProgram: PROGRAM.token, coinAta: ataOf(TEST_OWNER, M, PROGRAM.token) });
    const e = createSolEngine({ rpc, owner: TEST_OWNER, solUsd: async () => pump.solUsd, meta: async () => ({ liquidityUsd }) as never, now: () => 1_700_000_000_000, fetch: noRoute });
    return (await e.prepareDirect("buy", M, { usd: 0.001 })).quote.slippageBps;
  };
  assert.equal(await floor(1), await floor(2_000), "listed at $1, the $0.001 buy (impact 0) is floored as in the pool its step shows");
});
