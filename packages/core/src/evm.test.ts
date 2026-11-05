import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { readFileSync } from "node:fs";
import { EVM_NODES, evmAddress, unlimited, unsignedEvmTx } from "./evm.ts";
import { GNOSIS_NODES } from "./gnosis-pay.ts";
import type { EvmCall, EvmChain, EvmSimulated } from "./evm.ts";
import { fromBase64, fromHex, parseTx, rlpDecode, toHex } from "./evm/wire.ts";
import type { Rlp } from "./evm/wire.ts";
import type { PlainWords } from "./signer.ts";
import { SubWallets } from "./subwallets.ts";
import type { SolChain } from "./solana.ts";
import { MemoryVault } from "./vault.ts";
import { tradeCalls } from "./testing/trade-calls.ts";

const V2 = "0x10ed43c718714eb63d5aa57b78b54704e256024e";
const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const CAKE = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";
const OTHER = "0x00000000000000000000000000000000000000aa";
const ONE = 10n ** 18n;

const w = (v: string | bigint) => (typeof v === "bigint" ? v.toString(16) : v.replace(/^0x/, "")).padStart(64, "0");
/** swapExactETHForTokensSupportingFeeOnTransferTokens(min, [WBNB, coin], to, deadline) */
const v2Buy = (min: bigint, to: string) => `0xb6f9de95${w(min)}${w(0x80n)}${w(to)}${w(2_000_000_000n)}${w(2n)}${w(WBNB)}${w(CAKE)}`;
/** swapExactTokensForETHSupportingFeeOnTransferTokens(amountIn, min, [coin, WBNB], to, deadline) */
const v2Sell = (amountIn: bigint, min: bigint, to: string) => `0x791ac947${w(amountIn)}${w(min)}${w(0xa0n)}${w(to)}${w(2_000_000_000n)}${w(2n)}${w(CAKE)}${w(WBNB)}`;
const approve = (spender: string, amount: bigint) => `0x095ea7b3${w(spender)}${w(amount)}`;
const tx = (to: string, value: bigint, data: string, nonce = 0, chainId = 56) => unsignedEvmTx({ chainId, nonce, tip: 1_000_000_000n, fee: 3_000_000_000n, gas: 300_000n, to, value, data });
/** D143 (approval-policy.ts hotNeedsApproval): with no site asking, what a hot key's checks don't pass is refused,
 *  named, and nothing is signed; never asked. */
const refused = (why: RegExp) => (e: any) => e?.problem?.code === "security.subwallet.refused" && why.test(e.problem.more) && /Nothing was signed\.$/.test(e.problem.more);
/** refused, for a wallet's own trade refused (its own code, security.trade.not-signed). */
const refusedTrade = (why: RegExp) => (e: any) => e?.problem?.code === "security.trade.not-signed" && why.test(e.problem.more) && /Nothing was signed\.$/.test(e.problem.more);

function setup(sim: Partial<EvmSimulated> = {}) {
  const shown: PlainWords[] = [];
  const runs: EvmCall[][] = [];
  let answer = true;
  const evm: EvmChain = {
    // A fair fill: a buy of CAKE gets exactly its 1,000 minimum (what v2Buy asks).
    simulate: async (_chain, calls) => (runs.push(calls), { ok: true, agreed: true, balance: 2n * ONE, coinsIn: new Map([[CAKE, 1000n]]), ...sim }),
    nonce: async () => 0,
    tokenBalance: async () => 1000n * ONE,
    token: async (_chain, t) => (t === CAKE ? { symbol: "CAKE", decimals: 18 } : undefined),
    ponsCurve: async () => null,
  };
  const sol = {} as SolChain;
  // BNB and ETH at $100, so the Trade session's dollars read as coins: $100 a trade is 1 BNB.
  const wallets = new SubWallets({ marketPrice: async () => 1e-12, vault: new MemoryVault(), sol, evm, usdPrice: async () => 100, approve: async (words) => (shown.push(words), answer), emit: () => {} });
  tradeCalls(wallets);
  return { wallets, shown, runs, say: (yes: boolean) => (answer = yes) };
}

