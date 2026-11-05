import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { checksumAddress, type EvmCall, type EvmChain } from "./evm.ts";
import { fromBase64, parseTx, toHex } from "./evm/wire.ts";
import type { PlainWords } from "./signer.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";

const TO = "0x00000000000000000000000000000000000000aa";
const SITE = { origin: "https://app.example.com" };
const V2 = "0x10ed43c718714eb63d5aa57b78b54704e256024e";
const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const CAKE = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";
const word = (v: string | bigint) => (typeof v === "bigint" ? v.toString(16) : v.replace(/^0x/, "")).padStart(64, "0");
/** swapExactETHForTokensSupportingFeeOnTransferTokens(min, [WBNB, CAKE], to, deadline): a buy the core signs on BNB Chain
 *  (D143), the fake chain's test run getting exactly its 1,000 minimum. */
const buy = (to: string) => `0xb6f9de95${word(1000n)}${word(0x80n)}${word(to)}${word(2_000_000_000n)}${word(2n)}${word(WBNB)}${word(CAKE)}`;
/** D143 (approval-policy.ts hotNeedsApproval): with no site asking, what a hot key's checks don't pass is refused, named,
 *  and nothing is signed; never asked. A site asks only from its own wallet (audit C1: subwallet.site.forHost); an
 *  unlisted site's own wallet always asks, one tap. */
const refused = (why: RegExp) => (e: any) => e?.problem?.code === "security.subwallet.refused" && why.test(e.problem.more) && /Nothing was signed\.$/.test(e.problem.more);
/** refused, for a wallet's own trade refused (its own code, security.trade.not-signed). */
const refusedTrade = (why: RegExp) => (e: any) => e?.problem?.code === "security.trade.not-signed" && why.test(e.problem.more) && /Nothing was signed\.$/.test(e.problem.more);

function setup(over: Partial<EvmChain> = {}) {
  const shown: PlainWords[] = [];
  const sent: string[] = [];
  const estimated: Omit<EvmCall, "gas">[] = [];
  let receipts: ("ok" | "failed" | null)[] = ["ok", "ok"];
  let answer = true;
  const evm: EvmChain = {
    simulate: async () => ({ ok: true, agreed: true, balance: 10n ** 18n, coinsIn: new Map([[CAKE, 1000n]]) }),
    nonce: async () => 7,
    tokenBalance: async () => 0n,
    token: async () => undefined,
    ponsCurve: async () => null,
    fees: async () => ({ tip: 1_000_000n, maxFee: 5_000_000n }),
    estimateGas: async (_chain, call) => (estimated.push(call), 50_000n),
    send: async (_chain, signed) => (sent.push(signed), true),
    receipt: async () => receipts,
    read: async (_chain, method, params) => ({ method, params }),
    ...over,
  };
  // BNB (and ETH) at $600: a clean trade has a price and is inside the caps
  const wallets = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm, usdPrice: async () => 600, approve: async (w) => (shown.push(w), answer), emit: () => {}, confirm: { everyMs: 1, forMs: 5 } });
  return { wallets, shown, sent, estimated, setReceipts: (r: ("ok" | "failed" | null)[]) => (receipts = r), say: (yes: boolean) => (answer = yes) };
}
const ASKED_BY_SITE = "app.example.com isn't a site ZeroFee knows, so ZeroFee asks you.";
/** Audit C1: a site on a shared chain wallet is refused by name, before anything is read or asked. */
const sharedRefused = (e: any) => e?.problem?.code === "security.subwallet.refused" && e.problem.more === "This site can use only its own wallet.";

