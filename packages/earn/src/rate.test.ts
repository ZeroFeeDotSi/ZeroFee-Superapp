import { test } from "node:test";
import assert from "node:assert/strict";
import { measureRate } from "./rate.ts";
import { FakeNear, near } from "./testing/fake-near.ts";

const span = (chain: FakeNear, blocks: number) =>
  Promise.all([chain.blockAt("final"), chain.blockAt(chain.height - blocks)]).then(([now, then]) => ({ now: now!, then: then! }));

test("a pool's rate is the agreed growth of stakers who neither added nor took out anything", async () => {
  const chain = new FakeNear();
  chain.height = 6_021_600;
  chain.addPool("allnodes.poolv1.near", { growth: 0.0537 });
  const { now, then } = await span(chain, 4_500_000); // about 30 days
  const rate = await measureRate(chain, "allnodes.poolv1.near", now, then);
  assert.equal(rate?.percent, "5.37");
  assert.equal(rate?.days, 29.8);
});

test("stakers who added NEAR are left out; too few agreeing stakers means no rate, never a guess", async () => {
  const chain = new FakeNear();
  const pool = chain.addPool("busy.poolv1.near", { growth: 0.05 });
  const ids = [...pool.stakers.keys()];
  for (const id of ids.slice(0, 2)) pool.stakers.get(id)!.added = near(500);
  const { now, then } = await span(chain, 130_000);
  assert.equal((await measureRate(chain, "busy.poolv1.near", now, then))?.percent, "5.00", "three dormant stakers still agree");
  pool.stakers.get(ids[2])!.added = near(500);
  assert.equal(await measureRate(chain, "busy.poolv1.near", now, then), null);
});

test("no growth at all is a pool nobody pinged, so no rate; and tiny stakers don't count", async () => {
  const chain = new FakeNear();
  const pool = chain.addPool("idle.poolv1.near", { growth: 0 });
  const { now, then } = await span(chain, 130_000);
  assert.equal(await measureRate(chain, "idle.poolv1.near", now, then), null);
  pool.growth = 0.05;
  for (const s of pool.stakers.values()) s.staked = near(0.5);
  assert.equal(await measureRate(chain, "idle.poolv1.near", now, then), null);
});
