import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { scrypt } from "@noble/hashes/scrypt.js";
import type { PlainWords } from "./signer.ts";
import { base58, base64, cat, fromBase58, fromBase64, u64le, utf8 } from "./sol/bytes.ts";
import { decodeTx } from "./sol/wire.ts";
import { SOL, extensionSolSecret, ownTokenAccount, solAddress } from "./solana.ts";
import type { SolChain, Simulated } from "./solana.ts";
import { SubWallets, type SubWallet } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { fairCoins } from "./testing/sol-coins.ts";
import { HOT_ROOT, hotRoot } from "./hot-keys.ts";
import { tradeCalls } from "./testing/trade-calls.ts";

/** The Extension's linked wallet, as import adds it (without the link's scrypt): since D55 the only wallet with a
 *  wallet's own session (the chain wallets are shared, so they go fast only through Trade's session, Trade's calls). */
const extensionOf = (w: SubWallets): Promise<SubWallet> => (w as any).add("extension", crypto.getRandomValues(new Uint8Array(32)), "extension", "Extension wallet");

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const BLOCKHASH = base58(new Uint8Array(32).fill(5));

/** A legacy Solana transaction: `keys[0]` pays and is the only signer; one empty signature slot. */
function legacyTx(keys: string[], ixs: { program: string; accounts: string[]; data: Uint8Array }[], readonlyUnsigned: number, nonceFirst = false): string {
  const at = (k: string) => keys.indexOf(k);
  const parts: (Uint8Array | number[])[] = [[1, 0, readonlyUnsigned], [keys.length], ...keys.map(fromBase58), fromBase58(BLOCKHASH), [ixs.length]];
  for (const ix of ixs) parts.push([at(ix.program), ix.accounts.length, ...ix.accounts.map(at), ix.data.length], ix.data);
  void nonceFirst;
  return base64(cat([1], new Uint8Array(64), cat(...parts)));
}
const u32 = (n: number) => new Uint8Array([n, 0, 0, 0]);

/** The coin the buys here buy (a stand-in mint). */
const COIN = base58(new Uint8Array(32).fill(0x5c));
const stand = (n: number) => base58(new Uint8Array(32).fill(n));
/**
 * pump.fun's accounts as Trade builds them (buy_exact_quote_in_v3 / sell_v3, 17 accounts), so the core's payout check
 * (sol/decode.ts payoutRefusal) reads where it pays: global @0, the coin's mint @1, wSOL @2, the coin's token program @3,
 * Token @4, the curve and its two accounts @5-@7, the user @8, the user's own coin account @9, its own wSOL account @10,
 * then volume, fee config, buyback, System, event authority and pump.fun itself (stand-ins at fixed addresses).
 */
const pumpAccounts = (wallet: string, coin: string) => [stand(0xd1), coin, SOL.wsol, SOL.token, SOL.token, stand(0xd2), stand(0xd3), stand(0xd4), wallet, ownTokenAccount(wallet, coin), ownTokenAccount(wallet, SOL.wsol), stand(0xd5), stand(0xd6), stand(0xd7), SOL.system, stand(0xd8), PUMP];
/** A legacy transaction from `ixs`, the wallet first and the only signer; programs read-only, every other account writable. */
function txOf(wallet: string, ixs: { program: string; accounts: string[]; data: Uint8Array }[]): string {
  const programs = [...new Set(ixs.map((i) => i.program))];
  const keys = [wallet, ...new Set(ixs.flatMap((i) => i.accounts).filter((k) => k !== wallet && !programs.includes(k))), ...programs];
  return legacyTx(keys, ixs, programs.length);
}

/** A pump.fun buy the way Trade builds it: wrap SOL into the wallet's own account, sync it, buy. */
function buy(wallet: string, lamports: bigint, wrapInto = ownTokenAccount(wallet, SOL.wsol)): string {
  return txOf(wallet, [
    { program: SOL.system, accounts: [wallet, wrapInto], data: cat(u32(2), u64le(lamports)) },
    { program: SOL.token, accounts: [wrapInto], data: new Uint8Array([17]) },
    { program: PUMP, accounts: pumpAccounts(wallet, COIN), data: cat(Uint8Array.from([0xe1, 0xf7, 0x50, 0x1e, 0xd5, 0xb3, 0x84, 0x88]), u64le(lamports), u64le(1000n)) },
  ]);
}

function setup(sim: Partial<Simulated> = {}, valid = true) {
  const shown: PlainWords[] = [];
  const events: unknown[] = [];
  let answer = true;
  const sol: SolChain = {
    blockhashValid: async () => valid,
    mintDecimals: async () => 6,
    simulate: async (tx: string) => ({ tokens: fairCoins(tx), ok: true, agreed: true, lamportsBefore: 10_000_000_000n, lamportsAfter: 9_900_000_000n, ...sim }),
    lookupTables: async () => [],
  };
  // SOL at $150 (BNB and ETH at $100): a checked trade has a price, and the ones here are inside the caps
  const w = new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol, usdPrice: async (c) => (c === "sol" ? 150 : 100), approve: async (words) => (shown.push(words), answer), emit: (e, p) => events.push([e, p]) });
  return { w, shown, events, say: (yes: boolean) => (answer = yes) };
}

/** D143: a hot key's refusal, named, with nothing signed. */
const notSigned = (e: any) => e.problem?.code === "security.subwallet.refused" && /Nothing was signed\.$/.test(e.problem.more);
/** notSigned, for a wallet's own trade refused (its own code, security.trade.not-signed). */
const notSignedTrade = (e: any) => e.problem?.code === "security.trade.not-signed" && /Nothing was signed\.$/.test(e.problem.more);
/** The cause a refusal names ("It isn't one trade"), as a sheet's first warning says it (a full stop or not). */
const causeOf = (more: string) => more.replace(/\. Nothing was signed\.$/, "");
const sameCause = (warning: string | undefined, cause: string) => (warning ?? "").replace(/\.$/, "").toLowerCase() === cause.toLowerCase();

test("D143: a new trading wallet signs a checked trade with no sheet, as the only signer", async () => {
  const { w, shown } = setup();
  const wallet = await w.create("trade", "sol");
  assert.deepEqual((await w.list()).map((x) => x.id), [wallet.id]);
  const out = await w.signTx(wallet.id, buy(wallet.address, 100_000_000n), "Buy BONK on pump.fun");
  assert.equal(shown.length, 0, "a hot key never asks");
  const signed = decodeTx(out.signedTx);
  assert.ok(ed25519.verify(signed.signatures[0], signed.message, fromBase58(wallet.address)));
});