test("a site's call from its own wallet (audit C1): the core picks nonce, fees and gas and checks it; an unlisted site is asked first, one tap: a yes sends to both nodes and confirms on both, a no sends nothing (control: on the shared chain wallet the site is refused, nothing read)", async () => {
  const { wallets, shown, sent, estimated, say } = setup();
  const shared = await wallets.create("chain", "bsc");
  await assert.rejects(wallets.sendCall(shared.id, { to: V2, value: "1000", data: buy(shared.address) }, undefined, SITE, "Browser"), sharedRefused);
  assert.deepEqual([estimated.length, shown.length, sent.length], [0, 0, 0], "refused before any node or sheet");
  const w = await wallets.siteFor(SITE, "bsc");
  const data = buy(w.address);
  const out = await wallets.sendCall(w.id, { to: V2, value: "0x2386f26fc10000", data }, "Swap on Example", SITE, "Browser");
  assert.equal(out.status, "done");
  assert.equal(sent.length, 1);
  const t = parseTx(fromBase64(sent[0]));
  assert.deepEqual([t.chainId, t.nonce, t.to, t.value, t.gas, t.maxFeePerGas, t.maxPriorityFeePerGas], [56, 7, V2, 10n ** 16n, 60_000n, 5_000_000n, 1_000_000n], "chain, nonce, fees and gas (estimate + 20%) are the core's own");
  assert.equal(estimated[0].from, w.address);
  const hash = toHex(keccak_256(fromBase64(sent[0])));
  assert.deepEqual(out, { status: "done", txHash: hash, explorerUrl: `https://bscscan.com/tx/${hash}` });
  assert.equal(shown.length, 1, "asked: a site ZeroFee doesn't list never signs silently");
  assert.equal(shown[0]!.warnings[0]?.text, ASKED_BY_SITE, "the first warning says why");
  assert.equal(shown[0]!.tap, true, "one tap, never Face ID");
  // Signed by this wallet.
  const f = t.signature!;
  const unsigned = (await import("./evm.ts")).unsignedEvmTx({ chainId: 56, nonce: 7, tip: 1_000_000n, fee: 5_000_000n, gas: 60_000n, to: V2, value: 10n ** 16n, data });
  const pub = new secp256k1.Signature(f.r, f.s).addRecoveryBit(f.yParity).recoverPublicKey(keccak_256(fromBase64(unsigned)));
  assert.equal(toHex(keccak_256(pub.toBytes(false).subarray(1)).subarray(12)), w.address);

  // The next call goes after it: the first may not have landed.
  await wallets.sendCall(w.id, { to: V2, value: "1000", data }, undefined, SITE, "Browser");
  assert.equal(parseTx(fromBase64(sent[1])).nonce, 8);

  // a no: nothing signed or sent
  say(false);
  assert.deepEqual(await wallets.sendCall(w.id, { to: V2, value: "1000", data }, undefined, SITE, "Browser"), { status: "declined" });
  assert.equal(sent.length, 2, "nothing sent");

  // The same site's plain send from its own Base wallet fails its check: asked, the cause first; a no sends nothing
  const base = await wallets.siteFor(SITE, "base");
  shown.length = 0;
  assert.deepEqual(await wallets.sendCall(base.id, { to: TO, value: "0x2386f26fc10000", data: "0x" }, "Swap on Example", SITE, "Browser"), { status: "declined" });
  assert.equal(shown[0]?.warnings[0]?.text, "It sends ETH out of the wallet, so ZeroFee asks you.");
  // control: the same send from the person's own flow is refused by name, never asked
  const ownBase = await wallets.create("browser", "base");
  await assert.rejects(wallets.sendCall(ownBase.id, { to: TO, value: "0x2386f26fc10000", data: "0x" }, undefined, undefined, "Browser", "browser"), refusedTrade(/^It sends ETH out of the wallet\./));
  assert.deepEqual([sent.length, shown.length], [2, 1]);
});

