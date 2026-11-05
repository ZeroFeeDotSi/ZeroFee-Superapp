// The test real-money run (4 Nov): selling all of a coin ~1 s after its buy landed was refused twice, "Solana's test
// run of it didn't go through", and went through a few seconds later: the test run ran on a node that hadn't seen the buy.
// Trade now tells the core the slot its wallet's last trade landed in (minSlot); the core keeps it for that wallet and
// every test run of it after is on state at or after that slot (SolChain.simulate minSlot). Controls: no slot, nothing
// changes; a preflight read before a later landed trade is read again; a bad slot, or one from anyone but Trade, is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { POCKET_COIN, buy, pocketNode, sell } from "./testing/pocket-tx.ts";
import { MemoryVault } from "./vault.ts";

const UNREACHED = 900_000_000_000;
async function setup() {
  const node = pocketNode();
  const slots: (number | undefined)[] = [];
  const sol = {
    blockhashValid: (b: string) => node.blockhashValid(b),
    lookupTables: (k: string[]) => node.lookupTables(k),
    // a slot past UNREACHED: every node still behind after its tries (RpcSolChain.simulate's behind)
    simulate: async (tx: string, wallet: string, watch?: string[], o?: { minSlot?: number }) => (slots.push(o?.minSlot), o?.minSlot !== undefined && o.minSlot >= UNREACHED ? { ok: false, agreed: false, lamportsBefore: 0n, lamportsAfter: 0n, servers: 0, behind: true as const } : node.simulate(tx, wallet, watch)),
    executable: async (k: string[]) => k.map(() => false),
    mintDecimals: async () => 6,
  } as SolChain;
  const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {} as never, usdPrice: async (c) => (c === "sol" ? 150 : null), marketPrice: async () => 20, approve: async () => false, emit: () => {} });
  const t = await w.create("trade", "sol");
  const sign = (tx: string, minSlot?: unknown) => w.signTx(t.id, tx, "", undefined, "Trade", undefined, "trade", undefined, undefined, minSlot);
  return { w, t, slots, sign };
}

test("Trade's landed slot reaches the test run, and stays the wallet's for its next trades; the highest wins (control: with no landed trade, no slot)", async () => {
  const s = await setup();
  assert.ok("signedTx" in (await s.sign(buy(s.t.address, 10))));
  assert.deepEqual(s.slots, [undefined], "control: no landed trade, the test run as before");
  assert.ok("signedTx" in (await s.sign(sell(s.t.address, POCKET_COIN, 20), 465_000_100)));
  assert.equal(s.slots.at(-1), 465_000_100, "the sale runs at or after the buy's slot");
  await s.sign(buy(s.t.address, 11));
  assert.equal(s.slots.at(-1), 465_000_100, "the wallet's record holds for a call that doesn't say it");
  await s.sign(buy(s.t.address, 12), 465_000_050);
  assert.equal(s.slots.at(-1), 465_000_100, "an older slot never lowers it");
});

test("a preflight read before a later landed trade is read again at the tap (control: one read at the same slot is used, no read)", async () => {
  const s = await setup();
  const tx = sell(s.t.address, POCKET_COIN, 20);
  assert.deepEqual(await s.w.preflight(s.t.id, tx, "trade"), { ok: true });
  assert.deepEqual(s.slots, [undefined]);
  assert.ok("signedTx" in (await s.sign(tx, 465_000_200)));
  assert.deepEqual(s.slots, [undefined, 465_000_200], "read again, at or after the landed slot");
  // control: the preflight made at that slot is the tap's
  const tx2 = sell(s.t.address, POCKET_COIN, 21);
  assert.deepEqual(await s.w.preflight(s.t.id, tx2, "trade", undefined, 465_000_200), { ok: true });
  const n = s.slots.length;
  assert.ok("signedTx" in (await s.sign(tx2, 465_000_200)));
  assert.equal(s.slots.length, n, "no read at the tap");
  assert.equal(s.slots.at(-1), 465_000_200);
});

test("a slot that isn't a positive whole number, or from anyone but Trade's own call, is refused and nothing is signed", async () => {
  const s = await setup();
  for (const bad of ["465000000", -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
    await assert.rejects(s.sign(buy(s.t.address, 10), bad), (e: any) => e.problem?.code === "security.request.invalid", String(bad));
  }
  await assert.rejects(s.w.signTx(s.t.id, buy(s.t.address, 10), "", undefined, "Browser", undefined, "browser", undefined, undefined, 465_000_000), (e: any) => e.problem?.code === "security.request.invalid");
  assert.deepEqual(s.slots, [], "no test run, nothing signed");
});

test("a code review: a slot no node reaches costs one refusal, then is dropped: the next tap without a slot runs as before (control: a slot nodes reach stays)", async () => {
  const s = await setup();
  await assert.rejects(s.sign(sell(s.t.address, POCKET_COIN, 20), UNREACHED), (e: any) => e.problem?.code === "security.trade.not-signed" && /test run/.test(e.problem.more), "refused once, nothing signed");
  assert.ok("signedTx" in (await s.sign(sell(s.t.address, POCKET_COIN, 21))), "the next tap signs");
  assert.deepEqual(s.slots, [UNREACHED, undefined], "the next test run asks no slot");
  // control: a slot the nodes reach is kept for the next tap
  await s.sign(buy(s.t.address, 10), 465_000_300);
  await s.sign(buy(s.t.address, 11));
  assert.deepEqual(s.slots.slice(-2), [465_000_300, 465_000_300]);
});
