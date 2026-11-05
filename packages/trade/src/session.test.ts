// The tap against Security's real separate wallets (core/subwallets.ts) and the core's own rule, with only the chain
// stubbed. D143 (product decision, 3 Nov): a hot key never asks. Every trade Trade builds signs with no sheet and no Face ID when the
// core's checks pass, whatever its size and however many came before; one they don't pass is refused by name (the
// core's Problem, "... Nothing was signed."), nothing is sent, and the line under the pill said so before the tap.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { ProblemError } from "@zerofee/core/problem";
import type { PlainWords } from "@zerofee/core/signer";
import { SOL, sessionRefusal, type SolChain } from "@zerofee/core/solana";
import { SubWallets } from "@zerofee/core/subwallets";
import { MemoryVault } from "@zerofee/core/vault";
import { createTradeService, SESSION } from "./service.ts";
import { ataOf } from "./sol/keys.ts";
import { buildTx, createAtaIdempotent, ix, wrapSol } from "./sol/tx.ts";
import type { ChainEngine, Prepared } from "./types.ts";
import { fairCoins } from "@zerofee/core/testing/sol-coins";
import { base58 } from "@zerofee/core/sol/bytes";

const SOL_USD = 100;
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
/** What a new coin account's rent and the fee take on top of the amount (the core counts all of it against the caps). */
const RENT = 2_039_280n, FEE = 5_000n + 50_000n;
const lamports = (usd: number) => BigInt(Math.round((usd / SOL_USD) * 1e9));

/** Builds what Trade builds for this wallet: open its own coin account, then the venue's swap (pump.fun, or a Jupiter route for "JUP…" coins). */
function engineFor(owner: string, out: Map<string, bigint>, sent: string[]): ChainEngine {
  let n = 0;
  return {
    chain: "sol", owner,
    async prepare(side, coin, amount) {
      // a sale in these tests: "fraction" carries its dollars / 1000 (the stub has no pool to price it)
      const usd = "usd" in amount ? amount.usd : "fraction" in amount ? amount.fraction * 1000 : 0, pay = lamports(usd);
      const venue = coin.startsWith("JUP") ? SOL.jupiter : PUMP;
      // pump.fun's own instruction bytes (buy_exact_quote_in_v3 / sell_v3: discriminator, what goes in, the floor), as
      // the core decodes them: the core signs only a swap it can read (Security, audit SOL-1). This stub's Jupiter step
      // is one byte, a route no one can read. A "Wide..." coin's sale has a floor half what it brings back.
      n++;
      const floor = side === "buy" ? 990_000n : coin.startsWith("Wide") ? pay / 2n : (pay * 99n) / 100n;
      const u64 = (v: bigint) => Array.from({ length: 8 }, (_, i) => Number((v >> BigInt(8 * i)) & 0xffn));
      const disc = side === "buy" ? [0xe1, 0xf7, 0x50, 0x1e, 0xd5, 0xb3, 0x84, 0x88] : [0x1c, 0x92, 0xde, 0x77, 0x26, 0xc4, 0x69, 0xd5];
      const data = venue === PUMP ? [...disc, ...u64(side === "buy" ? pay : 1_000_000n), ...u64(floor)] : [n];
      // as Trade builds it (direct.ts): the coin's mint where the core reads it, and a buy pays from the wallet's own wSOL
      // account, wrapped first (the core reads a buy only when it wraps SOL: audit W-9)
      // pump.fun's own 17 accounts as Trade's curveSwapIx lays them out (the core's payout check reads where it pays:
      // the wallet's own coin account @9 and its own wSOL account @10); a "JUP…" coin keeps a one-byte stand-in route
      const stand = (b: number) => ({ pubkey: base58(new Uint8Array(32).fill(b)), isSigner: false, isWritable: true });
      const keys = venue === PUMP
        ? [stand(0x61), { pubkey: coin, isSigner: false, isWritable: false }, { pubkey: SOL.wsol, isSigner: false, isWritable: false }, { pubkey: SOL.token, isSigner: false, isWritable: false }, { pubkey: SOL.token, isSigner: false, isWritable: false }, stand(0x62), stand(0x63), stand(0x64), { pubkey: owner, isSigner: true, isWritable: true }, { pubkey: ataOf(owner, coin, SOL.token), isSigner: false, isWritable: true }, { pubkey: ataOf(owner, SOL.wsol, SOL.token), isSigner: false, isWritable: true }, stand(0x65), stand(0x66), stand(0x67), { pubkey: SOL.system, isSigner: false, isWritable: false }, stand(0x68), { pubkey: PUMP, isSigner: false, isWritable: false }]
        : [{ pubkey: owner, isSigner: true, isWritable: true }, { pubkey: coin, isSigner: false, isWritable: false }, { pubkey: ataOf(owner, coin, SOL.token), isSigner: false, isWritable: true }];
      const swap = ix(venue, keys, data);
      const wrap = side === "buy" ? wrapSol(owner, ataOf(owner, SOL.wsol, SOL.token), pay) : [];
      const tx = buildTx(owner, BLOCKHASH, [createAtaIdempotent(owner, owner, coin, SOL.token), ...wrap, swap]);
      // a buy spends the amount, the new coin account's rent and the fee; a sale brings the amount back, less the fee
      out.set(tx, side === "buy" ? pay + RENT + FEE : FEE - pay);
      const p: Prepared = {
        key: `k${n}`, at: 0, ready: async () => {}, steps: [{ id: "swap", tx, lastValidBlockHeight: 1000 }],
        quote: { side, chain: "sol", coin, symbol: "PUMPE", decimals: 6, payRaw: pay.toString(), payUsd: usd, getRaw: side === "buy" ? "1000000" : pay.toString(), getUsd: usd, getMinRaw: floor.toString(), feeRaw: (RENT + FEE).toString(), feeUsd: 0.25, route: venue === PUMP ? "pump.fun" : "Jupiter", slippageBps: 300, expiresAt: Date.now() + 60_000 },
      };
      return p;
    },
    txHash: () => `sig${n}`,
    async send(tx) { sent.push(tx); return `sig${n}`; },
    async status() { return "confirmed"; },
    async fill(p, hash) { return { txHash: hash, got: p.quote.getRaw, spent: p.quote.payRaw, fee: FEE.toString() }; },
    async holdings() { return { native: "10000000000", coins: [] }; },
    poolChanged() {},
  };
}

