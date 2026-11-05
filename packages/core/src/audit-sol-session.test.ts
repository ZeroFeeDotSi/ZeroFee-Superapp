// Audit PoCs (money paths, Solana slice; kept here and FIXED): what a hot key signs on Solana with no sheet (subwallets.ts
// solPrepare/coinsRefusal, solana.ts sessionRefusal, sol/decode.ts). The stand-in node now says what the chain would:
// the wallet's coins before and after (SOL-1: the held coin falls; SOL-2: the buy gets far more than its floor), as
// RpcSolChain.simulate reads them. Fixed: one swap per transaction; a buy spends only SOL and its floor is at least 80%
// of what it gets; a sale spends only the coin it sells. D143 (approval-policy.ts hotNeedsApproval): in the person's own
// flow (no site asked) what fails a check is refused by name ("… Nothing was signed."), never asked, and each refusal
// has its control: a clean trade of the same shape, priced and inside the caps, signs with no sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlainWords } from "./signer.ts";
import { base58, base64, cat, fromBase58, u64le } from "./sol/bytes.ts";
import { SOL, ownTokenAccount } from "./solana.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import type { TokenChange } from "./solana.ts";
import { fairCoins } from "./testing/sol-coins.ts";
import { MemoryVault } from "./vault.ts";
import { tradeCalls } from "./testing/trade-calls.ts";

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMPSWAP = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const LAUNCHLAB = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";
const BLOCKHASH = base58(new Uint8Array(32).fill(5));
const addr = (n: number) => base58(new Uint8Array(32).fill(n));
const u32 = (n: number) => new Uint8Array([n, 0, 0, 0]);

function legacyTx(keys: string[], ixs: { program: string; accounts: string[]; data: Uint8Array }[], readonlyUnsigned: number): string {
  const at = (k: string) => keys.indexOf(k);
  const parts: (Uint8Array | number[])[] = [[1, 0, readonlyUnsigned], [keys.length], ...keys.map(fromBase58), fromBase58(BLOCKHASH), [ixs.length]];
  for (const ix of ixs) parts.push([at(ix.program), ix.accounts.length, ...ix.accounts.map(at), ix.data.length], ix.data);
  return base64(cat([1], new Uint8Array(64), cat(...parts)));
}

/**
 * A trade wallet and a sim that says only the 5,000-lamport fee leaves (no session: D143, a session gates nothing).
 * `shown`: every sheet the core asks for; no site asks here (the person's own flow), so a hot key never asks: it stays empty.
 */
async function trading(lamportsOut = 5_000n, coins?: (wallet: string) => TokenChange[]) {
  const shown: PlainWords[] = [];
  const sol: SolChain = { blockhashValid: async () => true, mintDecimals: async () => 6, simulate: async (tx, wallet) => ({ ok: true, agreed: true, lamportsBefore: 10_000_000_000n, lamportsAfter: 10_000_000_000n - lamportsOut, tokens: coins ? coins(wallet) : fairCoins(tx) }), lookupTables: async () => [] };
  const w = tradeCalls(new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol, usdPrice: async (c) => (c === "sol" ? 150 : c === "bsc" ? 600 : 3000), approve: async (words) => (shown.push(words), true), emit: () => {} }));
  const a = await w.create("trade", "sol");
  return { w, a, shown };
}

/** D143: refused by name ("… Nothing was signed."), never signed and never asked. `why`: the check that refuses it. */
async function refused(signing: Promise<unknown>, shown: PlainWords[], why?: RegExp) {
  await assert.rejects(signing, (e: { problem?: { code?: string; more?: string } }) => {
    assert.equal(e.problem?.code, "security.subwallet.refused");
    assert.match(e.problem?.more ?? "", /Nothing was signed\.$/);
    if (why) assert.match(e.problem!.more!, why);
    return true;
  });
  assert.equal(shown.length, 0, "no site asked: a hot key never asks (D143): no sheet");
}
/** refused, for a wallet's own trade refused (its own code, security.trade.not-signed). */
async function refusedTrade(signing: Promise<unknown>, shown: PlainWords[], why?: RegExp) {
  await assert.rejects(signing, (e: { problem?: { code?: string; more?: string } }) => {
    assert.equal(e.problem?.code, "security.trade.not-signed");
    assert.match(e.problem?.more ?? "", /Nothing was signed\.$/);
    if (why) assert.match(e.problem!.more!, why);
    return true;
  });
  assert.equal(shown.length, 0, "no site asked: a hot key never asks (D143): no sheet");
}
/** The control: signed, with no sheet. */
async function signs(signing: Promise<unknown>, shown: PlainWords[]) {
  const r = await signing;
  assert.ok(r && typeof r === "object" && "signedTx" in r, "signed");
  assert.equal(shown.length, 0, "no sheet");
}

