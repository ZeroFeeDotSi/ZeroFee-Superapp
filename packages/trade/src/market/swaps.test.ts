// The swap decoders on wallet v1's real captures, with v1's own tests and numbers (market/live/sol-decode.test.ts and
// evm-decode.test.ts there): Solana notifications and transactions of 21 Oct 2026 (fixtures/v1-live-sol.json, with
// GeckoTerminal's trending capture of the same minutes for each pool's coin and quote), and 44 swap logs of 19 BNB Chain and
// Robinhood Chain pools with each transaction's Transfers (fixtures/v1-live-evm.json). The truth each decode is checked
// against is the chain's own: the pool's vaults in the same transaction, or an ERC-20 Transfer of exactly that amount.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fx } from "./testing.ts";
import { coinIs0, decodeEvmLog, decodeLogs, decodeTx, isPoolId, kindOfProgram, MANAGERS, PROGRAMS, T, type EvmCtx, type SolCtx, type Swap } from "./swaps.ts";
import { bondingCurveOf } from "../sol/keys.ts";
import { fromBase64 } from "../sol/bytes.ts";

const SOL = fx("v1-live-sol"), TRENDING = fx("v1-trending-solana"), EVM = fx("v1-live-evm");
const tokenOf = (id: string) => ({ mint: id.replace("solana_", ""), decimals: TRENDING.included.find((i: any) => i.id === id)!.attributes.decimals as number });
/** A captured pool's coin and quote, from GeckoTerminal's trending capture of the same minutes. */
function ctxOf(name: string): SolCtx {
  const pool = SOL.pools[name], acct = SOL.accounts[pool];
  const row = TRENDING.data.find((p: any) => p.attributes.address === pool)!;
  const coin = tokenOf(row.relationships.base_token.data.id), quote = tokenOf(row.relationships.quote_token.data.id);
  return { pool, kind: kindOfProgram(acct.owner), coinMint: coin.mint, coinDecimals: coin.decimals, quoteMint: quote.mint, quoteDecimals: quote.decimals, poolData: fromBase64(acct.data) };
}
const close = (a: number, b: number, rel = 0.02) => Math.abs(a - b) <= Math.abs(b) * rel;
const cases = (kind: string): any[] => SOL.cases.filter((c: any) => c.kind === kind);

describe("Solana: the owner program names the pool type", () => {
  it("the captured pools are owned by the programs decoded", () => {
    const k = (n: string) => kindOfProgram(SOL.accounts[SOL.pools[n]].owner);
    assert.equal(k("pumpswap_PUMP_USDC"), "pumpswap");
    assert.equal(k("clmm_CARDS_USDC"), "clmm");
    assert.equal(k("cpmm_USELESS_SOL"), "cpmm");
    assert.equal(k("dlmm_STONK_SOL"), "other");
    assert.equal(SOL.accounts[SOL.pools.dlmm_STONK_SOL].owner, PROGRAMS.dlmm);
  });
});