test("D143: a checked trade signs with no sheet; SOL wrapped into someone else's account or a token approval is refused, nothing signed, session or not", async () => {
  const { w, shown } = setup();
  const ext = await extensionOf(w);
  const trade = await w.create("trade", "sol");
  assert.deepEqual(Object.keys(await w.sessionStart(ext.id, "200000000", "300000000", 15)), ["endsAtIso"], "the Extension's session starts at once");
  for (const wallet of [ext, trade]) {
    // The control: the wallet's own allowlisted buy signs.
    assert.ok((await w.signTx(wallet.id, buy(wallet.address, 100_000_000n), "")).signedTx);
    // SOL wrapped into an account that isn't the wallet's own is a transfer out: refused.
    await assert.rejects(w.signTx(wallet.id, buy(wallet.address, 100_000_000n, base58(new Uint8Array(32).fill(9))), ""), notSignedTrade, `${wallet.kind}: a wrap into another's account`);
    // A token approval (letting someone else move the coins later) is never signed.
    const approve = legacyTx([wallet.address, base58(new Uint8Array(32).fill(3)), base58(new Uint8Array(32).fill(4)), SOL.token], [{ program: SOL.token, accounts: [base58(new Uint8Array(32).fill(3)), base58(new Uint8Array(32).fill(4)), wallet.address], data: cat([4], u64le(1n)) }], 1);
    await assert.rejects(w.signTx(wallet.id, approve, ""), notSignedTrade, `${wallet.kind}: a token approval`);
  }
  assert.equal(shown.length, 0, "no sheet, ever");
});

/** A pump.fun sell: `tokens` of the coin for at least `minLamports` of SOL, straight back to the wallet. */
function sell(wallet: string, tokens: bigint, minLamports: bigint): string {
  const mint = base58(new Uint8Array(32).fill(7));
  return txOf(wallet, [{ program: PUMP, accounts: pumpAccounts(wallet, mint), data: cat(Uint8Array.from([0x1c, 0x92, 0xde, 0x77, 0x26, 0xc4, 0x69, 0xd5]), u64le(tokens), u64le(minLamports)) }]);
}

test("a sell needs a fair minimum against what it brings back (the study's item 6): else refused, nothing signed, no sheet", async () => {
  // The test run says the sale brings 0.05 SOL back (the wallet's SOL goes up by that much).
  const run = async (minLamports: bigint, back = 50_000_000n) => {
    const { w, shown } = setup({ lamportsBefore: 10_000_000_000n, lamportsAfter: 10_000_000_000n + back });
    const wallet = await extensionOf(w);
    // the Extension's wallet goes with no sheet only inside its own session
    await w.sessionStart(wallet.id, "200000000", "300000000", 15);
    const out = await w.signTx(wallet.id, sell(wallet.address, 1_000_000n, minLamports), "").then(() => "signed", (e) => (notSignedTrade(e) ? "refused" : e));
    assert.equal(shown.length, 0, `no sheet: ${shown[0]?.warnings[0]?.text}`);
    return out;
  };
  assert.equal(await run(45_000_000n), "signed", "10% under what it brings back: signed");
  assert.equal(await run(1n), "refused", "a minimum of one lamport (a dump into a sandwich)");
  assert.equal(await run(30_000_000n), "refused", "40% under");
  assert.equal(await run(1_000n, 0n), "refused", "the test run shows nothing coming back");
});

test("nodes that disagree, a failed test run, a stale blockhash or a durable nonce never sign", async () => {
  const disagree = setup({ agreed: false });
  const a = await extensionOf(disagree.w);
  await disagree.w.sessionStart(a.id, "200000000", "300000000", 15);
  await assert.rejects(disagree.w.signTx(a.id, buy(a.address, 100_000_000n), ""), (e: any) => notSignedTrade(e) && /didn't agree/.test(e.problem.more));
  assert.equal(disagree.shown.length, 0);
  const failed = setup({ ok: false });
  const f = await failed.w.create("trade", "sol");
  await assert.rejects(failed.w.signTx(f.id, buy(f.address, 100_000_000n), ""), (e: any) => notSignedTrade(e) && /test run of it didn't go through/.test(e.problem.more));
  assert.equal(failed.shown.length, 0);

  const stale = setup({}, false);
  const b = await stale.w.create("trade", "sol");
  await assert.rejects(stale.w.signTx(b.id, buy(b.address, 1n), ""), (e: any) => e.problem.code === "security.subwallet.expired");

  const { w } = setup();
  const c = await w.create("trade", "sol");
  const nonce = legacyTx([c.address, base58(new Uint8Array(32).fill(6)), SOL.system], [{ program: SOL.system, accounts: [base58(new Uint8Array(32).fill(6)), c.address], data: u32(4) }], 1);
  await assert.rejects(w.signTx(c.id, nonce, ""), (e: any) => e.problem.code === "security.subwallet.refused");
  const other = legacyTx([base58(new Uint8Array(32).fill(8)), c.address, SOL.system], [{ program: SOL.system, accounts: [c.address, c.address], data: cat(u32(2), u64le(1n)) }], 1);
  await assert.rejects(w.signTx(c.id, other, ""), (e: any) => e.problem.code === "security.subwallet.refused");
});

test("the key is shown only after the sheet, as a 64-byte Solana keypair", async () => {
  const { w, say } = setup();
  const wallet = await w.create("trade", "sol");
  say(false);
  assert.deepEqual(await w.export(wallet.id), { declined: true });
  say(true);
  const { secretKey } = (await w.export(wallet.id)) as { secretKey: string };
  const pair = fromBase58(secretKey);
  assert.equal(pair.length, 64);
  assert.equal(base58(pair.subarray(32)), wallet.address);
});

test("linking the extension: the phone's code opens the panel's QR once, and gives the extension's own address", async () => {
  // Extension's pinned vector: a seed of 32 × 0x07 is this Solana address.
  assert.equal(solAddress(extensionSolSecret(new Uint8Array(32).fill(7))), "61mKCjtjjyngrdVDYJNTc3LDAqYmamrvT8y9yvPyuDxt");
  const { w } = setup();
  const seal = async (code: string, seed: Uint8Array) => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey("raw", new Uint8Array(scrypt(utf8(code), salt, { N: 2 ** 17, r: 8, p: 1, dkLen: 32 })), "AES-GCM", false, ["encrypt"]);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8("zerofee-extension/link/v1") }, key, seed));
    return base64(utf8(JSON.stringify({ v: 1, salt: base64(salt), iv: base64(iv), ct: base64(ct) })));
  };
  const { code } = w.linkStart("extension");
  const typed = code.replace("-", ""); // what the panel normalises it to
  const wallets = await w.import("extension", await seal(typed, new Uint8Array(32).fill(7)));
  assert.equal(wallets[0].address, "61mKCjtjjyngrdVDYJNTc3LDAqYmamrvT8y9yvPyuDxt");
  // Single use: the same QR again finds no code waiting.
  await assert.rejects(w.import("extension", await seal(typed, new Uint8Array(32).fill(7))), (e: any) => e.problem.code === "security.link.expired");
  // A different code doesn't open it.
  w.linkStart("extension");
  await assert.rejects(w.import("extension", await seal("WRONGCODE0", new Uint8Array(32).fill(7))), (e: any) => e.problem.code === "security.link.wrong");
});

test("ending every session at once, as the shell does when the phone locks", async () => {
  const { w, events } = setup();
  const a = await extensionOf(w);
  await w.sessionStart(a.id, "100000000", "200000000", 15);
  w.endAll("locked");
  assert.deepEqual(events.at(-1), ["subwallet.session.ended", { id: a.id, reason: "locked" }]);
  w.endAll("locked");
  assert.equal(events.length, 1, "nothing left to end");
});

test("two wallets made at the same moment are both kept", async () => {
  const { w } = setup();
  const [a, b] = await Promise.all([w.create("trade", "sol"), w.create("browser", "sol")]);
  assert.deepEqual((await w.list()).map((x) => x.id).sort(), [a.id, b.id].sort());
});

