// The one-balance screens' model: the split's arithmetic, the moves in words, and the sample's money (it never appears
// or vanishes: the Trading total moves only when money is added or taken out).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSampleFloat, DEFAULT_SPLIT, policyOf } from "./float-view.ts";
import { moveWords } from "./move-words.ts";

test("the reserve's share is kept off the chains; the chains split the rest by their shares", () => {
  const p = policyOf(DEFAULT_SPLIT, 1000);
  assert.equal(p.budgetUsd, 900);
  assert.deepEqual(p.weights, { sol: 40, hood: 25, bsc: 25 });
});

test("moves in words", () => {
  const m = { id: "1", usd: 40, at: 0, where: "chain" as const };
  assert.equal(moveWords({ ...m, kind: "out", chain: "sol", status: "done" }), "Moved $40.00 to your SOL wallet");
  assert.equal(moveWords({ ...m, kind: "out", chain: "bsc", status: "refunded" }), "$40.00 for your BNB wallet came back to your NEAR wallet");
  assert.equal(moveWords({ ...m, kind: "in", chain: "hood", status: "moving" }), "Bringing $40.00 back from your Robinhood wallet");
  assert.equal(moveWords({ ...m, kind: "out", chain: "hood", status: "waiting" }), "$40.00 to your Robinhood wallet, waiting its turn", "waiting is never \"Moving\"");
  assert.equal(moveWords({ ...m, kind: "in", chain: "sol", status: "waiting" }), "$40.00 back from your SOL wallet, waiting its turn");
  assert.equal(moveWords({ ...m, kind: "add", status: "moving" }), "Moving $40.00 to your NEAR wallet");
});

function sample(approve = true) {
  let t = 0;
  const queue: { at: number; fn: () => void }[] = [];
  const f = createSampleFloat({ now: () => t, later: (fn, ms) => { queue.push({ at: t + ms, fn }); }, approve: async () => approve, moveSec: 6 });
  /** Steps the clock to `ms` later, running what falls due in order. */
  const step = (ms: number) => { const end = t + ms; for (;;) { queue.sort((a, b) => a.at - b.at); const q = queue[0]; if (!q || q.at > end) break; queue.shift(); t = q.at; q.fn(); } t = end; };
  return { f, step };
}

test("$1,000 added: it lands in the reserve, then the chains fill to their sliders in the background; the total never moves", async () => {
  const { f, step } = sample();
  const m = await f.add(1000);
  assert.notEqual(m, "declined");
  assert.equal(f.snapshot().totalUsd, 1000, "counted while it's on its way in");
  step(6000);
  const s = f.snapshot();
  assert.equal(s.totalUsd, 1000);
  assert.deepEqual(s.chains.map((c) => [c.chain, c.inFlight?.usd]), [["sol", 400], ["hood", 250], ["bsc", 250]]);
  step(6000);
  const after = f.snapshot();
  assert.deepEqual(after.chains.map((c) => c.nativeUsd), [400, 250, 250]);
  assert.equal(after.reserveUsd, 100);
  assert.equal(after.totalUsd, 1000);
  assert.equal(after.chains[0]!.readyUsd, 399, "Solana keeps $1 for its fees");
  assert.equal(after.movesLeftToday, 17);
});

test("a no on the refill sheet moves nothing; a share too small to move says so", async () => {
  const { f } = sample(false);
  assert.equal(await f.add(50), "declined");
  assert.equal(f.snapshot().totalUsd, 0);
  const g = sample();
  await g.f.add(30); g.step(6000);
  const bsc = g.f.snapshot().chains.find((c) => c.chain === "bsc")!;
  assert.equal(bsc.targetUsd, 7.5, "the chains share $27 (the reserve keeps 10 %): BNB 25 of 90");
  assert.equal(bsc.tooLittle, true, "under BNB's $10 minimum");
});
