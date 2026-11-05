// Phone test, 5 Nov (rule 4): a SELL of a Solana coin asked for Face ID. Trading wallets never ask inside a session;
// only a send to an outside address asks, every time.
//
// The cause was not the decoder: every sale Trade's own routes build reads as one sale (pump.fun's curve, PumpSwap,
// Raydium CPMM, Raydium LaunchLab, Meteora DBC, Meteora DAMM v2 and a Jupiter route), with only the wallet's own wSOL
// and coin accounts closed back to it, and never as a transfer out (the first tests, per venue, each with a control).
// It was the step after the sheet: a sale that puts up the one-tap sheet (a coin with no market price, or one past the
// cap) was answered Approve, and then the core asked the browser's passkey (safeStepUp: Face ID on an iPhone, Touch ID on
// a Mac), a check that exists for the Safe's own key only. The step-up now skips a hot key's one-tap sheet (`tap`, set
// only by the core's hot-key sheets); a send to an outside address (no `tap`) and the Safe still ask, every time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge, BridgeResult } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import type { PlainWords } from "./signer.ts";
import { base58, base64, cat, fromBase58, u64le } from "./sol/bytes.ts";
import { decodeSolTx, ownWsol } from "./sol/decode.ts";
import { payoutRefusal } from "./sol/payout.ts";
import { SOL, ownTokenAccount, sessionRefusal } from "./solana.ts";
import type { SolChain, Simulated } from "./solana.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { fairCoins } from "./testing/sol-coins.ts";
import { MemoryVault } from "./vault.ts";