test("a site's call that can't go through, isn't taken, fails or isn't seen by both nodes says so", async () => {
  const notRun = setup({ estimateGas: async () => Promise.reject(new Error("execution reverted")) });
  const a = await notRun.wallets.siteFor(SITE, "bsc");
  await assert.rejects(notRun.wallets.sendCall(a.id, { to: V2, value: "1000", data: buy(a.address) }, undefined, SITE), (e: any) => /test runs refused it/.test(JSON.stringify(e.problem)));
  assert.deepEqual([notRun.sent.length, notRun.shown.length], [0, 0], "nothing sent for a call that can't run");

  const tries: string[] = [];
  let take = false;
  const notTaken = setup({ send: async (_chain, x) => (tries.push(x), take) });
  const b = await notTaken.wallets.siteFor(SITE, "bsc");
  assert.equal(((await notTaken.wallets.sendCall(b.id, { to: V2, value: "1000", data: buy(b.address) }, undefined, SITE)) as any).problem.code, "security.subwallet.not-sent");
  take = true;
  assert.equal((await notTaken.wallets.sendCall(b.id, { to: V2, value: "1000", data: buy(b.address) }, undefined, SITE)).status, "done");
  assert.equal(parseTx(fromBase64(tries[1])).nonce, 7, "nothing was sent, so the next call takes the same turn");

  const failed = setup();
  const c = await failed.wallets.siteFor(SITE, "bsc");
  const call = { to: V2, value: "1000", data: buy(c.address) };
  failed.setReceipts(["failed", "failed"]);
  assert.equal(((await failed.wallets.sendCall(c.id, call, undefined, SITE)) as any).problem.code, "security.subwallet.send-failed");
  failed.setReceipts(["ok", null]);
  assert.equal(((await failed.wallets.sendCall(c.id, call, undefined, SITE)) as any).problem.code, "security.subwallet.unconfirmed", "one node alone isn't confirmed");
  failed.setReceipts(["ok", "failed"]);
  assert.equal(((await failed.wallets.sendCall(c.id, call, undefined, SITE)) as any).problem.code, "security.nodes.disagree");
  assert.equal(failed.shown.length, 3, "each asked first (a site ZeroFee doesn't list), then said as it went");
});

test("what a site's call may be, and who may send one", async () => {
  const { wallets, sent } = setup();
  const w = await wallets.siteFor(SITE, "gnosis");
  const invalid = async (call: unknown, why: RegExp) => assert.rejects(wallets.sendCall(w.id, call, undefined, SITE), (e: any) => e.problem.code === "security.request.invalid" && why.test(JSON.stringify(e.problem)));
  await invalid({ data: "0x6080" }, /contract creation/);
  await invalid({ to: TO, value: "-1" }, /call.value/);
  await invalid({ to: TO, value: 1 }, /call.value/);
  await invalid({ to: TO, data: "0x123" }, /call.data/);
  await invalid({ to: TO, gas: "30000001" }, /call.gas/);
  const card = await wallets.create("pay", "gnosis");
  await assert.rejects(wallets.sendCall(card.id, { to: TO, value: "1" }, undefined, SITE), (e: any) => /signs only for Gnosis Pay/.test(JSON.stringify(e.problem)));
  // audit C1: a chain wallet never sends for a site; NEAR's wallets never either.
  await assert.rejects(wallets.sendCall((await wallets.create("browser", "gnosis")).id, { to: TO, value: "1" }, undefined, SITE), sharedRefused);
  const pocket = await wallets.create("private", "near");
  await assert.rejects(wallets.sendCall(pocket.id, { to: TO, value: "1" }, undefined, SITE), (e: any) => e.problem.code === "security.subwallet.refused");
  const sol = await wallets.siteFor(SITE, "sol");
  await assert.rejects(wallets.sendCall(sol.id, { to: TO }, undefined, SITE), (e: any) => e.problem.code === "security.request.invalid");
  assert.equal(sent.length, 0);
});