test("an Extension session's caps are checked in dollars at the core's own price, with no sheet", async () => {
  const shown: PlainWords[] = [];
  const sol = { blockhashValid: async () => true, mintDecimals: async () => 6, simulate: async (tx: string) => ({ tokens: fairCoins(tx), ok: true, agreed: true, lamportsBefore: 0n, lamportsAfter: 0n }), lookupTables: async () => [] };
  const priced = (price: number | null) => new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol, evm: {} as any, approve: async (words) => (shown.push(words), true), emit: () => {}, usdPrice: async () => price });
  const w = priced(100);
  const wallet = await extensionOf(w);
  assert.ok((await w.sessionStart(wallet.id, "500000000", "2500000000", 15)).endsAtIso); // 0.5 SOL ($50) a trade, 2.5 SOL ($250) in all
  assert.equal(shown.length, 0, "no sheet");
  // An app whose own price was ten times too low asks for ten times the caps: refused.
  await assert.rejects(w.sessionStart(wallet.id, "5000000000", "25000000000", 15), (e: any) => e.problem.code === "security.request.not-allowed");
  // No price to check against: no session (each trade still asks on its own).
  const blind = priced(null);
  const other = await extensionOf(blind);
  await assert.rejects(blind.sessionStart(other.id, "500000000", "2500000000", 15), (e: any) => e.problem.code === "security.partner.unreachable");
});

test("the private pocket: one NEAR wallet with its own implicit account; it signs no transactions", async () => {
  const { w } = setup();
  await assert.rejects(w.create("private", "sol"), (e: any) => e.problem.code === "security.request.invalid");
  await assert.rejects(w.create("pay", "near"), (e: any) => e.problem.code === "security.request.invalid");
  // the NEAR coin wallet (Rhea trades, 3 Nov) is NEAR's one other wallet: one only, and it signs no plain transaction either
  const coins = await w.create("browser", "near");
  assert.equal(coins.label, "NEAR coin wallet");
  assert.equal((await w.create("browser", "near")).id, coins.id, "asking again gives the same one");
  await assert.rejects(w.signTx(coins.id, "AAAA", ""), (e: any) => e.problem.code === "security.subwallet.refused");
  const pocket = await w.create("private", "near");
  assert.match(pocket.address, /^[0-9a-f]{64}$/);
  assert.equal(pocket.label, "Private pocket");
  await assert.rejects(w.create("private", "near"), (e: any) => e.problem.code === "security.request.invalid");
  await assert.rejects(w.signTx(pocket.id, "AAAA", ""), (e: any) => e.problem.code === "security.subwallet.refused");
});

test("trading wallets: five per chain by slot; none given means 0; wallets made before slots are numbered in the order they were made", async () => {
  const { w } = setup();
  const first = await w.create("trade", "sol");
  assert.equal(first.slot, 0);
  assert.deepEqual(await w.create("trade", "sol"), first, "asking again gives slot 0's wallet");
  const third = await w.create("trade", "sol", 3);
  assert.equal(third.slot, 3);
  assert.notEqual(third.address, first.address);
  assert.deepEqual(await w.create("trade", "sol", 3), third);
  assert.equal((await w.create("trade", "hood", 3)).slot, 3, "each chain has its own five");
  for (const bad of [5, -1, 1.5, "2"]) await assert.rejects(w.create("trade", "sol", bad), (e: any) => e.problem.code === "security.request.invalid", String(bad));
  await assert.rejects(w.create("trade", "near", 1), (e: any) => e.problem.code === "security.request.invalid", "the float has no slots");
  await assert.rejects(w.create("browser", "base", 1), (e: any) => e.problem.code === "security.request.invalid");
  assert.deepEqual((await w.list()).filter((x) => x.chain === "sol").map((x) => x.slot), [0, 3]);

  // An account from before slots: two Solana trading wallets in the list, no slot stored.
  const vault = new MemoryVault();
  const sol: SolChain = { blockhashValid: async () => true, mintDecimals: async () => 6, simulate: async (tx: string) => ({ tokens: fairCoins(tx), ok: true, agreed: true, lamportsBefore: 0n, lamportsAfter: 0n }), lookupTables: async () => [] };
  const old = new SubWallets({ vault, sol, approve: async () => true, emit: () => {} });
  const a = await old.create("trade", "sol", 0);
  const b = await old.create("trade", "sol", 1);
  const raw = JSON.parse(new TextDecoder().decode((await vault.get("subwallets"))!));
  await vault.put("subwallets", new TextEncoder().encode(JSON.stringify(raw.map(({ slot, ...rest }: any) => rest))));
  assert.deepEqual((await old.list()).map((x) => [x.id, x.slot]), [[a.id, 0], [b.id, 1]]);
  assert.equal((await old.create("trade", "sol", 1)).id, b.id);
  assert.equal((await old.create("trade", "sol", 2)).slot, 2);
});

test("the Trade session: starts with no sheet and gates nothing; its caps are still bounded; the lock ends it", async () => {
  const shown: PlainWords[] = [];
  const events: unknown[] = [];
  // What a trade takes out of the wallet, as the two nodes' test run says.
  let spend = 0n;
  const sol: SolChain = { blockhashValid: async () => true, mintDecimals: async () => 6, simulate: async (tx: string) => ({ tokens: fairCoins(tx), ok: true, agreed: true, lamportsBefore: 10_000_000_000n, lamportsAfter: 10_000_000_000n - spend }), lookupTables: async () => [] };
  const usdPrice = async (c: string) => (c === "sol" ? 150 : c === "bsc" ? 600 : null);
  const w = tradeCalls(new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol, usdPrice, approve: async (words) => (shown.push(words), true), emit: (e, p) => events.push([e, p]) }));
  const a = await w.create("trade", "sol", 0);
  const b = await w.create("trade", "sol", 1);
  for (const [per, total] of [[101, 500], [100, 501], [0, 100], [50, 20]]) {
    await assert.rejects(w.tradeSessionStart(per, total, 30), (e: any) => /request\.(not-allowed|invalid)/.test(e.problem.code), `${per}/${total}`);
  }
  await assert.rejects(w.tradeSessionStart("100", 500, 30), (e: any) => e.problem.code === "security.request.invalid", "dollars are numbers");
  assert.ok((await w.tradeSessionStart(100, 200, 30)).endsAtIso);
  // Trades from slot 0 and slot 1 sign on the core's checks alone.
  spend = 500_000_000n;
  assert.ok((await w.signTx(a.id, buy(a.address, spend), "")).signedTx);
  assert.ok((await w.signTx(b.id, buy(b.address, spend), "")).signedTx);
  w.endAll("locked");
  assert.deepEqual(events.at(-1), ["subwallet.session.ended", { id: "trade", reason: "locked" }]);
  // The session never gated anything: after the lock a checked trade still signs, and a risky one is still refused.
  spend = 100_000_000n;
  assert.ok((await w.signTx(a.id, buy(a.address, spend), "")).signedTx);
  await assert.rejects(w.signTx(a.id, buy(a.address, spend, base58(new Uint8Array(32).fill(9))), ""), notSignedTrade);
  assert.equal(shown.length, 0, "no sheet, ever");
});