/** The signer of a signed EIP-1559 transaction, recovered from its signature. */
function signerOf(signedB64: string): string {
  const signed = fromBase64(signedB64);
  const f = rlpDecode(signed.subarray(1)) as Uint8Array[];
  const unsigned = new Uint8Array([2, ...rlpOf(f.slice(0, 9))]);
  const big = (b: Uint8Array) => (b.length ? BigInt(toHex(b)) : 0n);
  const sig = new secp256k1.Signature(big(f[10]), big(f[11])).addRecoveryBit(Number(big(f[9])));
  return toHex(keccak_256(sig.recoverPublicKey(keccak_256(unsigned)).toBytes(false).subarray(1)).subarray(12));
}
function rlpOf(x: Rlp): Uint8Array {
  const head = (n: number, base: number) => (n < 56 ? [base + n] : [base + 55 + Math.ceil(n.toString(16).length / 2), ...fromHex(n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, "0"))]);
  if (x instanceof Uint8Array) return x.length === 1 && x[0] < 0x80 ? x : new Uint8Array([...head(x.length, 0x80), ...x]);
  const body = x.flatMap((i) => [...rlpOf(i)]);
  return new Uint8Array([...head(body.length, 0xc0), ...body]);
}

test("an EVM wallet's address is its key's, as every Ethereum wallet computes it", () => {
  assert.equal(evmAddress(new Uint8Array(32).fill(1)), "0x1a642f0e3c3af545e7acbd38b07251b3990914f1");
});

test("a clean BNB Chain buy signs with no sheet and no session, as this wallet, and only for its own chain", async () => {
  const { wallets, shown } = setup();
  const wallet = await wallets.create("trade", "bsc");
  assert.match(wallet.address, /^0x[0-9a-f]{40}$/);
  assert.equal(wallet.chain, "bsc");
  // D143: no session needed; the core's checks are what let it through
  const out = (await wallets.signTx(wallet.id, tx(V2, ONE / 10n, v2Buy(1000n, wallet.address)), "Buy CAKE")) as { signedTx: string };
  assert.equal(signerOf(out.signedTx), wallet.address);
  assert.equal(parseTx(out.signedTx).chainId, 56);
  // and a Trade session starts with no sheet
  await wallets.tradeSessionStart(100, 200, 15);
  assert.equal(shown.length, 0, "never a sheet (D143)");

  // The same trade for Ethereum mainnet (chain 1) would spend the same address there: refused outright.
  await assert.rejects(wallets.signTx(wallet.id, tx(V2, ONE / 10n, v2Buy(1000n, wallet.address), 1, 1), ""), (e: any) => e.problem.code === "security.subwallet.refused");
});

test("a clean trade whose fee per gas is past ZeroFee's cap for the chain is refused, named, with no sheet (audit NF-16)", async () => {
  const { wallets, shown } = setup();
  const wallet = await wallets.create("trade", "bsc");
  const dear = unsignedEvmTx({ chainId: 56, nonce: 0, tip: 1_000_000_000n, fee: 50_000_000_000n, gas: 300_000n, to: V2, value: ONE / 10n, data: v2Buy(1000n, wallet.address) });
  await assert.rejects(wallets.signTx(wallet.id, dear, "Buy CAKE"), refusedTrade(/^Its network fee is higher than ZeroFee pays on this chain/), "50 gwei on BNB Chain (its cap is 10)");
  // the control: the same buy at 3 gwei signs
  assert.ok("signedTx" in (await wallets.signTx(wallet.id, tx(V2, ONE / 10n, v2Buy(1000n, wallet.address)), "Buy CAKE")));
  assert.equal(shown.length, 0, "never a sheet");
});

test("a send, a payout to someone else, no floor, or an unlimited approval is refused, named, with no sheet", async () => {
  const { wallets, shown } = setup();
  const wallet = await wallets.create("trade", "bsc");
  await wallets.tradeSessionStart(100, 500, 15);
  await assert.rejects(wallets.signTx(wallet.id, tx(OTHER, ONE / 10n, "0x"), ""), refusedTrade(/^It sends coins out of the wallet/));
  await assert.rejects(wallets.signTx(wallet.id, tx(V2, ONE / 10n, v2Buy(1000n, OTHER)), ""), refusedTrade(/^It pays out to someone else/));
  await assert.rejects(wallets.signTx(wallet.id, tx(V2, ONE / 10n, v2Buy(0n, wallet.address)), ""), refusedTrade(/^It has no minimum you get back/));
  await assert.rejects(wallets.signTx(wallet.id, tx(CAKE, 0n, approve(V2, (1n << 256n) - 1n)), ""), refusedTrade(/^It allows more than this wallet holds/));
  assert.equal(shown.length, 0, "never a sheet, a session open or not");
  // the controls: the same buy paid to this wallet at its floor, and an approval of no more than it holds, sign
  assert.ok("signedTx" in (await wallets.signTx(wallet.id, tx(V2, ONE / 10n, v2Buy(1000n, wallet.address)), "")));
  assert.ok("signedTx" in (await wallets.signTx(wallet.id, tx(CAKE, 0n, approve(V2, 50n * ONE), 1), "")));
});