const AMM_BUY = Uint8Array.from([194, 171, 28, 70, 104, 77, 91, 47]);                 // PumpSwap buy_exact_quote_in_v2
const LL_BUY = Uint8Array.from([0xfa, 0xea, 0x0d, 0x7b, 0xd5, 0x9c, 0x13, 0xec]);      // Raydium LaunchLab buy_exact_in
const PUMP_BUY = Uint8Array.from([0xe1, 0xf7, 0x50, 0x1e, 0xd5, 0xb3, 0x84, 0x88]);    // pump.fun buy
type Step = { program: string; accounts: string[]; data: Uint8Array };
/** A buy paid in SOL as Trade builds it: SOL into the wallet's own wSOL account, SyncNative, then `steps`. */
function solPaid(wallet: string, lamports: bigint, steps: Step[]): string {
  const wsol = ownTokenAccount(wallet, SOL.wsol);
  const ixs = [{ program: SOL.system, accounts: [wallet, wsol], data: cat(u32(2), u64le(lamports)) }, { program: SOL.token, accounts: [wsol], data: new Uint8Array([17]) }, ...steps];
  const programs = [...new Set(ixs.map((i) => i.program))];
  const keys = [wallet, ...new Set(ixs.flatMap((i) => i.accounts).filter((k) => k !== wallet && !programs.includes(k))), ...programs];
  return legacyTx(keys, ixs, programs.length);
}
/**
 * pump.fun's accounts as Trade builds them (buy_exact_quote_in_v3 / sell_v3, 17 accounts), so the core's payout check
 * (sol/decode.ts payoutRefusal) reads where it pays: global @0, the coin's mint @1, wSOL @2, the coin's token program @3,
 * Token @4, the curve and its two accounts @5-@7, the user @8, the user's own coin account @9, its own wSOL account @10,
 * then volume, fee config, buyback, System, event authority and pump.fun itself (stand-ins at fixed addresses).
 */
const pumpAccounts = (wallet: string, coin: string) => [addr(0xd1), coin, SOL.wsol, SOL.token, SOL.token, addr(0xd2), addr(0xd3), addr(0xd4), wallet, ownTokenAccount(wallet, coin), ownTokenAccount(wallet, SOL.wsol), addr(0xd5), addr(0xd6), addr(0xd7), SOL.system, addr(0xd8), PUMP];
/** A pump.fun buy of `coin`, paid in SOL, with a floor of `minOut`. */
const pumpBuy = (wallet: string, coin: string, lamports: bigint, minOut: bigint): Step => ({ program: PUMP, accounts: pumpAccounts(wallet, coin), data: cat(PUMP_BUY, u64le(lamports), u64le(minOut)) });

/**
 * SOL-1. A PumpSwap buy_exact_quote_in_v2 whose QUOTE is a coin the wallet holds (the pool is base = the attacker's coin,
 * quote = the victim coin X): it pays the wallet's whole holding of X (here 10^15 raw units) for at least 1 unit of a
 * worthless coin. No SOL leaves (only the fee); the decoder once called it a "buy" by its discriminator, so the
 * sell-proceeds rule never ran; PumpSwap is an allowed venue. Expected (D143): refused, never signed, never asked.
 */