test("the Trade session: its first trade is bounded in dollars at the core's own price (no price, no first trade), and signed with no sheet", async () => {
  let spend = 200_000_000n;
  const sol: SolChain = { blockhashValid: async () => true, mintDecimals: async () => 6, simulate: async (tx: string) => ({ tokens: fairCoins(tx), ok: true, agreed: true, lamportsBefore: 10_000_000_000n, lamportsAfter: 10_000_000_000n - spend }), lookupTables: async () => [] };
  const none = tradeCalls(new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol, usdPrice: async () => null, approve: async () => true, emit: () => {} }));
  const n = await none.create("trade", "sol");
  await assert.rejects(none.tradeSessionStart(100, 500, 30, undefined, "Trade", n.id, buy(n.address, spend)), (e: any) => e.problem.code === "security.partner.unreachable", "no price: the first trade can't be bounded");
  const shown: PlainWords[] = [];
  const w = tradeCalls(new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol, usdPrice: async (c) => (c === "sol" ? 150 : null), approve: async (words) => (shown.push(words), true), emit: () => {} }));
  const a = await w.create("trade", "sol");
  const started = await w.tradeSessionStart(50, 100, 15, "Buy $30 of DOPE", "Trade", a.id, buy(a.address, spend));
  const signed = decodeTx(started.signedTx!);
  assert.ok(ed25519.verify(signed.signatures[0], signed.message, fromBase58(a.address)), "the first trade, signed by this wallet");
  // A first trade may be $50 and its $1 of fees: $50.70 is inside, $52.20 and $60 are over.
  spend = 338_000_000n;
  assert.ok((await w.tradeSessionStart(50, 500, 15, undefined, "Trade", a.id, buy(a.address, spend))).signedTx, "$50.70: inside $50 and its $1 of fees");
  for (const [lamports, usd] of [[348_000_000n, "$52.20"], [400_000_000n, "$60"]] as const) {
    spend = lamports;
    await assert.rejects(w.tradeSessionStart(50, 100, 15, undefined, "Trade", a.id, buy(a.address, spend)), (e: any) => e.problem.code === "security.subwallet.refused" && /bigger than one trade here may be\. Nothing was signed\.$/.test(e.problem.more), `${usd}: over $50 a trade`);
  }
  assert.equal(shown.length, 0, "no sheet, ever");
});

test("a trading wallet never sends SOL straight to another of the person's trading wallets: that would link them on chain", async () => {
  const { w, shown } = setup();
  const a = await w.create("trade", "sol", 0);
  const b = await w.create("trade", "sol", 1);
  const send = (to: string) => legacyTx([a.address, to, SOL.system], [{ program: SOL.system, accounts: [a.address, to], data: cat(u32(2), u64le(1_000_000n)) }], 1);
  await assert.rejects(w.signTx(a.id, send(b.address), ""), (e: any) => e.problem.code === "security.subwallet.refused" && /Use Move instead/.test(e.problem.more)
    // linkability hunt M1 (5 Nov): a Move can be matched by amount and time, so the line promises only what's true
    && /Use Move instead: it goes through Private\./.test(e.problem.more) && !/privately/i.test(e.problem.more));
  // The control: anyone else is refused too (a plain send isn't a trade), but for its own reason, not the link's.
  const someone = solAddress(new Uint8Array(32).fill(9));
  await assert.rejects(w.signTx(a.id, send(someone), ""), (e: any) => notSignedTrade(e) && !/Use Move instead/.test(e.problem.more));
  assert.equal(shown.length, 0, "no sheet, ever");
});

test("Trade's float: one NEAR wallet beside the pocket; it signs no transactions, has no fast sessions and pays nothing privately", async () => {
  const { w, shown } = setup();
  const pocket = await w.create("private", "near");
  const float = await w.create("trade", "near");
  assert.match(float.address, /^[0-9a-f]{64}$/);
  assert.notEqual(float.address, pocket.address);
  assert.deepEqual([float.kind, float.chain, float.label], ["trade", "near", "Your NEAR wallet's cash"]);
  assert.deepEqual(await w.create("trade", "near"), float, "asking again gives the same one");
  assert.equal((await w.list()).filter((x) => x.chain === "near").length, 2);
  await assert.rejects(w.signTx(float.id, "AAAA", ""), (e: any) => e.problem.code === "security.subwallet.refused");
  await assert.rejects(w.sessionStart(float.id, "1", "1", 15), (e: any) => e.problem.code === "security.subwallet.refused");
  await assert.rejects(w.balances(float.id), (e: any) => e.problem.code === "security.request.invalid");
  const intent = { payload: { message: "{}", nonce: "AAAA", recipient: "intents.far" } };
  await assert.rejects(w.privatePay(float.id, "a".repeat(64), intent, ""), (e: any) => e.problem.code === "security.subwallet.refused");
  assert.equal(shown.length, 0, "nothing reached the sheet");
  assert.deepEqual(await w.floatLimits(), { movesLeftToday: 20, perDay: 20, minUsd: 2, open: ["sol", "hood"] });
});

test("audit C1: a site's Solana transaction goes only from its own wallet: on a shared wallet it is refused by name; pump.fun's own wallet on pump.fun sends its checked buy with no sheet, to both nodes and confirmed on both; an unlisted site's own wallet asks (one tap) and a yes sends it; one that fails a check is asked with its cause first, and a no sends nothing (control: the person's own flow is refused)", async () => {
  const sent: string[] = [];
  let seen: ("ok" | "failed" | null)[] = ["ok", "ok"];
  const shown: PlainWords[] = [];
  let answer = true;
  const sol: SolChain = {
    blockhashValid: async () => true, mintDecimals: async () => 6,
    simulate: async (tx: string) => ({ tokens: fairCoins(tx), ok: true, agreed: true, lamportsBefore: 10_000_000_000n, lamportsAfter: 9_900_000_000n }),
    lookupTables: async () => [],
    send: async (signed) => (sent.push(signed), true),
    status: async () => seen,
  };
  const w = new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol, evm: {} as never, usdPrice: async (c) => (c === "sol" ? 150 : null), approve: async (words) => (shown.push(words), answer), emit: () => {}, confirm: { everyMs: 1, forMs: 5 } });
  const PUMP_FUN = { origin: "https://pump.fun" };
  const SITE = { origin: "https://app.example.com" };
  // the shared wallets: refused for any site, nothing read, nothing asked
  for (const shared of [await w.create("browser", "sol"), await w.create("chain", "sol")]) {
    await assert.rejects(w.sendSol(shared.id, buy(shared.address, 100_000_000n), "Buy on pump.fun", PUMP_FUN, "Browser", "browser"), (e: any) => e.problem?.more === "This site can use only its own wallet.");
  }
  assert.deepEqual([shown.length, sent.length], [0, 0]);
  // pump.fun's own wallet, on pump.fun's own page: its checked buy goes with no sheet, to both nodes, confirmed on both
  const pump = await w.create("site", "sol", undefined, "pump");
  const out = await w.sendSol(pump.id, buy(pump.address, 100_000_000n), "Buy on pump.fun", PUMP_FUN, "Browser", "browser");
  const signed = decodeTx(sent[0]);
  assert.ok(ed25519.verify(signed.signatures[0], signed.message, fromBase58(pump.address)));
  assert.deepEqual(out, { status: "done", txHash: base58(signed.signatures[0]), explorerUrl: `https://solscan.io/tx/${base58(signed.signatures[0])}` });
  assert.equal(shown.length, 0, "no sheet for a listed site's own wallet");
  seen = ["ok", null];
  assert.equal(((await w.sendSol(pump.id, buy(pump.address, 1n), undefined, PUMP_FUN, "Browser", "browser")) as any).problem.code, "security.subwallet.unconfirmed");
  seen = ["ok", "ok"];
  // an unlisted site's own wallet: asked, one tap; a yes sends it
  const own = await w.siteFor(SITE, "sol");
  assert.equal((await w.sendSol(own.id, buy(own.address, 1n), undefined, SITE, "Browser", "browser")).status, "done");
  assert.deepEqual(shown.map((x) => [x.warnings[0]?.text, x.tap]), [["app.example.com isn't a site ZeroFee knows, so ZeroFee asks you.", true]]);
  // A site's plain send out of its own wallet isn't a trade: asked, the cause first; a no signs and sends nothing.
  const n = sent.length;
  const chain = await w.create("chain", "sol");
  const away = (from: string) => legacyTx([from, solAddress(new Uint8Array(32).fill(9)), SOL.system], [{ program: SOL.system, accounts: [from, solAddress(new Uint8Array(32).fill(9))], data: cat(u32(2), u64le(1_000_000n)) }], 1);
  // control: from the person's own flow it is refused by name, never asked
  const refusal = await w.sendSol(chain.id, away(chain.address), undefined, undefined, "Browser", "browser").then(() => assert.fail("signed"), (e: any) => (assert.ok(notSignedTrade(e)), causeOf(e.problem.more)));
  answer = false;
  assert.deepEqual(await w.sendSol(own.id, away(own.address), undefined, SITE, "Browser", "browser"), { status: "declined" });
  assert.equal(shown.length, 2);
  assert.ok(sameCause(shown[1]!.warnings[0]?.text?.replace(/, so ZeroFee asks you\.$/, ""), refusal), `the cause first: ${shown[1]!.warnings[0]?.text}`);
  assert.equal(sent.length, n, "nothing sent");
});

