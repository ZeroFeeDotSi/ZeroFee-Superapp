// The pocket day's two stops (FLOW-V5 §5 item 9 and QA's call, 3 Nov): the drawdown freeze (under 85% of the day's peak
// value, the day ends like a Stop) and a pause or Stop seen on NEAR from another device (read every 30 s while a day is
// open, never inside a trade). Fake timers and a fake NEAR; no wall clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DRAWDOWN_LINE, PAUSED_ELSEWHERE_LINE, WATCH_MS } from "./agent-pocket.ts";
import { SubWallets } from "./subwallets.ts";
import { buy, pocketNode } from "./testing/pocket-tx.ts";
import { MemoryVault } from "./vault.ts";

async function wallets(balance?: () => bigint, market?: { price: (coin: string) => number | null; decimals?: number; pool?: (coin: string) => number | null }) {
  const ended: { id: string; reason: string; line?: string }[] = [];
  const w = new SubWallets({
    vault: new MemoryVault(),
    sol: market ? Object.assign(pocketNode(balance), { mintDecimals: async () => market.decimals ?? 6, ...(market.pool ? { poolPrice: async (coin: string) => market.pool!(coin) } : {}) }) : pocketNode(balance),
    ...(market ? { marketPrice: async (_c: string, coin: string) => market.price(coin) } : {}),
    evm: {} as never,
    usdPrice: async (c) => (c === "sol" ? 150 : null),
    approve: async () => true,
    emit: (e, p) => void (e === "subwallet.session.ended" && ended.push(p as { id: string; reason: string; line?: string })),
    // D107's pocket on the SOL row: AgentZero's own wallet explicitly off (on, its leg is agent/sol: agent-sandbox.test.ts)
    agentWallet: { on: false },
  });
  const pocket = await w.agentSolRow();
  return { w, pocket, ended };
}
const refusedWith = (re: RegExp) => (e: any) => e?.problem?.code === "security.subwallet.refused" && re.test(String(e.problem.more));

test("item 9: the pocket's value falls under 85% of the day's peak: the trade is refused, the day ends with its line; control: a fall to 86% trades on", async () => {
  let sol = 10_000_000_000n; // 10 SOL at $150: $1,500
  const { w, pocket, ended } = await wallets(() => sol);
  await w.agentPocketStart(5, 50, 60);
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 5))), "peak $1,500");
  sol = 8_600_000_000n; // $1,290 SOL + $5 of coins at cost: 86.3%
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 5))), "control: 86% trades on");
  sol = 8_400_000_000n; // $1,260 + $10: 84.7%
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 5)), refusedWith(/^Stopped\. Your SOL wallet fell 15% today\./));
  assert.deepEqual(ended.at(-1), { id: "agentzero-pocket", reason: "drawdown", line: DRAWDOWN_LINE });
  sol = 10_000_000_000n;
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 1)), refusedWith(/isn't approved/), "the day is over, even if the value comes back");
});

test("item 9: a buy is not a fall (SOL out, coins in at their cost)", async () => {
  let sol = 10_000_000_000n;
  const { w, pocket } = await wallets(() => sol);
  await w.agentPocketStart(5, 50, 60);
  for (let i = 0; i < 8; i++) {
    assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 5))), `buy ${i}`);
    sol -= 33_333_333n; // each $5 buy took $5 of SOL
  }
});

// Audit: coins were valued at what they cost until sold, so a coin rugged to zero never tripped the stop. They are now
// valued at the market price (the core's own marketPrice); a coin with no price counts as nothing.
test("audit: a held coin rugged to zero trips the 15% stop on the next trade, though nothing was sold", async () => {
  let sol = 300_000_000n; // 0.3 SOL at $150: $45
  let coinUsd: number | null = 5_000; // a whole coin; each $5 buy brings 0.001 of it (1,000 raw at 6 decimals): $5
  const { w, pocket, ended } = await wallets(() => sol, { price: () => coinUsd });
  await w.agentPocketStart(5, 50, 60);
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 5))), "peak $45");
  sol = 266_666_667n; // $40 of SOL + the coin at $5
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 5))), "control: priced at the market, no fall");
  sol = 233_333_334n; // $35 of SOL + $10 of coins
  coinUsd = 0.0001; // rugged
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 1)), refusedWith(/^Stopped\. Your SOL wallet fell 15% today\./));
  assert.equal(ended.at(-1)?.reason, "drawdown");
});

test("audit: a held coin with no price counts as nothing (fail-safe), so its fall can't hide", async () => {
  let sol = 300_000_000n;
  let coinUsd: number | null = 5_000;
  const { w, pocket } = await wallets(() => sol, { price: () => coinUsd });
  await w.agentPocketStart(5, 50, 60);
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 5))));
  sol = 266_666_667n;
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 5))));
  sol = 233_333_334n;
  coinUsd = null;
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 1)), refusedWith(/fell 15% today/));
});