const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}: ${r.problem.more ?? ""}`);
  return r.ok;
};
const BLOCKHASH = base58(new Uint8Array(32).fill(5));
const stand = (n: number) => base58(new Uint8Array(32).fill(n));
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
const disc = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
const PROGRAM = {
  pump: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", pumpswap: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  cpmm: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", dbc: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
  damm2: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", launchlab: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
};

/**
 * Trade's real sales, byte for byte (packages/trade/src/sol/fixtures/sol-golden.json: the messages its golden test pins
 * the port to): pump.fun's curve (half, and all: the coin account closed too), PumpSwap (all), Raydium CPMM (all) and
 * Raydium LaunchLab (all). Each as the core gets it: one empty signature, then the message.
 */
const golden = JSON.parse(readFileSync(new URL("../../trade/src/sol/fixtures/sol-golden.json", import.meta.url), "utf8")) as { cases: { name: string; side: string; owner: string; message?: string }[] };
const goldenSales = golden.cases.filter((c) => c.side === "sell" && c.message).map((c) => ({ name: c.name, owner: c.owner, tx: base64(cat([1], new Uint8Array(64), Uint8Array.from(Buffer.from(c.message!, "base64")))) }));

/** Trade's plumbing around a sale (curve-trade.ts, direct.ts): compute budget, its own wSOL account made, the swap, the
 *  wSOL account closed back to it, and on a sale of all the coin's account too. */
function sale(owner: string, coin: string, swap: Ix, all = false): string {
  const wsol = ownWsol(owner);
  const cu = (op: number, v: bigint, n: number) => cat([op], u64le(v).subarray(0, n));
  return legacyTx(owner, [
    { program: SOL.computeBudget, accounts: [], data: cu(2, 160_000n, 4) },
    { program: SOL.computeBudget, accounts: [], data: cu(3, 1_000n, 8) },
    { program: SOL.ata, accounts: [owner, wsol, owner, SOL.wsol, SOL.system, SOL.token], data: new Uint8Array([1]) },
    swap,
    { program: SOL.token, accounts: [wsol, owner, owner], data: new Uint8Array([9]) },
    ...(all ? [{ program: SOL.token, accounts: [ownTokenAccount(owner, coin), owner, owner], data: new Uint8Array([9]) }] : []),
  ]);
}
const amounts = (a: bigint, b: bigint) => cat(u64le(a), u64le(b));
/** The swap instruction of each venue Trade sells through, in its own account order (sol/decode.ts swapOf reads these). */
const VENUE_SALES: { venue: string; swap: (owner: string, coin: string) => Ix }[] = [
  { venue: "pump.fun", swap: (o, c) => ({ program: PROGRAM.pump, accounts: [stand(0xd1), c, SOL.wsol, SOL.token, SOL.token, stand(0xd2), stand(0xd3), stand(0xd4), o, ownTokenAccount(o, c), ownWsol(o), stand(0xd5), stand(0xd6), stand(0xd7), SOL.system, stand(0xd8), PROGRAM.pump], data: cat(disc("1c92de7726c469d5"), amounts(1_000_000n, 900_000_000n)) }) },
  { venue: "PumpSwap", swap: (o, c) => ({ program: PROGRAM.pumpswap, accounts: [stand(0xe0), o, stand(0xe1), c, SOL.wsol, ownTokenAccount(o, c), ownWsol(o), stand(0xe2), stand(0xe3), stand(0xe4), stand(0xe5), SOL.token, SOL.token, SOL.system, SOL.ata, stand(0xe6), PROGRAM.pumpswap], data: cat(disc("5df6823ce7e940b2"), amounts(1_000_000n, 900_000_000n)) }) },
  { venue: "Raydium", swap: (o, c) => ({ program: PROGRAM.cpmm, accounts: [o, stand(0xf0), stand(0xf1), stand(0xf2), ownTokenAccount(o, c), ownWsol(o), stand(0xf3), stand(0xf4), SOL.token, SOL.token, c, SOL.wsol, stand(0xf5)], data: cat(disc("8fbe5adac41e33de"), amounts(1_000_000n, 900_000_000n)) }) },
  { venue: "Meteora DBC", swap: (o, c) => ({ program: PROGRAM.dbc, accounts: [stand(0xa0), stand(0xa1), stand(0xa2), ownTokenAccount(o, c), ownWsol(o), stand(0xa3), stand(0xa4), c, SOL.wsol, o, SOL.token, SOL.token, PROGRAM.dbc, stand(0xa6), PROGRAM.dbc], data: cat(disc("414b3f4ceb5b5b88"), amounts(1_000_000n, 900_000_000n), [0]) }) },
  { venue: "Meteora DAMM v2", swap: (o, c) => ({ program: PROGRAM.damm2, accounts: [stand(0xb0), stand(0xb1), ownTokenAccount(o, c), ownWsol(o), stand(0xb2), stand(0xb3), c, SOL.wsol, o, SOL.token, SOL.token, PROGRAM.damm2, stand(0xb5), PROGRAM.damm2], data: cat(disc("414b3f4ceb5b5b88"), amounts(1_000_000n, 900_000_000n), [0]) }) },
  { venue: "Raydium LaunchLab", swap: (o, c) => ({ program: PROGRAM.launchlab, accounts: [o, stand(0xc0), stand(0xc1), stand(0xc2), stand(0xc3), ownTokenAccount(o, c), ownWsol(o), stand(0xc4), stand(0xc5), c, SOL.wsol, SOL.token, SOL.token, stand(0xc6), stand(0xc7)], data: cat(disc("9527de9bd37c981a"), amounts(1_000_000n, 900_000_000n), u64le(0n)) }) },
  // a Jupiter exact-in `route`: authority @1, source (its own coin account) @2, destination (its own wSOL account) @3, out mint @5
  { venue: "Jupiter", swap: (o, c) => ({ program: SOL.jupiter, accounts: [SOL.token, o, ownTokenAccount(o, c), ownWsol(o), SOL.jupiter, SOL.wsol, SOL.jupiter], data: cat(disc("e517cb977ae3ad2a"), [1, 0, 0, 0, 7, 100, 0, 1], u64le(1_000_000n), u64le(950_000_000n), [50, 0], [0]) }) },
];
const ME = stand(0x31), COIN = stand(0x77), STRANGER = stand(0x99);

test("rule 4: every sale Trade's own routes build reads as one sale, never as a send: the goldens, byte for byte", () => {
  assert.equal(goldenSales.length, 5, "pump.fun half and all, PumpSwap all, Raydium CPMM all, LaunchLab all");
  for (const s of goldenSales) {
    const d = decodeSolTx(s.tx);
    assert.equal(d.swaps.length, 1, s.name);
    assert.equal(d.swaps[0]!.side, "sell", s.name);
    assert.deepEqual([d.transfers, d.tokenMoves, d.unreadSteps, d.unreadTokenSteps, d.unknownPrograms], [[], [], [], 0, []], `${s.name}: nothing but the sale`);
    assert.ok(d.closedTo.length >= 1 && d.closedTo.every((to) => to === s.owner), `${s.name}: its wSOL (and on a sale of all, the coin's) account closes back to the wallet`);
    assert.equal(sessionRefusal(s.tx, s.owner), null, s.name);
    assert.equal(payoutRefusal(d, s.tx, [], s.owner), null, s.name);
  }
});