// ── One wallet per chain (D55, D56): the CRITICAL caller-bound session, the current wallet, the moves by id ─────────

/** A core whose Solana test runs pass every check (an allowlisted pump.fun buy of 0.1 SOL, $15 at $150); `sim` changes
 *  what the test run says (`servers: 1`: one server's ok, the other silent). */
function shared(sim: Partial<Simulated> = {}) {
  const shown: PlainWords[] = [];
  const sent: string[] = [];
  const sol: SolChain = {
    blockhashValid: async () => true, mintDecimals: async () => 6,
    simulate: async (tx: string) => ({ tokens: fairCoins(tx), ok: true, agreed: true, lamportsBefore: 10_000_000_000n, lamportsAfter: 9_900_000_000n, ...sim }),
    lookupTables: async () => [],
    send: async (signed) => (sent.push(signed), true),
    status: async () => ["ok", "ok"],
  };
  let answer = true;
  const w = new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol, evm: {} as never, usdPrice: async (c) => (c === "sol" ? 150 : null), approve: async (words) => (shown.push(words), answer), emit: () => {}, confirm: { everyMs: 1, forMs: 5 } });
  return { w, shown, sent, say: (yes: boolean) => (answer = yes) };
}

test("CRITICAL (D55, B36), D143 refinement: one server's test run lets only Trade's own buy go with no sheet; the same bytes from every other caller ask (a yes signs); two servers that disagree are refused for every caller; a site's send from its own wallet that isn't a trade asks, its cause first, and a no sends nothing (controls)", async () => {
  const { w, shown, sent, say } = shared({ agreed: false, servers: 1 });
  const wallet = await w.create("chain", "sol");
  // Trade's own buy signs, and says one server checked it
  assert.deepEqual(Object.keys(await w.signTx(wallet.id, buy(wallet.address, 100_000_000n), "", undefined, "Trade", undefined, "trade")).sort(), ["checkedByOne", "signedTx"]);
  assert.equal(shown.length, 0, "Trade's own buy: no sheet");
  // the same bytes from Browser, the apps, Chat or no app: one server isn't two, so the sheet asks; a yes signs
  for (const app of ["browser", "social", "chat", "extension", undefined]) {
    assert.ok("signedTx" in (await w.signTx(wallet.id, buy(wallet.address, 100_000_000n), "", undefined, app, undefined, app)), `${app ?? "no app"}: a yes signs`);
    assert.deepEqual(shown.splice(0).map((x) => x.warnings[0]?.text), ["Only one server could test it, so ZeroFee asks you."], `${app ?? "no app"}: asked`);
  }
  // audit C1: a site asks only from its own wallet (Jupiter's, on jup.ag); one server isn't two, so it asks there too
  const jup = await w.create("site", "sol", undefined, "jupiter");
  assert.equal((await w.sendSol(jup.id, buy(jup.address, 100_000_000n), "", { origin: "https://jup.ag" }, "Browser", "browser")).status, "done");
  assert.equal(shown.splice(0).length, 1, "a site's buy: asked");
  // a site's send that isn't a trade, whatever the servers say: asked, the same cause the person's own flow is refused for
  const wrapAway = buy(wallet.address, 100_000_000n, base58(new Uint8Array(32).fill(9)));
  const refusal = await w.signTx(wallet.id, wrapAway, "", undefined, "Trade", undefined, "trade").then(() => assert.fail("signed"), (e: any) => (assert.ok(notSignedTrade(e), "own flow: refused"), causeOf(e.problem.more)));
  assert.equal(shown.length, 0, "own flow: never asked");
  say(false);
  assert.deepEqual(await w.sendSol(jup.id, buy(jup.address, 100_000_000n, base58(new Uint8Array(32).fill(9))), "", { origin: "https://jup.ag" }, "Browser", "browser"), { status: "declined" }, "SOL wrapped into someone else's account");
  const asked = shown.splice(0);
  assert.equal(asked.length, 1);
  assert.ok(sameCause(asked[0]!.warnings[0]?.text?.replace(/, so ZeroFee asks you\.$/, ""), refusal), `the cause first: ${asked[0]!.warnings[0]?.text}`);
  assert.equal(sent.length, 1, "only the trade was sent");
  // two servers that answered and disagree: refused for every caller, nothing signed, never asked
  const split = shared({ agreed: false, servers: 2 });
  const w2 = await split.w.create("chain", "sol");
  for (const app of ["trade", "browser", "social", "chat", "extension", undefined]) {
    await assert.rejects(split.w.signTx(w2.id, buy(w2.address, 100_000_000n), "", undefined, app, undefined, app), (e: any) => notSignedTrade(e) && /The two Solana servers didn't agree/.test(e.problem.more), `${app ?? "no app"}: disagree`);
  }
  // A wallet's own session is the Extension's only; a chain wallet's trades need none.
  await assert.rejects(w.sessionStart(wallet.id, "200000000", "300000000", 15, undefined, "Trade", undefined, undefined, "trade"), (e: any) => e.problem.code === "security.subwallet.refused" && /already go without asking/.test(e.problem.more));
  assert.equal(shown.length + split.shown.length, 0, "no other sheet");
});

test("review H1, M3, audit C1: one rolling cap over every hot wallet's no-sheet trades: one over $100 (and $1 of fees) asks, and so does one past $500 in any 24 hours, whichever wallet signs it; a no signs nothing (controls: $20 and $100 sign with no sheet; the cap's record is kept in the vault)", async () => {
  let spend = 0n;
  const shown: PlainWords[] = [];
  let answer = false;
  // what a trade takes out of the wallet, as the two nodes' test run says; SOL at $100, so $1 is 0.01 SOL
  const sol: SolChain = { blockhashValid: async () => true, mintDecimals: async () => 6, simulate: async (tx: string) => ({ tokens: fairCoins(tx), ok: true, agreed: true, lamportsBefore: 100_000_000_000n, lamportsAfter: 100_000_000_000n - spend }), lookupTables: async () => [] };
  const w = tradeCalls(new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol, usdPrice: async (c) => (c === "sol" ? 100 : null), approve: async (words) => (shown.push(words), answer), emit: () => {} }));
  const a = await w.create("trade", "sol", 0);
  const trade = (id: string, address: string, usd: number) => ((spend = BigInt(usd) * 10_000_000n), w.signTx(id, buy(address, spend), ""));
  const asked = (why: string) => assert.deepEqual(shown.splice(0).map((x) => x.warnings[0]?.text), [why]);
  // control: $20 signs with no sheet
  assert.ok("signedTx" in (await trade(a.id, a.address, 20)));
  assert.equal(shown.length, 0);
  // $102: over $100 and its $1 of fees: asked; a no signs nothing
  assert.deepEqual(await trade(a.id, a.address, 102), { declined: true });
  asked("It's over $100, so ZeroFee asks you.");
  // the day: $20 and four of $100 is $420, with no sheet; one more $100 would be $520: asked
  for (let i = 0; i < 4; i++) assert.ok("signedTx" in (await trade(a.id, a.address, 100)), `$100, number ${i + 1}`);
  assert.equal(shown.length, 0);
  assert.deepEqual(await trade(a.id, a.address, 100), { declined: true });
  asked("It's past $500 in a day, so ZeroFee asks you.");
  // the person's yes signs it
  answer = true;
  assert.ok("signedTx" in (await trade(a.id, a.address, 100)));
  asked("It's past $500 in a day, so ZeroFee asks you.");
  // audit C1: another wallet is under the same one cap, so it asks too
  answer = false;
  const b = await w.create("trade", "sol", 1);
  assert.deepEqual(await trade(b.id, b.address, 100), { declined: true });
  asked("It's past $500 in a day, so ZeroFee asks you.");
  // a cap record that can't be read counts as a full day, never an empty one
  await ((w as any).o.vault as MemoryVault).put("hot-spent", new TextEncoder().encode("not json"));
  assert.deepEqual(await trade(b.id, b.address, 20), { declined: true });
  asked("It's past $500 in a day, so ZeroFee asks you.");
});