test("SOL-1: a 'buy' that pays with a coin the wallet holds is refused (control: the same buy paid in SOL signs)", async () => {
  const coinX = addr(21), attackerCoin = addr(22), pool = addr(23);
  const { w, a, shown } = await trading(5_000n, (wallet) => [
    { address: ownTokenAccount(wallet, coinX), mint: coinX, before: 1_000_000_000_000_000n, after: 0n },
    { address: ownTokenAccount(wallet, attackerCoin), mint: attackerCoin, before: 0n, after: 1n },
  ]);
  const walletX = ownTokenAccount(a.address, coinX);           // the victim coin, paid as the pool's "quote"
  const walletAtk = ownTokenAccount(a.address, attackerCoin);   // receives the worthless base
  const data = cat(AMM_BUY, u64le(1_000_000_000_000_000n), u64le(1n));
  // PumpSwap v2 order (pumpswap.ts): pool, user, globalConfig, base mint, quote mint, userBase, userQuote, ...
  const accounts = [pool, a.address, addr(24), attackerCoin, coinX, walletAtk, walletX];
  const keys = [a.address, ...new Set([...accounts.filter((k) => k !== a.address), PUMPSWAP])];
  const tx = legacyTx(keys, [{ program: PUMPSWAP, accounts, data }], keys.length - 3);
  await refusedTrade(w.signTx(a.id, tx, ""), shown);
  // control: the same PumpSwap buy on a pool quoted in SOL, paid from the wallet's own wrapped SOL, signs with no sheet
  const c = await trading();
  const wsol = ownTokenAccount(c.a.address, SOL.wsol);
  await signs(c.w.signTx(c.a.id, solPaid(c.a.address, 100_000_000n, [{ program: PUMPSWAP, accounts: [pool, c.a.address, addr(24), attackerCoin, SOL.wsol, ownTokenAccount(c.a.address, attackerCoin), wsol], data: cat(AMM_BUY, u64le(100_000_000n), u64le(1_000_000n)) }]), ""), c.shown);
});

test("SOL-1 (variant): the same through Raydium LaunchLab's buy_exact_in on a pool quoted in a held coin is refused (control: quoted in SOL signs)", async () => {
  const coinX = addr(31), attackerCoin = addr(32), pool = addr(33);
  const { w, a, shown } = await trading(5_000n, (wallet) => [
    { address: ownTokenAccount(wallet, coinX), mint: coinX, before: 1_000_000_000_000_000n, after: 0n },
    { address: ownTokenAccount(wallet, attackerCoin), mint: attackerCoin, before: 0n, after: 1n },
  ]);
  const walletX = ownTokenAccount(a.address, coinX), walletAtk = ownTokenAccount(a.address, attackerCoin);
  const data = cat(LL_BUY, u64le(1_000_000_000_000_000n), u64le(1n), u64le(0n));
  // LaunchLab account order (curves.ts): user, authority, global, platform, pool, userBase, userQuote, vaults, base mint @9, quote mint @10
  const accounts = [a.address, addr(34), addr(35), addr(36), pool, walletAtk, walletX, addr(37), addr(38), attackerCoin, coinX];
  const keys = [...new Set([...accounts, LAUNCHLAB])];
  const tx = legacyTx(keys, [{ program: LAUNCHLAB, accounts, data }], keys.length - 3);
  await refusedTrade(w.signTx(a.id, tx, ""), shown);
  // control: the same LaunchLab buy on a pool quoted in SOL, paid from the wallet's own wrapped SOL, signs with no sheet
  const c = await trading();
  const wsol = ownTokenAccount(c.a.address, SOL.wsol);
  const ok = [c.a.address, addr(34), addr(35), addr(36), pool, ownTokenAccount(c.a.address, attackerCoin), wsol, addr(37), addr(38), attackerCoin, SOL.wsol];
  await signs(c.w.signTx(c.a.id, solPaid(c.a.address, 100_000_000n, [{ program: LAUNCHLAB, accounts: ok, data: cat(LL_BUY, u64le(100_000_000n), u64le(1_000_000n), u64le(0n)) }]), ""), c.shown);
});

/**
 * SOL-2. A buy whose floor is ONE unit of the coin: anything that builds the transaction (Trade's own slippage up to
 * 20 %, or a compromised Trade page) could hand a sandwich the whole trade. Expected (the sell rule's twin): a buy whose
 * floor is far under what its own test run gets is refused, by name.
 */