describe("Solana: the logs agree with the pool's own vaults in the same transaction", () => {
  for (const kind of ["pumpswap-buy", "pumpswap-sell", "clmm", "cpmm"]) {
    it(`${kind}: every captured transaction (3)`, () => {
      const cs = cases(kind);
      assert.equal(cs.length, 3);
      for (const c of cs) {
        const ctx = ctxOf(c.name);
        const fast = decodeLogs(ctx, c.logs)!, truth = decodeTx(ctx, c.tx);
        assert.ok(fast.length >= 1, `${c.sig.slice(0, 8)} swaps`);
        // the sum of the log's swaps is what the vaults moved (an aggregator route can hold two swaps of the pool)
        const sum = (f: (s: Swap) => number) => fast.reduce((a, s) => a + f(s), 0);
        assert.equal(truth.length, 1, `${c.sig.slice(0, 8)} vault view`);
        assert.ok(fast.every((s) => s.side === truth[0]!.side), `${c.sig.slice(0, 8)} side`);
        assert.ok(close(sum((s) => s.coin), truth[0]!.coin, 0.03), `${c.sig.slice(0, 8)} coin ${sum((s) => s.coin)} vs ${truth[0]!.coin}`);
        assert.ok(close(sum((s) => s.quote), truth[0]!.quote, 0.05), `${c.sig.slice(0, 8)} quote ${sum((s) => s.quote)} vs ${truth[0]!.quote}`);
        if (kind.startsWith("pumpswap")) assert.match(fast[0]!.trader!, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      }
    });
  }
  it("a notification that holds another pool's event is nothing for this pool", () => {
    const c = SOL.cases.find((x: any) => x.kind === "pumpswap-sell" && x.name === "pumpswap_CATE_SOL");
    assert.deepEqual(decodeLogs({ ...ctxOf("pumpswap_CATE_SOL"), pool: SOL.pools.pumpswap_COLLECTOOOR_USDC }, c.logs), []);
  });
  it("an event another program logs (the same bytes, inside the same transaction) is never this pool's swap", () => {
    const c = cases("pumpswap-buy")[0]!;
    const ctx = ctxOf(c.name);
    const real = (c.logs as string[]).filter((l) => l.startsWith("Program data: "));
    assert.ok(decodeLogs(ctx, c.logs)!.length >= 1);
    // an attacker's program, invoked in the same transaction, logs a copy of the pool's own event
    const FAKE = "Fake111111111111111111111111111111111111111";
    const spoof = ["Program " + FAKE + " invoke [1]", ...real, "Program " + FAKE + " success"];
    assert.deepEqual(decodeLogs(ctx, spoof), [], "not from the pool's program: nothing");
    // and the real transaction with that program after it still reads its own swaps once
    assert.equal(decodeLogs(ctx, [...c.logs, ...spoof])!.length, decodeLogs(ctx, c.logs)!.length);
  });
  it("buys and sells come out the right way round", () => {
    for (const c of cases("pumpswap-buy")) assert.ok(decodeLogs(ctxOf(c.name), c.logs)!.every((s) => s.side === "buy"));
    for (const c of cases("pumpswap-sell")) assert.ok(decodeLogs(ctxOf(c.name), c.logs)!.every((s) => s.side === "sell"));
  });
  it("a CLMM swap's price is the pool's own sqrt price, within a few percent of the swap's execution price", () => {
    for (const c of cases("clmm")) {
      const [s] = decodeLogs(ctxOf(c.name), c.logs)!;
      assert.ok(s!.price! > 0);
      assert.ok(close(s!.price!, s!.quote / s!.coin, 0.05));
    }
  });
});

describe("Solana: the whole transaction, for a pool whose program emits no log event (Meteora DLMM)", () => {
  it("DLMM: no fast path; the swap comes out of the vault deltas, at STONK's price per GeckoTerminal's capture of the same minutes (2 cases)", () => {
    const cs = cases("dlmm");
    assert.equal(cs.length, 2);
    for (const c of cs) {
      const ctx = ctxOf(c.name);
      assert.equal(decodeLogs(ctx, c.logs), undefined);
      const s = decodeTx(ctx, c.tx);
      assert.equal(s.length, 1);
      assert.ok(s[0]!.coin > 0 && s[0]!.quote > 0);
      const gt = Number(TRENDING.data.find((p: any) => p.attributes.address === ctx.pool).attributes.base_token_price_native_currency);
      assert.ok(close(s[0]!.quote / s[0]!.coin, gt, 0.1), `${s[0]!.quote / s[0]!.coin} vs ${gt}`);
    }
  });
  it("a transaction that only mentions the pool (a bot reading it) is no swap", () => {
    const c = SOL.cases.find((x: any) => x.kind === "dlmm-mention-only");
    assert.deepEqual(decodeTx(ctxOf(c.name), c.tx), []);
  });
});

describe("Solana: the pump.fun curve (a coin before graduation)", () => {
  it("the TradeEvent agrees with what the curve's own accounts did: its coin vault, and its lamports (3 cases)", () => {
    const cs = cases("pumpfun");
    assert.equal(cs.length, 3);
    const curve = bondingCurveOf(SOL.pumpMint);
    const ctx: SolCtx = { pool: curve, kind: "pumpfun", coinMint: SOL.pumpMint, coinDecimals: 6, quoteMint: "So11111111111111111111111111111111111111112", quoteDecimals: 9 };
    for (const c of cs) {
      const swaps = decodeLogs(ctx, c.logs)!.filter((s) => s.coin > 0);
      assert.ok(swaps.length >= 1);
      const post = c.tx.post.find((t: any) => t.owner === curve && t.mint === SOL.pumpMint), pre = c.tx.pre.find((t: any) => t.accountIndex === post.accountIndex);
      const dCoin = (Number(post.uiTokenAmount.amount) - Number(pre.uiTokenAmount.amount)) / 1e6;
      const buys = swaps.filter((s) => s.side === "buy").reduce((a, s) => a + s.coin, 0), sells = swaps.filter((s) => s.side === "sell").reduce((a, s) => a + s.coin, 0);
      assert.ok(close(sells - buys, dCoin, 0.001), `${c.sig.slice(0, 8)} net coin ${sells - buys} vs ${dCoin}`);
      const ci = c.tx.keys.indexOf(curve);
      const dSol = (c.tx.postLamports[ci] - c.tx.preLamports[ci]) / 1e9;
      const netSol = swaps.reduce((a, s) => a + (s.side === "buy" ? s.quote : -s.quote), 0);
      assert.ok(close(netSol, dSol, 0.02), `${c.sig.slice(0, 8)} net SOL ${netSol} vs ${dSol}`);
    }
  });
  it("another coin's trade in the same notification is not ours", () => {
    const c = cases("pumpfun")[0];
    assert.deepEqual(decodeLogs({ pool: "x", kind: "pumpfun", coinMint: "So11111111111111111111111111111111111111112", coinDecimals: 6, quoteMint: "q", quoteDecimals: 9 }, c.logs), []);
  });
});

describe("BNB Chain and Robinhood Chain: every captured swap decodes and matches the chain's own Transfers", () => {
  const ctxOfE = (c: any): EvmCtx => ({ coin: c.coin.address, coinDecimals: c.coin.decimals, quoteDecimals: c.quote.decimals, coinIs0: coinIs0(c.coin.address, c.quote.address), ...(isPoolId(c.poolId) ? { poolId: c.poolId } : {}) });
  const known = (t: string) => Object.values(T).includes(t as never);
  const DEXES = ["pancakeswap_v2", "pancakeswap-v3-bsc", "uniswap-bsc", "pancakeswap-infinity-clmm", "uniswap-v4-robinhood", "pons-v2-dex", "uniswap-v3-robinhood", "ramses-v3-robinhood"];
  it("covers every dex type that was trending (44 swaps)", () => {
    const dexes = new Set(EVM.cases.map((c: any) => c.dex));
    for (const d of DEXES) assert.ok(dexes.has(d), d);
    assert.ok(EVM.cases.length >= 40);
  });
  for (const dex of [...DEXES, "uniswap-pools-trade"]) {
    it(dex, () => {
      const cs = EVM.cases.filter((c: any) => c.dex === dex);
      assert.ok(cs.length > 0);
      for (const c of cs) {
        assert.ok(known(c.log.topics[0]), `${c.name} topic`);
        const s = decodeEvmLog(ctxOfE(c), c.log);
        assert.ok(s, `${c.name} ${c.log.transactionHash.slice(0, 10)}`);
        const raw = BigInt(Math.round(s.coin * 10 ** c.coin.decimals));
        // a Transfer of the coin of the decoded amount (within 4e-9 of a token), or the sum leaving / entering one address (a hook pool pays a fee from the same delta)
        const tol = BigInt(10 ** Math.max(0, c.coin.decimals - 9)) * 4n;
        const near = (v: bigint) => (v > raw ? v - raw : raw - v) <= tol;
        const coinT = c.transfers.filter((t: any) => t.token.toLowerCase() === c.coin.address.toLowerCase());
        const sums = new Map<string, bigint>();
        for (const t of coinT) { sums.set("from:" + t.from, (sums.get("from:" + t.from) ?? 0n) + BigInt(t.value)); sums.set("to:" + t.to, (sums.get("to:" + t.to) ?? 0n) + BigInt(t.value)); }
        assert.ok(coinT.some((t: any) => near(BigInt(t.value))) || [...sums.values()].some(near), `${c.name}: no Transfer of ~${s.coin} in ${c.log.transactionHash.slice(0, 10)}`);
        // the swap's price, in dollars at the quote's GeckoTerminal price of the same minutes, is the coin's price within 10 %
        const p = (s.price ?? s.quote / s.coin) * Number(c.quoteUsd), gt = Number(c.priceUsd);
        assert.ok(Math.abs(p - gt) / gt < 0.1, `${c.name} price ${p} vs ${gt}`);
      }
    });
  }
  it("a buy is a buy: the coin leaves the pool (a Transfer from the pool of the coin)", () => {
    for (const c of EVM.cases.filter((x: any) => x.poolId.length === 42)) {
      const s = decodeEvmLog(ctxOfE(c), c.log)!;
      const t = c.transfers.find((x: any) => x.token.toLowerCase() === c.coin.address.toLowerCase() && (x.from.toLowerCase() === c.poolId.toLowerCase() || x.to.toLowerCase() === c.poolId.toLowerCase()));
      if (!t) continue;                                                     // routed through another hop in this transaction
      assert.equal(t.from.toLowerCase() === c.poolId.toLowerCase() ? "buy" : "sell", s.side, `${c.name} ${c.log.transactionHash.slice(0, 10)}`);
    }
  });
  it("a swap of another pool in the same singleton is not ours", () => {
    const c = EVM.cases.find((x: any) => x.dex === "uniswap-v4-robinhood");
    assert.equal(decodeEvmLog({ ...ctxOfE(c), poolId: "0x" + "ab".repeat(32) }, c.log), undefined);
  });
  it("the singleton managers are the contracts that emitted the captured swaps", () => {
    for (const c of EVM.cases.filter((x: any) => isPoolId(x.poolId))) {
      const m = MANAGERS[c.chain as "bsc" | "hood"];
      assert.ok([m.v4, m.infCL, m.infBin].filter(Boolean).includes(c.log.address.toLowerCase()), c.name);
    }
  });
});

describe("Solana: a transaction that only moves liquidity is no swap (found live on 27 Oct, not in v1)", () => {
  const L = fx("dlmm-launch");
  const ctx: SolCtx = { pool: L.pool, kind: kindOfProgram(L.account.owner), coinMint: L.coin, coinDecimals: L.coinDecimals, quoteMint: "So11111111111111111111111111111111111111112", quoteDecimals: 9, poolData: fromBase64(L.account.data[0]) };
  it("a Meteora DLMM RebalanceLiquidity moved the vaults opposite ways: v1's vault reading took it for a sale at 189x the price; with its logs it is nothing", async () => {
    const { slim, liquidityOnly } = await import("./swaps.ts");
    const { tx, logs } = slim(L.txs.rebalance);
    const v1 = decodeTx(ctx, tx);
    assert.equal(v1.length, 1);
    assert.ok(v1[0]!.quote / v1[0]!.coin / L.gtPriceSol > 150, "what v1 read");
    assert.ok(liquidityOnly(logs));
    assert.deepEqual(decodeTx(ctx, tx, logs), []);
  });
  it("a Swap2 of the same pool still reads, at the market's price", async () => {
    const { slim, liquidityOnly } = await import("./swaps.ts");
    const { tx, logs } = slim(L.txs.swap2);
    assert.equal(liquidityOnly(logs), false);
    const s = decodeTx(ctx, tx, logs);
    assert.equal(s.length, 1);
    assert.equal(s[0]!.side, "buy");
    assert.ok(Math.abs(s[0]!.quote / s[0]!.coin / L.gtPriceSol - 1) < 0.05, `${s[0]!.quote / s[0]!.coin}`);
  });
});