test("the current wallet is index 0 of the current words; after new words it is the new words' index 0, and the old one is older", async () => {
  const { w } = shared();
  const vault = (w as any).o.vault as MemoryVault;
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(1)));
  const sol0 = await w.create("chain", "sol");
  const base0 = await w.create("chain", "base");
  assert.deepEqual([sol0.kind, sol0.current, base0.kind, base0.current], ["trade", true, "browser", true], "Solana's is the trade path, Base's the browser path");
  const older = await w.create("trade", "sol", 2);
  assert.equal(older.current, false, "another slot is an older wallet");
  assert.equal((await w.list()).filter((x) => x.chain === "sol" && x.current).length, 1, "one current wallet per chain");
  await w.markOldWords();
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(2)));
  const fresh = await w.create("chain", "sol");
  assert.notEqual(fresh.address, sol0.address);
  const listed = await w.list();
  assert.deepEqual(listed.filter((x) => x.chain === "sol" && x.current).map((x) => x.id), [fresh.id], "the new words' index 0 is current");
  assert.equal(listed.find((x) => x.id === sol0.id)!.current, false, "the old words' one is older");
  assert.equal(listed.find((x) => x.chain === "base")!.current, false, "every old-words chain wallet is older until its chain's new one is made");
  assert.equal(listed.find((x) => x.kind === "trade" && x.chain === "near"), undefined, "no float was made here");
});

test("asking for a chain's wallet twice gives the same one, never a replaced words' slot-0 wallet", async () => {
  const { w } = shared();
  const vault = (w as any).o.vault as MemoryVault;
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(1)));
  const old0 = await w.create("trade", "sol", 0);
  await w.markOldWords();
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(2)));
  const a = await w.create("chain", "sol");
  const [b, c] = await Promise.all([w.create("chain", "sol"), w.create(undefined, "sol")]);
  assert.notEqual(a.id, old0.id, "not the old words' slot 0");
  assert.deepEqual([b.id, c.id], [a.id, a.id], "the same one, asked at once too");
  assert.equal((await w.create("trade", "sol", 0)).id, a.id, "a legacy slot 0 from the words is matched by address: the new one");
  await assert.rejects(w.create("chain", "near"), (e: any) => e.problem.code === "security.request.invalid");
  await assert.rejects(w.create("chain", "sol", 1), (e: any) => e.problem.code === "security.request.invalid");
});

test("Spending's moves name a wallet by id from the core's own list: an id not in it is refused; a legacy slot still resolves", async () => {
  const asked: any[] = [];
  const sol: SolChain = { blockhashValid: async () => true, mintDecimals: async () => 6, simulate: async () => ({ ok: true, agreed: true, lamportsBefore: 0n, lamportsAfter: 0n }), lookupTables: async () => [] };
  const relay = { quote: async (req: any) => (asked.push(req), Promise.reject(new Error("stop here"))), generateIntent: async () => null, submitIntent: async () => null, status: async () => null };
  const w = new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol, evm: {} as never, floatRelay: relay, usdPrice: async () => 150, approve: async () => true, emit: () => {} });
  await w.create("trade", "near");
  const current = await w.create("chain", "sol");
  const slot3 = await w.create("trade", "sol", 3);
  const hood = await w.create("chain", "hood");
  const key = (n: number) => `trade-job-d55-${String(n).padStart(4, "0")}`;
  const unknown = (e: any) => e.problem.code === "security.subwallet.unknown";
  await assert.rejects(w.floatOut("sol", undefined, "100000000", key(1), "trade-sol-zzzzzz"), unknown, "not in the list");
  await assert.rejects(w.floatOut("sol", undefined, "100000000", key(2), hood.id), unknown, "another chain's wallet");
  await assert.rejects(w.floatOut("sol", undefined, "100000000", key(3), "../trade-sol"), (e: any) => e.problem.code === "security.request.invalid", "not an id");
  await assert.rejects(w.floatOut("sol", 0, "100000000", key(4), current.id), (e: any) => e.problem.code === "security.request.invalid", "an id or a slot, not both");
  assert.equal(asked.length, 0, "nothing asked of 1Click for any of them");
  const to = async (slot: unknown, id?: string) => {
    await w.floatOut("sol", slot, "100000000", key(10 + asked.length), id).catch(() => undefined);
    return asked.at(-1)?.recipient;
  };
  assert.equal(await to(undefined), current.address, "neither: the chain's current wallet");
  assert.equal(await to(undefined, slot3.id), slot3.address, "by id");
  assert.equal(await to(3), slot3.address, "a legacy slot, as a journal from before D55 names it");
});