test("SOL-2: a buy whose minimum out is one unit is refused (control: a fair floor signs)", async () => {
  // The test run says it gets 1,000,000 of the coin: a floor of 1 is under 80% of it.
  const coin = addr(71);
  const gets = (wallet: string) => [{ address: ownTokenAccount(wallet, coin), mint: coin, before: 0n, after: 1_000_000n }];
  const { w, a, shown } = await trading(100_000_000n, gets);   // 0.1 SOL = $15
  await refusedTrade(w.signTx(a.id, solPaid(a.address, 100_000_000n, [pumpBuy(a.address, coin, 100_000_000n, 1n)]), ""), shown, /^Its minimum is far under what it gets\./);
  // control: a floor of 90% of what it gets signs with no sheet
  const c = await trading(100_000_000n, gets);
  await signs(c.w.signTx(c.a.id, solPaid(c.a.address, 100_000_000n, [pumpBuy(c.a.address, coin, 100_000_000n, 900_000n)]), ""), c.shown);
});

/** A wallet of `kind`, no session; the sim says only the fee leaves, and the wallet's coins as `coins` says (default: a
 *  fair fill). SOL at $150: a clean trade has a price and is inside the caps, so it may go with no sheet. */
function plain(kind: "trade" | "browser", coins: (tx: string, wallet: string) => TokenChange[] = (tx) => fairCoins(tx)) {
  const shown: PlainWords[] = [];
  const sol: SolChain = { blockhashValid: async () => true, mintDecimals: async () => 6, simulate: async (tx, wallet) => ({ ok: true, agreed: true, lamportsBefore: 10_000_000_000n, lamportsAfter: 10_000_000_000n - 5_000n, tokens: coins(tx, wallet) }), lookupTables: async () => [] };
  const w = tradeCalls(new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol, usdPrice: async (c) => (c === "sol" ? 150 : null), approve: async (words) => (shown.push(words), true), emit: () => {} }));
  return { w, shown, create: () => w.create(kind, "sol") };
}

/**
 * SOL-3. A Token Program Transfer (a coin leaving the wallet) is a known program with no line of its own: a route, or
 * any page asking the Browser wallet, could append "transfer all of coin Y to the attacker" to an ordinary trade. Once
 * the sheet had to name it; D143: it is refused, alone or riding on a buy, and never asked.
 */
for (const kind of ["trade", "browser"] as const) {
  test(`SOL-3 (${kind} wallet): a coin sent out of the wallet, alone or riding on a buy, is refused (control: the buy alone signs)`, async () => {
    const coinY = addr(41), attacker = addr(42), attackerAta = ownTokenAccount(attacker, coinY), bought = addr(44);
    // the stand-in node says what the chain would: coin Y leaves the wallet (and a buy's coin comes in)
    const { w, shown, create } = plain(kind, (tx, wallet) => [...fairCoins(tx), { address: ownTokenAccount(wallet, coinY), mint: coinY, before: 5_000_000_000_000n, after: 0n }]);
    const a = await create();
    const mine = ownTokenAccount(a.address, coinY);
    // Token Program Transfer (3): source, destination, authority; amount u64
    const send: Step = { program: SOL.token, accounts: [mine, attackerAta, a.address], data: cat([3], u64le(5_000_000_000_000n)) };
    const keys = [a.address, mine, attackerAta, SOL.token];
    await refusedTrade(w.signTx(a.id, legacyTx(keys, [send], 1), kind === "trade" ? "Buy $5 of DOPE" : undefined), shown);
    await refusedTrade(w.signTx(a.id, solPaid(a.address, 33_000_000n, [pumpBuy(a.address, bought, 33_000_000n, 1_000n), send]), "Buy $5 of DOPE"), shown);
    // control: the buy alone (nothing else leaves) signs with no sheet
    const c = plain(kind);
    const b = await c.create();
    await signs(c.w.signTx(b.id, solPaid(b.address, 33_000_000n, [pumpBuy(b.address, bought, 33_000_000n, 1_000n)]), "Buy $5 of DOPE"), c.shown);
  });
}

/**
 * SOL-3b. A token account closed to SOMEONE ELSE: for a wSOL account, a close sends its whole wrapped balance (not just
 * rent) to the destination. Refused, alone or after a buy (control: the buy closing its wSOL account back to itself signs).
 */
