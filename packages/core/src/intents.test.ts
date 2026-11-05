import { test } from "node:test";
import assert from "node:assert/strict";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner } from "./dev-signer.ts";
import { STAKING_POOL_CODE_HASH } from "./coins.ts";
import { INTENTS, PRIVATE_POCKET, TRADING_BALANCE } from "./intents.ts";
import type { OneClickLookup } from "./intents.ts";
import type { PlainWords, TxRequest } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const SOL_USDC = "sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const DEPOSIT = "1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c";
const SOLANA_ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
/** 1Click as recorded for an address it never gave out (its /status answers 404): hermetic, never the live service. */
const NOT_A_DEPOSIT: OneClickLookup = async () => null;

function setup(options: { quote?: Record<string, unknown>; intentsCode?: string; network?: "mainnet" | "testnet"; lookup?: OneClickLookup; ownWallets?: Map<string, string>; ownQuote?: OneClickLookup; privateLeg?: (dep: string) => Promise<{ tokenId: string; units: string } | null>; sendPayout?: (dep: string) => Promise<import("./intents.ts").SendPayout | null>; intentOf?: (dep: string) => Promise<"swap" | "move" | null>; usdcUnits?: string } = {}) {
  const chain = new FakeChain(options.network ?? "mainnet");
  const key = SoftwareKey.generate();
  chain.fund("alice.near", key.publicKey);
  const balances: Record<string, string> = { [`nep141:${USDC}`]: options.usdcUnits ?? "20000000", "nep141:eth.omft.near": "2000000000000000000", "nep141:fakeusdc.near": "5" };
  chain.contract("intents.near", options.intentsCode ?? INTENTS.codeHashBase58, { mt_balance_of: ({ token_id }) => balances[String(token_id)] ?? "0" });
  chain.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6, icon: "data:image/svg+xml,…" }) });
  chain.contract("eth.omft.near", "omft", { ft_metadata: () => ({ symbol: "ETH", decimals: 18 }) });
  chain.contract(SOL_USDC, "omft", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  chain.contract("fakeusdc.near", "fake", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  const lookup: OneClickLookup = options.lookup ?? (async (address) => (address === DEPOSIT && options.quote ? options.quote : null));
  const shown: PlainWords[] = [];
  const signer = new DevSigner({ accountId: "alice.near", chain, key, approve: async (w) => (shown.push(w), true), oneClick: lookup, quoteKey: TEST_QUOTE_KEY, ...(options.ownQuote ? { ownQuote: options.ownQuote } : {}), ...(options.privateLeg ? { privateLeg: options.privateLeg } : {}), ...(options.sendPayout ? { sendPayout: options.sendPayout } : {}), ...(options.intentOf ? { intentOf: options.intentOf } : {}), ...(options.ownWallets ? { ownWallets: async () => options.ownWallets! } : {}) });
  return { chain, signer, shown };
}

const intentsCall = (method: string, args: Record<string, unknown>): TxRequest => ({
  receiverId: "intents.near",
  actions: [{ kind: "call", method, args, depositYocto: "1", gas: "30000000000000" }],
  why: "",
  from: "wallet",
});
/** A real quote's deadline: 1Click signs it (a dry quote signs none, audit T-1). */
const SOON = new Date(Date.now() + 2 * 86_400_000).toISOString();
const quote = (over: Record<string, unknown> = {}, quoteOver: Record<string, unknown> = {}) => ({
  status: "PENDING_DEPOSIT",
  // Signed the way 1Click signs a quote (by the test key), for the deposit address it's paid to.
  quoteResponse: signedQuote({
    quoteRequest: { dry: false, originAsset: `nep141:${USDC}`, destinationAsset: `nep141:${SOL_USDC}`, refundTo: "alice.near", refundType: "INTENTS", recipient: SOLANA_ADDRESS, recipientType: "DESTINATION_CHAIN", deadline: SOON, ...over },
    quote: { depositAddress: DEPOSIT, amountIn: "10050000", minAmountOut: "10000000", deadline: SOON, ...quoteOver },
  }),
});
/** The payee the person entered (TxRequest.payee): a 1Click quote to anyone else outside the account is refused. */
const PAYEE = { recipient: SOLANA_ADDRESS, recipientType: "DESTINATION_CHAIN" as const };
const pay: TxRequest = { ...intentsCall("mt_transfer", { receiver_id: DEPOSIT, token_id: `nep141:${USDC}`, amount: "10050000", approval: null }), payee: PAYEE };

test("a send inside NEAR Intents names the coin, the exact amount, and the balance before and after", async () => {
  const { signer } = setup();
  const words = await signer.describe(intentsCall("mt_transfer", { receiver_id: "bob.near", token_id: `nep141:${USDC}`, amount: "12500000", approval: null }));
  assert.equal(words.title, "Send 12.5 USDC to bob.near");
  assert.equal(words.lines[0], "Send 12.5 USDC from your Safe to bob.near, on NEAR");
  assert.deepEqual(words.effect.at(-1), { token: "USDC", before: "20", after: "7.5" });
  assert.deepEqual(words.warnings.map((w) => w.kind), ["first-time-recipient", "large-amount"]);
});

test("security review 2 Nov: the first-time warning is every coin send's, not NEAR's only, from the same past-sends list; unread, it shows", async () => {
  const first = (w: PlainWords) => w.warnings.filter((x) => x.kind === "first-time-recipient").map((x) => x.text);
  const usdcTo = (to: string) => intentsCall("mt_transfer", { receiver_id: to, token_id: `nep141:${USDC}`, amount: "1000000", approval: null });
  // the list unread (no record of sends, nothing on this device): every coin send warns, and says "from this device"
  const { signer } = setup();
  assert.deepEqual(first(await signer.describe(usdcTo("bob.near"))), ["You haven't sent to bob.near from this device before."], "USDC inside NEAR Intents");
  assert.deepEqual(first(await signer.describe(intentsCall("ft_withdraw", { token: USDC, receiver_id: "carol.near", amount: "1000000" }))), ["You haven't sent to carol.near from this device before."], "USDC out of NEAR Intents to a NEAR account");
  assert.deepEqual(first(await signer.describe(intentsCall("ft_withdraw", { token: "eth.omft.near", receiver_id: "eth.omft.near", amount: "1", memo: "WITHDRAW_TO:0xAbCd000000000000000000000000000000007890" }))), ["You haven't sent to 0xAbCd000000000000000000000000000000007890 from this device before."], "a coin to its home chain: the address it goes to");
  const coin = await signer.describe({ receiverId: USDC, actions: [{ kind: "call", method: "ft_transfer", args: { receiver_id: "dave.near", amount: "1000000" }, depositYocto: "1", gas: "30000000000000" }], why: "", from: "wallet" });
  assert.deepEqual(first(coin), ["You haven't sent to dave.near from this device before."], "a coin sent by its own contract");
  // a 1Click payment: the person it pays (the quote's recipient), never 1Click's deposit address
  const paid = setup({ quote: quote() });
  assert.deepEqual(first(await paid.signer.describe(pay)), [`You haven't sent to ${SOLANA_ADDRESS} from this device before.`]);
  // the past-sends list (the account's record) holds them: no warning, for NEAR and coins alike
  const chain = new FakeChain("mainnet");
  const key = SoftwareKey.generate();
  chain.fund("alice.near", key.publicKey);
  chain.contract("intents.near", INTENTS.codeHashBase58, { mt_balance_of: () => "20000000" });
  chain.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  const known = new DevSigner({ accountId: "alice.near", chain, key, approve: async () => true, oneClick: NOT_A_DEPOSIT, pastRecipients: async () => ["bob.near"] });
  assert.deepEqual(first(await known.describe(usdcTo("bob.near"))), [], "sent to before: quiet");
  assert.deepEqual(first(await known.describe(usdcTo("erin.near"))), ["You haven't sent to erin.near before."], "control: someone the record doesn't hold");
  // the record can't be read: never "sent before"
  const blind = new DevSigner({ accountId: "alice.near", chain, key, approve: async () => true, oneClick: NOT_A_DEPOSIT, pastRecipients: async () => { throw new Error("index down"); } });
  assert.deepEqual(first(await blind.describe(usdcTo("bob.near"))), ["You haven't sent to bob.near from this device before."]);
  // the account's own wallets (the Add into Spending) and its own balance are no one: no warning
  const FLOAT = "f1".repeat(32);
  const into = { originAsset: `nep141:${USDC}`, destinationAsset: `nep141:${USDC}`, recipient: FLOAT, recipientType: "CONFIDENTIAL_INTENTS", refundTo: FLOAT, refundType: "CONFIDENTIAL_INTENTS" };
  const own = setup({ quote: quote(into, { amountIn: "10000000", minAmountOut: "10000000" }), ownWallets: new Map([[FLOAT, TRADING_BALANCE]]) });
  const add = await own.signer.describe(intentsCall("ft_withdraw", { token: USDC, receiver_id: DEPOSIT, amount: "10000000" }));
  assert.equal(add.title, "Move 10 USDC to your NEAR wallet", "control: it is the move into your NEAR wallet");
  assert.deepEqual(first(add), [], "a Top up into Trading");
});

test("a coin send that lands goes on the past-sends list: the next one to them isn't 'first time'", async () => {
  const { signer, chain } = setup();
  const first = (w: PlainWords) => w.warnings.filter((x) => x.kind === "first-time-recipient").length;
  const send = intentsCall("mt_transfer", { receiver_id: "bob.near", token_id: `nep141:${USDC}`, amount: "1000000", approval: null });
  assert.equal(first(await signer.describe(send)), 1);
  assert.equal((await signer.request(send)).status, "done");
  assert.ok(chain.sent.length > 0, "control: it was sent");
  assert.equal(first(await signer.describe(send)), 0);
  assert.equal(first(await signer.describe(intentsCall("mt_transfer", { receiver_id: "carol.near", token_id: `nep141:${USDC}`, amount: "1000000", approval: null }))), 1, "only them");
});

test("a withdrawal to another chain is described as one only when it really is one", async () => {
  const { signer } = setup();
  const address = "0xAbCd000000000000000000000000000000007890";
  const real = await signer.describe(intentsCall("ft_withdraw", { token: "eth.omft.near", receiver_id: "eth.omft.near", amount: "500000000000000000", memo: `WITHDRAW_TO:${address}` }));
  assert.equal(real.title, "Send 0.5 ETH to 0xAbCd00…007890 on Ethereum");
  assert.equal(real.lines[0], `Send 0.5 ETH from your Safe to ${address} on Ethereum`);

  // Same memo, but sent to an ordinary NEAR account: that is a transfer to that account, and the words say so.
  const lookAlike = await signer.describe(intentsCall("ft_withdraw", { token: "eth.omft.near", receiver_id: "mallory.near", amount: "500000000000000000", memo: `WITHDRAW_TO:${address}` }));
  assert.equal(lookAlike.title, "Move 0.5 ETH to mallory.near");

  // A msg turns it into a call that doesn't refund on failure: warned.
  const withMsg = await signer.describe(intentsCall("ft_withdraw", { token: "eth.omft.near", receiver_id: "eth.omft.near", amount: "1", memo: `WITHDRAW_TO:${address}`, msg: "" }));
  assert.match(withMsg.title, /^Move /);
  assert.ok(withMsg.warnings.some((w) => w.kind === "effect-unknown" && /don't come back/.test(w.text)));
});

test("a 1Click payment says what 1Click promises, after its terms are checked against the bytes", async () => {
  const { signer, shown } = setup({ quote: quote() });
  const outcome = await signer.request(pay);
  assert.equal(outcome.status, "done");
  const words = shown[0];
  assert.equal(words.title, "Send 10.05 USDC to 7xKXtg…osgAsU");
  assert.deepEqual(words.lines.slice(0, 3), [
    "Send 10.05 USDC from your Safe to the swap service",
    `The swap service promises at least 10 USDC to 7xKXtg…osgAsU on Solana`,
    "If it can't, your USDC comes back to your Safe",
  ]);
  assert.ok(words.warnings.some((w) => /The swap service promises the payout/.test(w.text)));
});

test("the balance a payment leaves is named by who signs: your balance, the Trading balance or the Private balance", async () => {
  for (const [own, name] of [[undefined, "your Safe"], [TRADING_BALANCE, "your NEAR wallet"], [PRIVATE_POCKET, "your private balance"]] as const) {
    const words = await setup({ quote: quote(), ...(own ? { ownWallets: new Map([["alice.near", own]]) } : {}) }).signer.describe(pay);
    assert.equal(words.lines[0], `Send 10.05 USDC from ${name} to the swap service`, String(own));
    assert.equal(words.lines[2], `If it can't, your USDC comes back to ${name}`, String(own));
  }
});

test("a 1Click payment the protection would hold is refused before Face ID: its price can't wait", async () => {
  const { signer, shown, chain } = setup({ quote: quote() });
  chain.withRules("alice.near", [{ up_to: null, level: { Wait: { seconds: "120" } } }]);
  const outcome = await signer.request(pay);
  assert.equal(outcome.status === "problem" && outcome.problem.code, "security.quote.cant-wait");
  assert.equal(shown.length, 0);
  assert.equal(chain.sent.length, 0);
  // Within the Face ID band it goes as before.
  chain.withRules("alice.near", [{ up_to: null, level: "FaceId" }]);
  assert.equal((await signer.request(pay)).status, "done");
});

test("held by rules saved before they counted every coin (no wNEAR in the first band): the next step is Count every coin", async () => {
  const { signer, shown, chain } = setup({ quote: quote() });
  // The test account's rules (mainnet 2 Nov, release 4): Face ID for NEAR up to a limit, anything else waits 2 minutes.
  chain.withRules("alice.near", [{ up_to: [["near", "0"]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }]);
  const old = await signer.request(pay);
  assert.ok(old.status === "problem");
  assert.equal(old.problem.code, "security.quote.cant-wait", "the same code: Pay and the ledger still know it");
  assert.deepEqual(old.problem.next, { kind: "open", label: "Save my rules", screen: "security/protection" });
  assert.equal(shown.length, 0);
  assert.equal(chain.sent.length, 0);
  // Rules that count every coin and still hold it: the plain refusal, as before.
  chain.withRules("alice.near", [{ up_to: [["near", "0"], ["nep141:wrap.near", "0"]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }]);
  const plain = await signer.request(pay);
  assert.ok(plain.status === "problem");
  assert.equal(plain.problem.next.kind, "nothing");
});

test("a 1Click payment is refused if the refund goes elsewhere, the amount or coin differs, or the price ran out", async () => {
  const cases: [Record<string, unknown>, Record<string, unknown>, string][] = [
    [{ refundTo: "mallory.near" }, {}, "security.quote.mismatch"],
    [{ refundType: "ORIGIN_CHAIN" }, {}, "security.quote.mismatch"],
    [{ originAsset: "nep141:fakeusdc.near" }, {}, "security.quote.mismatch"],
    [{}, { amountIn: "10000000" }, "security.quote.mismatch"],
    [{}, { deadline: "2001-01-01T00:00:00.000Z" }, "security.quote.expired"],
  ];
  for (const [req, q, expected] of cases) {
    const { signer, shown, chain } = setup({ quote: quote(req, q) });
    const outcome = await signer.request(pay);
    assert.equal(outcome.status === "problem" && outcome.problem.code, expected, JSON.stringify({ req, q }));
    assert.equal(shown.length, 0);
    assert.equal(chain.sent.length, 0);
  }
  const { signer } = setup({ quote: { ...quote(), status: "SUCCESS" } });
  const used = await signer.request(pay);
  assert.equal(used.status === "problem" && used.problem.code, "security.quote.expired");
});

test("spending more of a coin than the account holds stops before the sheet", async () => {
  const { signer, shown, chain } = setup();
  const outcome = await signer.request(intentsCall("mt_transfer", { receiver_id: "bob.near", token_id: `nep141:${USDC}`, amount: "20000001", approval: null }));
  assert.equal(outcome.status === "problem" && outcome.problem.code, "security.balance.low-coin");
  assert.equal(outcome.status === "problem" && outcome.problem.whatHappened, "You don't have enough USDC for this.");
  assert.equal(shown.length, 0);
  assert.equal(chain.sent.length, 0);
});

test("a copied coin name, or a changed NEAR Intents, carries a warning", async () => {
  const { signer } = setup({ intentsCode: "SomethingElse111111111111111111111111111111" });
  const words = await signer.describe(intentsCall("mt_transfer", { receiver_id: "bob.near", token_id: "nep141:fakeusdc.near", amount: "1", approval: null }));
  const texts = words.warnings.map((w) => w.text);
  assert.ok(texts.some((t) => /moved to a place this ZeroFee doesn't know/.test(t)));
  assert.ok(texts.some((t) => /doesn't know this coin\. Names can be copied/.test(t)));
  // review (QA): a coin that calls itself USDC never reads as the pinned USDC
  assert.match(words.title, /USDC \(fakeusdc\.near\)/, words.title);
});

test("on testnet nothing is looked up: there is no intents.near there", async () => {
  const { signer } = setup({ network: "testnet", lookup: async () => assert.fail("1Click was asked on testnet") });
  const words = await signer.describe({ receiverId: "bob.near", actions: [{ kind: "transfer", yocto: "1" }], why: "", from: "wallet" });
  assert.equal(words.title, "Send 0.000000000000000000000001 NEAR to bob.near");
});

// ── Coins, staking pools, route B, and chains ──

const POOL = "stakely.pool.near";
function withCoinsAndPool(options: { quote?: Record<string, unknown> } = {}) {
  const ctx = setup(options);
  ctx.chain.contract("wrap.near", "wrap", { ft_metadata: () => ({ symbol: "wNEAR", decimals: 24 }) });
  ctx.chain.contract(POOL, STAKING_POOL_CODE_HASH, { get_reward_fee_fraction: () => ({ numerator: 3, denominator: 100 }) });
  return ctx;
}
const call = (method: string, args: Record<string, unknown>, depositYocto = "0") => ({ kind: "call" as const, method, args, depositYocto, gas: "30000000000000" });

test("wrapping NEAR and putting it into NEAR Intents read as plain words", async () => {
  const { signer } = withCoinsAndPool();
  const words = await signer.describe({ receiverId: "wrap.near", actions: [call("near_deposit", {}, "100000000000000000000000"), call("ft_transfer_call", { receiver_id: "intents.near", amount: "100000000000000000000000", msg: "" }, "1")], why: "", from: "wallet" });
  assert.equal(words.title, "Turn 0.1 NEAR into wNEAR, and 1 more step");
  assert.ok(words.lines.includes("Put 0.1 wNEAR into your Safe"));
  assert.ok(!words.warnings.some((w) => w.kind === "unknown-contract"));
});

test("staking reads as plain words with the pool's live fee, and plain NEAR to a pool is refused", async () => {
  const { signer, chain, shown } = withCoinsAndPool();
  const stake = await signer.describe({ receiverId: POOL, actions: [call("deposit_and_stake", {}, "2000000000000000000000000")], why: "", from: "earn" });
  assert.equal(stake.title, `Stake 2 NEAR with ${POOL}`);
  assert.ok(stake.lines.includes("Its fee is 3% now; it can raise it at any time."));
  const lost = await signer.request({ receiverId: POOL, actions: [{ kind: "transfer", yocto: "1000000000000000000000000" }], why: "", from: "earn" });
  assert.equal(lost.status === "problem" && lost.problem.code, "security.request.not-allowed");
  assert.equal(shown.length, 0);
  assert.equal(chain.sent.length, 0);
});

test("route B: paying a 1Click address on NEAR out of the ledger is checked against the quote", async () => {
  const routeB = (over: Record<string, unknown> = {}) =>
    quote({ originAsset: "nep141:wrap.near", refundType: "ORIGIN_CHAIN", ...over }, { amountIn: "500000000000000000000000" });
  const pay = { ...intentsCall("ft_withdraw", { token: "wrap.near", receiver_id: DEPOSIT, amount: "500000000000000000000000" }), payee: PAYEE };
  const good = withCoinsAndPool({ quote: routeB() });
  good.chain.views.set("intents.near mt_balance_of", () => "900000000000000000000000");
  const words = await good.signer.describe(pay);
  assert.match(words.title, /^Pay 10 USDC to /);
  const bad = withCoinsAndPool({ quote: routeB({ refundTo: "mallory.near" }) });
  bad.chain.views.set("intents.near mt_balance_of", () => "900000000000000000000000");
  const out = await bad.signer.request(pay);
  assert.equal(out.status === "problem" && out.problem.code, "security.quote.mismatch");
});

test("a chain is one approval: every step in order, and each only if the one before it worked", async () => {
  const { signer, chain, shown } = withCoinsAndPool();
  chain.withRules("alice.near", [{ up_to: null, level: "FaceId" }]);
  const out = await signer.request({
    receiverId: "wrap.near",
    actions: [call("near_withdraw", { amount: "1000000000000000000000000" }, "1")],
    then: [{ receiverId: POOL, actions: [call("deposit_and_stake", {}, "1000000000000000000000000")] }],
    why: "Stake from the ledger",
    from: "earn",
  });
  assert.equal(out.status, "done");
  assert.equal(shown.length, 1, "one sheet for the whole chain");
  assert.equal(shown[0].title, `Turn 1 wNEAR back into NEAR, then Stake 1 NEAR with ${POOL}`);
  assert.ok(shown[0].lines.includes("Each step happens only if the one before it worked."));
  assert.equal(chain.sent[0].actions[0].kind === "call" && chain.sent[0].actions[0].method, "execute_many");
});

// Earn's two everyday moves, each one approval (docs/layers/earn.md).
test("Earn case A, ledger to staking: register, out of NEAR Intents, unwrap, stake: one sheet, every step named", async () => {
  const { signer, chain, shown } = withCoinsAndPool();
  chain.withRules("alice.near", [{ up_to: null, level: "FaceId" }]);
  chain.views.set("intents.near mt_balance_of", () => "5000000000000000000000000");
  const ONE = "1000000000000000000000000";
  // The account must be registered on wrap.near BEFORE the withdrawal, or wrap.near can't pay it the wNEAR (the step
  // drops out when it is registered already).
  const request = {
    receiverId: "wrap.near",
    actions: [call("storage_deposit", { registration_only: true }, "1250000000000000000000")],
    then: [
      { receiverId: "intents.near", actions: [call("ft_withdraw", { token: "wrap.near", receiver_id: "alice.near", amount: ONE }, "1")] },
      { receiverId: "wrap.near", actions: [call("near_withdraw", { amount: ONE }, "1")] },
      { receiverId: POOL, actions: [{ ...call("deposit_and_stake", {}, ONE), gas: "125000000000000" }] },
    ],
    why: "Stake 1 NEAR",
    from: "earn" as const,
  };
  const out = await signer.request(request);
  assert.equal(out.status, "done");
  assert.equal(shown.length, 1, "one sheet for the whole move");
  const words = shown[0];
  assert.equal(words.title, `Let your account hold wNEAR, then Move 1 wNEAR to alice.near, then Turn 1 wNEAR back into NEAR, then Stake 1 NEAR with ${POOL}`);
  assert.ok(words.lines.includes(`Stake 1 NEAR with ${POOL}`));
  assert.ok(words.lines.includes("Each step happens only if the one before it worked."));
  assert.ok(!words.warnings.some((w) => w.kind === "unknown-contract"));
  assert.equal(chain.sent[0].actions[0].kind === "call" && chain.sent[0].actions[0].method, "execute_many");
});

test("Earn case B, staking to ledger: take out of the pool, wrap, into NEAR Intents: one sheet", async () => {
  const { signer, chain, shown } = withCoinsAndPool();
  chain.withRules("alice.near", [{ up_to: null, level: "FaceId" }]);
  const ONE = "1000000000000000000000000";
  const out = await signer.request({
    receiverId: POOL,
    actions: [{ ...call("withdraw_all", {}), gas: "125000000000000" }],
    then: [{ receiverId: "wrap.near", actions: [call("near_deposit", {}, ONE), call("ft_transfer_call", { receiver_id: "intents.near", amount: ONE, msg: "" }, "1")] }],
    why: "Back to your balance",
    from: "earn",
  });
  assert.equal(out.status, "done");
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, `Take your unstaked NEAR out of ${POOL}, then Turn 1 NEAR into wNEAR, and 1 more step`);
  assert.ok(shown[0].lines.includes("Put 1 wNEAR into your Safe"));
  assert.ok(!shown[0].warnings.some((w) => w.kind === "unknown-contract"));
});

test("moving coins out of NEAR Intents to your own account asks 1Click nothing", async () => {
  const asked: string[] = [];
  const { signer, chain } = setup({ lookup: async (address) => (asked.push(address), null) });
  chain.contract("wrap.near", "wrap", { ft_metadata: () => ({ symbol: "wNEAR", decimals: 24 }) });
  chain.views.set("intents.near mt_balance_of", () => "5000000000000000000000000");
  const words = await signer.describe(intentsCall("ft_withdraw", { token: "wrap.near", receiver_id: "alice.near", amount: "1000000000000000000000000" }));
  assert.equal(words.title, "Move 1 wNEAR to alice.near");
  assert.deepEqual(asked, []);
});

test("when the account contract accepts but a later step fails, the outcome is a Problem, never done", async () => {
  const { signer, chain } = withCoinsAndPool();
  chain.withRules("alice.near", [{ up_to: null, level: "FaceId" }]);
  chain.failLater = true;
  const out = await signer.request({ receiverId: "wrap.near", actions: [call("near_withdraw", { amount: "1" }, "1")], why: "", from: "wallet" });
  assert.equal(out.status === "problem" && out.problem.code, "security.send.partly");
});

test("a chain needs the account contract", async () => {
  const { signer } = withCoinsAndPool();
  const out = await signer.request({ receiverId: "wrap.near", actions: [call("near_withdraw", { amount: "1" }, "1")], then: [{ receiverId: "bob.near", actions: [{ kind: "transfer", yocto: "1" }] }], why: "", from: "wallet" });
  assert.equal(out.status === "problem" && out.problem.code, "security.request.not-allowed");
});

test("the Add (main → Spending's float), the same coin: the money sheet's Move and one line, nothing else (audit 2 Nov, S1); a refund elsewhere isn't an Add", async () => {
  const FLOAT = "f1".repeat(32);
  const own = new Map([[FLOAT, TRADING_BALANCE]]);
  const into = { originAsset: `nep141:${USDC}`, destinationAsset: `nep141:${USDC}`, recipient: FLOAT, recipientType: "CONFIDENTIAL_INTENTS", refundTo: FLOAT, refundType: "CONFIDENTIAL_INTENTS" };
  const add = { ...intentsCall("ft_withdraw", { token: USDC, receiver_id: DEPOSIT, amount: "10000000" }), why: "Add $10.00 to your pump.fun wallet", from: "trade" };
  const words = await setup({ quote: quote(into, { amountIn: "10000000", minAmountOut: "10000000" }), ownWallets: own }).signer.describe(add);
  assert.equal(words.title, "Move 10 USDC to your NEAR wallet");
  assert.deepEqual(words.lines, ["From your Safe."]);
  assert.equal(words.amount, undefined);
  assert.equal(words.hint, undefined, "an app's words never lead or trail the sheet");
  const all = [words.title, ...words.lines].join(" | ");
  for (const gone of [/Top up/, /says:/, /30 minutes/, /Fee:/, /Details:/]) assert.doesNotMatch(all, gone);
  // A refund anywhere else isn't an Add: today's words for a move to an own wallet.
  const other = await setup({ quote: quote({ ...into, refundTo: "alice.near", refundType: "INTENTS" }, { amountIn: "10000000", minAmountOut: "10000000" }), ownWallets: own }).signer.describe(add);
  assert.equal(other.title, "Move 10 USDC to your NEAR wallet", "the generic own-wallet words, not the Move's (unchanged here)");
  assert.ok(!other.lines.some((l) => l.includes("30 minutes")), "not the Add's words");
});

test("Home's Move (integration walk, 3 Nov): the Add's sheet keeps its own title and line, and names where the money ends as the app's words, last (\"Trade says: it goes on to your SOL wallet, privately.\"); words that aren't plain are no line (control: without them, no line)", async () => {
  const FLOAT = "f1".repeat(32);
  const own = new Map([[FLOAT, TRADING_BALANCE]]);
  const into = { originAsset: `nep141:${USDC}`, destinationAsset: `nep141:${USDC}`, recipient: FLOAT, recipientType: "CONFIDENTIAL_INTENTS", refundTo: FLOAT, refundType: "CONFIDENTIAL_INTENTS" };
  const add = { ...intentsCall("ft_withdraw", { token: USDC, receiver_id: DEPOSIT, amount: "10000000" }), why: "Move $10.00 from your Safe · SOL $10.00", from: "trade" as const };
  const sheet = (onward?: string) => setup({ quote: quote(into, { amountIn: "10000000", minAmountOut: "10000000" }), ownWallets: own }).signer.describe({ ...add, ...(onward !== undefined ? { onward } : {}) });
  const words = await sheet("it goes on to your SOL wallet, privately.");
  assert.equal(words.title, "Move 10 USDC to your NEAR wallet", "what the signature does, from its bytes");
  assert.deepEqual(words.lines, ["From your Safe."]);
  assert.equal(words.hint, "Trade says: it goes on to your SOL wallet, privately.");
  assert.equal((await sheet("it goes to <a href=x>here</a>")).hint, undefined, "not plain words: no line");
  assert.equal((await sheet()).hint, undefined, "control: no onward words, no line");
});

test("the independent grade (3 Nov, w-m04d): a Move from the Safe on to the SOL and ETH (RH) wallets names where it ends, the route a quiet line, no app's line (controls: another form of words, a name that isn't the person's own wallet, or a move that isn't into the NEAR wallet keep the core's title)", async () => {
  const FLOAT = "f3".repeat(32);
  const own = new Map([[FLOAT, TRADING_BALANCE]]);
  const into = { originAsset: `nep141:${USDC}`, destinationAsset: `nep141:${USDC}`, recipient: FLOAT, recipientType: "CONFIDENTIAL_INTENTS", refundTo: FLOAT, refundType: "CONFIDENTIAL_INTENTS" };
  const add = { ...intentsCall("ft_withdraw", { token: USDC, receiver_id: DEPOSIT, amount: "10000000" }), why: "Move $10.00 from your Safe · SOL $5.00 · ETH (RH) $4.50", from: "trade" as const };
  const sheet = (onward?: string) => setup({ quote: quote(into, { amountIn: "10000000", minAmountOut: "10000000" }), ownWallets: own }).signer.describe({ ...add, ...(onward !== undefined ? { onward } : {}) });
  const two = await sheet("it goes on to your SOL and ETH (RH) wallets. The rest stays in Private.");
  assert.equal(two.title, "Move 10 USDC to your SOL and ETH (RH) wallets", "the final wallets; the amount the bytes say");
  assert.deepEqual(two.lines, ["From your Safe.", "It goes through your NEAR wallet first.", "The rest stays in Private.", "Fee: at most 0.007 NEAR."]);
  assert.equal(two.hint, undefined, "no \"Trade says:\" line");
  const one = await sheet("it goes on to your SOL wallet.");
  assert.equal(one.title, "Move 10 USDC to your SOL wallet");
  assert.deepEqual(one.lines, ["From your Safe.", "It goes through your NEAR wallet first.", "Fee: at most 0.007 NEAR."]);
  // finding 45 (crawl, 4 Nov): a $3 pump.fun Add's sheet said only "to your NEAR wallet", with no fee
  const pump = await sheet("it goes on to your pump.fun wallet on Solana.");
  assert.equal(pump.title, "Add 10 USDC to your pump.fun wallet on Solana", "a listed site's wallet, where it ends, with the word of its button (Add)");
  assert.deepEqual(pump.lines, ["From your Safe.", "It goes through your NEAR wallet first.", "Fee: at most 0.007 NEAR."]);
  assert.equal((await sheet("it goes on to your GMGN wallet on Solana.")).title, "Add 10 USDC to your GMGN wallet on Solana");
  // controls: anything but the engine's own form, naming the person's own wallets, keeps the core's words
  for (const w of ["it goes on to your SOL wallet, privately.", "it goes on to alice.near's wallet.", "it goes on to your SOL and SOL wallets.", "it goes on to your Bitcoin wallet.", "it goes on to your evil.site wallet on Solana.", "it goes on to your AgentZero's pocket wallet on Solana."]) {
    const x = await sheet(w);
    assert.equal(x.title, "Move 10 USDC to your NEAR wallet", w);
    assert.match(x.hint ?? "", /^Trade says: /, w);
  }
  assert.equal((await sheet()).title, "Move 10 USDC to your NEAR wallet", "control: no onward words");
  const { endsTitle } = await import("./onward-ends.ts");
  assert.equal(endsTitle("Send $5.00 to alice.near", "it goes on to your SOL wallet."), null, "control: only a move into the person's own NEAR wallet");
});

test("Home's Swap to a chain wallet: the sheet says Swap and the person's own amount, the grid's extra on its own line with its dollars; only when they add up to what the core says leaves (controls)", async () => {
  const { endsTitle, swapEnds } = await import("./onward-ends.ts");
  const on = "Wallet says: it is a swap of $25.00 of USDC for SOL in your SOL wallet. $1.00 stays hidden in your NEAR wallet.";
  const s = endsTitle("Move $26.00 (26.00 USDC) to your NEAR wallet", on)!;
  assert.equal(s.title, "Swap $25.00 of USDC for SOL");
  assert.deepEqual(s.lines, ["It goes through your NEAR wallet first.", "$1.00 more leaves your Safe, rounded up for privacy. It stays in your NEAR wallet. It's not a fee."]);
  assert.equal(endsTitle("Move $25.00 (25.00 USDC) to your NEAR wallet", "it is a swap of $25.00 of USDC for ETH (RH) in your ETH (RH) wallet.")!.title, "Swap $25.00 of USDC for ETH (RH)", "no extra: no line");
  assert.equal(endsTitle("Move $40.00 (40.00 USDC) to your NEAR wallet", on), null, "control: $25 + $1 isn't the $40 that leaves: the core's own title stands");
  assert.equal(endsTitle("Move $26.00 (26.00 USDC) to your NEAR wallet", "it is a swap of $25.00 of USDC for SOL in your BNB wallet. $1.00 stays hidden in your NEAR wallet."), null, "control: not the engine's form");
  assert.equal(swapEnds("Swap $2.20 (0.5486 NEAR) for USDC", "it is a swap of $2.20 of NEAR for SOL in your SOL wallet.")!.title, "Swap $2.20 (0.5486 NEAR) for SOL", "paid in NEAR: the core's own figure, for the coin asked");
});

test("the Add paid in NEAR: the sheet says the wNEAR paid and the USDC promised; a payment in another coin than the quote's is refused", async () => {
  const FLOAT = "f2".repeat(32);
  const own = new Map([[FLOAT, TRADING_BALANCE]]);
  const into = { originAsset: "nep141:wrap.near", destinationAsset: `nep141:${USDC}`, recipient: FLOAT, recipientType: "CONFIDENTIAL_INTENTS", refundTo: FLOAT, refundType: "CONFIDENTIAL_INTENTS" };
  const five = "5000000000000000000000000";
  const s1 = setup({ quote: quote(into, { amountIn: five, minAmountOut: "12400000" }), ownWallets: own });
  s1.chain.contract("wrap.near", "wrap", { ft_metadata: () => ({ symbol: "wNEAR", decimals: 24 }) });
  s1.chain.views.set("intents.near mt_balance_of", () => "9000000000000000000000000");
  const words = await s1.signer.describe({ ...intentsCall("ft_withdraw", { token: "wrap.near", receiver_id: DEPOSIT, amount: five }), why: "Top up Spending with 5 NEAR", from: "wallet" });
  // Home's Swap (audit 2 Nov, S1): two lines, what leaves and what the swap service promises; nothing else
  assert.equal(words.title, "Swap 5 NEAR for USDC", "the NEAR it pays, once (wNEAR is NEAR one for one, the Safe's name)");
  assert.deepEqual(words.lines, ["From your Safe. At least 12.4 USDC lands in your NEAR wallet.", "If the swap fails, it comes back to your NEAR wallet."], "the USDC promised, and where a refusal leaves it");
  assert.equal(words.amount, undefined, "no Amount line: the amount is in the title");
  assert.equal(words.hint, undefined, "no app's echo (\"Wallet says: …\")");
  assert.deepEqual(words.effect, []);
  const all = [words.title, ...words.lines, words.hint ?? "", words.amount ?? "", ...words.warnings.map((w) => w.text)].join(" | ");
  for (const gone of [/Top up/, /says:/, /30 minutes/, /Fee:/, /Details:/, /\d\.\d{5,} w?NEAR/]) assert.doesNotMatch(all, gone);
  const s2 = setup({ quote: quote(into, { amountIn: five, minAmountOut: "12400000" }), ownWallets: own });
  s2.chain.views.set("intents.near mt_balance_of", () => "9000000000000000000000000");
  const wrong = await s2.signer.request({ ...intentsCall("ft_withdraw", { token: USDC, receiver_id: DEPOSIT, amount: five }), why: "", from: "wallet" });
  assert.equal(wrong.status === "problem" && wrong.problem.code, "security.quote.mismatch", "USDC paid into a quote for wNEAR");
});

test("a move into Private: \"Move … to Private\" from the core's own quote, out of NEAR Intents or straight from the account", async () => {
  const POCKET = "a1".repeat(32);
  const own = new Map([[POCKET, PRIVATE_POCKET]]);
  const into = { originAsset: `nep141:${USDC}`, destinationAsset: `nep141:${USDC}`, recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS", refundTo: POCKET, refundType: "CONFIDENTIAL_INTENTS", depositType: "ORIGIN_CHAIN" };
  const pocketQuote = quote(into, { amountIn: "10000000", minAmountOut: "9900000" });
  // Out of the ledger (ft_withdraw, route B).
  const ledger = await setup({ quote: pocketQuote, ownWallets: own }).signer.describe(intentsCall("ft_withdraw", { token: USDC, receiver_id: DEPOSIT, amount: "10000000" }));
  assert.equal(ledger.title, "Move 10 USDC to your private balance");
  // audit H1: only what's true, never "privately"
  assert.ok(ledger.lines.includes("At least 9.9 USDC lands in your private balance. The swap service promises it."));
  assert.ok(!ledger.lines.some((l: string) => /privately/i.test(l)), "control: no line says privately");
  assert.ok(ledger.lines.includes("If it can't, the money comes back to your private balance"));
  // the pair-private walk (5 Nov): Private said once, first, and the receipt line after the route's lines (control: the Spending sheet has neither)
  assert.equal(ledger.lines[0], "Private is your money inside NEAR Confidential. Moves pay from it. The public can't see what's in it.");
  const receipt = ledger.lines.indexOf("NEAR Confidential moves it. ZeroFee takes nothing.");
  assert.ok(receipt > ledger.lines.indexOf("It pays only when you hold Send or Pay."), "the receipt line after the route's lines");
  assert.equal(ledger.lines.filter((l: string) => /NEAR Confidential/.test(l)).length, 2, "each said once");
  // From the account itself (the coin's own contract, ft_transfer): only a quote the core asked for itself is read.
  const plain: TxRequest = { receiverId: USDC, actions: [{ kind: "call", method: "ft_transfer", args: { receiver_id: DEPOSIT, amount: "10000000" }, depositYocto: "1", gas: "30000000000000" }], why: "", from: "wallet" };
  const ours = setup({ ownQuote: async (a) => (a === DEPOSIT ? pocketQuote : null), ownWallets: own });
  ours.chain.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  const fromAccount = await ours.signer.describe(plain);
  assert.equal(fromAccount.title, "Move 10 USDC to your private balance");
  assert.ok(fromAccount.lines.includes("Send 10 USDC from your Safe to the swap service"));
  assert.ok(!fromAccount.lines.some((l) => l.startsWith("Details:")), "Hidden is the person's own: no address line");
  // Not a quote this core asked for: the plain send it always was, to a raw address (1Click's public word isn't asked).
  const unknown = setup({ lookup: async () => assert.fail("the public status isn't asked for a plain transfer"), ownWallets: own });
  unknown.chain.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  assert.doesNotMatch((await unknown.signer.describe(plain)).title, /Private/);
  // The core's quote, but bytes that don't match it, or a quote that refunds elsewhere: refused before the sheet.
  const more = { ...plain, actions: [{ ...plain.actions[0], args: { receiver_id: DEPOSIT, amount: "20000000" } }] } as TxRequest;
  const refuse = async (q: unknown, tx: TxRequest, what: string) => {
    const s = setup({ ownQuote: async (a) => (a === DEPOSIT ? (q as any) : null), ownWallets: own });
    s.chain.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
    await assert.rejects(s.signer.describe(tx), (e: any) => e.problem?.code === "security.quote.mismatch", what);
  };
  await refuse(pocketQuote, more, "another amount");
  await refuse(quote({ ...into, refundTo: "mallory.near", refundType: "INTENTS" }, { amountIn: "10000000", minAmountOut: "9900000" }), plain, "refunds elsewhere");
  await refuse(quote({ ...into, recipient: "e".repeat(64), refundTo: "e".repeat(64) }, { amountIn: "10000000", minAmountOut: "9900000" }), plain, "not the pocket");
});

test("Sim re-check (QA, 5 Nov): the fill sheet's Private line is what Private really pays. $50 with $15 of Private's USDC: the Safe fills $40, Private falls $10 (the sheet said $15); $9.74 with $5: the Safe fills $10, Private rises $0.26 (the sheet said $5); the lines add up in cents, a $0 line left out; control: the old gross share is never said", async () => {
  const { splitLines } = await import("./private-route.ts");
  const say = (c: bigint) => `$${(c / 100n).toString()}.${String(c % 100n).padStart(2, "0")}`;
  // the ledger's own sums as it pays: Private's share, then the fill's payout; the fill lands in Private first
  const privateChange = (move: number, fill: number) => Math.round((fill - move) * 100);
  const big = splitLines(5000n, 4000n, say);
  assert.deepEqual(big, ["From Private · $10.00", "From your Safe · $40.00", "Together · $50.00"]);
  assert.equal(privateChange(50, 40), -1000, "Private really falls $10.00");
  assert.ok(!big.some((l) => /\$15\.00|\$5\.00/.test(l)), "control: never the gross $15 nor a $5 that stays");
  const small = splitLines(974n, 1000n, say);
  assert.deepEqual(small, ["From your Safe · $10.00", "Stays in Private · $0.26", "Together · $9.74"]);
  assert.equal(privateChange(9.74, 10), 26, "Private really rises $0.26");
  assert.ok(!small.some((l) => /From Private/.test(l)), "control: Private pays nothing, so no From Private line");
  const c = (l: string) => Math.round(Number(l.split("$")[1]) * 100);
  for (const [lines, typed] of [[big, 5000], [small, 974]] as const) {
    const get = (k: string) => lines.filter((l) => l.startsWith(k)).reduce((n, l) => n + c(l), 0);
    assert.equal(get("From Private") + get("From your Safe") - get("Stays in Private"), get("Together"), "the lines add up");
    assert.equal(get("Together"), typed);
  }
  assert.deepEqual(splitLines(3000n, 3000n, say), ["From your Safe · $30.00", "Together · $30.00"], "the fill is the Move: both $0 lines left out");
});

test("the ruling (the audit and the copy review, 5 Nov): a Move's fill sheet is titled by the Move's own figure and wallet, \"Move $30.00 to your SOL wallet\", then From Private, From your Safe (the bytes' amountIn, the only Safe figure), Stays in Private and Together, which add up; Private's line not known: \"Your Safe adds $20.00 to Private first.\" (controls: a payee ownPayee didn't pass, or no record: the bytes' own title; an app's figure never shown; another coin; no marker: no block)", async () => {
  const POCKET = "a1".repeat(32), SOLW = "So1aWa11et1111111111111111111111111111111111";
  const own = new Map([[POCKET, PRIVATE_POCKET], [SOLW, "your SOL wallet"]]);
  const into = { originAsset: `nep141:${USDC}`, destinationAsset: `nep141:${USDC}`, recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS", refundTo: POCKET, refundType: "CONFIDENTIAL_INTENTS", depositType: "ORIGIN_CHAIN" };
  const block = (lines: string[]) => lines.filter((l) => /^(From Private|From your Safe|Stays in Private|Together) · /.test(l));
  type Leg = { tokenId: string; units?: string; payUnits?: string; recipient?: string; own?: boolean };
  const sheet = async (o: { units?: string; leg?: Leg | null; extra?: Record<string, unknown> }) => {
    const units = o.units ?? "20000000";
    const asked: string[] = [];
    const s = setup({ quote: quote(into, { amountIn: units, minAmountOut: "1" }), ownWallets: own, usdcUnits: "900000000", privateLeg: async (dep: string) => (asked.push(dep), (o.leg ?? null) as any) });
    const w = await s.signer.describe({ ...intentsCall("ft_withdraw", { token: USDC, receiver_id: DEPOSIT, amount: units }), ...(o.extra ?? {}) } as TxRequest);
    return { lines: w.lines, title: w.title, amount: w.amount, tap: w.tap, amountSaid: w.amountSaid, asked };
  };
  const leg: Leg = { tokenId: `nep141:${USDC}`, units: "12500000", payUnits: "17500000", recipient: SOLW, own: true };
  const both = await sheet({ leg, extra: { moveFill: true } });
  assert.equal(both.title, "Move $30.00 to your SOL wallet", "the Move's own figure and its wallet");
  // Sim re-check (5 Nov): Private's line is what Private really pays, the Move less the Safe's fill ($30 - $20), never
  // its gross share ($12.50, of which $2.50 came back from the fill)
  assert.deepEqual(block(both.lines), ["From Private · $10.00", "From your Safe · $20.00", "Together · $30.00"], String(both.lines));
  assert.deepEqual(both.lines.slice(0, 3), block(both.lines), "the block right under the title, never folded away");
  assert.deepEqual(both.asked, [DEPOSIT], "Private's leg read by this very move in's address");
  const cents = block(both.lines).map((l) => Math.round(Number(l.split("$")[1]) * 100));
  assert.equal(cents[0]! + cents[1]!, cents[2]!, "Private + Safe = Together");
  assert.equal(cents[1]!, 2000, "the Safe's line is the bytes' amountIn (20 USDC)");
  assert.equal(both.lines.filter((l) => /Safe/.test(l) && /\$\d/.test(l)).length, 1, "the only Safe figure on the sheet");
  assert.equal(both.lines[3], "Anyone can see the Safe's part.", "then who can see what");
  assert.equal(both.amountSaid, true, "the block says the Safe's figure: no Amount line over it (one amount, said once)");
  // the audit's condition: with "Amount:" gone, the Safe's signed figure (the bytes' amountIn, 20 USDC) is still on the sheet,
  // as the From your Safe line; and the line hides only while that is so (sheet-amount.ts, the phone's SheetWords.swift)
  const { amountLine } = await import("./sheet-amount.ts");
  assert.ok(both.lines.includes("From your Safe · $20.00"), String(both.lines));
  assert.equal(amountLine({ amount: both.amount, amountSaid: both.amountSaid, lines: both.lines }), null);
  assert.equal(amountLine({ amount: both.amount, amountSaid: true, lines: both.lines.filter((l) => !l.startsWith("From your Safe")) }), both.amount, "control: no line says it, the Amount line stays");
  assert.equal(amountLine({ amount: both.amount, lines: both.lines }), both.amount, "control: no flag, the Amount line stays");
  const big = await sheet({ units: "40000000", leg: { tokenId: `nep141:${USDC}`, units: "15000000", payUnits: "35000000", recipient: SOLW, own: true }, extra: { moveFill: true } });
  assert.deepEqual(block(big.lines), ["From Private · $10.00", "From your Safe · $40.00", "Together · $50.00"], "QA's $50 case from the bytes");
  assert.equal(amountLine({ amount: big.amount, amountSaid: big.amountSaid, lines: big.lines }), null);
  const alone2 = await sheet({ extra: { moveFill: true } });
  assert.equal(amountLine({ amount: alone2.amount, amountSaid: alone2.amountSaid, lines: alone2.lines }), null, "the one-line form says the bytes' $20.00 too");
  // rule 2: money leaves on this sheet and it is Face ID's (no `tap`), so the Move's job is made on its Approve (job-run.ts movesMoney)
  assert.ok(both.amount && both.tap === undefined, JSON.stringify([both.amount, both.tap]));
  assert.ok(both.lines.includes("Send 20 USDC from your Safe to the swap service"), "the signed amount line stays");
  // nothing stays: no Stays line, still adds up
  const exact = await sheet({ leg: { ...leg, payUnits: "20000000" }, extra: { moveFill: true } });
  assert.deepEqual([exact.title, block(exact.lines)], ["Move $32.50 to your SOL wallet", ["From Private · $12.50", "From your Safe · $20.00", "Together · $32.50"]]);
  // Private paid none (Private's line not known): the title and the Safe's one line
  const solo = await sheet({ units: "10000000", leg: { tokenId: `nep141:${USDC}`, payUnits: "6000000", recipient: SOLW, own: true }, extra: { moveFill: true } });
  assert.deepEqual([solo.title, solo.lines[0], block(solo.lines)], ["Move $6.00 to your SOL wallet", "Your Safe adds $10.00 to Private first.", []]);
  // controls: ownPayee didn't pass, or the core's list doesn't name it: the bytes' own title, never a name
  const outside = await sheet({ leg: { ...leg, own: false }, extra: { moveFill: true } });
  assert.equal(outside.title, "Move $20.00 to Private", "a payee ownPayee didn't pass: the bytes' own title");
  const unnamed = await sheet({ leg: { ...leg, recipient: "Unkn0wnWa11et111111111111111111111111111111" }, extra: { moveFill: true } });
  assert.equal(unnamed.title, "Move $20.00 to Private", "not in the core's own list: the bytes' own title");
  // no record at all: the bytes' own title and the Safe's one line
  const alone = await sheet({ extra: { moveFill: true } });
  assert.deepEqual([alone.title, alone.lines[0], block(alone.lines)], ["Move $20.00 to Private", "Your Safe adds $20.00 to Private first.", []]);
  // controls: an app's own figures (the old split, understated: $1 over $500) are never shown; the bytes' $500.00 is
  const under = await sheet({ units: "500000000", extra: { moveFill: true, split: { privateUsd: "1", safeUsd: "1" } } });
  assert.equal(under.lines[0], "Your Safe adds $500.00 to Private first.");
  assert.ok(!under.lines.some((l) => /\$1\.00\b/.test(l)), "never the app's $1");
  const other = await sheet({ leg: { ...leg, tokenId: "nep141:eth.omft.near" }, extra: { moveFill: true } });
  assert.deepEqual([other.title, block(other.lines)], ["Move $20.00 to Private", []], "a record in another coin: the bytes' own words");
  const none = await sheet({ leg, extra: { split: { privateUsd: "12.50", safeUsd: "17.50" } } });
  assert.deepEqual([block(none.lines), none.asked], [[], []], "no marker: no block, nothing read");
  assert.match(none.title, /^Move .+ to your private balance$/, "control: the Private screen's own move in keeps its title");
});

test("hotfix (Train 19's one bridge leg): a Move's fill paid by ONE mt_transfer inside intents.near on an INTENTS quote into the core's own pocket is accepted by the real core and titled as the Move, with the same block as the ft_withdraw route; controls, each refused before Face ID: a quote that takes its deposit from outside (ORIGIN_CHAIN), a pocket not on the core's list, another coin than the one sent, a wrong amount, a refund elsewhere", async () => {
  const POCKET = "a1".repeat(32), SOLW = "So1aWa11et1111111111111111111111111111111111";
  const own = new Map([[POCKET, PRIVATE_POCKET], [SOLW, "your SOL wallet"]]);
  // subwallets privateQuoteIn with `intents` (Train 19): the pocket is recipient and refund, the deposit taken INTENTS
  const into = { originAsset: `nep141:${USDC}`, destinationAsset: `nep141:${USDC}`, recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS", refundTo: POCKET, refundType: "CONFIDENTIAL_INTENTS", depositType: "INTENTS" };
  const block = (lines: string[]) => lines.filter((l) => /^(From Private|From your Safe|Stays in Private|Together) · /.test(l));
  const leg = { tokenId: `nep141:${USDC}`, units: "12500000", payUnits: "17500000", recipient: SOLW, own: true };
  // to-private.ts on main: convert.ts mtTransfer({ to: depositAddress, tokenId, units }), one action on intents.near
  const sheet = async (o: { q?: Record<string, unknown>; wallets?: Map<string, string>; sent?: { token_id?: string; amount?: string }; extra?: Record<string, unknown> } = {}) => {
    const s = setup({ quote: quote({ ...into, ...o.q }, { amountIn: "20000000", minAmountOut: "19800000" }), ownWallets: o.wallets ?? own, usdcUnits: "900000000", privateLeg: async () => leg as any });
    const w = await s.signer.describe({ ...intentsCall("mt_transfer", { receiver_id: DEPOSIT, token_id: o.sent?.token_id ?? `nep141:${USDC}`, amount: o.sent?.amount ?? "20000000", approval: null }), ...(o.extra ?? { moveFill: true }) } as TxRequest);
    return w;
  };
  const w = await sheet();
  assert.equal(w.title, "Move $30.00 to your SOL wallet", String(w.lines));
  assert.deepEqual(block(w.lines), ["From Private · $10.00", "From your Safe · $20.00", "Together · $30.00"], String(w.lines));
  assert.ok(w.amount && w.tap === undefined, "money leaves on this sheet: Face ID's");
  // the Private screen's own move in on this route (no marker): accepted, its own title
  assert.match((await sheet({ extra: {} })).title, /^Move .+ to your private balance$/);
  const refused = (o: Parameters<typeof sheet>[0], why: string) => assert.rejects(sheet(o), (e: any) => e.problem?.code === "security.quote.mismatch", why);
  await refused({ q: { depositType: "ORIGIN_CHAIN" } }, "an outside deposit paid inside the ledger");
  await refused({ wallets: new Map([[SOLW, "your SOL wallet"]]) }, "a pocket not on the core's own list");
  await refused({ q: { originAsset: "nep141:eth.omft.near" } }, "the quote in another coin than the one sent");
  await refused({ sent: { token_id: "nep141:eth.omft.near", amount: "20000000" } }, "another coin sent than the quote's");
  await refused({ sent: { amount: "20000001" } }, "a wrong amount");
  await refused({ q: { refundTo: "e".repeat(64) } }, "recipient isn't refundTo: refunded elsewhere than the pocket it pays");
  await refused({ q: { recipient: "e".repeat(64) } }, "recipient isn't refundTo: a foreign recipient, refunded to the pocket");
  await refused({ q: { recipient: "e".repeat(64), refundTo: "e".repeat(64) } }, "a foreign recipient and refund, not on the core's list");
  await refused({ q: { recipientType: "INTENTS" } }, "recipientType not CONFIDENTIAL_INTENTS");
  await refused({ q: { refundType: "INTENTS" } }, "refundType not CONFIDENTIAL_INTENTS");
  // mt_transfer_call to the deposit (its msg runs code there): refused, never the move in
  const s = setup({ quote: quote(into, { amountIn: "20000000", minAmountOut: "19800000" }), ownWallets: own, usdcUnits: "900000000", privateLeg: async () => leg as any });
  await assert.rejects(s.signer.describe({ ...intentsCall("mt_transfer_call", { receiver_id: DEPOSIT, token_id: `nep141:${USDC}`, amount: "20000000", approval: null, msg: "" }), moveFill: true } as TxRequest), (e: any) => e.problem?.code === "security.quote.mismatch", "mt_transfer_call");
  // control: the same mt_transfer_call to an address that is no quote's deposit is not this check's
  const c = setup({ quote: quote(into, { amountIn: "20000000", minAmountOut: "19800000" }), ownWallets: own, usdcUnits: "900000000" });
  await c.signer.describe(intentsCall("mt_transfer_call", { receiver_id: "bob.near", token_id: `nep141:${USDC}`, amount: "1000000", approval: null, msg: "" }));
});

test("a move to one of the account's own wallets is named by its row (\"your SOL row\"): about the amount in the title, the lines to 4 places, no address line and no chain after the row", async () => {
  const own = new Map([[SOLANA_ADDRESS, "your SOL row"]]);
  // Through 1Click, inside NEAR Intents (mt_transfer to the quote's deposit address).
  const viaQuote = setup({ quote: quote({}, { minAmountOut: "4917871" }), ownWallets: own });
  const words = await viaQuote.signer.describe(pay);
  // Half of it promised (4.917 of 10.05 USDC): the title names what arrives, never the dollars that leave (J6 review, M1).
  assert.equal(words.title, "Move about 4.917 USDC to your SOL row");
  assert.ok(words.lines.includes("The swap service promises at least 4.9178 USDC to your SOL row"), JSON.stringify(words.lines));
  assert.ok(!words.lines.some((l) => l.startsWith("Details:")), "the person's own row: no address line (D37 is for others)");
  // Priced, the title says what leaves, dollars first (J6); what arrives is the lines' (the promise above).
  assert.equal((await setup({ quote: quote(), ownWallets: own }).signer.describe(pay)).title, "Move 10.05 USDC to your SOL row");
  // Someone else's address keeps today's words.
  assert.match((await setup({ quote: quote() }).signer.describe(pay)).title, /^Send 10.05 USDC to /);

  // A withdrawal to the home chain, to the account's own wallet.
  const evm = "0xabcd000000000000000000000000000000007890";
  const home = setup({ ownWallets: new Map([[evm, "your Ethereum Browser wallet"]]) });
  const out = await home.signer.describe(intentsCall("ft_withdraw", { token: "eth.omft.near", receiver_id: "eth.omft.near", amount: "491787154000000000", memo: `WITHDRAW_TO:${evm}` }));
  assert.equal(out.title, "Move about 0.4917 ETH to your Ethereum Browser wallet");
  assert.equal(out.lines[0], "Move 0.491787154 ETH from your Safe to your Ethereum Browser wallet on Ethereum");
  // the whole address one tap away, never a raw "Details:" line (mainnet rehearsal, 3 Nov)
  assert.ok(!out.lines.some((l) => l.startsWith("Details:") || l.includes(evm)), JSON.stringify(out.lines));
  assert.ok(out.details?.some((d) => d.label === "The address in full" && d.lines.includes(evm)), "the address in full, one tap away");
});

test("the Safe's swap in place (into and refunded to the signing account itself) names the action and the amount chosen: Swap, never Pay or Move to its own name; control: someone else's address keeps Send", async () => {
  const self = quote({ destinationAsset: "nep141:eth.omft.near", recipient: "alice.near", recipientType: "INTENTS", refundTo: "alice.near", refundType: "INTENTS" }, { amountIn: "15000000", minAmountOut: "8000000000000000" });
  const s = setup({ quote: self, ownQuote: async (a) => (a === DEPOSIT ? self : null) });
  const words = await s.signer.describe(intentsCall("mt_transfer", { receiver_id: DEPOSIT, token_id: `nep141:${USDC}`, amount: "15000000", approval: null }));
  assert.equal(words.title, "Swap 15 USDC for ETH", JSON.stringify(words));
  assert.deepEqual(words.lines.slice(0, 2), ["At least 0.008 ETH lands in your Safe.", "If it doesn't swap, your USDC comes back to your Safe."]);
  assert.match((await setup({ quote: quote() }).signer.describe(pay)).title, /^Send 10.05 USDC to /, "control");
});

test("a sheet's coin figures go to 4 places, rounded down; under 0.0001 keeps 4 significant digits; dollars untouched (product decision, 3 Nov); control: 4 places or fewer unchanged", async () => {
  const { fourPlacesText } = await import("./intents.ts");
  assert.equal(fourPlacesText("Move 0.491787154 SOL to your SOL row"), "Move 0.4917 SOL to your SOL row");
  assert.equal(fourPlacesText("at least 4.917871 USDC"), "at least 4.9178 USDC");
  assert.equal(fourPlacesText("0.0000123456 BTC"), "0.00001234 BTC");
  assert.equal(fourPlacesText("Move $10.05 (10.05 USDC)"), "Move $10.05 (10.05 USDC)", "control: dollars and short figures unchanged");
  assert.equal(fourPlacesText("2.0000001 NEAR"), "2 NEAR");
});

test("home/words: the Add's sheet says \"your NEAR wallet\" (never Trading or Spending), and what is signed is exactly what was asked, words aside", async () => {
  const FLOAT = "f3".repeat(32);
  const own = new Map([[FLOAT, TRADING_BALANCE]]);
  const into = { originAsset: `nep141:${USDC}`, destinationAsset: `nep141:${USDC}`, recipient: FLOAT, recipientType: "CONFIDENTIAL_INTENTS", refundTo: FLOAT, refundType: "CONFIDENTIAL_INTENTS" };
  const args = { token: USDC, receiver_id: DEPOSIT, amount: "10000000" };
  const add = { ...intentsCall("ft_withdraw", args), why: "Add $10.00 to your pump.fun wallet", from: "trade" as const };
  const s = setup({ quote: quote(into, { amountIn: "10000000", minAmountOut: "10000000" }), ownWallets: own });
  const out = await s.signer.request(add);
  assert.equal(out.status, "done", JSON.stringify(out));
  const sheet = s.shown.at(-1)!;
  assert.equal(sheet.title, "Move 10 USDC to your NEAR wallet");
  assert.doesNotMatch([sheet.title, ...sheet.lines].join(" "), /Trading|Spending/);
  // the signed transaction: the one call asked, its args byte for byte, to intents.near, 1 yocto; nothing of the words
  const tx = s.chain.sent.at(-1)!;
  assert.deepEqual([tx.signerId, tx.receiverId, tx.actions.length], ["alice.near", "intents.near", 1]);
  const a = tx.actions[0]!;
  assert.ok(a.kind === "call");
  assert.deepEqual([a.method, String(a.depositYocto), String(a.gas)], ["ft_withdraw", "1", "30000000000000"]);
  assert.equal(new TextDecoder().decode(a.args), JSON.stringify(args), "the signed args are the request's, byte for byte");
  assert.doesNotMatch(new TextDecoder().decode(a.args), /NEAR wallet|Trading|Spending/, "control: no sheet word reaches what is signed");
});

test("finding 61 (a real-money test): the Add paid in NEAR names 1Click's deposit as the swap service and USDC by name, even when its details don't load", async () => {
  const FLOAT = "f2".repeat(32);
  const into = { originAsset: "nep141:wrap.near", destinationAsset: `nep141:${USDC}`, recipient: FLOAT, recipientType: "CONFIDENTIAL_INTENTS", refundTo: FLOAT, refundType: "CONFIDENTIAL_INTENTS" };
  const amount = "513800000000000000000000";
  const q = quote(into, { amountIn: amount, minAmountOut: "2037724" });
  const s = setup({ ownQuote: async (a) => (a === DEPOSIT ? q : null), ownWallets: new Map([[FLOAT, TRADING_BALANCE]]) });
  s.chain.contract("wrap.near", "wrap", { ft_metadata: () => ({ symbol: "wNEAR", decimals: 24 }) });
  // NEAR's RPC rate-limited: USDC's details don't load
  s.chain.contract(USDC, "usdc", { ft_metadata: () => { throw new Error("429 Too Many Requests"); } });
  const tx: TxRequest = { receiverId: "wrap.near", actions: [
    { kind: "call", method: "storage_deposit", args: { account_id: DEPOSIT, registration_only: true }, depositYocto: "1250000000000000000000", gas: "30000000000000" },
    { kind: "call", method: "ft_transfer", args: { receiver_id: DEPOSIT, amount }, depositYocto: "1", gas: "30000000000000" },
  ], why: "", from: "wallet" };
  const words = await s.signer.describe(tx);
  const all = [words.title, ...words.lines, ...words.warnings.map((w) => w.text)].join(" | ");
  assert.match(all, /Let the swap service hold wNEAR/, all);
  assert.match(all, /2\.0377 USDC|2\.037724 USDC/, all);
  assert.doesNotMatch(all, /the NEAR account [0-9a-f]{6}…|unnamed coin|nep141:|units\)/, all);
});

test("a UI test (4 Nov): a SOL Move paid in wNEAR from the Safe is one sheet that names the coins and the SOL wallet, never ids or \"3 more steps\" (controls: other set-up steps, another amount wrapped, no onward words)", async () => {
  const FLOAT = "f4".repeat(32);
  const own = new Map([[FLOAT, TRADING_BALANCE]]);
  const into = { originAsset: "nep141:wrap.near", destinationAsset: `nep141:${USDC}`, recipient: FLOAT, recipientType: "CONFIDENTIAL_INTENTS", refundTo: FLOAT, refundType: "CONFIDENTIAL_INTENTS", depositType: "ORIGIN_CHAIN" };
  const paid = "548600000000000000000000";
  const q = quote(into, { amountIn: paid, minAmountOut: "2174587" });
  const storage = (account_id: string) => ({ kind: "call" as const, method: "storage_deposit", args: { account_id, registration_only: true }, depositYocto: "1250000000000000000000", gas: "10000000000000" });
  const move = (over: { wrap?: string; extra?: string } = {}): TxRequest => ({
    receiverId: "wrap.near",
    actions: [
      storage(over.extra ?? "alice.near"),
      storage(DEPOSIT),
      { kind: "call", method: "near_deposit", args: {}, depositYocto: over.wrap ?? paid, gas: "10000000000000" },
      { kind: "call", method: "ft_transfer", args: { receiver_id: DEPOSIT, amount: paid }, depositYocto: "1", gas: "30000000000000" },
    ],
    why: "Move $2.20 from your Safe · SOL $2.20",
    from: "wallet",
  });
  const sheet = (tx: TxRequest, onward?: string, usdcBusy = false) => {
    const s = setup({ ownQuote: async (a) => (a === DEPOSIT ? q : null), ownWallets: own });
    s.chain.contract("wrap.near", "wrap", { ft_metadata: () => ({ symbol: "wNEAR", decimals: 24 }) });
    if (usdcBusy) s.chain.views.set(`${USDC} ft_metadata`, () => { throw new Error("busy"); });
    return s.signer.describe({ ...tx, ...(onward !== undefined ? { onward } : {}) });
  };
  for (const busy of [false, true]) {
    const w = await sheet(move(), "it goes on to your SOL wallet.", busy);
    assert.equal(w.title, "Move 0.5486 NEAR to your SOL wallet", `the Move asked for, where it ends (USDC read ${busy ? "busy" : "fine"})`);
    assert.deepEqual(w.lines, ["From your Safe. At least 2.1745 USDC lands in your NEAR wallet.", "If the swap fails, it comes back to your NEAR wallet.", "Setting up the coin costs at most 0.0025 NEAR.", "Then it goes on to your SOL wallet.", "Fee: at most 0.016 NEAR."]);
    const all = [w.title, ...w.lines, w.hint ?? "", ...w.warnings.map((x) => x.text), ...(w.details ?? []).flatMap((d) => [d.label, ...d.lines])].join(" | ");
    for (const gone of [/more step/, /unnamed/i, /can't read/, /nep141/, /[0-9a-f]{6}…/, /1c1c1c/, /hold wNEAR/]) assert.doesNotMatch(all, gone, all);
  }
  // controls: anything but that exact set-up keeps every step's own line
  const big = move();
  big.actions[1] = { ...storage(DEPOSIT), depositYocto: "50000000000000000000000000" };
  assert.match((await sheet(big, "it goes on to your SOL wallet.")).title, /more steps/, "50 NEAR to the payee is never folded (review, QA)");
  const notOnly = move();
  notOnly.actions[1] = { ...storage(DEPOSIT), args: { account_id: DEPOSIT } };
  assert.match((await sheet(notOnly, "it goes on to your SOL wallet.")).title, /more steps/, "storage without registration_only: every step said");
  const other = await sheet(move({ extra: "bob.near" }), "it goes on to your SOL wallet.");
  assert.match(other.title, /more steps/, "storage for someone else: every step said");
  const more = await sheet(move({ wrap: "600000000000000000000000" }), "it goes on to your SOL wallet.");
  assert.match(more.title, /more steps/, "more NEAR wrapped than paid: every step said");
  assert.equal((await sheet(move())).title, "Swap 0.5486 NEAR for USDC", "no onward words: the core's own swap title");
  // a UI re-test (4 Nov): the swap service's address already set up (no storage for it), USDC's details not read
  const registered = move();
  registered.actions.splice(1, 1);
  const swap = await sheet(registered, "it goes on to your SOL wallet.", true);
  assert.equal(swap.title, "Move 0.5486 NEAR to your SOL wallet");
  const said = [swap.title, ...swap.lines, ...swap.warnings.map((x) => x.text), ...(swap.details ?? []).flatMap((d) => [d.label, ...d.lines])].join(" | ");
  for (const gone of [/unnamed/i, /nep141/, /1c1c1c/, /[0-9a-f]{6}…[0-9a-f]{4}/]) assert.doesNotMatch(said, gone, said);
});

test("product decision (5 Nov), QA's MUSTs 1 and 4: a Send's fill sheet is ONE Face ID that says the payout bound to this move in (the payee in full, never shortened; what they get from its signed quote) and the Safe's figure from the bytes, the split adding up (Safe = Stays + Together; Stays left out at 0); controls: no payout bound, another coin, or more than the move in brings is refused before Face ID; no marker: never read", async () => {
  const POCKET = "a1".repeat(32);
  const PAYEE = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
  const own = new Map([[POCKET, PRIVATE_POCKET]]);
  const into = { originAsset: `nep141:${USDC}`, destinationAsset: `nep141:${USDC}`, recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS", refundTo: POCKET, refundType: "CONFIDENTIAL_INTENTS", depositType: "ORIGIN_CHAIN" };
  const payout = { recipient: PAYEE, recipientType: "DESTINATION_CHAIN", originAsset: `nep141:${USDC}`, destinationAsset: "nep141:sol.omft.near", amountIn: "250000000", amountOut: "1234567890", amountInUsd: "250.00", amountOutUsd: "247.5" };
  // the UI lead's ruling (5 Nov): this sheet's legs are "They get", "Your Safe sends", "Stays in Private"; the old
  // words are matched too, so a sheet still saying them fails below
  const block = (lines: string[]) => lines.filter((l) => /^(They get|Your Safe sends|From Private|From your Safe|Stays in Private|Together|Network fees|Fees) · /.test(l));
  // the core's own tag (bind-intent, demo-core intentOf): the move in its private.quoteIn door asked is a "move"
  const sheet = async (o: { units?: string; out?: typeof payout | null; extra?: Record<string, unknown>; tag?: "swap" | "move" | null; unnamed?: true }) => {
    const units = o.units ?? "300000000";
    const asked: string[] = [];
    const s = setup({ quote: quote(into, { amountIn: units, minAmountOut: "297000000" }), ownWallets: own, usdcUnits: "900000000", sendPayout: async (dep) => (asked.push(dep), o.out === undefined ? payout : o.out), intentOf: async (dep) => (o.tag === undefined ? (dep === DEPOSIT ? "move" : null) : o.tag) });
    if (!o.unnamed) s.chain.contract("sol.omft.near", "sol", { ft_metadata: () => ({ symbol: "SOL", decimals: 9 }) });
    const w = await s.signer.describe({ ...intentsCall("ft_withdraw", { token: USDC, receiver_id: DEPOSIT, amount: units }), ...(o.extra ?? { sendFill: true }) } as TxRequest);
    return { w, asked };
  };
  const { w, asked } = await sheet({});
  // the UI lead's rulings (5 Nov) and QA's Sim walk: ONE "They get" line, the signed coin figure (the audit's MUST 4) then what
  // it is worth to them (the signed amountOutUsd) in brackets; the network fees named last
  assert.deepEqual(block(w.lines), ["They get · 1.2345 SOL ($247.50)", "Your Safe sends · $300.00", "Stays in Private · $50.00", "Network fees · about $2.50"], String(w.lines));
  const cents = block(w.lines).map((l) => Math.round(Number(l.split("$").at(-1)!.replace(")", "")) * 100));
  const T = 25000; // the payout's amountIn, what leaves Private: $250.00
  assert.equal(cents[1], cents[2]! + T, "the lines add up: the Safe's figure is what stays plus what goes (Y = Z + T)");
  assert.ok(Math.abs(cents[0]! + cents[3]! - T) <= 1, "They get's dollars + the network fees = T (within a cent)");
  assert.equal(w.lines.filter((l) => /They get/.test(l)).length, 1, `"They get" said exactly once: ${String(w.lines)}`);
  assert.ok(!w.lines.some((l) => /^(Together|From your Safe) · /.test(l)), "no \"Together\" and no \"From your Safe\" on a Send's fill sheet");
  // every outside sheet: the full address first, unfolded, then where it lands (the audit's D37 condition, the copy review's words)
  assert.deepEqual(w.lines.slice(0, 2), [`To ${PAYEE}`, "Public on Solana."], String(w.lines));
  assert.ok(!(w.details ?? []).some((d) => d.lines.includes(PAYEE)), "control: never inside a folded detail");
  assert.ok(!w.lines.some((l) => l.includes("…")), "control: no short form on the sheet");
  assert.ok(w.lines.some((l) => l.startsWith("They get · 1.2345 SOL ")), `what they get: the payout's signed amountOut (MUST 4), 4 places down from 1.23456789: ${String(w.lines)}`);
  assert.equal(w.title, "Send $250.00 from your Safe");
  assert.deepEqual(asked, [DEPOSIT], "the payout read by this very move in's address");
  assert.ok(w.amount && w.tap === undefined, "money leaves on this sheet: Face ID's (no tap)");
  // the whole fill goes: no Stays line
  const exact = await sheet({ units: "250000000" });
  assert.deepEqual(block(exact.w.lines), ["They get · 1.2345 SOL ($247.50)", "Your Safe sends · $250.00", "Network fees · about $2.50"]);
  // control: a zero-fee quote (worth all of T to them): no fees line
  const free = await sheet({ out: { ...payout, amountOutUsd: "250" } });
  assert.deepEqual(block(free.w.lines), ["They get · 1.2345 SOL ($250.00)", "Your Safe sends · $300.00", "Stays in Private · $50.00"], String(free.w.lines));
  // controls, each refused before Face ID: no payout bound to this move in, another coin, more than the move in brings
  // the audit's ruling (5 Nov): a payout coin the core can't name with its decimals is refused before the sheet (the control:
  // the named SOL above shows "They get · 1.2345 SOL ($247.50)")
  await assert.rejects(sheet({ unnamed: true }), (e: any) => e.problem?.code === "security.send.coin-unknown" && e.problem.next.label === "Try again" && e.problem.next2?.label === "Pick a coin", "an unnamed payout coin");
  await assert.rejects(sheet({ out: null }), (e: any) => e.problem?.code === "security.send.unbound" && e.problem.whatHappened === "NEAR Intents priced it differently than asked. Nothing moved." && e.problem.next.label === "Send again" && e.problem.money.where === "in your Safe", "no payout bound");
  await assert.rejects(sheet({ out: { ...payout, originAsset: "nep141:wrap.near" } }), (e: any) => e.problem?.code === "security.send.unbound", "another coin");
  await assert.rejects(sheet({ out: { ...payout, amountIn: "297000001" } }), (e: any) => e.problem?.code === "security.send.unbound", "more than the move in brings");
  // bind-intent: a Send's fill is only ever under the core's own "move" tag; none (an address its doors never asked) or a
  // swap's is refused before Face ID, whatever the payout says
  await assert.rejects(sheet({ tag: null }), (e: any) => e.problem?.code === "security.intent.changed", "control: no tag");
  await assert.rejects(sheet({ tag: "swap" }), (e: any) => e.problem?.code === "security.intent.changed", "control: a swap's tag");
  // no marker: the Private screen's own move in, the payout never read
  const none = await sheet({ extra: {} });
  assert.deepEqual([block(none.w.lines).length, none.asked, none.w.lines.some((l) => l.startsWith("To "))], [0, [], false]);
  // main's fill route (Train 20): the Safe's NEAR Intents balance pays the move in inside intents.near (mt_transfer to
  // the deposit, depositType INTENTS): the same bound sheet, the same refusals
  const inside = async (out: typeof payout | null) => {
    const s = setup({ quote: quote({ ...into, depositType: "INTENTS" }, { amountIn: "300000000", minAmountOut: "297000000" }), ownWallets: own, usdcUnits: "900000000", sendPayout: async () => out, intentOf: async (dep: string) => (dep === DEPOSIT ? ("move" as const) : null) });
    s.chain.contract("sol.omft.near", "sol", { ft_metadata: () => ({ symbol: "SOL", decimals: 9 }) });
    return s.signer.describe({ ...intentsCall("mt_transfer", { receiver_id: DEPOSIT, token_id: `nep141:${USDC}`, amount: "300000000", approval: null }), sendFill: true } as TxRequest);
  };
  const mt = await inside(payout);
  assert.deepEqual([mt.title, ...block(mt.lines)], ["Send $250.00 from your Safe", "They get · 1.2345 SOL ($247.50)", "Your Safe sends · $300.00", "Stays in Private · $50.00", "Network fees · about $2.50"], String(mt.lines));
  assert.deepEqual(mt.lines.slice(0, 2), [`To ${PAYEE}`, "Public on Solana."], "the full address first, then where it lands");
  await assert.rejects(inside(null), (e: any) => e.problem?.code === "security.send.unbound", "control: unbound, refused on this route too");
  // controls on the route itself (checkIntents): an mt_transfer on a quote that takes its deposit from outside, or paying
  // a pocket that isn't on the core's own list, is refused as before
  const lie = async (q: Record<string, unknown>, wallets = own) => {
    const s = setup({ quote: quote({ ...into, depositType: "INTENTS", ...q }, { amountIn: "300000000", minAmountOut: "297000000" }), ownWallets: wallets, usdcUnits: "900000000", sendPayout: async () => payout, intentOf: async (dep: string) => (dep === DEPOSIT ? ("move" as const) : null) });
    s.chain.contract("sol.omft.near", "sol", { ft_metadata: () => ({ symbol: "SOL", decimals: 9 }) });
    return s.signer.describe({ ...intentsCall("mt_transfer", { receiver_id: DEPOSIT, token_id: `nep141:${USDC}`, amount: "300000000", approval: null }), sendFill: true } as TxRequest);
  };
  await assert.rejects(lie({ depositType: "ORIGIN_CHAIN" }), (e: any) => e.problem?.code === "security.intent.changed", "control: an outside deposit paid inside the ledger");
  await assert.rejects(lie({}, new Map()), (e: any) => e.problem?.code === "security.intent.changed", "control: not the core's own pocket");
  await assert.rejects(lie({ originAsset: "nep141:wrap.near" }), (e: any) => e.problem?.code === "security.intent.changed", "control: another coin than the one sent");
});