function setup() {
  const sheets: PlainWords[] = [], answers: boolean[] = [], out = new Map<string, bigint>(), starts: Record<string, unknown>[] = [], sent: string[] = [];
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const sol: SolChain = {
    blockhashValid: async () => true, mintDecimals: async () => 6,
    simulate: async (tx) => ({ tokens: fairCoins(tx), ok: true, agreed: true, lamportsBefore: 10_000_000_000n, lamportsAfter: 10_000_000_000n - (out.get(tx) ?? 0n) }),
    lookupTables: async () => [],
  };
  const core = new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol, usdPrice: async (c) => (c === "sol" ? SOL_USD : null), approve: async (w) => (sheets.push(w), answers.shift() ?? true), emit: (e, p) => listeners.get(e)?.forEach((h) => h(p)) });
  const store = new Map<string, string>();
  const methods: Record<string, (p: any) => unknown> = {
    "subwallet.list": () => core.list(),
    "subwallet.create": (p) => core.create(p.kind, p.chain),
    // Trade's bridge (forApps(…, "trade")) stamps its app id: the Trade session covers Trade's calls only (D55)
    "subwallet.signTx": (p) => core.signTx(p.id, p.tx, p.why, p.coin, "Trade", p.site, "trade"),
    // the one Trade session (dollars at the core's price); the old per-wallet form for anything else
    "subwallet.session.start": (p) => (starts.push(p), p.perTxUsd !== undefined ? core.tradeSessionStart(p.perTxUsd, p.totalUsd, p.minutes, p.why, "Trade", p.id, p.firstTx, p.coin) : core.sessionStart(p.id, p.perTx, p.total, p.minutes, p.why, "Trade", p.firstTx, p.coin)),
    "device.store.get": (p) => ({ value: store.get(p.key) ?? null }),
    "device.store.set": (p) => (store.set(p.key, p.value), { ok: true }),
  };
  const bridge: Bridge = {
    async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      try { return { ok: (await methods[method]!(p)) as T }; }
      catch (e) { if (e instanceof ProblemError) return { problem: e.problem }; throw e; }
    },
    on<T>(event: string, h: (p: T) => void) { const s = listeners.get(event) ?? new Set(); s.add(h as (p: unknown) => void); listeners.set(event, s); return () => s.delete(h as (p: unknown) => void); },
  };
  const svc = createTradeService({ bridge, chains: ["sol"], nativeUsd: async () => SOL_USD, engineFor: (_c, owner) => engineFor(owner, out, sent), sessionRule: { sol: sessionRefusal }, sleep: async () => {} });
  const buy = async (coin: string, usd: number) => { const p = await svc.quote("buy", "sol", coin, { usd }); return { p, asks: await svc.asks(p), rec: await svc.trade(p) }; };
  const sell = async (coin: string, usd: number) => { const p = await svc.quote("sell", "sol", coin, { fraction: usd / 1000 }); return { p, asks: await svc.asks(p), rec: await svc.trade(p) }; };
  return { svc, core, sheets, answers, buy, sell, starts, sent };
}

// a buy a little under the $100 cap (its fee and new coin account counted): $95 here
const FITS = 95;
const COIN = "PUMPEmint1111111111111111111111111111111111";
/** The core's refusal, named: a Problem whose words end "Nothing was signed." */
const refusedByName = (e: unknown) => e instanceof ProblemError && e.problem.code === "security.subwallet.refused" && /Nothing was signed\.$/.test(e.problem.more ?? "");
/** refusedByName, for a wallet's own trade refused (its own code, security.trade.not-signed). */
const refusedByNameTrade = (e: unknown) => e instanceof ProblemError && e.problem.code === "security.trade.not-signed" && /Nothing was signed\.$/.test(e.problem.more ?? "");

