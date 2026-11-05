// The core's Solana decoder and its refusals (audit W-1, W-9, T-4): what the sheet says, what is never signed, and that
// every transaction Trade really built (packages/trade/src/sol/fixtures) still reads as its own trade.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { base58, base64, cat, fromBase58, u32le, u64le } from "./bytes.ts";
import { MAX_PRIORITY_FEE_LAMPORTS, decodeSolTx, solWords } from "./decode.ts";
import { lookupTableAddresses } from "./wire.ts";
import { SOL, ownTokenAccount, sessionRefusal, signableReason } from "../solana.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../../../trade/src/sol/fixtures/${f}`, import.meta.url), "utf8"));
const golden = load("sol-golden.json"), alt = load("web3-alt-vectors.json"), routes = load("jup-routes.json");
const OWNER = "GKreMsHvt8A79VApjboYDq3J4ZCXSJRYYQk9BscMbi1H"; // the fixtures' test wallet: BIP-39's public test phrase at m/44'/501'/0'/1' (trade sol/testing/replay.test.ts)

const BLOCKHASH = base58(new Uint8Array(32).fill(5));
const addr = (n: number) => base58(new Uint8Array(32).fill(n));
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMPSWAP = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const DAMM2 = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
const JUP = SOL.jupiter;
const WSOL = SOL.wsol;
type Ix = { program: string; accounts: string[]; data: Uint8Array };

/** A legacy transaction, `payer` the only signer; every program read-only, every other account writable. */
function legacyTx(payer: string, ixs: Ix[]): string {
  const programs = [...new Set(ixs.map((i) => i.program))];
  const others = [...new Set(ixs.flatMap((i) => i.accounts))].filter((k) => k !== payer && !programs.includes(k));
  const keys = [payer, ...others, ...programs];
  const at = (k: string) => keys.indexOf(k);
  const parts: (Uint8Array | number[])[] = [[1, 0, programs.length], [keys.length], ...keys.map(fromBase58), fromBase58(BLOCKHASH), [ixs.length]];
  for (const ix of ixs) parts.push([at(ix.program), ix.accounts.length, ...ix.accounts.map(at), ix.data.length], ix.data);
  return base64(cat([1], new Uint8Array(64), cat(...parts)));
}
const limitIx = (units: number): Ix => ({ program: SOL.computeBudget, accounts: [], data: cat([2], u32le(units)) });
const priceIx = (micro: bigint): Ix => ({ program: SOL.computeBudget, accounts: [], data: cat([3], u64le(micro)) });
const transferIx = (from: string, to: string, lamports: bigint): Ix => ({ program: SOL.system, accounts: [from, to], data: cat(u32le(2), u64le(lamports)) });
const syncIx = (acct: string): Ix => ({ program: SOL.token, accounts: [acct], data: new Uint8Array([17]) });
const ataIx = (owner: string, mint: string): Ix => ({ program: SOL.ata, accounts: [owner, addr(90), owner, mint, SOL.system, SOL.token], data: new Uint8Array([1]) });
const JUP_ROUTE = [0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a];
/** Jupiter's `route`: token program, authority, source, destination, destination (optional), destination mint @5. */
const jupRoute = (owner: string, src: string, dst: string, outMint: string, inAmount: bigint, quoted: bigint, bps: number): Ix => ({
  program: JUP, accounts: [SOL.token, owner, src, dst, JUP, outMint, JUP],
  data: cat(JUP_ROUTE, [1, 0, 0, 0, 7, 100, 0, 1], u64le(inAmount), u64le(quoted), [bps & 0xff, bps >> 8], [0]),
});
const text = (lines: string[]) => lines.join(" | ");

// ---------------------------------------------------------------------------------------------------------------------
// T-4: the priority fee is bounded, and said.

test("T-4: a priority fee over the cap is never signed (the sign path and a session both refuse it)", () => {
  const me = addr(1);
  // 1.4M compute units at 10 lamports each = 14,000,000 lamports = 0.014 SOL of priority fee
  const tx = legacyTx(me, [limitIx(1_400_000), priceIx(10_000_000n), transferIx(me, addr(2), 1n)]);
  assert.match(signableReason(tx, me) ?? "", /network fee/i, "the general sign path refuses it");
  assert.match(sessionRefusal(tx, me) ?? "", /network fee/i, "a session refuses it");
  // at the cap exactly it is signable
  const ok = legacyTx(me, [limitIx(1_000_000), priceIx(MAX_PRIORITY_FEE_LAMPORTS), transferIx(me, addr(2), 1n)]);
  assert.equal(signableReason(ok, me), null);
});

