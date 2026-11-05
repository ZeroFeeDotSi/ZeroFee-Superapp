// B36 (product decision, 3 Nov), D109 (QA) and D143 (approval-policy.ts hotNeedsApproval): what a Trade buy on Solana signs,
// by how many servers ran its test run. No site asks here (the person's own flow): what fails a check is refused by name
// ("… Nothing was signed."), never asked.
// - Trade's own buy from a trade wallet on a listed venue, ONE server answering: signed with no sheet, flagged for
//   Trade's line (Jupiter's routes included; production runs one: solana.ts SOL_SIM_NODES);
// - Trade's own sale of a coin the market prices, ONE server answering, inside the cap: signed with no sheet, flagged (the
//   crawl, 4 Nov: selling all of MOGMAS put the sheet up); a coin with no market price, or past the cap, still asks;
// - one server for anything else (the Extension's wallet, another app): the approve sheet asks, its first warning says so;
// - two that answered and don't agree are refused, and so is a run that didn't go through.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlainWords } from "./signer.ts";
import { base58, base64, cat, fromBase58, u64le } from "./sol/bytes.ts";
import { SOL, ownTokenAccount } from "./solana.ts";
import type { SolChain, Simulated } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { fairCoins } from "./testing/sol-coins.ts";
import { MemoryVault } from "./vault.ts";
import { tradeCalls } from "./testing/trade-calls.ts";

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const BLOCKHASH = base58(new Uint8Array(32).fill(5));
const ANAKIN = base58(new Uint8Array(32).fill(66));
type Ix = { program: string; accounts: string[]; data: Uint8Array };
function legacyTx(payer: string, ixs: Ix[]): string {
  const programs = [...new Set(ixs.map((i) => i.program))];
  const others = [...new Set(ixs.flatMap((i) => i.accounts))].filter((k) => k !== payer && !programs.includes(k));
  const keys = [payer, ...others, ...programs];
  const at = (k: string) => keys.indexOf(k);
  const parts: (Uint8Array | number[])[] = [[1, 0, programs.length], [keys.length], ...keys.map(fromBase58), fromBase58(BLOCKHASH), [ixs.length]];
  for (const ix of ixs) parts.push([at(ix.program), ix.accounts.length, ...ix.accounts.map(at), ix.data.length], ix.data);
  return base64(cat([1], new Uint8Array(64), cat(...parts)));
}
const u32 = (n: number) => new Uint8Array([n, 0, 0, 0]);
const stand = (n: number) => base58(new Uint8Array(32).fill(n));
/**
 * pump.fun's accounts as Trade builds them (buy_exact_quote_in_v3 / sell_v3, 17 accounts), so the core's payout check
 * (sol/decode.ts payoutRefusal) reads where it pays: global @0, the coin's mint @1, wSOL @2, the coin's token program @3,
 * Token @4, the curve and its two accounts @5-@7, the user @8, the user's own coin account @9, its own wSOL account @10,
 * then volume, fee config, buyback, System, event authority and pump.fun itself (stand-ins at fixed addresses).
 */
const pumpAccounts = (wallet: string, coin: string) => [stand(0xd1), coin, SOL.wsol, SOL.token, SOL.token, stand(0xd2), stand(0xd3), stand(0xd4), wallet, ownTokenAccount(wallet, coin), ownTokenAccount(wallet, SOL.wsol), stand(0xd5), stand(0xd6), stand(0xd7), SOL.system, stand(0xd8), PUMP];
/** A pump.fun buy of ANAKIN as Trade builds it (a listed venue). */
function pumpBuy(wallet: string, lamports: bigint): string {
  const wsol = ownTokenAccount(wallet, SOL.wsol);
  return legacyTx(wallet, [
    { program: SOL.system, accounts: [wallet, wsol], data: cat(u32(2), u64le(lamports)) },
    { program: SOL.token, accounts: [wsol], data: new Uint8Array([17]) },
    { program: PUMP, accounts: pumpAccounts(wallet, ANAKIN), data: cat(Uint8Array.from([0xe1, 0xf7, 0x50, 0x1e, 0xd5, 0xb3, 0x84, 0x88]), u64le(lamports), u64le(1000n)) },
  ]);
}
/** A Jupiter route buy: SOL (its own wSOL account) → ANAKIN (its own coin account). */
function jupiterBuy(wallet: string, lamports: bigint, outMint = ANAKIN, quoted = 2_400_000n): string {
  const route = [0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a];
  const wsol = ownTokenAccount(wallet, SOL.wsol);
  return legacyTx(wallet, [{ program: SOL.system, accounts: [wallet, wsol], data: cat(u32(2), u64le(lamports)) }, { program: SOL.token, accounts: [wsol], data: new Uint8Array([17]) }, { program: SOL.jupiter, accounts: [SOL.token, wallet, ownTokenAccount(wallet, SOL.wsol), ownTokenAccount(wallet, outMint), SOL.jupiter, outMint, SOL.jupiter], data: cat(route, [1, 0, 0, 0, 7, 100, 0, 1], u64le(lamports), u64le(quoted), [50, 0], [0]) }]);
}

