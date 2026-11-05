// Speed (the test real-money run, 3 Nov) under the review's rule (3 Nov): subwallet.preflight makes Trade's own
// Solana transaction's NETWORK READS ahead of the tap (the blockhash, the tables, the two-node test run, the route's
// programs; a sale's coins' market price and decimals; SOL's price), kept for one signTx of those exact bytes within
// PREFLIGHT_MS. Never a verdict: at the tap every check runs again as pure computation on those reads, and the tap makes
// no network call. Controls: no preflight, other bytes, a second use, too late, another caller: read in full.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlainWords } from "./signer.ts";
import { SOL, ownTokenAccount } from "./solana.ts";
import type { SolChain } from "./solana.ts";
import { PREFLIGHT_MS, SubWallets } from "./subwallets.ts";
import { fairCoins } from "./testing/sol-coins.ts";
import { POCKET_COIN, buy, pocketNode, sell } from "./testing/pocket-tx.ts";
import { MemoryVault } from "./vault.ts";

const STRANGER = "8JVZpqUZfQMEc8kMduTS9SkVxP9v8rgunJNcV4qNYGYZ";

/** Trade's wallet on a node that counts every read; the coin a sale sells is worth `coinUsd` (6 decimals). */
async function setup(o: { coinUsd?: number | null; wsolTo?: (wallet: string) => string } = {}) {
  let reads = 0;
  const node = pocketNode();
  const sol = {
    blockhashValid: async (b: string) => (reads++, node.blockhashValid(b)),
    lookupTables: async (k: string[]) => (reads++, node.lookupTables(k)),
    simulate: async (tx: string, wallet: string, watch?: string[]) => {
      reads++;
      const r = await node.simulate(tx, wallet, watch);
      // a sale here pays its SOL into a wrapped-SOL account (the wallet's own, unless the test says otherwise)
      return o.wsolTo ? { ...r, lamportsAfter: r.lamportsBefore - 5_000n, tokens: [...fairCoins(tx), { address: o.wsolTo(wallet), mint: SOL.wsol, before: 0n, after: r.lamportsAfter - r.lamportsBefore + 5_000n }] } : r;
    },
    executable: async (k: string[]) => (reads++, k.map(() => false)),
    mintDecimals: async () => (reads++, 6),
  } as SolChain;
  const shown: PlainWords[] = [];
  const w = new SubWallets({
    vault: new MemoryVault(), sol, evm: {} as never,
    usdPrice: async (c) => (reads++, c === "sol" ? 150 : null),
    marketPrice: async () => (reads++, o.coinUsd === undefined ? 20 : o.coinUsd),
    approve: async (words) => (shown.push(words), false), emit: () => {},
  });
  const t = await w.create("trade", "sol");
  return { w, t, shown, reads: () => reads };
}

test("a tap after preflight makes zero network calls, and signs a checked buy and a checked sale (control: with no preflight the tap reads the chain)", async () => {
  for (const make of [(a: string) => buy(a, 10), (a: string) => sell(a, POCKET_COIN, 20)]) {
    const s = await setup();
    const tx = make(s.t.address);
    assert.deepEqual(await s.w.preflight(s.t.id, tx, "trade"), { ok: true });
    const before = s.reads();
    assert.ok("signedTx" in (await s.w.signTx(s.t.id, tx, "", undefined, "Trade", undefined, "trade")));
    assert.equal(s.reads() - before, 0, "no network call at the tap");
    assert.equal(s.shown.length, 0);
    // control: the same bytes again (the preflight is used once) read the chain
    const again = s.reads();
    await s.w.signTx(s.t.id, tx, "", undefined, "Trade", undefined, "trade").catch(() => undefined);
    assert.ok(s.reads() > again, "a second use reads in full");
  }
  const cold = await setup();
  const before = cold.reads();
  assert.ok("signedTx" in (await cold.w.signTx(cold.t.id, buy(cold.t.address, 10), "", undefined, "Trade", undefined, "trade")));
  assert.ok(cold.reads() > before, "control: no preflight, the tap reads");
});