test("T-4: without a compute limit the bound is 200k units per instruction (1.4M at most)", () => {
  const me = addr(1);
  // two instructions besides the price: 400k units at 15 lamports = 6,000,000 lamports, over the cap
  const over = legacyTx(me, [priceIx(15_000_000n), transferIx(me, addr(2), 1n), transferIx(me, addr(3), 1n)]);
  assert.match(signableReason(over, me) ?? "", /network fee/i);
  // one instruction: 200k units at 15 lamports = 3,000,000, under it
  const under = legacyTx(me, [priceIx(15_000_000n), transferIx(me, addr(2), 1n)]);
  assert.equal(signableReason(under, me), null);
});

test("T-4: a compute-budget instruction that isn't read is refused, never let through", () => {
  const me = addr(1);
  for (const data of [new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8]), new Uint8Array([9]), new Uint8Array([3, 1, 2]), new Uint8Array([2, 1])]) {
    const tx = legacyTx(me, [{ program: SOL.computeBudget, accounts: [], data }, transferIx(me, addr(2), 1n)]);
    assert.ok(signableReason(tx, me), `compute budget [${data.join(",")}] is refused on the sign path`);
    assert.ok(sessionRefusal(tx, me), `compute budget [${data.join(",")}] is refused by a session`);
  }
  // two limits: the network rejects it; so does the wallet
  assert.ok(signableReason(legacyTx(me, [limitIx(200_000), limitIx(300_000), transferIx(me, addr(2), 1n)]), me));
  // a heap frame and a loaded-data limit change no fee: read, and fine
  const heap = legacyTx(me, [{ program: SOL.computeBudget, accounts: [], data: cat([1], u32le(256 * 1024)) }, { program: SOL.computeBudget, accounts: [], data: cat([4], u32le(64 * 1024)) }, transferIx(me, addr(2), 1n)]);
  assert.equal(signableReason(heap, me), null);
});

test("T-4: the sheet says the network fee: 5,000 lamports a signature plus the priority bound", () => {
  const me = addr(1);
  const d = decodeSolTx(legacyTx(me, [limitIx(200_000), priceIx(1_000n), transferIx(me, addr(2), 1n)]));
  // 200,000 × 1,000 / 1,000,000 = 200 lamports of priority, + 5,000 for the one signature
  assert.ok(solWords(d).lines.includes("Network fee: at most 0.0000052 SOL"), text(solWords(d).lines));
  const none = decodeSolTx(legacyTx(me, [transferIx(me, addr(2), 1n)]));
  assert.ok(solWords(none).lines.includes("Network fee: at most 0.000005 SOL"), text(solWords(none).lines));
});

// ---------------------------------------------------------------------------------------------------------------------
// W-1: Assign / Allocate on the wallet itself, and every step the words don't read.