test("security review 2 Nov (Medium): Spending never fills a wallet of replaced words, by its legacy slot or by its id", async () => {
  // New words are asked for when the old ones may have been seen ("Lost your paper, or someone saw it?"), so a wallet
  // that opens with them is D51's case: its key may be in someone else's hands. Since D55 a create of slot 0 after new
  // words makes the new words' wallet beside the old one, and the legacy slot 0 found the old one first.
  const asked: any[] = [];
  const sol: SolChain = { blockhashValid: async () => true, mintDecimals: async () => 6, simulate: async () => ({ ok: true, agreed: true, lamportsBefore: 0n, lamportsAfter: 0n }), lookupTables: async () => [] };
  const relay = { quote: async (req: any) => (asked.push(req), Promise.reject(new Error("stop here"))), generateIntent: async () => null, submitIntent: async () => null, status: async () => null };
  const vault = new MemoryVault();
  const w = new SubWallets({ vault, sol, evm: {} as never, floatRelay: relay, usdPrice: async () => 150, approve: async () => true, emit: () => {} });
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(1)));
  await w.create("trade", "near");
  const old0 = await w.create("trade", "sol", 0);
  const oldSite = await w.create("browser", "sol");
  const key = (n: number) => `trade-job-oldwords-${String(n).padStart(4, "0")}`;
  // The control: before new words, slot 0 and the site's slot fill those wallets.
  await w.floatOut("sol", 0, "100000000", key(1)).catch(() => undefined);
  assert.equal(asked.at(-1)?.recipient, old0.address, "the control: slot 0 fills the words' slot-0 wallet");
  await w.markOldWords();
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(2)));
  // Audit 2 (4 Nov): the float is made again from the new words (demo-core syncRenew), and only that one fills.
  await w.rotateAfterNewWords();
  const new0 = await w.create("trade", "sol", 0);
  assert.notEqual(new0.address, old0.address);
  const n = asked.length;
  await w.floatOut("sol", 0, "100000000", key(2)).catch(() => undefined);
  assert.equal(asked.at(-1)?.recipient, new0.address, "slot 0 now fills the new words' wallet, the one Trade trades from");
  assert.equal(asked.length, n + 1);
  const oldWords = (e: any) => e.problem?.code === "security.subwallet.refused" && /old words|words you replaced/i.test(JSON.stringify(e.problem));
  await assert.rejects(w.floatOut("sol", undefined, "100000000", key(3), old0.id), oldWords, "the old one, by its id: refused");
  await assert.rejects(w.floatOut("sol", 5, "100000000", key(4)), oldWords, "the old site's wallet (SITE_SLOT), with no new one: refused");
  assert.equal(asked.length, n + 1, "nothing asked of 1Click for either");
  // Its money can still come back.
  assert.equal(oldSite.chain, "sol");
});

test("security review 2 Nov (Low): Spending never fills an older wallet whose key was shown, not even with gas; the current one stays filled (D56)", async () => {
  const asked: any[] = [];
  const sol: SolChain = { blockhashValid: async () => true, mintDecimals: async () => 6, simulate: async () => ({ ok: true, agreed: true, lamportsBefore: 0n, lamportsAfter: 0n }), lookupTables: async () => [] };
  const relay = { quote: async (req: any) => (asked.push(req), Promise.reject(new Error("stop here"))), generateIntent: async () => null, submitIntent: async () => null, status: async () => null };
  const vault = new MemoryVault();
  const w = new SubWallets({ vault, sol, evm: {} as never, floatRelay: relay, usdPrice: async () => 150, approve: async () => true, emit: () => {} });
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(3)));
  await w.create("trade", "near");
  const current = await w.create("chain", "sol");
  const older = await w.create("trade", "sol", 1);
  assert.equal((await w.list()).find((x) => x.id === older.id)?.current, false, "slot 1: an older wallet");
  const key = (n: number) => `trade-job-exported-${String(n).padStart(4, "0")}`;
  // The control: an older wallet's gas, before its key is shown, is asked of 1Click.
  await w.floatOut("sol", undefined, "100000000", key(1), older.id).catch(() => undefined);
  assert.equal(asked.at(-1)?.recipient, older.address, "the control: an older wallet holding coins gets its gas");
  await w.export(older.id);
  await w.export(current.id);
  const n = asked.length;
  await assert.rejects(w.floatOut("sol", undefined, "100000000", key(2), older.id), (e: any) => e.problem?.code === "security.subwallet.refused" && /showed that wallet's key/.test(JSON.stringify(e.problem)), "the exported older one: refused");
  await assert.rejects(w.floatOut("sol", 1, "100000000", key(3)), (e: any) => e.problem?.code === "security.subwallet.refused", "by its legacy slot too");
  assert.equal(asked.length, n, "nothing asked of 1Click");
  await w.floatOut("sol", undefined, "100000000", key(4), current.id).catch(() => undefined);
  assert.equal(asked.at(-1)?.recipient, current.address, "D56: the current wallet, its key shown, is filled as before");
});

test("an Extension session's why is plain text, at most 80 characters", async () => {
  const { w, shown } = setup();
  const wallet = await extensionOf(w);
  assert.ok((await w.sessionStart(wallet.id, "200000000", "300000000", 15, "Buy $1.00 of DOPE", "Trade")).endsAtIso);
  for (const bad of ["x".repeat(81), "Buy \u202Eevil", "line\nbreak", 5]) {
    await assert.rejects(w.sessionStart(wallet.id, "200000000", "300000000", 15, bad, "Trade"), (e: any) => e.problem.code === "security.request.invalid", JSON.stringify(bad));
  }
  assert.equal(shown.length, 0, "no sheet");
});

test("the Extension session's first trade: checked as any trade, no bigger than one trade may be, signed with no sheet; a refused one starts nothing", async () => {
  const shown: PlainWords[] = [];
  const events: unknown[] = [];
  let sim: Partial<Simulated> = {};
  const sol: SolChain = {
    blockhashValid: async () => true, mintDecimals: async () => 6,
    simulate: async (tx: string) => ({ tokens: fairCoins(tx), ok: true, agreed: true, lamportsBefore: 10_000_000_000n, lamportsAfter: 9_900_000_000n, ...sim }),
    lookupTables: async () => [],
  };
  const w = new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol, evm: {} as never, approve: async (words) => (shown.push(words), true), emit: (e, p) => events.push([e, p]), usdPrice: async () => 100 });
  const wallet = await extensionOf(w);

  const started = await w.sessionStart(wallet.id, "200000000", "250000000", 15, "Buy $10.00 of BONK", "Trade", buy(wallet.address, 100_000_000n));
  const signed = decodeTx(started.signedTx!);
  assert.ok(ed25519.verify(signed.signatures[0], signed.message, fromBase58(wallet.address)), "the first trade, signed by this wallet");

  // A first trade that isn't one the checks pass, or is bigger than one trade may be, is refused, and no session starts.
  const fresh = await extensionOf(w);
  await assert.rejects(w.sessionStart(fresh.id, "50000000", "250000000", 15, undefined, "Trade", buy(fresh.address, 100_000_000n)), (e: any) => e.problem.code === "security.subwallet.refused" && /bigger than one trade here may be\. Nothing was signed\.$/.test(e.problem.more));
  sim = { ok: false };
  await assert.rejects(w.sessionStart(fresh.id, "200000000", "250000000", 15, undefined, "Trade", buy(fresh.address, 100_000_000n)), (e: any) => e.problem.code === "security.subwallet.refused" && /test run of it didn't go through/.test(e.problem.more));
  w.endAll("locked");
  assert.deepEqual(events, [["subwallet.session.ended", { id: wallet.id, reason: "locked" }]], "only the first wallet's session had started");
  assert.equal(shown.length, 0, "no sheet, ever");
});

