// Re-review B1 (3 Nov): a no-sheet sale is valued at the coin's market price, never only at the SOL its own pool gives
// back. A thin pool the asker made would turn a $3,000 bag into a "$2 sale" that signs with no sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlainWords } from "./signer.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { POCKET_COIN, pocketNode, sell } from "./testing/pocket-tx.ts";
import { SOL, ownTokenAccount } from "./solana.ts";
import { fairCoins } from "./testing/sol-coins.ts";

/** Trade's wallet; the coin sold is worth `coinUsd` a whole coin (6 decimals), or has no price (null). */
async function core(coinUsd: number | null) {
  const shown: PlainWords[] = [];
  const sol = { ...pocketNode(), executable: async (keys: string[]) => keys.map(() => false), mintDecimals: async () => 6 } as SolChain;
  const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {} as never, usdPrice: async (c) => (c === "sol" ? 150 : null), marketPrice: async () => coinUsd, approve: async (words) => (shown.push(words), false), emit: () => {} });
  return { w, shown, t: await w.create("trade", "sol") };
}

test("re-review B1: a sale into a thin pool (1,000,000 units of a coin worth $3,000 brought back as $2 of SOL) is refused in the person's own flow and never signs with no sheet; no market price: a pump.fun curve sale is its curve's dollars (controls: the same sale at its fair price signs with no sheet)", async () => {
  // pocket-tx's sale sells 1,000,000 raw units (1 whole coin at 6 decimals)
  const thin = await core(3000);
  await assert.rejects(thin.w.signTx(thin.t.id, sell(thin.t.address, POCKET_COIN, 2), "", undefined, "Trade", undefined, "trade"), (e: any) => e.problem?.code === "security.trade.not-signed" && /^It brings back much less than the coin is worth\. Nothing was signed\.$/.test(e.problem.more));
  assert.equal(thin.shown.length, 0, "refused, never signed");
  // a fair sale of a $3,000 bag is still over the $100 cap: asked, never silent
  assert.deepEqual(await thin.w.signTx(thin.t.id, sell(thin.t.address, POCKET_COIN, 3000), "", undefined, "Trade", undefined, "trade"), { declined: true });
  assert.equal(thin.shown.at(-1)!.warnings[0]?.text, "It's over $100, so ZeroFee asks you.");
  // no market price for the coin (a fresh launch): decision H (product decision, 4 Nov): Trade's own pump.fun curve sale is worth
  // what the coin's one curve gives back (no thin pool can be made there), so $20 signs with no sheet; past the cap, asked
  // (preflight.test.ts has the rest of that case)
  const none = await core(null);
  assert.ok("signedTx" in (await none.w.signTx(none.t.id, sell(none.t.address, POCKET_COIN, 20), "", undefined, "Trade", undefined, "trade")));
  assert.equal(none.shown.length, 0);
  assert.deepEqual(await none.w.signTx(none.t.id, sell(none.t.address, POCKET_COIN, 150), "", undefined, "Trade", undefined, "trade"), { declined: true });
  assert.equal(none.shown.at(-1)!.warnings[0]?.text, "It's over $100, so ZeroFee asks you.");
  // control: a $20 coin sold for $20 of SOL signs with no sheet
  const fair = await core(20);
  assert.ok("signedTx" in (await fair.w.signTx(fair.t.id, sell(fair.t.address, POCKET_COIN, 20), "", undefined, "Trade", undefined, "trade")));
  assert.equal(fair.shown.length, 0);
});

test("re-review B1 (ship fix): a sale paid into the wallet's OWN wrapped-SOL account counts as SOL back, so a fair one signs with no sheet (control: the wSOL landing in another owner's account isn't counted, and the sale is refused)", async () => {
  // a $20 coin sold for 0.1333 SOL ($20) paid as wSOL: the wallet's own SOL only pays the fee
  const run = async (to: (wallet: string) => string) => {
    const shown: PlainWords[] = [];
    const sol = {
      ...pocketNode(),
      executable: async (keys: string[]) => keys.map(() => false),
      mintDecimals: async () => 6,
      simulate: async (tx: string, wallet: string) => ({ ok: true, agreed: true, lamportsBefore: 10_000_000_000n, lamportsAfter: 10_000_000_000n - 5_000n, tokens: [...fairCoins(tx), { address: to(wallet), mint: SOL.wsol, before: 0n, after: 133_333_333n }] }),
    } as SolChain;
    const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {} as never, usdPrice: async (c) => (c === "sol" ? 150 : null), marketPrice: async () => 20, approve: async (words) => (shown.push(words), false), emit: () => {} });
    const t = await w.create("trade", "sol");
    return { shown, out: await w.signTx(t.id, sell(t.address, POCKET_COIN, 20), "", undefined, "Trade", undefined, "trade").then((r) => ("signedTx" in r ? "signed" : "declined"), (e: any) => e.problem?.more as string) };
  };
  const own = await run((wallet) => ownTokenAccount(wallet, SOL.wsol));
  assert.deepEqual([own.out, own.shown.length], ["signed", 0], "its own wSOL account: SOL back, no sheet");
  const other = await run(() => ownTokenAccount("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", SOL.wsol));
  assert.equal(other.out, "It doesn't show what the sale brings back. Nothing was signed.", "another owner's wSOL account counts for nothing: refused by name");
  assert.equal(other.shown.length, 0);
});