test("W-1: Assign, Allocate and their with-seed forms on the wallet itself are never signed", () => {
  const me = addr(1), program = addr(9);
  const steps: [string, Ix][] = [
    ["Assign", { program: SOL.system, accounts: [me], data: cat(u32le(1), fromBase58(program)) }],
    ["Allocate", { program: SOL.system, accounts: [me], data: cat(u32le(8), u64le(100n)) }],
    ["AllocateWithSeed", { program: SOL.system, accounts: [me, me], data: cat(u32le(9), fromBase58(me), u64le(1n), [120], u64le(100n), fromBase58(program)) }],
    ["AssignWithSeed", { program: SOL.system, accounts: [me, me], data: cat(u32le(10), fromBase58(me), u64le(1n), [120], fromBase58(program)) }],
  ];
  for (const [name, ix] of steps) {
    const tx = legacyTx(me, [ix]);
    assert.match(signableReason(tx, me) ?? "", /wallet/i, `${name} on the wallet is refused`);
    assert.ok(sessionRefusal(tx, me), `${name}: no session covers it`);
    assert.match(text(solWords(decodeSolTx(tx)).lines), /we don't read/, `${name}: the words say so`);
  }
});

test("W-1: a step of a known program whose data isn't read gets a line, never silence", () => {
  const me = addr(1);
  const cases: [string, Ix][] = [
    ["System CreateAccountWithSeed", { program: SOL.system, accounts: [me, addr(3), me], data: cat(u32le(3), fromBase58(me), u64le(1n), [120], u64le(1_000_000n), u64le(0n), fromBase58(addr(9))) }],
    ["Token accounts RecoverNested", { program: SOL.ata, accounts: [addr(3), addr(4), addr(5), addr(6), addr(7), me, SOL.token], data: new Uint8Array([2]) }],
    ["pump.fun, an instruction that isn't a swap", { program: PUMP, accounts: [me, addr(3)], data: new Uint8Array(24).fill(7) }],
    ["Jupiter, a route kind that isn't read", { program: JUP, accounts: [me], data: new Uint8Array(40).fill(3) }],
  ];
  for (const [name, ix] of cases) {
    const tx = legacyTx(me, [ix]);
    const words = solWords(decodeSolTx(tx));
    assert.match(text(words.lines), /does something we don't read/, `${name}: ${text(words.lines)}`);
    assert.ok(sessionRefusal(tx, me), `${name}: no session covers it`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// W-9: the swap's words are read, not guessed.

test("W-9: a Jupiter route with slippage over 100% is not read as a swap (its floor would be negative)", () => {
  const me = addr(1), wsolAcct = ownTokenAccount(addr(1), WSOL), coinAcct = addr(3), coin = addr(4);
  const tx = legacyTx(me, [transferIx(me, wsolAcct, 1_000_000n), syncIx(wsolAcct), jupRoute(me, wsolAcct, coinAcct, coin, 1_000_000n, 500n, 20_000)]);
  const d = decodeSolTx(tx);
  assert.ok(d.swaps.every((s) => BigInt(s.minOutRaw) >= 0n), `a floor is never negative: ${d.swaps.map((s) => s.minOutRaw)}`);
  assert.equal(d.swaps.length, 0, "refused as a swap");
  assert.match(text(solWords(d).lines), /does something we don't read/);
  // at exactly 100% the floor is zero, not negative
  const all = decodeSolTx(legacyTx(me, [transferIx(me, wsolAcct, 1_000_000n), syncIx(wsolAcct), jupRoute(me, wsolAcct, coinAcct, coin, 1_000_000n, 500n, 10_000)]));
  assert.equal(all.swaps[0]?.minOutRaw, "0");
});

test("W-9: a Jupiter sale's coin isn't guessed from an account the route opens", () => {
  const me = addr(1), coinAcct = addr(3), wsolAcct = addr(2), middle = addr(6);
  const d = decodeSolTx(legacyTx(me, [ataIx(me, middle), jupRoute(me, coinAcct, wsolAcct, WSOL, 1_000n, 2_000_000n, 100)]));
  assert.equal(d.swaps.length, 1);
  assert.equal(d.swaps[0]!.side, "sell");
  assert.equal(d.swaps[0]!.coin, undefined, "a `route` sale doesn't name its coin: said as 'a coin', never the middle hop's");
});

test("W-9: a Jupiter buy's coin is the route's own output mint", () => {
  const me = addr(1), wsolAcct = ownTokenAccount(addr(1), WSOL), coinAcct = addr(3), coin = addr(4), other = addr(6);
  const d = decodeSolTx(legacyTx(me, [ataIx(me, other), ataIx(me, coin), transferIx(me, wsolAcct, 1_000n), syncIx(wsolAcct), jupRoute(me, wsolAcct, coinAcct, coin, 1_000n, 2_000n, 100)]));
  assert.deepEqual(d.swaps.map((s) => [s.side, s.coin]), [["buy", coin]]);
  // a "buy" whose output is wSOL, or one that wraps no SOL, isn't a buy we can read
  const noWrap = decodeSolTx(legacyTx(me, [jupRoute(me, addr(7), coinAcct, coin, 1_000n, 2_000n, 100)]));
  assert.ok(noWrap.swaps.every((s) => s.side !== "buy"), "no SOL wrapped: not called a buy");
});

test("W-9: a PumpSwap 'buy' paid in a coin (its quote isn't wSOL) is not called a buy", () => {
  const me = addr(1), pool = addr(23), coinX = addr(21), attackerCoin = addr(22);
  const data = cat(Uint8Array.from([194, 171, 28, 70, 104, 77, 91, 47]), u64le(1_000_000_000_000_000n), u64le(1n));
  const d = decodeSolTx(legacyTx(me, [{ program: PUMPSWAP, accounts: [pool, me, addr(24), attackerCoin, coinX, addr(25), addr(26)], data }]));
  assert.equal(d.swaps.length, 0);
  assert.match(text(solWords(d).lines), /does something we don't read/);
});

test("W-9: a DAMM v2 swap between two coins (neither is SOL) isn't called a sale", () => {
  const me = addr(1);
  const data = cat(Uint8Array.from([0x41, 0x4b, 0x3f, 0x4c, 0xeb, 0x5b, 0x5b, 0x88]), u64le(1_000n), u64le(1n));
  // pool authority, pool, input account @2, output account, vaults, mint A @6, mint B @7
  const d = decodeSolTx(legacyTx(me, [{ program: DAMM2, accounts: [addr(30), addr(31), addr(32), addr(33), addr(34), addr(35), addr(36), addr(37)], data }]));
  assert.equal(d.swaps.length, 0, `read as ${JSON.stringify(d.swaps)}`);
});

// ---------------------------------------------------------------------------------------------------------------------
// The control: every transaction Trade really built still reads as its own trade, with nothing unread, and is signable.

test("control: Trade's real transactions read as their quote, nothing unread, the fee within the cap", () => {
  let n = 0;
  for (const c of golden.cases.filter((x: any) => !x.error)) {
    const tx = c.sims.at(-1);
    const d = decodeSolTx(tx);
    assert.equal(d.swaps.length, 1, c.name);
    const s = d.swaps[0]!;
    assert.deepEqual([s.side, s.coin, s.inRaw, s.minOutRaw], [c.side, c.mint, c.quote.payRaw, c.quote.getMinRaw], c.name);
    const words = text(solWords(d).lines);
    assert.doesNotMatch(words, /don't read/, `${c.name}: ${words}`);
    assert.match(words, /Network fee: at most 0\.000\d+ SOL/, c.name);
    assert.equal(signableReason(tx, OWNER), null, c.name);
    n++;
  }
  assert.equal(n, 13);
  for (const [i, v] of alt.vectors.entries()) {
    const tables = Object.entries(v.alts as Record<string, string>).map(([k, data]) => ({ key: k, addresses: lookupTableAddresses(Buffer.from(data, "base64")) }));
    const d = decodeSolTx(v.swapTransaction, tables);
    const q = routes.routes[i].quote;
    assert.deepEqual(d.swaps.map((s) => [s.side, s.coin, s.inRaw]), [["buy", q.outputMint, q.inAmount]], v.name);
    assert.doesNotMatch(text(solWords(d).lines), /don't read/, v.name);
    assert.equal(signableReason(v.swapTransaction, d.feePayer), null, v.name);
  }

});

test("SOC-2: a plain SOL transfer shows the recipient's FULL address, not 4…4", () => {
  const me = addr(1), to = addr(2);
  const lines = solWords(decodeSolTx(legacyTx(me, [transferIx(me, to, 1n)]))).lines;
  assert.ok(lines.includes(`Sends 0.000000001 SOL to ${to}`), text(lines));
  assert.ok(!lines.some((l) => /Sends .* to \w{4}…\w{4}$/.test(l)), "no shortened recipient");
});

test("a Stake program Authorize / AuthorizeChecked says it gives control of the stake account, to the full address", () => {
  const STAKE = "Stake11111111111111111111111111111111111111", acct = addr(31), clock = addr(32), to = addr(33);
  // Authorize: tag 1, new authority (32 bytes), role u32 (1 = withdrawer)
  const a = decodeSolTx(legacyTx(OWNER, [{ program: STAKE, accounts: [acct, clock, OWNER], data: cat(u32le(1), fromBase58(to), u32le(1)) }]));
  assert.deepEqual(a.stakeHandovers, [{ account: acct, to, role: "withdrawer" }]);
  assert.ok(solWords(a).lines.includes(`Gives control of a stake account to ${to}`), "the full address, not a shortened one");
  // AuthorizeChecked: tag 10, role u32 (0 = staker); the new authority is the 4th account
  const c = decodeSolTx(legacyTx(OWNER, [{ program: STAKE, accounts: [acct, clock, OWNER, to], data: cat(u32le(10), u32le(0)) }]));
  assert.deepEqual(c.stakeHandovers, [{ account: acct, to, role: "staker" }]);
  assert.ok(solWords(c).lines.includes(`Gives control of a stake account to ${to}`));
  // other Stake steps (Delegate = 2) are not a handover
  assert.deepEqual(decodeSolTx(legacyTx(OWNER, [{ program: STAKE, accounts: [acct, clock, OWNER], data: u32le(2) }])).stakeHandovers, []);
});
