// The coverage audit, 3 Nov: a Raydium CLMM buy (MPLX, through Jupiter) was refused, "The two Solana servers didn't agree
// on it": the SOL out agreed to the lamport, the coin in was 5,968,186 on one node and 5,967,459 on the other (1-3 slots
// apart; the pool moved between them). The coin the trade pays the wallet now agrees within the SOL's own 1 %, coming in
// on both nodes, held to the fewer; every other account must agree exactly (a security read).
import { test } from "node:test";
import assert from "node:assert/strict";
import { coinsAgree, COIN_DRIFT_BPS, SOL } from "./solana.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { POCKET_COIN, buy, pocketNode } from "./testing/pocket-tx.ts";

const ACC = "GQz5rj7eD8ZVBPrv5YQDaaxEvgL92xLYAbG8aujC5N4a", MPLX = "METAewgxyPbgwsseH8T16a39CQ5VyVxZi9zXiDPY18m", OTHER = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const c = (after: bigint, before = 0n, mint = MPLX, address = ACC) => ({ address, mint, before, after });

test("the audit's MPLX buy: the coin it pays the wallet, 0.012 % apart on two nodes, agrees, held to the fewer (controls: exactly equal agrees as before; the same drift on a coin the trade doesn't pay is no agreement)", () => {
  assert.deepEqual(coinsAgree([c(5_968_186n)], [c(5_967_459n)], [MPLX]), [c(5_967_459n)]);
  assert.deepEqual(coinsAgree([c(5_967_459n)], [c(5_968_186n)], [MPLX]), [c(5_967_459n)], "either order: the fewer");
  assert.deepEqual(coinsAgree([c(7n)], [c(7n)]), [c(7n)]);
  assert.deepEqual(coinsAgree([], []), []);
  assert.equal(coinsAgree([c(5_968_186n)], [c(5_967_459n)], [OTHER]), null, "not the coin the trade pays: exactly, or nothing");
  assert.equal(coinsAgree([c(5_968_186n)], [c(5_967_459n)]), null, "no coin named as paid: exactly, or nothing");
});

test("the 1 % bound on the coin in: at it agrees, past it not", () => {
  assert.equal(COIN_DRIFT_BPS, 100n);
  assert.ok(coinsAgree([c(10_000n)], [c(9_900n)], [MPLX]), "exactly 1 % apart");
  assert.equal(coinsAgree([c(10_000n)], [c(9_899n)], [MPLX]), null, "past 1 %");
});

test("never any drift on a coin going out (a sale's coin, or a drain): exactly, or no agreement, even when it is the coin the trade pays", () => {
  assert.equal(coinsAgree([c(0n, 1_000n)], [c(5n, 1_000n)], [MPLX]), null, "0.5 % apart on a coin out");
  assert.deepEqual(coinsAgree([c(0n, 1_000n)], [c(0n, 1_000n)], [MPLX]), [c(0n, 1_000n)], "control: exactly equal agrees");
});

test("never agreement on a different shape: another account, another coin, another amount before, in on one and out on the other, a move on one and none on the other, one node's coin missing", () => {
  assert.equal(coinsAgree([c(100n)], [c(100n, 0n, MPLX, OTHER)], [MPLX]), null, "another account");
  assert.equal(coinsAgree([c(100n)], [c(100n, 0n, OTHER)], [MPLX]), null, "another coin");
  assert.equal(coinsAgree([c(100n, 5n)], [c(100n, 6n)], [MPLX]), null, "another amount before");
  assert.equal(coinsAgree([c(1_005n, 1_000n)], [c(995n, 1_000n)], [MPLX]), null, "in on one, out on the other");
  assert.equal(coinsAgree([c(1_000n, 1_000n)], [c(1_001n, 1_000n)], [MPLX]), null, "no move on one, a move on the other");
  assert.equal(coinsAgree([c(100n), c(5n, 0n, OTHER, OTHER)], [c(100n)], [MPLX]), null, "one node shows a coin the other doesn't");
});

test("a control: a buy whose test run also takes 0.5 % of another of the wallet's coins, the same on both nodes, is refused, never signed (control: the same buy without it signs)", async () => {
  for (const drain of [true, false]) {
    const node = pocketNode();
    const other = { address: "Fy1fFNs6hk1sWwAeDPXizTF2MtDjWKqDqjDA7YQSRUo4", mint: OTHER, before: 1_000_000n, after: 995_000n };
    const sol = { ...node, executable: async (keys: string[]) => keys.map(() => false), mintDecimals: async () => 6,
      simulate: async (tx: string, wallet: string, watch?: string[], o?: { received?: string[] }) => {
        assert.deepEqual(o?.received, [POCKET_COIN], "the core names the buy's own coin, from the bytes, as the only one paid");
        const r = await node.simulate(tx, wallet, watch, o);
        return drain ? { ...r, tokens: [...(r.tokens ?? []), other] } : r;
      } } as SolChain;
    const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {} as never, usdPrice: async (k) => (k === "sol" ? 150 : null), marketPrice: async () => 20, approve: async () => false, emit: () => {} });
    const t = await w.create("trade", "sol");
    const r = await w.signTx(t.id, buy(t.address, 10), "", undefined, "Trade", undefined, "trade").then((x) => x, (e: { problem?: { code?: string } }) => e.problem?.code);
    if (drain) assert.equal(r, "security.trade.not-signed", "a coin taken that the trade doesn't pay for: refused");
    else assert.ok(typeof r === "object" && r !== null && "signedTx" in r, "control: signs");
  }
  assert.ok(POCKET_COIN && SOL.wsol);
});