/** A trade wallet (no session: D143, a session gates nothing); every call Trade's own. `shown`: every sheet asked for.
 *  The network says none of a route's accounts is a program (review M2: decode.ts routeProgramsRefusal). */
async function setup(sim: Partial<Simulated>, market: number | null = 1e-9) {
  const shown: PlainWords[] = [];
  const sol: SolChain = {
    blockhashValid: async () => true, mintDecimals: async () => 6,
    simulate: async (tx: string) => ({ ok: true, agreed: true, servers: 2, lamportsBefore: 10_000_000_000n, lamportsAfter: 10_000_000_000n - 8_471_667n, tokens: fairCoins(tx), ...sim }),
    lookupTables: async () => [],
    mintDecimals: async () => 6,
    executable: async (keys) => keys.map(() => false),
  };
  const w = tradeCalls(new SubWallets({ marketPrice: async () => market, vault: new MemoryVault(), sol, usdPrice: async () => 150, approve: async (words) => (shown.push(words), true), emit: () => {} }));
  const a = await w.create("trade", "sol");
  return { w, a, shown };
}
/** The approve sheet was asked once, its first warning saying why it wasn't silent. */
function askedOnce(shown: PlainWords[], why: RegExp) {
  assert.equal(shown.length, 1, "the approve sheet asked");
  assert.match(shown[0]!.warnings[0]?.text ?? "", why);
}
/** D143: refused by name ("… Nothing was signed."), never signed and never asked. `why`: the check that refuses it. */
async function refused(signing: Promise<unknown>, shown: PlainWords[], why?: RegExp) {
  await assert.rejects(signing, (e: { problem?: { code?: string; more?: string } }) => {
    assert.equal(e.problem?.code, "security.subwallet.refused");
    assert.match(e.problem?.more ?? "", /Nothing was signed\.$/);
    if (why) assert.match(e.problem!.more!, why);
    return true;
  });
  assert.equal(shown.length, 0, "a hot key never asks (D143): no sheet");
}
/** refused, for a wallet's own trade refused (its own code, security.trade.not-signed). */
async function refusedTrade(signing: Promise<unknown>, shown: PlainWords[], why?: RegExp) {
  await assert.rejects(signing, (e: { problem?: { code?: string; more?: string } }) => {
    assert.equal(e.problem?.code, "security.trade.not-signed");
    assert.match(e.problem?.more ?? "", /Nothing was signed\.$/);
    if (why) assert.match(e.problem!.more!, why);
    return true;
  });
  assert.equal(shown.length, 0, "a hot key never asks (D143): no sheet");
}