test("security review 2 Nov (Medium), D143 refinement, audit C1: a site's coin transfer out of its own wallet on BNB Chain or Robinhood Chain fails its check, so it asks: the cause first, the coin and its payee named in full, no dollar figure; a no sends nothing (control: from the person's own flow it is refused, named)", async () => {
  // A coin's transfer(to, amount) out of the chain wallet: Trade's decoder once read it as "A BNB Chain transaction" and
  // "Up to 0.0000003 BNB leaves the wallet", a drain read as a fee. It isn't a trade, so it is never signed silently.
  const USDT = "0x55d398326f99059ff775485246999027b3197955";
  const THIEF = "0x" + "bb".repeat(20);
  const data = "0xa9059cbb" + word(THIEF) + word(10n ** 24n);
  for (const chain of ["bsc", "hood"] as const) {
    const { wallets, shown, sent, say } = setup({ token: async () => ({ symbol: "USDT", decimals: 18 }) as never });
    const w = await wallets.siteFor(SITE, chain);
    const own = await wallets.create("chain", chain);
    assert.equal(own.kind, "trade", "on these chains the chain wallet is Trade's own trading wallet (D55)");
    await assert.rejects(wallets.sendCall(own.id, { to: USDT, data }, undefined, SITE, "Browser", "browser"), sharedRefused, `${chain}: the site on the shared wallet`);
    say(false);
    assert.deepEqual(await wallets.sendCall(w.id, { to: USDT, data }, undefined, SITE, "Browser", "browser"), { status: "declined" }, chain);
    assert.equal(shown.length, 1, `${chain}: asked`);
    const sheet = shown[0]!;
    // (the decoder reads no coin contract's own calls, so the coin is "an app ZeroFee doesn't know")
    assert.equal(sheet.warnings[0]?.text, "It goes to an app ZeroFee doesn't know, so ZeroFee asks you.", `${chain}: the cause first`);
    assert.equal(sheet.title, "Send 1,000,000 USDT", `${chain}: the coin that leaves, never a fee`);
    assert.ok(sheet.lines.includes(`To ${checksumAddress(THIEF)}`), `${chain}: the payee in full`);
    assert.equal(sheet.amount, undefined, `${chain}: no dollar figure for a coin's transfer`);
    assert.equal(sent.length, 0, `${chain}: nothing sent`);
    // control: from the person's own flow the same transfer is refused by name, never asked
    await assert.rejects(wallets.sendCall(own.id, { to: USDT, data }, undefined, undefined, "Browser", "browser"), refusedTrade(/^It goes to an app ZeroFee doesn't know\./), chain);
    assert.deepEqual([sent.length, shown.length], [0, 1], `${chain}: nothing sent, not asked again`);
    if (chain !== "bsc") continue;
    // The control: a clean buy from the same site and wallet, on a yes, signs and is sent.
    say(true);
    assert.equal((await wallets.sendCall(w.id, { to: V2, value: "1000", data: buy(w.address) }, undefined, SITE, "Browser", "browser")).status, "done");
    assert.deepEqual([sent.length, shown.length], [1, 2]);
    assert.equal(shown[1]!.warnings[0]?.text, ASKED_BY_SITE);
  }
});

test("security review 2 Nov (Low), D143: a coin's transfer out of the chain wallet is refused whoever asks: Browser, Apps, Chat, the shell and Trade itself", async () => {
  const { unsignedEvmTx } = await import("./evm.ts");
  const USDT = "0x55d398326f99059ff775485246999027b3197955";
  const data = "0xa9059cbb" + word("0x" + "bb".repeat(20)) + word(10n ** 24n);
  for (const app of ["browser", "social", "chat", "trade", undefined]) {
    const { wallets, shown } = setup({ token: async () => ({ symbol: "USDT", decimals: 18 }) as never });
    const w = await wallets.create("chain", "bsc");
    const t = (to: string, value: bigint, d: string) => unsignedEvmTx({ chainId: 56, nonce: 8, tip: 1_000_000n, fee: 5_000_000n, gas: 60_000n, to, value, data: d });
    await assert.rejects(wallets.signTx(w.id, t(USDT, 0n, data), undefined, undefined, "An app", undefined, app), refusedTrade(/^It goes to an app ZeroFee doesn't know\./), app ?? "shell");
    // the control: a clean buy, asked by the same caller, signs
    assert.ok("signedTx" in (await wallets.signTx(w.id, t(V2, 1000n, buy(w.address)), undefined, undefined, "An app", undefined, app)), app ?? "shell");
    assert.equal(shown.length, 0, `${app ?? "shell"}: never a sheet`);
  }
});

test("a site reads only the read list, on its wallet's chain", async () => {
  const { wallets } = setup();
  const w = await wallets.create("browser", "arb");
  assert.deepEqual(await wallets.siteRead(w.id, "eth_call", [{ to: TO, data: "0x" }, "latest"]), { result: { method: "eth_call", params: [{ to: TO, data: "0x" }, "latest"] } });
  for (const method of ["eth_sendRawTransaction", "eth_sign", "personal_sign", "eth_accounts", "debug_traceCall"]) {
    await assert.rejects(wallets.siteRead(w.id, method, []), (e: any) => e.problem.code === "security.request.not-allowed", method);
  }
  await assert.rejects(wallets.siteRead(w.id, "eth_call", "x"), (e: any) => e.problem.code === "security.request.invalid");
});

test("a wallet's balances, for showing: the chain's coin and ZeroFee's listed coins, in smallest units", async () => {
  const asked: unknown[][] = [];
  const { wallets } = setup({ read: async (_chain, method, params) => (asked.push([method, params]), method === "eth_getBalance" ? "0xde0b6b3a7640000" : `0x${(5_000_000n).toString(16).padStart(64, "0")}`) });
  const w = await wallets.create("browser", "base");
  assert.deepEqual(await wallets.balances(w.id), [
    { token: "native", symbol: "ETH", decimals: 18, amount: "1000000000000000000" },
    { token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6, amount: "5000000" },
  ]);
  assert.deepEqual(asked[1], ["eth_call", [{ to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", data: `0x70a08231${w.address.slice(2).padStart(64, "0")}` }, "latest"]]);
  const card = await wallets.create("pay", "gnosis");
  assert.deepEqual((await wallets.balances(card.id)).map((b) => b.symbol), ["xDAI", "EURe", "USDC.e"]);
  const down = setup({ read: async () => Promise.reject(new Error("down")) });
  const x = await down.wallets.create("browser", "eth");
  // bug 8: Ethereum by name, never "NEAR didn't answer", and no NEAR service marked down
  await assert.rejects(down.wallets.balances(x.id), (e: any) => e.problem.code === "security.chain.unreachable" && e.problem.whatHappened === "Ethereum didn't answer." && e.problem.service === undefined);
});

test("subwallet.send (D143): only Wallet's own Send pays from the chain's current wallet, a plain transfer built by the core (to an outside address, after Face ID: QA, 5 Nov); Chat and every other caller are refused", async () => {
  const sent: string[] = [];
  const asked: PlainWords[] = [];
  const evm = {
    simulate: async () => ({ ok: true, agreed: true, balance: 10n ** 18n }), nonce: async () => 3, tokenBalance: async () => 0n, token: async () => undefined, ponsCurve: async () => null,
    fees: async () => ({ tip: 1_000_000n, maxFee: 5_000_000n }), estimateGas: async () => 21_000n, send: async (_c: string, s: string) => (sent.push(s), true), receipt: async () => ["ok", "ok"],
    // the wallet holds 1 BNB
    read: async (_c: string, method: string) => (method === "eth_getBalance" ? "0xde0b6b3a7640000" : "0x0"),
  } as unknown as EvmChain;
  const wallets = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm, usdPrice: async () => 600, approve: async (words) => (asked.push(words), true), emit: () => {}, confirm: { everyMs: 1, forMs: 5 } });
  const w = await wallets.create("chain", "bsc");
  // a hot key pays an outside address only on the person's Hold in Wallet: never Chat, an app, a site or the shell
  for (const [asker, app] of [["ZeroFee Chat", "chat"], ["Trade", "trade"], ["Browser", "browser"], ["ZeroFee", "undefined"]]) {
    await assert.rejects(wallets.sendPlain("bsc", TO, "0.25", undefined, asker, app), (e: any) => e.problem.code === "security.request.not-allowed" && /^Only your own Send in Home sends from your chain wallets\./.test(e.problem.more), app);
  }
  assert.equal(sent.length, 0, "nothing sent for any of them");
  assert.equal(asked.length, 0, "and nothing asked");
  // the control: Wallet's own Send of the same goes, after its Face ID sheet
  const out = await wallets.sendPlain("bsc", TO, "0.1", undefined, "ZeroFee", "wallet");
  assert.equal(out.status, "done");
  assert.deepEqual(asked.map((x) => [x.tap, x.lines[0]]), [[undefined, `To ${TO}`]]);
  const t = parseTx(fromBase64(sent[0]!));
  assert.deepEqual([t.chainId, t.to, t.value, t.data], [56, TO, 10n ** 17n, "0x"], "a plain transfer of exactly that, nothing else");
  // more than the wallet holds, not an address there, or a coin ZeroFee doesn't list there: refused before anything is signed
  await assert.rejects(wallets.sendPlain("bsc", TO, "2", undefined, "ZeroFee", "wallet"), (e: any) => e.problem.code === "security.balance.low-coin");
  await assert.rejects(wallets.sendPlain("bsc", "bob.near", "0.1", undefined, "ZeroFee", "wallet"), (e: any) => e.problem.code === "security.request.invalid");
  await assert.rejects(wallets.sendPlain("bsc", TO, "0.1", "0x55d398326f99059ff775485246999027b3197955", "ZeroFee", "wallet"), (e: any) => e.problem.code === "security.request.invalid", "a coin ZeroFee doesn't list there");
  assert.equal(sent.length, 1, "nothing sent for any refusal");
  assert.equal(w.chain, "bsc");
});

test("security review 2 Nov (Medium): Wallet's send pays exactly the address given, so a look-alike made to match its ends is another payee in the signed bytes; a broken checksum is refused before anything is signed", async () => {
  // An address-poisoning copy: the same first 8 and last 6 characters as the real one, different in the middle.
  const REAL = "0x1234ab" + "0".repeat(28) + "cdef01";
  const FAKE = "0x1234ab" + "9".repeat(28) + "cdef01";
  const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  assert.equal(`${REAL.slice(0, 8)}…${REAL.slice(-6)}`, `${FAKE.slice(0, 8)}…${FAKE.slice(-6)}`, "the control: shortened, they are one");
  const sent: string[] = [];
  const evm = {
    simulate: async () => ({ ok: true, agreed: true, balance: 10n ** 18n }), nonce: async () => 3, tokenBalance: async () => 0n, token: async () => ({ symbol: "USDC", decimals: 6 }), ponsCurve: async () => null,
    fees: async () => ({ tip: 1_000_000n, maxFee: 5_000_000n }), estimateGas: async () => 21_000n, send: async (_c: string, s: string) => (sent.push(s), true), receipt: async () => ["ok", "ok"],
    read: async (_c: string, method: string) => (method === "eth_getBalance" ? "0xde0b6b3a7640000" : "0x" + (5_000_000n).toString(16).padStart(64, "0")),
  } as unknown as EvmChain;
  const wallets = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm, usdPrice: async () => 600, approve: async () => true /* outside addresses: Face ID, approved (QA, 5 Nov) */, emit: () => {}, confirm: { everyMs: 1, forMs: 5 } });
  await wallets.create("chain", "bsc");
  await wallets.create("chain", "base");
  for (const to of [REAL, FAKE]) assert.equal((await wallets.sendPlain("bsc", to, "0.1", undefined, "ZeroFee", "wallet")).status, "done");
  const [real, fake] = sent.map((s) => parseTx(fromBase64(s)).to);
  assert.deepEqual([real, fake], [REAL, FAKE], "each pays its own address, in full");
  // a listed coin's transfer pays its receiver in full; the coin's contract is only what it calls
  await wallets.sendPlain("base", REAL, "2.5", USDC, "ZeroFee", "wallet");
  const coin = parseTx(fromBase64(sent.at(-1)!));
  assert.deepEqual([coin.chainId, coin.to, coin.value, coin.data], [8453, USDC, 0n, `0xa9059cbb${REAL.slice(2).padStart(64, "0")}${(2_500_000n).toString(16).padStart(64, "0")}`]);
  // EIP-55: its own checksum, all lower case and all upper case pass; mixed capitals that aren't its checksum don't
  const sum = checksumAddress(REAL);
  assert.notEqual(sum, REAL.toLowerCase(), "the control: this address has capitals in its checksum");
  const before = sent.length;
  const flipped = sum.replace(/[A-F]/, (c) => c.toLowerCase());
  await assert.rejects(wallets.sendPlain("bsc", flipped, "0.1", undefined, "ZeroFee", "wallet"), (e: any) => e.problem.code === "security.request.invalid" && /checksum/.test(e.problem.more));
  assert.equal(sent.length, before, "refused before anything is signed");
  for (const ok of [sum, REAL.toLowerCase(), "0x" + REAL.slice(2).toUpperCase()]) assert.equal((await wallets.sendPlain("bsc", ok, "0.1", undefined, "ZeroFee", "wallet")).status, "done", ok);
  // a bidi mark or a look-alike letter is no address at all
  for (const bad of [`${REAL.slice(0, 20)}‮${REAL.slice(20)}`, REAL.replace("a", "а"), ` ${REAL}`]) {
    await assert.rejects(wallets.sendPlain("bsc", bad, "0.1", undefined, "ZeroFee", "wallet"), (e: any) => e.problem.code === "security.request.invalid", JSON.stringify(bad));
  }
});

test("security review 2 Nov: a double tap on Wallet's Send is one send; once it is done or refused, the next payment goes", async () => {
  const sent: string[] = [];
  let reached!: () => void;
  let release!: () => void;
  const atNodes = new Promise<void>((r) => (reached = r));
  const gate = new Promise<void>((r) => (release = r));
  const evm = {
    simulate: async () => ({ ok: true, agreed: true, balance: 10n ** 18n }), nonce: async () => 3, tokenBalance: async () => 0n, token: async () => undefined, ponsCurve: async () => null,
    fees: async () => ({ tip: 1_000_000n, maxFee: 5_000_000n }), estimateGas: async () => 21_000n, receipt: async () => ["ok", "ok"],
    // the first send waits at the nodes until released
    send: async (_c: string, s: string) => (reached(), await gate, sent.push(s), true),
    read: async (_c: string, method: string) => (method === "eth_getBalance" ? "0xde0b6b3a7640000" : "0x0"),
  } as unknown as EvmChain;
  const wallets = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm, usdPrice: async () => 600, approve: async () => true /* outside: Face ID, approved (QA, 5 Nov) */, emit: () => {}, confirm: { everyMs: 1, forMs: 5 } });
  await wallets.create("chain", "bsc");
  const first = wallets.sendPlain("bsc", TO, "0.1", undefined, "ZeroFee", "wallet");
  await atNodes;
  await assert.rejects(wallets.sendPlain("bsc", TO, "0.1", undefined, "ZeroFee", "wallet"), (e: any) => e.problem.code === "security.subwallet.refused" && /one at a time/.test(e.problem.more), "the second tap, while the first is at the nodes");
  release();
  assert.equal((await first).status, "done");
  assert.equal(sent.length, 1, "one send");
  // finished or refused: the next payment goes
  await assert.rejects(wallets.sendPlain("bsc", TO, "5", undefined, "ZeroFee", "wallet"), (e: any) => e.problem.code === "security.balance.low-coin");
  assert.equal((await wallets.sendPlain("bsc", TO, "0.1", undefined, "ZeroFee", "wallet")).status, "done");
  assert.equal(sent.length, 2);
});

test("audit C1: Wallet's Hold send counts against the one rolling cap: over $100, or past $500 in a day across the hot wallets, it asks on the sheet (decision C, 4 Nov: to an outside address that is Face ID); a no sends nothing, a yes sends it (controls: inside the cap no sheet; no price asks)", async () => {
  const sent: string[] = [];
  const shown: PlainWords[] = [];
  let answer = false;
  let price: number | null = 600;
  const evm = {
    simulate: async () => ({ ok: true, agreed: true, balance: 10n ** 19n }), nonce: async () => 3, tokenBalance: async () => 0n, token: async () => undefined, ponsCurve: async () => null,
    fees: async () => ({ tip: 1_000_000n, maxFee: 5_000_000n }), estimateGas: async () => 21_000n, send: async (_c: string, s: string) => (sent.push(s), true), receipt: async () => ["ok", "ok"],
    // the wallet holds 10 BNB
    read: async (_c: string, method: string) => (method === "eth_getBalance" ? "0x8ac7230489e80000" : "0x0"),
  } as unknown as EvmChain;
  const wallets = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm, usdPrice: async () => price, approve: async (w) => (shown.push(w), answer), emit: () => {}, confirm: { everyMs: 1, forMs: 5 } });
  await wallets.create("chain", "bsc");
  // QA's ruling (5 Nov): an outside address always asks Face ID and isn't counted; the cap is for sends to the
  // person's own wallets (decision C: past it, one tap)
  const MINE = (await wallets.create("browser", "bsc")).address;
  // 0.25 BNB at $600 is $150: over $100, so it asks; a no sends nothing
  assert.deepEqual(await wallets.sendPlain("bsc", MINE, "0.25", undefined, "ZeroFee", "wallet"), { status: "declined" });
  assert.equal(sent.length, 0);
  assert.equal(shown.length, 1);
  assert.equal(shown[0]!.tap, true, "decision C: their own wallet past the cap, one tap");
  assert.equal(shown[0]!.asker, "wallet");
  assert.equal(shown[0]!.title, "Send 0.25 BNB");
  assert.equal(shown[0]!.warnings[0]?.text, "It's over $100, so ZeroFee asks you.");
  answer = true;
  assert.equal((await wallets.sendPlain("bsc", MINE, "0.25", undefined, "ZeroFee", "wallet")).status, "done", "a yes sends it");
  // control: inside the cap, no sheet; five of $90 fill the day's $500 but one
  for (let i = 0; i < 5; i++) assert.equal((await wallets.sendPlain("bsc", MINE, "0.15", undefined, "ZeroFee", "wallet")).status, "done");
  assert.equal(shown.length, 2, "no sheet inside the cap");
  // past $500 in a day: asked
  answer = false;
  assert.deepEqual(await wallets.sendPlain("bsc", MINE, "0.15", undefined, "ZeroFee", "wallet"), { status: "declined" });
  assert.equal(shown.at(-1)!.warnings[0]?.text, "It's past $500 in a day, so ZeroFee asks you.");
  // no price: asked, never sent blind
  price = null;
  const fresh = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm, usdPrice: async () => price, approve: async (w) => (shown.push(w), false), emit: () => {}, confirm: { everyMs: 1, forMs: 5 } });
  await fresh.create("chain", "bsc");
  const freshMine = (await fresh.create("browser", "bsc")).address;
  assert.deepEqual(await fresh.sendPlain("bsc", freshMine, "0.01", undefined, "ZeroFee", "wallet"), { status: "declined" });
  assert.equal(shown.at(-1)!.warnings[0]?.text, "Its price couldn't be read, so ZeroFee asks you.");
  assert.equal(sent.length, 6);
});