test("a trading wallet never pays another of the person's trading wallets straight: not a send, a coin transfer or a swap's payout", async () => {
  const { wallets, shown } = setup();
  const a = await wallets.create("trade", "bsc", 0);
  const b = await wallets.create("trade", "bsc", 1);
  const linked = (e: any) => e.problem.code === "security.subwallet.refused" && /Use Move instead/.test(e.problem.more);
  await assert.rejects(wallets.signTx(a.id, tx(b.address, ONE / 100n, "0x"), ""), linked);
  await assert.rejects(wallets.signTx(a.id, tx(b.address.toUpperCase().replace("0X", "0x"), ONE / 100n, "0x"), ""), linked, "whatever the letters' case");
  await assert.rejects(wallets.signTx(a.id, tx(CAKE, 0n, `0xa9059cbb${w(b.address)}${w(5n * ONE)}`), ""), linked);
  await assert.rejects(wallets.signTx(a.id, tx(CAKE, 0n, `0x23b872dd${w(a.address)}${w(b.address)}${w(5n * ONE)}`), ""), linked);
  await assert.rejects(wallets.signTx(a.id, tx(V2, 0n, v2Sell(ONE, 1n, b.address)), ""), linked);
  assert.equal(shown.length, 0, "never a sheet");
  // the controls: anyone else's send is refused for its own reason (it isn't a trade), never as a link; the same swap
  // paid to this wallet itself signs
  await assert.rejects(wallets.signTx(a.id, tx("0x000000000000000000000000000000000000beef", ONE / 100n, "0x"), ""), (e: any) => refusedTrade(/^It sends coins out of the wallet/)(e) && !/Use Move instead/.test(e.problem.more));
  assert.ok("signedTx" in (await wallets.signTx(a.id, tx(V2, ONE / 10n, v2Buy(1000n, a.address)), "")));
});

test("a sell: the exact approval is covered, and the swap is run after it, as the network will", async () => {
  // The test run says the sale brings 1,100 wei back; its minimum of 1,000 is within Trade's widest slippage.
  const { wallets, shown, runs } = setup({ nativeIn: 1100n });
  const wallet = await wallets.create("trade", "bsc");
  await wallets.tradeSessionStart(100, 500, 15);
  const started = shown.length;
  await wallets.signTx(wallet.id, tx(CAKE, 0n, approve(V2, 50n * ONE), 0), "");
  await wallets.signTx(wallet.id, tx(V2, 0n, v2Sell(50n * ONE, 1000n, wallet.address), 1), "");
  assert.equal(shown.length, started, "both covered");
  assert.deepEqual(runs.at(-1)!.map((c) => c.to), [CAKE, V2]);
});