test("B36 (a): Trade's own buy on a listed venue, ONE server answering, signs with no sheet; two servers that disagree, or none, are refused by name", async () => {
  const one = await setup({ agreed: false, servers: 1 });
  const r = await one.w.signTx(one.a.id, pumpBuy(one.a.address, 8_466_667n), "Buy ANAKIN on pump.fun", ANAKIN, undefined, undefined, undefined, "Anakin");
  assert.ok("signedTx" in r);
  assert.equal(one.shown.length, 0, "no sheet (the code before B36 asked: 'Only one network server could check this')");
  // control: both servers answered and they don't agree → refused, the reason in plain words
  const two = await setup({ agreed: false, servers: 2 });
  await refusedTrade(two.w.signTx(two.a.id, pumpBuy(two.a.address, 8_466_667n), "", ANAKIN, undefined, undefined, undefined, "Anakin"), two.shown, /^The two Solana servers didn't agree on it\./);
  // control: no server ran the test run → refused
  const none = await setup({ ok: false, agreed: false, servers: 0 });
  await refusedTrade(none.w.signTx(none.a.id, pumpBuy(none.a.address, 8_466_667n), ""), none.shown, /test run of it didn't go through/);
});

test("D143: a Jupiter route one server checked signs, flagged; two servers that disagree on it are refused (controls: two that agree sign, unflagged)", async () => {
  const s = await setup({ agreed: false, servers: 1 });
  const r = await s.w.signTx(s.a.id, jupiterBuy(s.a.address, 8_466_667n), "Buy Anakin on Jupiter", ANAKIN, undefined, undefined, undefined, "Anakin");
  assert.equal((r as { checkedByOne?: true }).checkedByOne, true);
  const split = await setup({ agreed: false, servers: 2 });
  await refusedTrade(split.w.signTx(split.a.id, jupiterBuy(split.a.address, 8_466_667n), "", ANAKIN), split.shown, /^The two Solana servers didn't agree on it\./);
  const two = await setup({});
  const r2 = await two.w.signTx(two.a.id, jupiterBuy(two.a.address, 8_466_667n), "Buy Anakin on Jupiter", ANAKIN, undefined, undefined, undefined, "Anakin");
  assert.ok("signedTx" in r2);
  assert.equal("checkedByOne" in r2, false);
  assert.equal(s.shown.length + split.shown.length + two.shown.length, 0);
});

test("B36 review H1: a Trade transaction with anything beyond its one swap is refused, whatever the servers say (control: the pure swap signs)", async () => {
  const thief = base58(new Uint8Array(32).fill(99));
  // the same Jupiter buy with one more step: SOL to someone else
  const withSend = (wallet: string) => {
    const wsol = ownTokenAccount(wallet, SOL.wsol);
    const route = [0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a];
    return legacyTx(wallet, [
      { program: SOL.system, accounts: [wallet, wsol], data: cat(u32(2), u64le(8_466_667n)) },
      { program: SOL.token, accounts: [wsol], data: new Uint8Array([17]) },
      { program: SOL.jupiter, accounts: [SOL.token, wallet, wsol, ownTokenAccount(wallet, ANAKIN), SOL.jupiter, ANAKIN, SOL.jupiter], data: cat(route, [1, 0, 0, 0, 7, 100, 0, 1], u64le(8_466_667n), u64le(2_400_000n), [50, 0], [0]) },
      { program: SOL.system, accounts: [wallet, thief], data: cat(u32(2), u64le(5_000_000_000n)) },
    ]);
  };
  const s = await setup({});
  await refusedTrade(s.w.signTx(s.a.id, withSend(s.a.address), "", ANAKIN, undefined, undefined, undefined, "Anakin"), s.shown, /^It moves SOL to an account this wallet doesn't own\./);
  // one server's check never lets it through either
  const one = await setup({ agreed: false, servers: 1 });
  await refusedTrade(one.w.signTx(one.a.id, withSend(one.a.address), "", ANAKIN, undefined, undefined, undefined, "Anakin"), one.shown);
  // control: without the extra step, the same route signs with no sheet
  assert.ok("signedTx" in (await s.w.signTx(s.a.id, jupiterBuy(s.a.address, 8_466_667n), "", ANAKIN, undefined, undefined, undefined, "Anakin")));
  assert.equal(s.shown.length, 0);
});

test("the crawl (4 Nov), B36 review H2: Trade's own sale of a priced coin one server checked signs with no sheet, flagged; an unpriced coin, or one past the cap, asks; a 1-lamport floor is refused (control: two servers that agree sign, unflagged)", async () => {
  const mint = base58(new Uint8Array(32).fill(7));
  const sellTx = (wallet: string, floor: bigint, raw = 1_000_000n) => legacyTx(wallet, [{ program: PUMP, accounts: pumpAccounts(wallet, mint), data: cat(Uint8Array.from([0x1c, 0x92, 0xde, 0x77, 0x26, 0xc4, 0x69, 0xd5]), u64le(raw), u64le(floor)) }]);
  const back = { lamportsAfter: 10_000_000_000n + 50_000_000n };
  // a priced coin ($7 of it, $7.50 back), one server: no sheet, and Trade's line says one server checked it
  const sell = await setup({ agreed: false, servers: 1, ...back }, 7);
  const r1 = await sell.w.signTx(sell.a.id, sellTx(sell.a.address, 45_000_000n), "");
  assert.ok("signedTx" in r1);
  assert.equal((r1 as { checkedByOne?: true }).checkedByOne, true);
  assert.equal(sell.shown.length, 0, "the code before asked: 'Only one server could test it'");
  // control: no market price for the coin, one server: asked, its first warning says why; a yes signs
  const unpriced = await setup({ agreed: false, servers: 1, ...back }, null);
  assert.ok("signedTx" in (await unpriced.w.signTx(unpriced.a.id, sellTx(unpriced.a.address, 45_000_000n), "")));
  askedOnce(unpriced.shown, /^Only one server could test it, so ZeroFee asks you\.$/);
  // control: past the cap ($150 of the coin, $150 back), one server: asked, as any sale past it is
  const big = await setup({ agreed: false, servers: 1, lamportsAfter: 10_000_000_000n + 1_000_000_000n }, 150);
  assert.ok("signedTx" in (await big.w.signTx(big.a.id, sellTx(big.a.address, 900_000_000n), "")));
  askedOnce(big.shown, /^It's over \$\d+, so ZeroFee asks you\.$/);
  // a 1-lamport floor fails the check: refused by name, never asked, whatever the servers say
  const dump = await setup({ agreed: false, servers: 1, ...back }, 7);
  await refusedTrade(dump.w.signTx(dump.a.id, sellTx(dump.a.address, 1n), ""), dump.shown, /^It could get back over 20% less than the sale is worth now\./);
  // control: two servers that agree on the fair sale: no sheet, unflagged
  const two = await setup({ ...back });
  const r = await two.w.signTx(two.a.id, sellTx(two.a.address, 45_000_000n), "");
  assert.ok("signedTx" in r);
  assert.equal("checkedByOne" in r, false);
  assert.equal(two.shown.length, 0);
});

test("B36 review N2: SOL into someone else's wrapped-SOL account is refused, whatever the servers say (control: the wallet's own signs)", async () => {
  const thief = base58(new Uint8Array(32).fill(98));
  const theirs = ownTokenAccount(thief, SOL.wsol);
  const tx = (wallet: string) => legacyTx(wallet, [
    { program: SOL.system, accounts: [wallet, ownTokenAccount(wallet, SOL.wsol)], data: cat(u32(2), u64le(8_466_667n)) },
    { program: SOL.token, accounts: [ownTokenAccount(wallet, SOL.wsol)], data: new Uint8Array([17]) },
    { program: SOL.system, accounts: [wallet, theirs], data: cat(u32(2), u64le(5_000_000_000n)) },
    { program: SOL.token, accounts: [theirs], data: new Uint8Array([17]) },
    { program: PUMP, accounts: pumpAccounts(wallet, ANAKIN), data: cat(Uint8Array.from([0xe1, 0xf7, 0x50, 0x1e, 0xd5, 0xb3, 0x84, 0x88]), u64le(8_466_667n), u64le(1000n)) },
  ]);
  const s = await setup({ agreed: false, servers: 1 });
  await refusedTrade(s.w.signTx(s.a.id, tx(s.a.address), ""), s.shown);
  const two = await setup({});
  await refusedTrade(two.w.signTx(two.a.id, tx(two.a.address), ""), two.shown, /^It moves SOL to an account this wallet doesn't own\./);
  // control: the plain buy into the wallet's own wSOL signs with no sheet
  assert.ok("signedTx" in (await s.w.signTx(s.a.id, pumpBuy(s.a.address, 8_466_667n), "")));
  assert.equal(s.shown.length, 0);
});

test("B36 review N1: Meteora's swap2 in any mode but exact in is never read as a swap (control: exact in is)", async () => {
  const { decodeSolTx } = await import("./sol/decode.ts");
  const DBC = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
  const me = base58(new Uint8Array(32).fill(1)), wsol = ownTokenAccount(me, SOL.wsol), coin = base58(new Uint8Array(32).fill(4));
  const swap2 = (mode: number) => legacyTx(me, [
    { program: SOL.system, accounts: [me, wsol], data: cat(u32(2), u64le(1_000_000n)) },
    { program: SOL.token, accounts: [wsol], data: new Uint8Array([17]) },
    { program: DBC, accounts: [base58(new Uint8Array(32).fill(10)), base58(new Uint8Array(32).fill(11)), base58(new Uint8Array(32).fill(12)), wsol, base58(new Uint8Array(32).fill(13)), base58(new Uint8Array(32).fill(14)), base58(new Uint8Array(32).fill(15)), coin, SOL.wsol], data: cat(Uint8Array.from([0x41, 0x4b, 0x3f, 0x4c, 0xeb, 0x5b, 0x5b, 0x88]), u64le(1_000_000n), u64le(500n), [mode]) },
  ]);
  assert.equal(decodeSolTx(swap2(0)).swaps.length, 1, "control: exact in reads as one buy");
  assert.equal(decodeSolTx(swap2(2)).swaps.length, 0, "exact out: amount_0 is what comes OUT, never read as what goes in");
  assert.equal(decodeSolTx(swap2(1)).swaps.length, 0);
});

test("B36 review M1, D143: one server lets only Trade's own buy from a trade wallet go silently: the Extension's wallet's clean buy one server checked asks, even stamped as Trade's (a no signs nothing); two servers that disagree are refused (control: two that agree sign inside its session, no sheet)", async () => {
  const shown: PlainWords[] = [];
  let agreed = false, servers = 1, answer = false;
  const sol: SolChain = { blockhashValid: async () => true, mintDecimals: async () => 6, simulate: async (tx: string) => ({ ok: true, agreed, servers, lamportsBefore: 10_000_000_000n, lamportsAfter: 10_000_000_000n - 8_471_667n, tokens: fairCoins(tx) }), lookupTables: async () => [] };
  const w = new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol, usdPrice: async () => 150, approve: async (words) => (shown.push(words), answer), emit: () => {} });
  const ext = await (w as any).add("extension", crypto.getRandomValues(new Uint8Array(32)), "extension", "Extension wallet");
  await w.sessionStart(ext.id, "200000000", "300000000", 15);
  for (const app of [undefined, "trade"]) {
    shown.length = 0;
    assert.deepEqual(await w.signTx(ext.id, pumpBuy(ext.address, 8_466_667n), "", undefined, undefined, undefined, app), { declined: true }, `${app ?? "no app"}: a no signs nothing`);
    askedOnce(shown, /^Only one server could test it, so ZeroFee asks you\.$/);
  }
  answer = true;
  assert.ok("signedTx" in (await w.signTx(ext.id, pumpBuy(ext.address, 8_466_667n), "")), "a yes signs");
  shown.length = 0;
  servers = 2;
  await refusedTrade(w.signTx(ext.id, pumpBuy(ext.address, 8_466_667n), ""), shown, /^The two Solana servers didn't agree on it\./);
  agreed = true;
  assert.ok("signedTx" in (await w.signTx(ext.id, pumpBuy(ext.address, 8_466_667n), "")), "control: two that agree sign");
  assert.equal(shown.length, 0);
});

test("B36-F1: a trade one server checked comes back flagged for Trade's line (control: two servers, no flag)", async () => {
  const one = await setup({ agreed: false, servers: 1 });
  const r = await one.w.signTx(one.a.id, pumpBuy(one.a.address, 8_466_667n), "");
  assert.equal(one.shown.length, 0);
  assert.equal((r as { checkedByOne?: true }).checkedByOne, true);
  const two = await setup({ agreed: true, servers: 2 });
  const r2 = await two.w.signTx(two.a.id, pumpBuy(two.a.address, 8_466_667n), "");
  assert.equal(two.shown.length, 0);
  assert.equal("checkedByOne" in (r2 as object), false);
});