test("a preflight for other bytes never lets a tap sign: a sale paying wSOL to another owner is checked in full and refused (control: the preflighted sale paying the wallet's own wSOL signs)", async () => {
  const bad = await setup({ wsolTo: () => ownTokenAccount(STRANGER, SOL.wsol) });
  const good = sell(bad.t.address, POCKET_COIN, 20);
  assert.deepEqual(await bad.w.preflight(bad.t.id, buy(bad.t.address, 10), "trade"), { ok: true }, "a preflight of other bytes");
  const before = bad.reads();
  await assert.rejects(bad.w.signTx(bad.t.id, good, "", undefined, "Trade", undefined, "trade"), (e: any) => e.problem?.code === "security.trade.not-signed" && /Nothing was signed\.$/.test(e.problem.more));
  assert.ok(bad.reads() > before, "checked in full, not on another transaction's reads");
  // the same rule on a preflight of these very bytes: the check runs again on its reads, and refuses
  await bad.w.preflight(bad.t.id, good, "trade");
  await assert.rejects(bad.w.signTx(bad.t.id, good, "", undefined, "Trade", undefined, "trade"), (e: any) => e.problem?.code === "security.trade.not-signed");
  // control: the wallet's own wSOL account
  const ok = await setup({ wsolTo: (wallet) => ownTokenAccount(wallet, SOL.wsol) });
  const tx = sell(ok.t.address, POCKET_COIN, 20);
  await ok.w.preflight(ok.t.id, tx, "trade");
  const at = ok.reads();
  assert.ok("signedTx" in (await ok.w.signTx(ok.t.id, tx, "", undefined, "Trade", undefined, "trade")));
  assert.equal(ok.reads() - at, 0);
});

test("never a cached verdict: the one cap and B1's market price run again at the tap on the preflight's reads; a curve sale with no market price is worth what its curve gives back, with no network call", async () => {
  // the cap: five $95 buys fill the day; a preflighted sixth asks at the tap
  const s = await setup();
  const sixth = buy(s.t.address, 95);
  assert.deepEqual(await s.w.preflight(s.t.id, sixth, "trade"), { ok: true });
  for (let i = 0; i < 5; i++) assert.ok("signedTx" in (await s.w.signTx(s.t.id, buy(s.t.address, 95 - i * 0.01), "", undefined, "Trade", undefined, "trade")));
  await s.w.preflight(s.t.id, sixth, "trade");
  const before = s.reads();
  assert.deepEqual(await s.w.signTx(s.t.id, sixth, "", undefined, "Trade", undefined, "trade"), { declined: true });
  assert.equal(s.shown.at(-1)!.warnings[0]?.text, "It's past $500 in a day, so ZeroFee asks you.");
  assert.equal(s.reads() - before, 0);
  // B1 at the tap: the coin's price kept by the preflight ($3,000 a coin) makes a $20 sale a thin-pool dump: refused
  const thin = await setup({ coinUsd: 3000 });
  const dump = sell(thin.t.address, POCKET_COIN, 20);
  await thin.w.preflight(thin.t.id, dump, "trade");
  await assert.rejects(thin.w.signTx(thin.t.id, dump, "", undefined, "Trade", undefined, "trade"), (e: any) => /^It brings back much less than the coin is worth\./.test(e.problem?.more));
  // no market price for the coin at preflight: a pump.fun curve sale is worth what its one curve gives back (decision H),
  // still checked and counted at the tap, and the tap reads nothing to look again
  const none = await setup({ coinUsd: null });
  const tx = sell(none.t.address, POCKET_COIN, 20);
  await none.w.preflight(none.t.id, tx, "trade");
  const at = none.reads();
  assert.ok("signedTx" in (await none.w.signTx(none.t.id, tx, "", undefined, "Trade", undefined, "trade")));
  assert.equal(none.shown.length, 0);
  assert.equal(none.reads() - at, 0, "no network call at the tap");
});

