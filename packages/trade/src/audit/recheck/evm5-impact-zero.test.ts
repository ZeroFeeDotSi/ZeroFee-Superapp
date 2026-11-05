// RECHECK (fix review, e72eddd) of EVM-5 / MKT-2 on BNB and Robinhood (796263f): the depth is "the deeper of the market
// figure and what the trade's impact shows", but an impact that reads 0 (evm/slippage.ts:10 needs i > 0; the KyberSwap path's
// impact is 0 whenever its dollar figures show out >= in, aggregator.ts:84-86) leaves the market figure alone in charge:
// a pool listed at $1 gives a $10 trade the 15 % ceiling. Asserts a measured impact of ~0 can't leave the floor at the
// ceiling; FAILS today.
import { test } from "node:test";
import assert from "node:assert/strict";
import { slippageBps } from "../../evm/slippage.ts";

test("RT-6b (EVM-5 variant): with the impact measured at 0, a $1 market listing doesn't put a $10 trade at the 15 % ceiling", () => {
  const listedAt1 = slippageBps({ liquidityUsd: 1, payUsd: 10, impactBps: 0 });
  const unknown = slippageBps({ payUsd: 10, impactBps: 0 });
  assert.ok(listedAt1 <= unknown + 400, `listed at $1: ${listedAt1} bps; with no figure at all: ${unknown} bps`);
});