test("SOL-3b: a close whose lamports go to someone else is refused (control: closed back to the wallet signs)", async () => {
  const { w, shown, create } = plain("trade");
  const a = await create();
  const wsol = ownTokenAccount(a.address, SOL.wsol), attacker = addr(43), coin = addr(45);
  const closeTo = (to: string): Step => ({ program: SOL.token, accounts: [wsol, to, a.address], data: new Uint8Array([9]) });
  await refusedTrade(w.signTx(a.id, solPaid(a.address, 1_000_000_000n, [closeTo(attacker)]), ""), shown);
  await refusedTrade(w.signTx(a.id, solPaid(a.address, 1_000_000_000n, [pumpBuy(a.address, coin, 1_000_000_000n, 1_000n), closeTo(attacker)]), ""), shown, /coin account in a way a trade doesn't need/);
  // control: the same buy, its wSOL account closed back to the wallet, signs with no sheet
  await signs(w.signTx(a.id, solPaid(a.address, 1_000_000_000n, [pumpBuy(a.address, coin, 1_000_000_000n, 1_000n), closeTo(a.address)]), ""), shown);
});

/**
 * SOL-1 (netting variant, SOL-quoted pools only). One transaction: sell the wallet's coin X on PumpSwap (proceeds into its
 * own wSOL), then a pump.fun buy of the attacker's coin paid from that same wSOL account, then the wSOL account closed
 * home. The sim nets the two: the wallet's SOL goes up by 0.001 SOL, so the sell rule would compare the sell's floor to
 * that NET gain: a floor of 0.0008 SOL on a 10 SOL ($1,500) sale would pass, the whole sale recycled into the attacker's
 * coin. Expected (D143): refused, never asked.
 */
test("SOL-1 (netting): a sell netted against a buy in one transaction is refused (control: the sale alone, its floor fair, signs)", async () => {
  const { w, a, shown } = await trading(-1_000_000n);   // the wallet's SOL goes UP by 0.001 SOL
  const wsol = ownTokenAccount(a.address, SOL.wsol), coinX = addr(51), pool = addr(52), atk = addr(53);
  const walletX = ownTokenAccount(a.address, coinX);
  const sellAccts = [pool, a.address, addr(54), coinX, SOL.wsol, walletX, wsol];
  // PumpSwap sell_v2: 10^12 raw of X, at least 0.0008 SOL
  const sell: Step = { program: PUMPSWAP, accounts: sellAccts, data: cat(Uint8Array.from([93, 246, 130, 60, 231, 233, 64, 178]), u64le(1_000_000_000_000n), u64le(800_000n)) };
  const keys = [a.address, ...new Set([...sellAccts.filter((k) => k !== a.address), wsol, atk, SOL.system, SOL.token, PUMPSWAP, PUMP])];
  const tx = legacyTx(keys, [
    sell,
    // the attacker's coin bought on pump.fun with 9.999 SOL of those proceeds, straight from the same wSOL account (no
    // wrap needed), with a 1-unit floor; then the wSOL account closed back to the wallet: the wallet nets +0.001 SOL
    { program: PUMP, accounts: [a.address, atk, wsol], data: cat(PUMP_BUY, u64le(9_999_000_000n), u64le(1n)) },
    { program: SOL.token, accounts: [wsol, a.address, a.address], data: new Uint8Array([9]) },
  ], keys.length - 3);
  await refusedTrade(w.signTx(a.id, tx, ""), shown);
  // control: the sale alone, whose floor is fair to the 0.001 SOL it brings back, signs with no sheet
  const sellKeys = [a.address, ...new Set([...sellAccts.filter((k) => k !== a.address), PUMPSWAP])];
  await signs(w.signTx(a.id, legacyTx(sellKeys, [sell], 1), ""), shown);
});

/**
 * Property: random transactions of 1-4 top-level steps, each either a shape a hot key may sign (compute budget, SOL
 * into the wallet's own wSOL + SyncNative, its own token account made or closed to itself, a pump.fun buy with a floor)
 * or one it must not (SOL to someone else, a token Transfer / Approve / SetAuthority, a close to someone else, a token
 * account for someone else, a durable-nonce advance, an unknown program). Signed (no sheet) iff every step is allowed
 * and there is exactly one swap; anything else refused by name, never asked (D143). 400 seeded cases.
 */
test("property: a hot key signs a random transaction only when every step is an allowed shape, and refuses the rest", async () => {
  let seed = 0x5eed;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const { w, a, shown } = await trading();
  const wsol = ownTokenAccount(a.address, SOL.wsol), other = addr(61), coin = addr(62), mine = ownTokenAccount(a.address, coin), unknown = addr(63);
  type Step = { ok: boolean; swap?: true; program: string; accounts: string[]; data: Uint8Array };
  const shapes: (() => Step)[] = [
    () => ({ ok: true, program: "ComputeBudget111111111111111111111111111111", accounts: [], data: cat([2], u32(200_000)) }),
    () => ({ ok: true, program: SOL.token, accounts: [wsol], data: new Uint8Array([17]) }),
    () => ({ ok: true, program: SOL.system, accounts: [a.address, wsol], data: cat(u32(2), u64le(1_000n)) }),
    () => ({ ok: true, program: SOL.token, accounts: [mine, a.address, a.address], data: new Uint8Array([9]) }),
    () => ({ ok: true, program: SOL.ata, accounts: [a.address, mine, a.address, coin, SOL.system, SOL.token], data: new Uint8Array([1]) }),
    () => ({ ok: true, swap: true, program: PUMP, accounts: pumpAccounts(a.address, coin), data: cat(PUMP_BUY, u64le(1_000n), u64le(10n)) }),
    () => ({ ok: false, program: SOL.system, accounts: [a.address, other], data: cat(u32(2), u64le(1_000n)) }),
    () => ({ ok: false, program: SOL.token, accounts: [mine, other, a.address], data: cat([3], u64le(1_000n)) }),
    () => ({ ok: false, program: SOL.token, accounts: [mine, other, a.address], data: cat([4], u64le(1_000n)) }),
    () => ({ ok: false, program: SOL.token, accounts: [mine, a.address], data: cat([6, 2, 1], fromBase58(other)) }),
    () => ({ ok: false, program: SOL.token, accounts: [mine, other, a.address], data: new Uint8Array([9]) }),
    () => ({ ok: false, program: SOL.ata, accounts: [a.address, ownTokenAccount(other, coin), other, coin, SOL.system, SOL.token], data: new Uint8Array([1]) }),
    () => ({ ok: false, program: unknown, accounts: [a.address], data: new Uint8Array([1]) }),
  ];
  // control: the seeded cases below happen to hold no clean trade, so one is signed here, from the same shapes (wrap,
  // SyncNative, the pump.fun buy): a rule that refused everything would fail
  const clean = [shapes[2]!(), shapes[1]!(), shapes[5]!()];
  const cleanKeys = [a.address, ...new Set(clean.flatMap((s) => [...s.accounts, s.program]).filter((k) => k !== a.address))];
  await signs(w.signTx(a.id, legacyTx(cleanKeys, clean, cleanKeys.length - 1), ""), shown);
  for (let i = 0; i < 400; i++) {
    const steps = Array.from({ length: 1 + rnd(4) }, () => shapes[rnd(shapes.length)]!());
    const accts = steps.flatMap((s) => [...s.accounts, s.program]).filter((k) => k !== a.address);
    const keys = [a.address, ...new Set(accts)];
    // writable: the wallet only (signer); the rest read-only is enough for the core's reading
    const tx = legacyTx(keys, steps.map(({ program, accounts, data }) => ({ program, accounts, data })), keys.length - 1);
    const r = await w.signTx(a.id, tx, "").catch((e) => e);
    const signed = Boolean(r && typeof r === "object" && "signedTx" in r);
    const label = `case ${i}: ${steps.map((s) => `${s.ok ? "ok" : "BAD"}:${s.program.slice(0, 4)}/${s.data[0]}`).join(", ")}`;
    // Signed only when every step is allowed and it is one trade (audit SOL-1: one swap per transaction), and that trade
    // is read with confidence (audit W-9): a buy wraps the wallet's SOL (a transfer into its wSOL account, then SyncNative).
    const wraps = steps.some((s) => s.program === SOL.system && s.ok) && steps.some((s) => s.program === SOL.token && s.data[0] === 17);
    // A compute limit set twice is refused (audit T-4: every compute-budget step read; the network rejects it too).
    const oneLimit = steps.filter((s) => s.program.startsWith("ComputeBudget")).length <= 1;
    const covered = steps.every((s) => s.ok) && steps.filter((s) => s.swap).length === 1 && wraps && oneLimit;
    assert.equal(signed, covered, label);
    // what isn't signed is refused by name, never asked (D143)
    if (!signed) assert.equal((r as { problem?: { code?: string } }).problem?.code, "security.trade.not-signed", label);
  }
  assert.equal(shown.length, 0, "a hot key never asks (D143)");
});

/**
 * Variant (the fix review's lead): the test run reads at most 32 of the accounts a transaction writes. 33 of the
 * wallet's own token accounts made first (each an allowed ATA create; a v0 transaction with a lookup table holds them
 * all) push the coin account SOL-1's attack drains past the 32 read, so the node says nothing about it (the coin it
 * gets made first, inside them, so the floor check passes). FAILED at the fix review; FIXED: a transaction writing more
 * accounts than the test run reads is refused, by that name (subwallets.ts SOL_WATCH_MAX).
 */
test("SOL-1 (variant): a coin account past the 32 the test run reads can't slip a held coin out unseen", async () => {
  const coinX = addr(21), attackerCoin = addr(22), pool = addr(23);
  const asked: string[][] = [];
  const shown: PlainWords[] = [];
  const sol: SolChain = {
    blockhashValid: async () => true, mintDecimals: async () => 6,
    lookupTables: async () => [],
    // As RpcSolChain: only the accounts asked about come back.
    simulate: async (_tx, wallet, watch = []) => {
      asked.push(watch);
      const all: TokenChange[] = [
        // 10^8 raw units of a 6-decimal coin: 100 coins, worth far more than the 0.1 SOL the same number reads as.
        { address: ownTokenAccount(wallet, coinX), mint: coinX, before: 100_000_000n, after: 0n },
        { address: ownTokenAccount(wallet, attackerCoin), mint: attackerCoin, before: 0n, after: 1n },
      ];
      return { ok: true, agreed: true, lamportsBefore: 10_000_000_000n, lamportsAfter: 10_000_000_000n - 5_000n, tokens: all.filter((t) => watch.includes(t.address)) };
    },
  };
  const w = tradeCalls(new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol, usdPrice: async () => 150, approve: async (words) => (shown.push(words), true), emit: () => {} }));
  const a = await w.create("trade", "sol");
  // The coin it gets comes first (inside the 32 read: the floor check sees it); 33 more push the drained one past them.
  const mints = [attackerCoin, ...Array.from({ length: 33 }, (_, i) => addr(100 + i))];
  const atas = mints.map((m) => ownTokenAccount(a.address, m));
  const walletX = ownTokenAccount(a.address, coinX), walletAtk = ownTokenAccount(a.address, attackerCoin);
  const swap = { program: PUMPSWAP, accounts: [pool, a.address, addr(24), attackerCoin, coinX, walletAtk, walletX], data: cat(AMM_BUY, u64le(100_000_000n), u64le(1n)) };
  const creates = mints.map((m, i) => ({ program: SOL.ata, accounts: [a.address, atas[i]!, a.address, m, SOL.system, SOL.token], data: Uint8Array.from([1]) }));
  const writable = [a.address, ...atas, pool, walletX];
  const readonly = [...new Set([...mints, addr(24), coinX, SOL.system, SOL.token, SOL.ata, PUMPSWAP])];
  const tx = legacyTx([...writable, ...readonly], [...creates, swap], readonly.length);
  // refused for that very reason (the decoder's own refusal of a pool not quoted in SOL comes after it)
  await refusedTrade(w.signTx(a.id, tx, ""), shown, /^It writes to more accounts than its test run can read\./);
  assert.ok(!asked.at(-1)!.includes(walletX), "the drained coin account is past the 32 read (the attack's premise)");
});