test("only Trade's own calls are preflighted; another app, a site or another wallet's id keeps nothing (control: Trade's own is kept)", async () => {
  const s = await setup();
  const tx = buy(s.t.address, 10);
  assert.deepEqual(await s.w.preflight(s.t.id, tx, "browser"), { ok: false });
  assert.deepEqual(await s.w.preflight(s.t.id, tx, "trade", { origin: "https://pump.fun" }), { ok: false });
  assert.deepEqual(await s.w.preflight(s.t.id, tx, undefined), { ok: false });
  const before = s.reads();
  await s.w.signTx(s.t.id, tx, "", undefined, "Trade", undefined, "trade");
  assert.ok(s.reads() > before, "nothing was kept for them");
  assert.ok(PREFLIGHT_MS <= 10_000);
});

test("product decision, 4 Nov (a sale put up the sheet): a price the preflight kept that would age past 30 s before the tap is read again at the preflight, so the tap signs with no sheet and no network call (control: on main the tap found it stale and asked)", async () => {
  const realNow = Date.now;
  let t = realNow();
  Date.now = () => t;
  try {
    for (const make of [(a: string) => sell(a, POCKET_COIN, 20), (a: string) => buy(a, 10)]) {
      const s = await setup();
      // the first quote warms SOL's price and the coin's (kept 30 s)
      await s.w.preflight(s.t.id, make(s.t.address), "trade");
      // 25 s later the sheet's refresh preflights new bytes; the tap comes 8 s after that (33 s after the first read)
      t += 25_000;
      const tx = make(s.t.address) + "";
      await s.w.preflight(s.t.id, tx, "trade");
      t += 8_000;
      const before = s.reads();
      const r = await s.w.signTx(s.t.id, tx, "", undefined, "Trade", undefined, "trade");
      assert.ok("signedTx" in r, "signed with no sheet");
      assert.equal(s.shown.length, 0);
      assert.equal(s.reads() - before, 0, "no network call at the tap");
    }
  } finally {
    Date.now = realNow;
  }
});

test("decision H: Trade's own pump.fun curve sale of a coin the market has no price for yet signs with no sheet, counted against the one cap at what the curve gives back (controls: over $100 and another app's call ask on the one-tap sheet; a floor under 80 % is refused by name)", async () => {
  const s = await setup({ coinUsd: null });
  const tx = sell(s.t.address, POCKET_COIN, 20);
  assert.ok("signedTx" in (await s.w.signTx(s.t.id, tx, "", undefined, "Trade", undefined, "trade")), "a fresh launch's sale: silent");
  assert.equal(s.shown.length, 0);
  // counted: $20 of the day's $500 is gone (the cap check reads what is left)
  assert.ok((await s.w.capCheck(0)).leftTodayUsd <= 480.01);
  // a floor that keeps under 80 % of it: refused by name, as before (nothing signed, nothing asked)
  await assert.rejects(s.w.signTx(s.t.id, sell(s.t.address, POCKET_COIN, 20, 75n), "", undefined, "Trade", undefined, "trade"), (e: any) => /over 20% less/.test(e.problem?.more));
  assert.equal(s.shown.length, 0);
  // over the $100 cap: the one-tap sheet, by its curve dollars
  assert.deepEqual(await s.w.signTx(s.t.id, sell(s.t.address, POCKET_COIN, 150), "", undefined, "Trade", undefined, "trade"), { declined: true });
  assert.equal(s.shown.at(-1)!.warnings[0]?.text, "It's over $100, so ZeroFee asks you.");
  assert.equal(s.shown.at(-1)!.tap, true, "one tap, never Face ID");
  // another app's call is not Trade's own flow: as before, the sheet
  const n = s.shown.length;
  await s.w.signTx(s.t.id, sell(s.t.address, POCKET_COIN, 20), "", undefined, "Browser", undefined, "browser").catch(() => undefined);
  assert.equal(s.shown.length, n + 1, "another app: asked");
});