for (const v of VENUE_SALES) {
  test(`rule 4, ${v.venue}: a sale (and a sale of all, its coin account closed) reads as one sale with nothing sent; control: one more SOL transfer to an outside address reads as a send`, () => {
    for (const all of [false, true]) {
      const d = decodeSolTx(sale(ME, COIN, v.swap(ME, COIN), all));
      assert.deepEqual(d.swaps.map((x) => [x.venue, x.side]), [[v.venue, "sell"]], `${v.venue}${all ? ", all" : ""}`);
      assert.deepEqual([d.transfers, d.tokenMoves, d.unreadSteps], [[], [], []]);
      assert.deepEqual(d.closedTo, all ? [ME, ME] : [ME], "the wSOL unwrap (a close) and the coin account's close pay the wallet itself");
    }
    // control: the same sale with SOL to someone else is a transfer out, said as one, and never covered
    const withSend = legacyTx(ME, [v.swap(ME, COIN), { program: SOL.system, accounts: [ME, STRANGER], data: cat([2, 0, 0, 0], u64le(5_000_000_000n)) }]);
    assert.deepEqual(decodeSolTx(withSend).transfers, [{ to: STRANGER, lamports: "5000000000" }]);
    assert.match(sessionRefusal(withSend, ME) ?? "", /moves SOL to an account this wallet doesn't own/);
  });
}

/** A core on a host with no Face ID sheet of its own (the web: the iPhone's Safari, a Mac), whose step-up is the passkey:
 *  Face ID or Touch ID. `stepUps` counts every time it was asked. The shell's sheet answers yes. */
async function webCore(sim: Partial<Simulated>, stepUp = true, answer = true) {
  const chain = new FakeChain();
  const stepUps: string[] = [];
  const shown: PlainWords[] = [];
  const sol: SolChain = {
    blockhashValid: async () => true, mintDecimals: async () => 6, lookupTables: async () => [], executable: async (keys) => keys.map(() => false),
    simulate: async (tx: string) => ({ ok: true, agreed: true, servers: 2, lamportsBefore: 10_000_000_000n, lamportsAfter: 10_000_000_000n, tokens: fairCoins(tx), ...sim }),
    balance: async () => 10_000_000_000n, latestBlockhash: async () => BLOCKHASH, tokenAccounts: async () => [],
  } as unknown as SolChain;
  const wasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
  const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => wasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, userVerified: async () => true, sol, nativeUsd: async () => 150,
    safeStepUp: async (reason) => (stepUps.push(reason), stepUp) });
  let yes = true; // the account's set-up says yes; the trade's sheet says `answer`
  (core as Bridge).on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => (shown.push(words), void core.call("approval.answer", { id, approve: yes })));
  ok(await core.call("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  const w = ok(await core.call<{ id: string; address: string }>("subwallet.create", { kind: "trade", chain: "sol", app: "trade" }));
  stepUps.length = 0;
  shown.length = 0;
  yes = answer;
  return { core, w, stepUps, shown };
}

test("rule 4, the test phone: Trade's own Solana sale that puts up the one-tap sheet signs on that tap, with no Face ID after it (the old code asked the passkey)", async () => {
  // a coin with no market price yet ($150 of SOL back): the sheet asks, one tap ("Its price couldn't be read")
  for (const v of VENUE_SALES) {
    const { core, w, stepUps, shown } = await webCore({ lamportsAfter: 10_000_000_000n + 1_000_000_000n });
    const got = await core.call<{ signedTx?: string }>("subwallet.signTx", { app: "trade", id: w.id, tx: sale(w.address, COIN, v.swap(w.address, COIN), true), why: `Sell on ${v.venue}` });
    assert.ok("ok" in got && got.ok.signedTx, `${v.venue}: signed (${"problem" in got ? got.problem.more : ""})`);
    assert.equal(shown.length, 1, `${v.venue}: the one-tap sheet`);
    assert.equal(shown[0]!.tap, true, `${v.venue}: one tap, never Face ID`);
    assert.deepEqual(stepUps, [], `${v.venue}: no passkey (Face ID) after the tap; the code before asked it once here`);
  }
});

test("rule 4 controls: a send to an outside address past the cap still asks Face ID after the sheet, every time; a failed check signs nothing", async () => {
  // Home's Send of 1 SOL ($150, past the $100 cap) from the Solana wallet to a stranger: the sheet with no tap, then the passkey
  for (let n = 1; n <= 2; n++) {
    const { core, stepUps, shown } = await webCore({});
    const r = await core.call<{ status: string }>("subwallet.send", { app: "wallet", chain: "sol", to: STRANGER, amount: "1" });
    assert.equal(shown.length, 1);
    assert.equal(shown[0]!.tap, undefined, "Face ID's sheet");
    assert.equal(stepUps.length, 1, `send ${n}: asked again`);
    assert.ok(!("ok" in r) || r.ok.status !== "done");
  }
  // the passkey says no: declined, nothing signed or sent
  const no = await webCore({}, false);
  assert.equal(ok(await no.core.call<{ status: string }>("subwallet.send", { app: "wallet", chain: "sol", to: STRANGER, amount: "1" })).status, "declined");
  assert.equal(no.stepUps.length, 1);
});

test("the audit's pin: with the tap-skip in place, an outside payee's sheet still asks the passkey after Approve; control: the same send past the cap to the person's own wallet is one tap and asks none", async () => {
  const out = await webCore({});
  await out.core.call("subwallet.send", { app: "wallet", chain: "sol", to: STRANGER, amount: "1" });
  assert.equal(out.shown.length, 1);
  assert.equal(out.shown[0]!.tap, undefined, "an outside payee: the sheet carries no tap");
  assert.equal(out.stepUps.length, 1, "an outside payee: the passkey (Face ID) is asked");
  // control: past the cap to one of the person's own wallets (decision C: one tap)
  const own = await webCore({});
  const mine = ok(await own.core.call<{ address: string }>("subwallet.create", { kind: "browser", chain: "sol" }));
  await own.core.call("subwallet.send", { app: "wallet", chain: "sol", to: mine.address, amount: "1" });
  assert.equal(own.shown.length, 1);
  assert.equal(own.shown[0]!.tap, true, "their own wallet: one tap");
  assert.deepEqual(own.stepUps, [], "their own wallet: no passkey");
});

test("rule 4 control: the same sale's one-tap sheet answered no signs nothing and asks nothing more", async () => {
  const { core, w, stepUps, shown } = await webCore({ lamportsAfter: 10_000_000_000n + 1_000_000_000n }, true, false);
  const r = ok(await core.call<{ signedTx?: string; declined?: true }>("subwallet.signTx", { app: "trade", id: w.id, tx: sale(w.address, COIN, VENUE_SALES[0]!.swap(w.address, COIN)), why: "Sell" }));
  assert.deepEqual([r.declined, r.signedTx], [true, undefined]);
  assert.equal(shown[0]!.tap, true);
  assert.deepEqual(stepUps, []);
});