test("a sell needs a fair minimum against what its test run brings back (the study's item 6), else it is refused", async () => {
  /** "signed", or the refusal's words; never a sheet */
  const sell = async (nativeIn: bigint, minOut: bigint) => {
    const { wallets, shown } = setup({ nativeIn });
    const wallet = await wallets.create("trade", "bsc");
    const out = await wallets.signTx(wallet.id, tx(V2, 0n, v2Sell(50n * ONE, minOut, wallet.address), 0), "").then(
      (r) => ("signedTx" in r ? "signed" : "?"),
      (e: any) => (refusedTrade(/./)(e) ? String(e.problem.more) : Promise.reject(e)),
    );
    assert.equal(shown.length, 0, "never a sheet");
    return out;
  };
  assert.equal(await sell(ONE / 2n, (ONE / 2n) * 9n / 10n), "signed", "10% under what it brings back: signed");
  assert.match(await sell(ONE / 2n, 1n), /^It could get back over 20% less than the sale is worth now/, "a minimum of one unit (a dump into a sandwich): refused");
  assert.match(await sell(ONE / 2n, (ONE / 2n) * 7n / 10n), /^It could get back over 20% less than the sale is worth now/, "30% under: refused");
  assert.match(await sell(0n, 1000n), /^It doesn't show what the sale brings back/, "the test run shows nothing coming back: refused");
});

test("a failed test run, or two nodes that don't agree, never signs: refused, named, with no sheet", async () => {
  for (const [sim, why] of [[{ ok: false }, /^Its test run didn't go through/], [{ agreed: false }, /^The two network servers didn't both test it the same way/]] as const) {
    const { wallets, shown } = setup(sim);
    await wallets.tradeSessionStart(100, 500, 15);
    const bsc = await wallets.create("trade", "bsc");
    await assert.rejects(wallets.signTx(bsc.id, tx(V2, ONE / 10n, v2Buy(1000n, bsc.address)), ""), refusedTrade(why));
    const hood = await wallets.create("trade", "hood");
    await assert.rejects(wallets.signTx(hood.id, tx(OTHER, 0n, "0x", 0, 4663), ""), refusedTrade(why), "Robinhood Chain too, before anything else is said");
    assert.equal(shown.length, 0);
  }
  // the control: the same buy, both nodes' test runs fine and agreeing, signs
  const { wallets } = setup();
  const wallet = await wallets.create("trade", "bsc");
  assert.ok("signedTx" in (await wallets.signTx(wallet.id, tx(V2, ONE / 10n, v2Buy(1000n, wallet.address)), "")));
});

test("an EVM wallet's key is shown only after the sheet, as the hex other wallets import", async () => {
  const { wallets, say } = setup();
  const wallet = await wallets.create("trade", "bsc");
  say(false);
  assert.deepEqual(await wallets.export(wallet.id), { declined: true });
  say(true);
  const { secretKey } = (await wallets.export(wallet.id)) as { secretKey: string };
  assert.match(secretKey, /^0x[0-9a-f]{64}$/);
  assert.equal(evmAddress(fromHex(secretKey)), wallet.address);
});

test("the Browser wallet lives on Ethereum, Base, Gnosis and Arbitrum, one per chain; the card's wallet on Gnosis is its own key", async () => {
  const { wallets } = setup();
  for (const chain of ["eth", "base", "gnosis", "arb"]) {
    const a = await wallets.create("browser", chain);
    assert.match(a.address, /^0x[0-9a-f]{40}$/);
    assert.equal(a.chain, chain);
    assert.equal(a.label, "Apps wallet");
    assert.equal((await wallets.create("browser", chain)).id, a.id, "asking again gives the same wallet");
  }
  const card = await wallets.create("pay", "gnosis");
  assert.equal(card.label, "Card wallet");
  assert.notEqual(card.address, (await wallets.create("browser", "gnosis")).address, "never the Browser wallet's key");
  assert.equal((await wallets.create("pay", "gnosis")).id, card.id);
  const [x, y] = await Promise.all([wallets.create("browser", "eth"), wallets.create("browser", "eth")]);
  assert.equal(x.id, y.id, "two asks at once still make one");
  for (const [kind, chain] of [["trade", "eth"], ["pay", "base"], ["extension", "arb"], ["private", "gnosis"]]) {
    await assert.rejects(wallets.create(kind, chain), (e: any) => e.problem.code === "security.request.invalid", `${kind} on ${chain}`);
  }
  await assert.rejects(wallets.create("browser", "polygon"), (e: any) => e.problem.code === "security.subwallet.chain");
});

test("audit C2 (3 Nov): on Ethereum, Base, Gnosis or Arbitrum nothing signs with no sheet but taking an allowance back, since the core reads no router's call: the person's own flow is refused by name (its cause first when a check names one), a site's own wallet asks on the one-tap sheet, the cause first; a site on the shared wallet is refused (controls: an allowance back to 0 signs with no sheet; a yes on the sheet signs)", async () => {
  const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
  // 1inch's Aggregation Router v6, listed on all four chains (evm-checks.ts KNOWN_ROUTERS); its v5 is listed on none
  const ROUTER = "0x111111125421ca6dc452d289314280a0f8842a65";
  const UNLISTED = "0x1111111254eeb25477b68fb85ed929f73a960582";
  const swapCall = "0x12aa3caf" + "00".repeat(64);
  const SITE = { origin: "https://app.example" };
  const UNREAD = "ZeroFee can't read what this call does";
  /** The approve sheet asked once, one tap, its first warning exactly `cause` and why it asks; then forgotten. */
  const askedOnce = (shown: PlainWords[], cause: string, faceId = false) => {
    assert.equal(shown.length, 1, "the approve sheet asked");
    assert.equal(shown[0]!.warnings[0]?.text, `${cause}, so ZeroFee asks you.`);
    // decision C (product decision, 4 Nov): a send to an outside address past the cap (or with no dollar figure) asks Face ID
    assert.equal(shown[0]!.tap, faceId ? undefined : true, faceId ? "a send out past the cap: Face ID" : "one tap, never Face ID");
    shown.length = 0;
  };
  const named = (cause: string) => refusedTrade(new RegExp(`^${cause.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\. Nothing was signed\\.$`));
  // Base and Arbitrum: a fee inside what ZeroFee pays there (0.1 gwei tip, 1 gwei most)
  const l2 = (to: string, value: bigint, data: string, chainId: number) => unsignedEvmTx({ chainId, nonce: 0, tip: 100_000_000n, fee: 1_000_000_000n, gas: 300_000n, to, value, data });
  // a buy: 0.1 ETH out, 1,000 CAKE in, nothing else (the nodes' traced coins), to a listed router
  const buy = setup({ coinsIn: new Map([[CAKE, 1000n]]) });
  const eth = await buy.wallets.create("browser", "eth");
  await assert.rejects(buy.wallets.signTx(eth.id, tx(ROUTER, ONE / 10n, swapCall, 0, 1), "buy", undefined, "Browser", undefined, "browser"), named(UNREAD), "the person's own flow: refused, named");
  await assert.rejects(buy.wallets.signTx(eth.id, tx(UNLISTED, ONE / 10n, swapCall, 0, 1), "", undefined, "Browser", undefined, "browser"), named(UNREAD), "an unlisted router too");
  // audit C1: a site on this shared wallet is refused, never asked
  await assert.rejects(buy.wallets.signTx(eth.id, tx(ROUTER, ONE / 10n, swapCall, 0, 1), "", undefined, "Browser", SITE, "browser"), (e: any) => e.problem.more === "This site can use only its own wallet.");
  assert.equal(buy.shown.length, 0);
  // the site's own wallet: asked, the cause first; a no signs nothing, a yes signs
  const own = await buy.wallets.siteFor(SITE, "eth");
  buy.say(false);
  assert.deepEqual(await buy.wallets.signTx(own.id, tx(ROUTER, ONE / 10n, swapCall, 0, 1), "", undefined, "Browser", SITE, "browser"), { declined: true });
  askedOnce(buy.shown, UNREAD);
  buy.say(true);
  assert.ok("signedTx" in (await buy.wallets.signTx(own.id, tx(ROUTER, ONE / 10n, swapCall, 0, 1), "", undefined, "Browser", SITE, "browser")));
  askedOnce(buy.shown, UNREAD);
  // GMGN's own wallet on Base, on GMGN's own page: a listed site, but its router's call isn't read either, so it asks
  const sell = setup({ coinsIn: new Map([[CAKE, -1000n]]), nativeIn: ONE / 10n });
  const gmgn = await sell.wallets.create("site", "base", undefined, "gmgn");
  assert.ok("signedTx" in (await sell.wallets.signTx(gmgn.id, l2(ROUTER, 0n, swapCall, 8453), "", undefined, "Browser", { origin: "https://gmgn.ai" }, "browser")));
  askedOnce(sell.shown, UNREAD);
  // what a check names is said first, for the person's own flow (refused) and for the site's own wallet (asked)
  for (const [t, cause, faceId] of [
    [tx(USDC, 0n, approve(ROUTER, (1n << 256n) - 1n), 0, 1), "It allows more than this wallet holds", false],
    [tx(CAKE, 0n, approve(UNLISTED, 5n * ONE), 0, 1), "It lets an app ZeroFee doesn't know spend a coin", false],
    [tx(OTHER, ONE / 2n, "0x", 0, 1), "It sends ETH out of the wallet", false], // $50 at $100 an ETH: inside the cap
    [tx(CAKE, 0n, `0xa9059cbb${"0".repeat(24)}${OTHER.slice(2)}${(5n * ONE).toString(16).padStart(64, "0")}`, 0, 1), "It sends coins out of the wallet", true],
  ] as const) {
    await assert.rejects(buy.wallets.signTx(eth.id, t, "", undefined, "Browser", undefined, "browser"), named(cause), cause);
    assert.equal(buy.shown.length, 0, `${cause}: no site, never asked`);
    buy.say(false);
    assert.deepEqual(await buy.wallets.signTx(own.id, t, "", undefined, "Browser", SITE, "browser"), { declined: true }, `${cause}: the site's own wallet, a no`);
    askedOnce(buy.shown, cause, faceId);
    buy.say(true);
  }
  // control: taking an allowance back (to 0) moves nothing and signs with no sheet
  assert.ok("signedTx" in (await buy.wallets.signTx(eth.id, tx(CAKE, 0n, approve(ROUTER, 0n), 0, 1))));
  // an exact allowance to a listed router is still a call the core doesn't read the use of: refused in the own flow
  await assert.rejects(buy.wallets.signTx(eth.id, tx(CAKE, 0n, approve(ROUTER, 5n * ONE), 0, 1)), named(UNREAD));
  // a call that moves nothing, takes two coins, or pays and gets nothing: not one trade, said by name
  for (const [coinsIn, nativeIn, value, why] of [
    [new Map<string, bigint>(), 0n, 0n, /^It isn't one trade\./],
    [new Map([[CAKE, -1000n], [USDC, -5n]]), ONE / 10n, 0n, /^It spends more than one coin you hold\./],
    [new Map<string, bigint>(), 0n, ONE / 10n, /^It isn't one trade\./],
  ] as const) {
    const s2 = setup({ coinsIn, nativeIn });
    const w2 = await s2.wallets.create("browser", "gnosis");
    await assert.rejects(s2.wallets.signTx(w2.id, tx(ROUTER, value, swapCall, 0, 100)), refusedTrade(why), String(why));
    assert.equal(s2.shown.length, 0);
  }
  // only one node ran it, or the two didn't run it the same way: refused
  const one = setup({ coinsIn: new Map([[CAKE, 1000n]]), agreed: false });
  const w3 = await one.wallets.create("browser", "eth");
  await assert.rejects(one.wallets.signTx(w3.id, tx(ROUTER, ONE / 10n, swapCall, 0, 1)), refusedTrade(/^The two network servers didn't both test it the same way\./));
  await assert.rejects(buy.wallets.signTx(eth.id, tx(OTHER, 1n, "0x", 0, 8453)), (e: any) => /chain 8453, not this wallet's chain/.test(e.problem.whatHappened + JSON.stringify(e.problem)), "a Base transaction can't be signed by the Ethereum wallet");
  assert.equal(buy.shown.length + one.shown.length, 0, "no other sheet");
});

test("review M6: a gas limit far past what its test run used (over twice it, and over it plus 100,000) is a failed check: refused in the person's own flow, asked for a site's own wallet, the cause first (controls: at the limit it signs)", async () => {
  // the transaction asks for 300,000 gas
  for (const [gasUsed, signs] of [[100_000n, false], [20_000n, false], [150_000n, true], [200_000n, true]] as const) {
    const { wallets, shown } = setup({ gasUsed });
    const wallet = await wallets.create("trade", "bsc");
    const t = tx(V2, ONE / 10n, v2Buy(1000n, wallet.address));
    if (signs) assert.ok("signedTx" in (await wallets.signTx(wallet.id, t, "")), `${gasUsed} used: inside the limit`);
    else await assert.rejects(wallets.signTx(wallet.id, t, ""), refusedTrade(/^It sets a network fee limit far above what its test run used\. Nothing was signed\.$/), `${gasUsed} used`);
    assert.equal(shown.length, 0, "no site: never asked");
  }
  // a site's own wallet: asked, the cause first; a no signs nothing
  const { wallets, shown, say } = setup({ gasUsed: 100_000n });
  const SITE = { origin: "https://app.example" };
  const wallet = await wallets.siteFor(SITE, "bsc");
  say(false);
  assert.deepEqual(await wallets.signTx(wallet.id, tx(V2, ONE / 10n, v2Buy(1000n, wallet.address)), "", undefined, "Browser", SITE, "browser"), { declined: true });
  assert.equal(shown.length, 1);
  assert.equal(shown[0]!.warnings[0]?.text, "It sets a network fee limit far above what its test run used, so ZeroFee asks you.");
});

test("review, 3 Nov, audit C2: a Browser-chain allowance goes only to a router the projects' own docs list for that chain, never unlimited, never more than it holds; Permit2 only to Uniswap's Universal Router, for at most an hour; and inside those limits it is still never silent: the person's own flow is refused as unread (controls: outside them, the limit's own cause is said first)", async () => {
  const { wallets, shown } = setup({ coinsIn: new Map() });
  const eth = await wallets.create("browser", "eth");
  const gnosis = await wallets.create("browser", "gnosis");
  const ONEINCH_V6 = "0x111111125421ca6dc452d289314280a0f8842a65", KYBER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5", PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
  const UR_ETH = "0x66a9893cc07d91d95644aedd05d03f95e1dba8af";
  const ONEINCH_V5 = "0x1111111254eeb25477b68fb85ed929f73a960582";
  // audit C2: an allowance inside every limit still isn't signed with no sheet (the router's later call isn't read)
  const signs = async (id: string, t: string) => assert.rejects(wallets.signTx(id, t), refusedTrade(/^ZeroFee can't read what this call does\. Nothing was signed\.$/));
  // the wallet holds 1,000 CAKE (setup's tokenBalance)
  await signs(eth.id, tx(CAKE, 0n, approve(ONEINCH_V6, 5n * ONE), 0, 1));
  await signs(eth.id, tx(CAKE, 0n, approve(KYBER, 1000n * ONE), 1, 1));
  await assert.rejects(wallets.signTx(eth.id, tx(CAKE, 0n, approve(ONEINCH_V6, (1n << 256n) - 1n), 2, 1)), refusedTrade(/^It allows more than this wallet holds\./), "never unlimited");
  await assert.rejects(wallets.signTx(eth.id, tx(CAKE, 0n, approve(ONEINCH_V6, 1001n * ONE), 2, 1)), refusedTrade(/^It allows more than this wallet holds\./), "never more than it holds");
  await assert.rejects(wallets.signTx(eth.id, tx(CAKE, 0n, approve(ONEINCH_V5, 5n * ONE), 2, 1)), refusedTrade(/^It lets an app ZeroFee doesn't know spend a coin\./), "an older router the docs don't list");
  // on Gnosis only 1inch's v6 is listed: KyberSwap's address isn't (its docs don't list Gnosis)
  await signs(gnosis.id, tx(CAKE, 0n, approve(ONEINCH_V6, 5n * ONE), 0, 100));
  await assert.rejects(wallets.signTx(gnosis.id, tx(CAKE, 0n, approve(KYBER, 5n * ONE), 1, 100)), refusedTrade(/^It lets an app ZeroFee doesn't know spend a coin\./));
  // Permit2.approve(token, spender, amount, expiration): to Uniswap's Universal Router, for at most an hour
  const now = Math.floor(Date.now() / 1000);
  const p2 = (spender: string, amount: bigint, until: number) => `0x87517c45${w(CAKE)}${w(spender)}${w(amount)}${w(BigInt(until))}`;
  await signs(eth.id, tx(PERMIT2, 0n, p2(UR_ETH, 5n * ONE, now + 1800), 2, 1));
  await assert.rejects(wallets.signTx(eth.id, tx(PERMIT2, 0n, p2(OTHER, 5n * ONE, now + 1800), 3, 1)), refusedTrade(/^It lets an app ZeroFee doesn't know spend a coin\./), "Permit2 to anyone else");
  await assert.rejects(wallets.signTx(eth.id, tx(PERMIT2, 0n, p2(UR_ETH, 5n * ONE, now + 2 * 86_400), 3, 1)), refusedTrade(/^Its spending permission lasts longer than a trade needs\./), "for days");
  await assert.rejects(wallets.signTx(eth.id, tx(PERMIT2, 0n, p2(UR_ETH, 2000n * ONE, now + 1800), 3, 1)), refusedTrade(/^It allows more than this wallet holds\./));
  assert.equal(shown.length, 0, "never a sheet");
});

test("the Browser wallet and the card's wallet have no fast sessions", async () => {
  const { wallets } = setup();
  for (const w of [await wallets.create("browser", "base"), await wallets.create("pay", "gnosis"), await wallets.create("browser", "bsc")]) {
    await assert.rejects(wallets.sessionStart(w.id, "1", "2", 5), (e: any) => e.problem.code === "security.subwallet.refused", w.label);
  }
});

test("every EVM and Gnosis node the core calls is on the phone's host allowlist (CoreContext.coreHosts)", () => {
  const swift = readFileSync(new URL("../../../apps/ios/ZeroFee/CoreContext.swift", import.meta.url), "utf8");
  const listed = new Set([...swift.slice(swift.indexOf("static let coreHosts")).split("]")[0].matchAll(/"([a-z0-9.-]+)"/g)].map((m) => m[1]));
  for (const url of [...Object.values(EVM_NODES).flat(), ...GNOSIS_NODES]) assert.ok(listed.has(new URL(url).hostname), `${new URL(url).hostname} is missing from coreHosts`);
});

test("the first EVM trade with the session: no sheet, the trade signed, and the next one run after it", async () => {
  const { wallets, shown, runs } = setup();
  const wallet = await wallets.create("trade", "bsc");
  const started = (await wallets.tradeSessionStart(100, 200, 15, "Buy CAKE", "Trade", wallet.id, tx(V2, ONE / 10n, v2Buy(1000n, wallet.address)))) as { endsAtIso: string; signedTx: string };
  assert.equal(shown.length, 0, "no sheet and no Face ID (D143)");
  assert.equal(signerOf(started.signedTx), wallet.address);
  // The next trade runs after the first, which may not have landed: it went into the wallet's pending list.
  await wallets.signTx(wallet.id, tx(V2, ONE / 10n, v2Buy(1000n, wallet.address), 1), "");
  assert.equal(shown.length, 0);
  assert.equal(runs.at(-1)!.length, 2, "simulated after the first trade");
  // A send can't be a first trade.
  const other = await wallets.create("trade", "bsc");
  await assert.rejects(wallets.tradeSessionStart(100, 200, 15, undefined, "Trade", other.id, tx(OTHER, ONE / 10n, "0x")), (e: any) => e.problem.code === "security.subwallet.refused");
});

test("exporting a key: the core's sheet first; with the phone's own screen the key goes there, never back to the caller", async () => {
  const shownKeys: { label: string; secretKey: string }[] = [];
  const words: PlainWords[] = [];
  const evm = {} as EvmChain;
  const onPhone = new SubWallets({ marketPrice: async () => 1e-12, vault: new MemoryVault(), sol: {} as SolChain, evm, approve: async (w) => (words.push(w), true), emit: () => {}, showSecret: async (s) => (shownKeys.push(s), true) });
  const card = await onPhone.create("pay", "gnosis");
  assert.deepEqual(await onPhone.export(card.id), { shown: true }, "the caller hears only that it was shown");
  assert.equal(shownKeys[0].label, "Card wallet");
  assert.match(shownKeys[0].secretKey, /^0x[0-9a-f]{64}$/);
  assert.equal(evmAddress(fromHex(shownKeys[0].secretKey)), card.address, "the key of that wallet");
  assert.equal(words[0].title, "Show the secret key of your card wallet");
  assert.deepEqual(words[0].lines.slice(0, 2), ["Anyone who sees it controls this wallet, and with it your Gnosis Pay card's account.", "It's a standard key. Your Safe's key is stronger. Future computers can't break it."]);

  const onWeb = new SubWallets({ marketPrice: async () => 1e-12, vault: new MemoryVault(), sol: {} as SolChain, evm, approve: async () => true, emit: () => {} });
  const t = await onWeb.create("trade", "bsc");
  const out = (await onWeb.export(t.id)) as { secretKey: string };
  assert.equal(evmAddress(fromHex(out.secretKey)), t.address, "without the phone's screen the caller shows it");
  const no = new SubWallets({ marketPrice: async () => 1e-12, vault: new MemoryVault(), sol: {} as SolChain, evm, approve: async () => false, emit: () => {}, showSecret: async (s) => (shownKeys.push(s), true) });
  const c2 = await no.create("pay", "gnosis");
  assert.deepEqual(await no.export(c2.id), { declined: true });
  assert.equal(shownKeys.length, 1, "Not now shows nothing");
});

// Audit W-8 (the core's own sheets): the browser's and a Permit's approval words read "no limit" only at 2^255, so
// 2^200 read as a modest-looking number. The decoder's rule now: 2^128 or more is no limit.
test("W-8: the core's sheets call an allowance of 2^128 or more 'no limit', and below it an amount", () => {
  assert.equal(unlimited((1n << 200n).toString()), true);
  assert.equal(unlimited((1n << 128n).toString()), true);
  assert.equal(unlimited(((1n << 160n) - 1n).toString()), true, "Permit2's own maximum");
  assert.equal(unlimited(((1n << 128n) - 1n).toString()), false);
  assert.equal(unlimited("1000000"), false);
});

test("a web test (4 Nov): Robinhood's money pair is dRPC and publicnode (two operators), never the chain's own node that timed out at 8 s; it stays a screen's spare (control: BNB unchanged)", async () => {
  const { EVM_READ_SPARES } = await import("./evm.ts");
  assert.deepEqual(EVM_NODES.hood, ["https://robinhood.drpc.org", "https://robinhood-rpc.publicnode.com"]);
  assert.notEqual(new URL(EVM_NODES.hood[0]!).hostname.split(".").slice(-2).join("."), new URL(EVM_NODES.hood[1]!).hostname.split(".").slice(-2).join("."), "two operators");
  assert.deepEqual(EVM_READ_SPARES.hood, ["https://rpc.mainnet.chain.robinhood.com"]);
  assert.deepEqual(EVM_NODES.bsc, ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"], "control");
});