test("mainnet 2 Nov: Spending's first move out to a chain with no wallet yet makes that chain's current wallet from the words, then fills it", async () => {
  const asked: any[] = [];
  const sol: SolChain = { blockhashValid: async () => true, mintDecimals: async () => 6, simulate: async () => ({ ok: true, agreed: true, lamportsBefore: 0n, lamportsAfter: 0n }), lookupTables: async () => [] };
  const relay = { quote: async (req: any) => (asked.push(req), Promise.reject(new Error("stop here"))), generateIntent: async () => null, submitIntent: async () => null, status: async () => null };
  const vault = new MemoryVault();
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(4)));
  const w = new SubWallets({ vault, sol, evm: {} as never, floatRelay: relay, usdPrice: async () => 150, approve: async () => true, emit: () => {} });
  await w.create("trade", "near");
  for (const chain of ["sol", "hood"] as const) {
    assert.ok(!(await w.list()).some((x) => x.chain === chain), `no ${chain} wallet yet`);
    await w.floatOut(chain, undefined, chain === "sol" ? "100000000" : "100000000000000000", `trade-job-fresh-${chain}-01`).catch(() => undefined);
    const made = (await w.list()).filter((x) => x.chain === chain);
    assert.equal(made.length, 1, `${chain}: one wallet made`);
    assert.deepEqual([made[0]!.current, made[0]!.inWords], [true, true], "the current one, from the words (never a random key)");
    assert.equal(asked.at(-1)?.recipient, made[0]!.address, "and the move asks 1Click to pay it");
  }
});

test("ST7: the test run is asked beside the blockhash check, not after it; an expired one is still refused: no sheet, nothing signed", async () => {
  // the blockhash check answers only when the test runner says so: the test run must already have started by then
  let answerFresh!: (v: boolean) => void;
  const order: string[] = [];
  const mk = (valid: boolean) => {
    const shown: PlainWords[] = [];
    const sol: SolChain = {
      blockhashValid: () => (order.push("blockhash asked"), new Promise<boolean>((r) => (answerFresh = (v) => r(v && valid)))),
      simulate: async (tx: string) => (order.push("test run asked"), { tokens: fairCoins(tx), ok: true, agreed: true, lamportsBefore: 10_000_000_000n, lamportsAfter: 9_900_000_000n }),
      lookupTables: async () => [],
    };
    const w = new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol, approve: async (words) => (shown.push(words), true), usdPrice: async () => (order.push("price asked"), 150) });
    return { w, shown };
  };
  const ok = mk(true);
  const wallet = await ok.w.create("trade", "sol");
  const signing = ok.w.signTx(wallet.id, buy(wallet.address, 100_000_000n), "");
  for (let i = 0; i < 20 && !order.includes("test run asked"); i++) await new Promise((r) => setImmediate(r));
  // D143: no sheet, so no price is read to sign
  assert.deepEqual([...order].sort(), ["blockhash asked", "test run asked"], "both asked before the blockhash check answered");
  answerFresh(true);
  const out = await signing;
  assert.ok(out.signedTx);
  assert.equal(ok.shown.length, 0, "no sheet");
  // control: the same transaction with a blockhash the nodes no longer take is refused, no sheet, nothing signed
  order.length = 0;
  const bad = mk(false);
  const w2 = await bad.w.create("trade", "sol");
  const refused = bad.w.signTx(w2.id, buy(w2.address, 100_000_000n), "");
  for (let i = 0; i < 20 && !order.includes("test run asked"); i++) await new Promise((r) => setImmediate(r));
  assert.ok(order.includes("blockhash asked"), "the second wallet's blockhash check was asked (else the first's answer would be reused)");
  answerFresh(true);
  await assert.rejects(refused, (e: any) => e.problem.code === "security.subwallet.expired");
  assert.equal(bad.shown.length, 0);
});

test("ST7 (review L3): a blockhash read that throws is the error said; a test run that throws while the blockhash is stale is 'expired', with no stray rejection; a price function that throws at once is no price (the sheet asks), never a failed signing", async () => {
  const stray: unknown[] = [];
  const onStray = (e: unknown) => stray.push(e);
  process.on("unhandledRejection", onStray);
  try {
    const mk = (sol: Partial<SolChain>, usdPrice?: (c: string) => Promise<number>) => {
      const shown: PlainWords[] = [];
      const base: SolChain = { blockhashValid: async () => true, mintDecimals: async () => 6, simulate: async (tx: string) => ({ tokens: fairCoins(tx), ok: true, agreed: true, lamportsBefore: 10_000_000_000n, lamportsAfter: 9_900_000_000n }), lookupTables: async () => [] };
      return { w: new SubWallets({ marketPrice: async () => 1e-9, vault: new MemoryVault(), sol: { ...base, ...sol }, approve: async (words) => (shown.push(words), false), ...(usdPrice ? { usdPrice } : {}) }), shown };
    };
    const a = mk({ blockhashValid: async () => { throw new Error("node down"); } });
    const wa = await a.w.create("trade", "sol");
    await assert.rejects(a.w.signTx(wa.id, buy(wa.address, 100_000_000n), ""), /node down/);
    assert.equal(a.shown.length, 0);
    const b = mk({ blockhashValid: async () => false, simulate: async () => { throw new Error("test run failed"); } });
    const wb = await b.w.create("trade", "sol");
    await assert.rejects(b.w.signTx(wb.id, buy(wb.address, 100_000_000n), ""), (e: any) => e.problem?.code === "security.subwallet.expired");
    assert.equal(b.shown.length, 0);
    // control: a fresh blockhash and the same failing test run says the test run's error, not "expired"
    const c = mk({ simulate: async () => { throw new Error("test run failed"); } });
    const wc = await c.w.create("trade", "sol");
    await assert.rejects(c.w.signTx(wc.id, buy(wc.address, 100_000_000n), ""), /test run failed/);
    const d = mk({}, (() => { throw new Error("sync throw"); }) as never);
    const wd = await d.w.create("trade", "sol");
    // no price, so the caps can't be read: the sheet asks (its approve here says no), and nothing is signed
    assert.deepEqual(await d.w.signTx(wd.id, buy(wd.address, 100_000_000n), ""), { declined: true });
    assert.deepEqual(d.shown.map((x) => x.warnings[0]?.text), ["Its price couldn't be read, so ZeroFee asks you."]);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(stray, []);
  } finally {
    process.off("unhandledRejection", onStray);
  }
});
