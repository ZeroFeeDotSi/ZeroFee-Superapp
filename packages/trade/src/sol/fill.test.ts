// What a landed Solana trade did, from the chain's own record (getTransaction, jsonParsed): the amounts a position books.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSolChain } from "./chain.ts";
import { TEST_OWNER } from "./testing/replay.ts";
import type { Prepared } from "../types.ts";

const MINT = "CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp", ATA = "AtaOfTheCoin11111111111111111111111111111111", POOL = "PooL1111111111111111111111111111111111111111";
const RENT = 2_039_280n, FEE = 5_000n, PAID = 31_000_000n;
/** A full sale's record: the wallet's coin account (index 1) closes, its rent comes back to the wallet with the swap's SOL. */
const fullSale = {
  meta: {
    err: null, fee: Number(FEE),
    preBalances: [1_000_000_000, Number(RENT), 0], postBalances: [Number(1_000_000_000n + PAID + RENT - FEE), 0, 0],
    preTokenBalances: [{ accountIndex: 1, owner: TEST_OWNER, mint: MINT, uiTokenAmount: { amount: "5000000" } }],
    postTokenBalances: [],
  },
  transaction: { message: { accountKeys: [{ pubkey: TEST_OWNER }, { pubkey: ATA }, { pubkey: POOL }] } },
};
const chainWith = (tx: unknown) => createSolChain({ owner: TEST_OWNER, solUsd: async () => 100, rpc: { call: async () => { throw new Error("no call"); }, askNodes: async () => [{ ok: true, value: tx }] } as never });
const sale = { key: "k", at: 0, steps: [], ready: async () => {}, quote: { side: "sell", chain: "sol", coin: MINT, symbol: "CARDS", decimals: 6, payRaw: "5000000", payUsd: 3, getRaw: "31000000", getUsd: 3.1, getMinRaw: "30000000", feeRaw: "5000", feeUsd: 0, route: "pump.fun", slippageBps: 300, expiresAt: 0 } } as unknown as Prepared;

test("SOL-6: a full sale's proceeds are what the swap paid; the closed coin account's rent is the wallet's own, said apart", async () => {
  const f = await chainWith(fullSale).fill(sale, "sig");
  assert.ok(f);
  assert.equal(f.got, PAID.toString(), "the swap's SOL, not the rent with it");
  assert.equal(f.rentBack, RENT.toString());
  assert.equal(f.spent, "5000000");
  // a half sale closes nothing: nothing to set apart
  const half = structuredClone(fullSale);
  half.meta.postBalances = [Number(1_000_000_000n + PAID - FEE), Number(RENT), 0];
  (half.meta as { postTokenBalances: unknown[] }).postTokenBalances = [{ accountIndex: 1, owner: TEST_OWNER, mint: MINT, uiTokenAmount: { amount: "2500000" } }];
  const h = await chainWith(half).fill(sale, "sig");
  assert.equal(h?.got, PAID.toString());
  assert.equal(h?.rentBack, undefined);
});

test("k-trade test, 4 Nov (MOGMAS, the chain's own figures): a first PumpSwap buy's coin, deposit, one-time account and fee are said apart and add up to what left the wallet", async () => {
  const { userVolumeAccumulator, PROGRAM } = await import("./keys.ts");
  const VOL = userVolumeAccumulator(PROGRAM.pumpAmm, TEST_OWNER), DEP = 1_513_840, SETUP = 1_346_200, SWAP = 10_377_750, FEE15 = 15_000;
  const pre = 39_733_746, post = pre - FEE15 - DEP - SETUP - SWAP;
  const buyTx = {
    meta: {
      err: null, fee: FEE15,
      preBalances: [pre, 0, 71_687_436_431, 0], postBalances: [post, DEP, 71_687_436_431 + SWAP, SETUP],
      preTokenBalances: [], postTokenBalances: [{ accountIndex: 1, owner: TEST_OWNER, mint: MINT, uiTokenAmount: { amount: "9000000" } }],
    },
    transaction: { message: { accountKeys: [{ pubkey: TEST_OWNER }, { pubkey: ATA }, { pubkey: POOL }, { pubkey: VOL }] } },
  };
  const buy = { ...sale, quote: { ...sale.quote, side: "buy", payRaw: String(SWAP), getRaw: "9000000" } } as Prepared;
  const f = await chainWith(buyTx).fill(buy, "sig");
  assert.ok(f);
  assert.equal(f.spent, String(SWAP), "the coin's part only: $1.00, not $1.13 (the one-time account in it) or $1.28");
  assert.equal(f.rentPaid, String(DEP));
  assert.equal(f.setupPaid, String(SETUP));
  assert.equal(BigInt(f.spent) + BigInt(f.fee) + BigInt(f.rentPaid!) + BigInt(f.setupPaid!), BigInt(pre - post), "the parts are the chain's figure");
  // control: a later buy (the account already there) pays no one-time account
  const later = structuredClone(buyTx);
  later.meta.preBalances[3] = SETUP;
  const g = await chainWith(later).fill(buy, "sig");
  assert.equal(g?.setupPaid, undefined);
  assert.equal(g?.spent, String(SWAP + SETUP));
});