// Follow-up: most fresh pump.fun coins have no market price yet, so $0 for them stopped the day after the first copy buy.
// Such a coin is valued at its pump.fun curve's (or PumpSwap pool's) on-chain price; $0 only when it has neither.
// Review: the market's price can be a minute old, so a coin that rugged seconds ago kept its old price. A pump.fun coin
// is valued at the LOWER of the market price and its curve/pool price.
test("review: the market says $1 but the curve says $0.10: the coin is worth $0.10 and the stop fires", async () => {
  let sol = 300_000_000n; // $45
  const market = 5_000; // per whole coin (6 decimals): 1,000 raw is $5
  const curve = 33_333_333 / 1000 / 10; // the curve: a tenth of that
  const { w, pocket, ended } = await wallets(() => sol, { price: () => market, pool: () => curve });
  await w.agentPocketStart(5, 50, 60);
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 5))), "peak $45");
  sol = 266_666_667n; // $40 + the coin at $0.50 (not $5): $40.50, 90%
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 5))));
  sol = 233_333_334n; // $35 + $1.00: 80%
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 1)), refusedWith(/fell 15% today/));
  assert.equal(ended.at(-1)?.reason, "drawdown");
});

test("a fresh coin with no market price but a curve price doesn't trip the stop; its curve falling does", async () => {
  let sol = 300_000_000n; // $45
  let curve: number | null = 33_333_333 / 1000; // lamports per raw unit: 1,000 raw (one $5 buy) is $5 at $150
  const { w, pocket, ended } = await wallets(() => sol, { price: () => null, pool: () => curve });
  await w.agentPocketStart(5, 50, 60);
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 5))), "peak $45");
  sol = 266_666_667n;
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 5))), "$40 + the coin at its curve's $5");
  sol = 233_333_334n;
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 1))), "$35 + $10 on the curve: no fall");
  assert.equal(ended.length, 0);
  curve = 1; // the curve collapsed
  const { POOL_PRICE_MS } = await import("./agent-pocket.ts");
  const t0 = Date.now();
  const real = Date.now;
  Date.now = () => t0 + POOL_PRICE_MS + 1; // past the kept curve price
  try {
    await assert.rejects(w.agentPocketSign(buy(pocket.address, 1)), refusedWith(/fell 15% today/));
  } finally {
    Date.now = real;
  }
});

/** A fake timer: tick() runs every callback once. */
function fakeTimer() {
  const fns = new Set<() => void>();
  let lastMs = 0;
  return {
    every: (ms: number, f: () => void) => (lastMs = ms, fns.add(f), () => void fns.delete(f)),
    tick: async () => {
      for (const f of [...fns]) f();
      await new Promise((r) => setImmediate(r));
    },
    running: () => fns.size,
    ms: () => lastMs,
  };
}

test("a pause seen on NEAR from another device ends the day within one read, with its line; NEAR not answering keeps it and says nothing; no reading without a day", async () => {
  const { w, pocket, ended } = await wallets();
  const t = fakeTimer();
  let near: { paused?: boolean } | null | undefined = { paused: false };
  let reads = 0;
  const watch = { read: async () => (reads++, near), every: t.every };
  await w.agentPocketStart(5, 20, 60, undefined, watch);
  assert.equal(t.ms(), WATCH_MS);
  assert.equal(t.running(), 1);
  await t.tick();
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 1))), "not paused: trades on");
  near = undefined; // NEAR didn't answer
  await t.tick();
  assert.equal(ended.length, 0, "nothing said");
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 1))));
  near = { paused: true };
  await t.tick();
  assert.deepEqual(ended.at(-1), { id: "agentzero-pocket", reason: "paused-elsewhere", line: PAUSED_ELSEWHERE_LINE });
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 1)), refusedWith(/isn't approved/));
  assert.equal(t.running(), 0, "the reading stops with the day");
  const before = reads;
  await t.tick();
  assert.equal(reads, before, "no reading without a day");
});

test("a Stop on NEAR (AgentZero off) ends the day too; a Stop here stops the reading", async () => {
  const { w, ended } = await wallets();
  const t = fakeTimer();
  await w.agentPocketStart(5, 20, 60, undefined, { read: async () => null, every: t.every });
  await t.tick();
  assert.equal(ended.at(-1)!.reason, "paused-elsewhere");
  const t2 = fakeTimer();
  const b = await wallets();
  await b.w.agentPocketStart(5, 20, 60, undefined, { read: async () => ({ paused: false }), every: t2.every });
  b.w.endAgentPocket("stopped");
  assert.equal(t2.running(), 0);
});