test("D143, audit C1: pump.fun buys up to $100 sign with no sheet and no Face ID, the first and each next one; one over $100 asks on the one-tap sheet (never Face ID): a no sends nothing, a yes sends it", async () => {
  const { core, sheets, answers, buy, sent } = setup();
  await core.create("trade", "sol");
  const first = await buy(COIN, FITS);
  assert.equal(first.asks, undefined, "the line under the pill: nothing stops it");
  assert.equal(first.rec.status, "done");
  for (let i = 0; i < 3; i++) assert.equal((await buy(COIN, FITS)).rec.status, "done");
  assert.deepEqual([sheets.length, sent.length], [0, 4], "no sheet up to the cap; every trade sent");
  answers.push(false);
  assert.equal((await buy(COIN, 150)).rec.status, "declined");
  assert.deepEqual([sheets.length, sent.length], [1, 4], "asked once; a no sends nothing");
  assert.equal(sheets[0]!.tap, true, "one tap, never Face ID");
  assert.equal(sheets[0]!.warnings[0]?.text, "It's over $100, so ZeroFee asks you.");
  assert.equal((await buy(COIN, 150)).rec.status, "done", "a yes sends it");
  assert.deepEqual([sheets.length, sent.length], [2, 5]);
});

test("audit C1: one rolling cap: past $500 of no-sheet trades in a day, the next asks on the one-tap sheet and a yes sends it (control: the five before it go with no sheet)", async () => {
  const { core, sheets, buy } = setup();
  await core.create("trade", "sol");
  for (let i = 0; i < SESSION.totalUsd / SESSION.perTradeUsd; i++) {
    const r = await buy(COIN, FITS);
    assert.deepEqual([r.asks, r.rec.status], [undefined, "done"], `trade ${i + 1}`);
  }
  assert.equal(sheets.length, 0);
  assert.equal((await buy(COIN, FITS)).rec.status, "done");
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0]!.tap, true);
  assert.equal(sheets[0]!.warnings[0]?.text, "It's past $500 in a day, so ZeroFee asks you.");
});

test("a step the core can't read (this stub's one-byte Jupiter route): the line says it won't go, the core refuses it by name, nothing is sent", async () => {
  const { core, sheets, svc, sent } = setup();
  await core.create("trade", "sol");
  const p = await svc.quote("buy", "sol", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", { usd: 10 });
  assert.equal(await svc.asks(p), "always", "said before the tap");
  await assert.rejects(svc.trade(p), refusedByNameTrade);
  assert.deepEqual([sheets.length, sent.length], [0, 0], "no sheet; nothing sent");
  assert.equal((await svc.activity())[0]!.status, "failed", "the record keeps the core's Problem");
  // control: a pump.fun buy right after goes
  const ok = await svc.quote("buy", "sol", COIN, { usd: 10 });
  assert.equal(await svc.asks(ok), undefined);
  assert.equal((await svc.trade(ok)).status, "done");
  assert.deepEqual([sheets.length, sent.length], [0, 1]);
});

test("product decision, 4 Nov, one tap: the tap never starts the session; Trade's open starts it (no sheet); a buy and a sale inside the cap sign with no sheet either way", async () => {
  const { core, sheets, buy, sell, starts, svc } = setup();
  await core.create("trade", "sol");
  assert.equal((await buy(COIN, 10)).rec.status, "done");
  assert.equal(starts.length, 0, "the tap starts none");
  await svc.open();
  assert.equal(starts.length, 1, "Trade's open starts it");
  assert.ok(!("firstTx" in starts[0]!) && !("id" in starts[0]!), "no trade rides on it");
  assert.ok(await svc.sessionEndsAt("sol"));
  assert.equal((await sell(COIN, 5)).rec.status, "done");
  assert.equal(starts.length, 1);
  assert.equal(sheets.length, 0, "no sheet, no Face ID");
});

test("Security 47a9ffb (D143), audit C1: a sale up to $100 signs with no sheet, one over it asks once on the one-tap sheet; one whose floor is far under what it brings back is said before the tap and refused by name", async () => {
  const { core, sheets, svc, buy, sell, sent } = setup();
  await core.create("trade", "sol");
  await buy(COIN, 25);
  const small = await sell(COIN, 40);
  assert.deepEqual([small.asks, small.rec.status], [undefined, "done"], "a $40 sale");
  const big = await sell(COIN, 150);
  assert.deepEqual([big.asks, big.rec.status], [undefined, "done"], "a $150 sale: asked, and the yes sends it");
  assert.deepEqual([sheets.length, sent.length], [1, 3]);
  assert.equal(sheets[0]!.tap, true);
  const wide = await svc.quote("sell", "sol", "WideMint11111111111111111111111111111111111", { fraction: 0.04 });
  assert.equal(await svc.asks(wide), "wide", "said before the tap");
  await assert.rejects(svc.trade(wide), (e: unknown) => refusedByNameTrade(e) && /20% less/.test((e as ProblemError).problem.more ?? ""));
  assert.deepEqual([sheets.length, sent.length], [1, 3], "nothing sent");
});
