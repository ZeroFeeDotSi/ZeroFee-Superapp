// The quote relay against Security's checklist, with 1Click mocked: a fixed upstream, four routes, shapes checked
// before anything is forwarded, the partner key only upstream, the status record only with its tag, CORS, a rate limit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
// @ts-ignore: plain JS, deployed as is (no build step)
import { APP_ORIGINS, HELIUS_RPC, UPSTREAM, alertsActionOf, createRelay } from "./relay.mjs";
// @ts-ignore: plain JS
import { addressBucket, callerAddress, memoryCounter, redisCounter } from "./guards.mjs";

const KEY = "partner-key-SECRET-1234567890";
const SECRET = "relay-tag-secret";
const POCKET = "a1".repeat(32);
const DEPOSIT = "818473a0072ed5084b4ec9f665b47d7c244546ca9a0ebc76d71fe1e6274ef8ba";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const tag = createHmac("sha256", SECRET).update(DEPOSIT).digest("base64url");

function setup(o: { answer?: (url: string, init: RequestInit) => Response; secret?: string | null; now?: () => number; fund?: boolean; usd?: string; fastnear?: string } = {}) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return o.answer ? o.answer(url, init) : new Response(JSON.stringify(url.includes("/status") ? { status: "PENDING_DEPOSIT", quoteResponse: { quoteRequest: { refundTo: POCKET } } } : { quote: { depositAddress: DEPOSIT, amountIn: "1000000", amountInUsd: o.usd ?? "0.999631000000" }, quoteRequest: {} }), { status: url.includes("/quote") ? 201 : 200, headers: { "x-upstream-secret": "never-passed" } });
  };
  const relay = createRelay({ key: KEY, secret: o.secret === null ? undefined : o.secret ?? SECRET, origins: [...APP_ORIGINS, "https://app.zerofee.example"], fetchFn, now: o.now, fundConfidential: o.fund === true, ...(o.fastnear ? { fastnear: o.fastnear } : {}) });
  const call = (path: string, init: RequestInit & { origin?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.origin) headers.set("origin", init.origin);
    return relay(new Request(`https://quotes.example${path}`, { ...init, headers }), "203.0.113.7");
  };
  const post = (route: string, body: unknown, origin?: string) => call(`/api/relay?route=${route}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, origin });
  return { sent, call, post };
}
const pay = { dry: true, swapType: "EXACT_OUTPUT", originAsset: USDC, depositType: "CONFIDENTIAL_INTENTS", refundType: "CONFIDENTIAL_INTENTS", refundTo: POCKET, recipient: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", recipientType: "DESTINATION_CHAIN", amount: "1000000", confidentiality: "basic" };
const moveIn = { ...pay, swapType: "EXACT_INPUT", depositType: "ORIGIN_CHAIN", destinationAsset: USDC, recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS" };
const signed = { type: "swap_transfer", signedData: { standard: "nep413", payload: { message: "{}", nonce: "x", recipient: "intents.far" }, public_key: "ed25519:Abc", signature: "ed25519:Def" } };

test("each of the four routes goes to 1Click's fixed address, with the partner key added only there", async () => {
  const { sent, post, call } = setup();
  assert.equal((await post("quote", pay)).status, 201);
  assert.equal((await post("quote", moveIn)).status, 201);
  assert.equal((await post("generate-intent", { type: "swap_transfer", standard: "nep413", signerId: POCKET, depositAddress: DEPOSIT })).status, 200);
  assert.equal((await post("submit-intent", signed)).status, 200);
  assert.equal((await call(`/api/relay?route=status&depositAddress=${DEPOSIT}`)).status, 200);
  assert.deepEqual(sent.map((s) => s.url), [`${UPSTREAM}/quote`, `${UPSTREAM}/quote`, `${UPSTREAM}/generate-intent`, `${UPSTREAM}/submit-intent`, `${UPSTREAM}/status?depositAddress=${DEPOSIT}`]);
  assert.ok(sent.every((s) => (s.init.headers as Record<string, string>).authorization === `Bearer ${KEY}`));
  assert.equal(UPSTREAM, "https://1click.chaindefuser.com/v0");
});

test("anything not shaped like ZeroFee's own private quotes and payments is refused before it's forwarded", async () => {
  const { sent, post, call } = setup();
  const refused = async (r: Promise<Response>) => (await r).status;
  assert.equal(await refused(post("quote", { ...pay, confidentiality: "public" })), 400);
  assert.equal(await refused(post("quote", { ...pay, refundType: "INTENTS" })), 400);
  assert.equal(await refused(post("quote", { ...pay, refundTo: "someone.near" })), 400);
  assert.equal(await refused(post("quote", { ...pay, depositType: "INTENTS" })), 400);
  assert.equal(await refused(post("quote", { ...moveIn, recipient: "a2".repeat(32) })), 400, "a move in goes into the pocket itself");
  assert.equal(await refused(post("quote", { ...moveIn, originAsset: "nep141:sol.omft.near", destinationAsset: "nep141:eth.omft.near" })), 400, "the same coin in and out");
  assert.equal(await refused(post("quote", { ...moveIn, originAsset: "nep245:v2_1.omni.hot.tg:56_SZzgw3HSudhZcTwPWUTi2RJB19t", destinationAsset: "nep245:v2_1.omni.hot.tg:56_SZzgw3HSudhZcTwPWUTi2RJB19t" })), 400, "a token on another chain (BNB Chain's USDT), never an on-ramp for it");
  // D155: a chain's own coin comes in as itself (set-up's first money from any chain NEAR Intents takes)
  const takes = setup();
  for (const own of ["nep245:v2_1.omni.hot.tg:56_11111111111111111111", "nep141:btc.omft.near", "nep141:doge.omft.near"]) assert.equal((await takes.post("quote", { ...moveIn, originAsset: own, destinationAsset: own })).status, 201, own);
  // review L6 with D155: from its own chain only a chain's OWN coin comes in as itself (set-up takes every chain's); a
  // token on another chain, or a chain whose address needs a memo, is refused
  // Send F (5 Nov): a token the core pins (hidden-coins.ts) comes in as itself; any other token on another chain stays refused
  assert.equal((await setup().post("quote", { ...moveIn, originAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", destinationAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near" })).status, 201, "a pinned token (USDC on Solana), as itself");
  assert.equal(await refused(post("quote", { ...moveIn, originAsset: "nep141:sol-2dc7b64e5dd3c717fc85abaf51cdcd4b18687f09.omft.near", destinationAsset: "nep141:sol-2dc7b64e5dd3c717fc85abaf51cdcd4b18687f09.omft.near" })), 400, "a token on another chain the core doesn't pin (sUSDC, Token-2022)");
  assert.equal(await refused(post("quote", { ...moveIn, originAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", destinationAsset: "nep141:sol.omft.near" })), 400, "a pinned token turned into another coin");
  assert.equal(await refused(post("quote", { ...moveIn, originAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", destinationAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", recipient: "a2".repeat(32) })), 400, "a pinned token into anyone else's balance");
  assert.equal(await refused(post("quote", { ...moveIn, originAsset: "nep141:xrp.omft.near", destinationAsset: "nep141:xrp.omft.near" })), 400, "a chain that needs a memo (XRP)");
  assert.equal(await refused(post("quote", { ...moveIn, originAsset: "nep245:v2_1.omni.hot.tg:1100_111bzQBB5v7AhLyPMDwS8uJgQV24KaAPXtwyVWu2KXbbfQU6NXRCz", destinationAsset: "nep245:v2_1.omni.hot.tg:1100_111bzQBB5v7AhLyPMDwS8uJgQV24KaAPXtwyVWu2KXbbfQU6NXRCz" })), 400, "Stellar (memo)");
  assert.equal(await refused(post("quote", { ...moveIn, originAsset: "nep141:btc.omft.near", destinationAsset: "nep141:eth.omft.near" })), 400, "a chain's coin turned into another");
  for (const c of ["nep141:sol.omft.near", "nep141:hood.omft.near"]) assert.equal((await setup().post("quote", { ...moveIn, originAsset: c, destinationAsset: c })).status, 201, `control: ${c}`);
  assert.equal(await refused(post("generate-intent", { type: "swap_transfer", standard: "erc191", signerId: POCKET, depositAddress: DEPOSIT })), 400);
  assert.equal(await refused(post("generate-intent", { type: "swap_transfer", standard: "nep413", signerId: "kid.near", depositAddress: DEPOSIT })), 400);
  assert.equal(await refused(post("submit-intent", { type: "swap_transfer", signedData: { standard: "erc191" } })), 400);
  assert.equal(await refused(call("/api/relay?route=status&depositAddress=kid.near")), 400);
  assert.equal(await refused(post("quote", "x".repeat(17 * 1024))), 413);
  for (const [path, method] of [["/api/relay?route=tokens", "GET"], ["/api/relay?route=quote", "GET"], ["/api/relay?route=status", "POST"], ["/api/relay?route=../admin", "GET"], ["/api/relay?route=__proto__", "GET"]]) {
    assert.equal((await call(path, { method })).status, 404, path);
  }
  assert.equal(sent.length, 0, "nothing reached 1Click");
});

test("the partner key never comes back, and none of 1Click's headers do", async () => {
  const { post, call } = setup({ answer: (url) => new Response(url.includes("generate") ? JSON.stringify({ echoed: `Bearer ${KEY}` }) : JSON.stringify({ message: "bad" }), { status: 400, headers: { "x-upstream-secret": "s" } }) });
  for (const r of [await post("quote", pay), await post("generate-intent", { type: "swap_transfer", standard: "nep413", signerId: POCKET, depositAddress: DEPOSIT }), await call(`/api/relay?route=status&depositAddress=${DEPOSIT}`)]) {
    const text = await r.text();
    assert.ok(!text.includes(KEY), "never the key");
    assert.equal(r.headers.get("x-upstream-secret"), null);
  }
  const down = setup({ answer: () => { throw new Error("down"); } });
  const r = await down.post("quote", pay);
  assert.deepEqual([r.status, (await r.json()).code], [502, "quotes.upstream.unreachable"]);
});

test("case (c): a trading wallet's SOL, ETH or BNB into the float, and nothing wider", async () => {
  const { post } = setup();
  const c = { ...moveIn, originAsset: "nep141:sol.omft.near", destinationAsset: USDC };
  assert.equal((await post("quote", c)).status, 201);
  assert.equal((await post("quote", { ...c, originAsset: "nep141:hood.omft.near" })).status, 201);
  // BNB's move home (D127, 3 Nov): exactly the core's own quote for it (float-moves.ts: EXACT_INPUT to the float as USDC)
  const BNB = "nep245:v2_1.omni.hot.tg:56_11111111111111111111";
  assert.equal((await post("quote", { ...c, originAsset: BNB })).status, 201, "BNB into the float as USDC");
  const no = async (b: unknown) => (await post("quote", b)).status;
  assert.equal(await no({ ...c, destinationAsset: "nep141:eth.omft.near" }), 400, "other destination");
  assert.equal(await no({ ...c, recipient: "a2".repeat(32) }), 400, "recipient is not refundTo");
  // BNB comes home as USDC into the float, or (D155, set-up's first money from any chain) as itself into the pot; never to
  // another account, never another shape
  assert.equal(await no({ ...c, originAsset: BNB, destinationAsset: BNB }), 201, "BNB as itself (D155: set-up's own coin from its chain)");
  assert.equal(await no({ ...c, originAsset: BNB, destinationAsset: "nep141:wrap.near" }), 400, "BNB into anything but USDC");
  assert.equal(await no({ ...c, originAsset: BNB, recipient: "a2".repeat(32) }), 400, "BNB to another account");
  assert.equal(await no({ ...c, originAsset: BNB, swapType: "EXACT_OUTPUT" }), 400, "BNB exact output");
  assert.equal(await no({ ...c, originAsset: BNB, refundType: "ORIGIN_CHAIN" }), 400, "BNB refunded on its chain");
  // review L3: refused by case (e)'s own list too, not only by its gate being off (BNB isn't a first-money coin)
  const funded = setup({ fund: true });
  const wallet = "0x" + "ab".repeat(20);
  assert.equal((await funded.post("quote", { ...c, originAsset: BNB, destinationAsset: "nep141:wrap.near", refundType: "ORIGIN_CHAIN", refundTo: wallet, swapType: "FLEX_INPUT" })).status, 400, "BNB as a first money, gate on");
  assert.equal((await funded.post("quote", { ...c, originAsset: "nep141:hood.omft.near", destinationAsset: "nep141:wrap.near", refundType: "ORIGIN_CHAIN", refundTo: wallet, swapType: "FLEX_INPUT" })).status, 201, "control: ETH on Robinhood Chain as a first money, gate on");
  assert.equal(await no({ ...c, originAsset: "nep245:v2_1.omni.hot.tg:56_0x55d398326f99059ff775485246999027b3197955" }), 400, "another HOT token (USDT on BNB Chain)");
  assert.equal(await no({ ...c, originAsset: "nep245:v2_1.omni.hot.tg:137_11111111111111111111" }), 400, "another chain's HOT coin (Polygon)");
  assert.equal(await no({ ...c, originAsset: "nep141:btc.omft.near" }), 400, "any other origin");
  assert.equal(await no({ ...c, refundType: "ORIGIN_CHAIN" }), 400, "refundType");
  assert.equal(await no({ ...c, swapType: "EXACT_OUTPUT" }), 400, "swapType");
  const short = "a1".repeat(31);
  assert.equal(await no({ ...c, recipient: short, refundTo: short }), 400, "not 64 hex");
});

test("case (d) (mainnet, 1 Nov): a Top up paid with the Safe's NEAR or USDT goes into the float as USDC; nothing wider", async () => {
  const { post, sent } = setup();
  // the Add's own quote, as float-moves.ts quoteAdd asks it (the old relay refused this: a Top up from NEAR never went)
  const add = { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: "nep141:wrap.near", depositType: "ORIGIN_CHAIN", destinationAsset: USDC, amount: "9000000000000000000000000", refundTo: POCKET, refundType: "CONFIDENTIAL_INTENTS", recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS", deadline: "2026-11-01T18:00:00.000Z", confidentiality: "basic" };
  assert.equal((await post("quote", add)).status, 201);
  assert.equal((await post("quote", { ...add, originAsset: "nep141:usdt.tether-token.near" })).status, 201);
  assert.equal(sent.length, 2);
  const no = async (b: unknown) => (await post("quote", b)).status;
  assert.equal(await no({ ...add, destinationAsset: "nep141:usdt.tether-token.near" }), 400, "into the float as USDC only (the same coin in is case (b), as before)");
  assert.equal(await no({ ...add, recipient: "a2".repeat(32) }), 400, "to the float itself (recipient is refundTo)");
  assert.equal(await no({ ...add, recipientType: "INTENTS" }), 400, "confidential only");
  assert.equal(await no({ ...add, refundType: "INTENTS" }), 400);
  assert.equal(await no({ ...add, swapType: "EXACT_OUTPUT" }), 400);
  assert.equal(await no({ ...add, confidentiality: "public" }), 400);
  assert.equal(await no({ ...add, originAsset: "nep141:token.v2.ref-finance.near" }), 400, "no other coin");
  assert.equal(sent.length, 2, "none of those reached 1Click");
});

const SOL_WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EVM_WALLET = "0x2b5AD5c4795c026514f8317c7a215E218DcCD6cF";
const RECIPIENT = "b7".repeat(32);
// The shape the core's funding ask will take on the confidential route: fund-start.ts fundRequest's terms with the
// recipient a confidential balance and confidentiality "basic". The core does NOT send this yet (it asks 1Click directly,
// in public); case (e) is off until the operator turns it on (review J2, H1 and M3).
const FUND_ASK = { dry: false, swapType: "FLEX_INPUT", slippageTolerance: 100, originAsset: "nep141:sol.omft.near", depositType: "ORIGIN_CHAIN", destinationAsset: "nep141:wrap.near", amount: "19060833", refundTo: SOL_WALLET, refundType: "ORIGIN_CHAIN", recipient: RECIPIENT, recipientType: "CONFIDENTIAL_INTENTS", deadline: "2026-11-02T18:00:00.000Z", confidentiality: "basic" };

test("case (e) is off unless the relay's owner turns it on (RELAY_FUND_CONFIDENTIAL=on); on, a quote over $25 is refused and its address never leaves", async () => {
  const off = setup();
  const r = await off.post("quote", FUND_ASK);
  assert.equal(r.status, 400);
  assert.equal(((await r.json()) as { code: string }).code, "quotes.request.refused");
  assert.equal(off.sent.length, 0, "off: never reaches 1Click");
  const big = setup({ fund: true, usd: "25.01" });
  const b = await big.post("quote", FUND_ASK);
  assert.equal(b.status, 400);
  const body = await b.text();
  assert.match(body, /quotes\.request\.too-big/);
  assert.doesNotMatch(body, new RegExp(DEPOSIT), "the address never leaves");
  assert.equal((await setup({ fund: true, usd: "24.99" }).post("quote", FUND_ASK)).status, 201, "control: the opening's few dollars pass");
  assert.equal((await setup({ usd: "24.99" }).post("quote", FUND_ASK)).status, 400, "control: the same, off, is refused");
});

test("case (e) (J2, 2 Nov): a new account's first money from another chain into its own confidential balance, refunded on that chain; nothing wider", async () => {
  const { post, sent } = setup({ fund: true });
  const fund = { dry: false, swapType: "FLEX_INPUT", slippageTolerance: 100, originAsset: "nep141:sol.omft.near", depositType: "ORIGIN_CHAIN", destinationAsset: "nep141:wrap.near", amount: "19060833", refundTo: SOL_WALLET, refundType: "ORIGIN_CHAIN", recipient: RECIPIENT, recipientType: "CONFIDENTIAL_INTENTS", deadline: "2026-11-02T18:00:00.000Z", confidentiality: "basic" };
  const passes = [
    fund,
    { ...fund, originAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near" },
    { ...fund, originAsset: "nep141:base.omft.near", refundTo: EVM_WALLET },
    { ...fund, originAsset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", refundTo: EVM_WALLET },
    { ...fund, dry: true, swapType: "EXACT_OUTPUT", amount: "441000000000000000000000" },
  ];
  for (const b of passes) assert.equal((await post("quote", b)).status, 201, b.originAsset);
  assert.equal(sent.length, passes.length);
  // What 1Click got is the request rebuilt from ZeroFee's own fields, nothing added.
  assert.deepEqual(JSON.parse(String(sent[0].init.body)), fund);
  const before = sent.length;
  const refused = async (b: unknown, why: string) => {
    const r = await post("quote", b);
    assert.equal(r.status, 400, why);
    assert.equal(((await r.json()) as { code: string }).code, "quotes.request.refused", why);
  };
  await refused({ ...fund, originAsset: "nep141:wrap.near" }, "NEAR itself needs no swap");
  await refused({ ...fund, originAsset: "nep141:btc.omft.near" }, "an unknown coin");
  await refused({ ...fund, originAsset: "nep245:v2_1.omni.hot.tg:56_11111111111111111111", refundTo: EVM_WALLET }, "BNB");
  await refused({ ...fund, originAsset: "nep245:v2_1.omni.hot.tg:56_SZzgw3HSudhZcTwPWUTi2RJB19t", refundTo: EVM_WALLET }, "USDC on BNB Chain");
  await refused({ ...fund, refundTo: EVM_WALLET }, "an EVM wallet for a Solana coin");
  await refused({ ...fund, originAsset: "nep141:base.omft.near", refundTo: SOL_WALLET }, "a Solana wallet for an EVM coin");
  await refused({ ...fund, refundTo: POCKET }, "a 64-hex refund with an ORIGIN_CHAIN refund");
  await refused({ ...fund, recipientType: "DESTINATION_CHAIN" }, "delivered in public");
  await refused({ ...fund, recipient: "someone.near" }, "a named recipient");
  await refused({ ...fund, recipient: "b7".repeat(31) }, "not 64 hex");
  await refused({ ...fund, destinationAsset: USDC }, "NEAR out only");
  await refused({ ...fund, swapType: "EXACT_INPUT" }, "EXACT_INPUT");
  await refused({ ...fund, swapType: "EXACT_OUTPUT" }, "a real EXACT_OUTPUT");
  await refused({ ...fund, dry: "true", swapType: "EXACT_OUTPUT" }, "dry as a string");
  const { confidentiality: _, ...open } = fund;
  await refused(open, "no confidentiality");
  await refused({ ...fund, confidentiality: "public" }, "public");
  await refused({ ...fund, depositType: "INTENTS" }, "deposit from inside intents");
  assert.equal(sent.length, before, "none of those reached 1Click");
  // The control: one of those bodies with its one field put back passes again.
  assert.equal((await post("quote", { ...{ ...fund, refundTo: EVM_WALLET }, refundTo: SOL_WALLET })).status, 201);
  assert.equal((await post("quote", { ...open, confidentiality: "basic" })).status, 201);
  // The older cases still refuse an origin-chain refund to their pocket or float.
  await refused({ ...moveIn, refundType: "ORIGIN_CHAIN" }, "a pocket move in");
  await refused({ ...pay, refundType: "ORIGIN_CHAIN" }, "a pocket payment");
});

test("a real quote carries its status tag; status gives the full record only with that tag, else just the status", async () => {
  const { post, call } = setup();
  assert.equal((await (await post("quote", { ...pay, dry: false })).json()).zerofeeStatusTag, tag);
  const full = await (await call(`/api/relay?route=status&depositAddress=${DEPOSIT}`, { headers: { "x-zerofee-status-tag": tag } })).json();
  assert.equal(full.quoteResponse.quoteRequest.refundTo, POCKET);
  for (const wrong of [undefined, "nope", createHmac("sha256", "other").update(DEPOSIT).digest("base64url")]) {
    const bare = await (await call(`/api/relay?route=status&depositAddress=${DEPOSIT}`, { headers: wrong ? { "x-zerofee-status-tag": wrong } : {} })).json();
    assert.deepEqual(bare, { status: "PENDING_DEPOSIT" }, "who it's for stays hidden");
  }
  assert.equal((await setup({ secret: null }).post("quote", pay)).status, 503, "no secret: not set up");
});

test("a move in from a chain wallet: status answers for its Solana or EVM deposit address, with its tag; nothing else reaches 1Click (mainnet 2 Nov)", async () => {
  const { sent, call } = setup();
  for (const deposit of ["5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"]) {
    const t = createHmac("sha256", SECRET).update(deposit).digest("base64url");
    const full = await call(`/api/relay?route=status&depositAddress=${deposit}`, { headers: { "x-zerofee-status-tag": t } });
    assert.equal(full.status, 200, deposit);
    assert.equal((await full.json()).quoteResponse.quoteRequest.refundTo, POCKET, "the full record with its tag");
    assert.equal(sent.at(-1)!.url, `${UPSTREAM}/status?depositAddress=${deposit}`);
    assert.deepEqual(await (await call(`/api/relay?route=status&depositAddress=${deposit}`)).json(), { status: "PENDING_DEPOSIT" }, "no tag: who it's for stays hidden");
  }
  const before = sent.length;
  const bad = ["5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j0", "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4jO", "5Q544fKrFoe6tsEbD7S8EmxGTJYAK", "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A06", "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063&x=1", "AB".repeat(32), "kid.near", ""];
  for (const d of bad) assert.equal((await call(`/api/relay?route=status&depositAddress=${encodeURIComponent(d)}`)).status, 400, d);
  assert.equal(sent.length, before, "none of those reached 1Click");
});

test("quotesPerMinute: a loopback tool's relay takes more from its one caller; unset, the 60 a minute holds", async () => {
  const at = async (quotesPerMinute?: number) => {
    const relay = createRelay({ key: KEY, secret: SECRET, origins: [], quotesPerMinute, fetchFn: async () => new Response(JSON.stringify({ status: "PENDING_DEPOSIT" }), { status: 200 }), now: () => 0 });
    const statuses: number[] = [];
    for (let i = 0; i < 601; i++) statuses.push((await relay(new Request(`http://127.0.0.1:8788/v0/status?depositAddress=${DEPOSIT}`), "127.0.0.1")).status);
    return statuses;
  };
  const local = await at(600);
  assert.deepEqual([local[599], local[600]], [200, 429]);
  const plain = await at();
  assert.deepEqual([plain[59], plain[60]], [200, 429]);
  assert.deepEqual([(await at(0))[60], (await at(-1))[60]], [429, 429], "nothing or less than nothing: the default");
});

test("only the app's own origins may call from a browser; a basic rate limit per address", async () => {
  const { post, call } = setup();
  assert.equal((await post("quote", pay, "https://evil.example")).status, 403);
  const ok = await post("quote", pay, "zerofee-app://app");
  assert.deepEqual([ok.status, ok.headers.get("access-control-allow-origin")], [201, "zerofee-app://app"]);
  const pre = await call("/api/relay?route=quote", { method: "OPTIONS", origin: "https://app.zerofee.example" });
  assert.deepEqual([pre.status, pre.headers.get("access-control-allow-origin"), pre.headers.get("access-control-allow-headers")], [204, "https://app.zerofee.example", "content-type, x-zerofee-status-tag, authorization, x-zf-agent-account, x-zf-agent-bind"]);
  assert.equal((await call("/api/relay?route=quote", { method: "OPTIONS", origin: "https://evil.example" })).status, 403);

  let t = 0;
  const limited = setup({ now: () => t });
  const statuses: number[] = [];
  for (let i = 0; i < 61; i++) statuses.push((await limited.call(`/api/relay?route=status&depositAddress=${DEPOSIT}`)).status);
  assert.deepEqual([statuses[59], statuses[60]], [200, 429]);
  t += 61_000;
  assert.equal((await limited.call(`/api/relay?route=status&depositAddress=${DEPOSIT}`)).status, 200, "a minute later, fine again");
});

test("D132: a real quote over $10,000 by 1Click's own price, or with none, is refused and its deposit address never leaves", async () => {
  // As 1Click answers: a real quote has a deposit address, a dry one never does.
  const at = (amountInUsd: unknown) => setup({ answer: (_url, init) => new Response(JSON.stringify({ quote: { ...(JSON.parse(String(init.body)).dry ? {} : { depositAddress: DEPOSIT }), amountIn: "1", ...(amountInUsd === undefined ? {} : { amountInUsd }) }, quoteRequest: {} }), { status: 201 }) });
  for (const usd of ["10000.01", "50000", undefined, "not a price", 50, "", "-5", "1e3", " 5"]) {
    const r = await at(usd).post("quote", { ...pay, dry: false });
    const text = await r.text();
    assert.deepEqual([r.status, JSON.parse(text).code], [400, "quotes.request.too-big"], String(usd));
    assert.ok(!text.includes(DEPOSIT), "no deposit address, so it can't be funded");
  }
  const ok = await at("99.99").post("quote", { ...pay, dry: false });
  assert.deepEqual([ok.status, (await ok.json()).quote.depositAddress], [201, DEPOSIT]);
  // D132: what the old $100 refused now passes, up to $10,000 exactly (control: $10,000.01 above is refused)
  for (const usd of ["100.01", "5000", "10000"]) assert.equal((await at(usd).post("quote", { ...pay, dry: false })).status, 201, usd);
  const dry = await at(undefined).post("quote", pay);
  assert.equal(dry.status, 201, "a dry quote has no deposit address to fund; it passes as 1Click answered it");
});

// The market routes (UI, 26 Oct): Trade's market reads through the operator's CoinGecko keys, with CoinGecko mocked.
const GT_KEY = "gt-key-SECRET-0987654321";
const CG_KEY = "cg-key-SECRET-1122334455";
const SOL_TOKEN = "So11111111111111111111111111111111111111112";
const BSC_POOL = "0x" + "ab".repeat(20);

function market(o: { answer?: (url: string) => Response; plan?: string; now?: () => number; keys?: boolean; dailyCalls?: number } = {}) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return o.answer ? o.answer(url) : new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "x-upstream-secret": "never-passed" } });
  };
  const relay = createRelay({ key: KEY, secret: SECRET, origins: [...APP_ORIGINS], market: o.keys === false ? {} : { gt: { key: GT_KEY, plan: o.plan }, cg: { key: CG_KEY }, dailyCalls: o.dailyCalls }, fetchFn, now: o.now });
  const get = (path: string, origin?: string, method = "GET", ip = "203.0.113.9") => {
    const headers = new Headers();
    if (origin) headers.set("origin", origin);
    return relay(new Request(`https://quotes.example${path}`, { method, headers }), ip);
  };
  const post = (route: string, body: unknown, ip = "203.0.113.9") => relay(new Request(`https://quotes.example/api/relay?route=${route}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), ip);
  return { sent, get, post };
}
const keyOf = (init: RequestInit) => new Headers(init.headers);

test("market: Trade's GeckoTerminal paths go to CoinGecko's on-chain API with the operator's key, and CoinGecko's to its own", async () => {
  const { sent, get } = market();
  const r = await get("/v0/market/gt/networks/solana/trending_pools?include=base_token%2Cquote_token%2Cdex&page=1", "zerofee-app://app");
  assert.equal(r.status, 200);
  assert.equal(sent[0].url, "https://pro-api.coingecko.com/api/v3/onchain/networks/solana/trending_pools?include=base_token%2Cquote_token%2Cdex&page=1");
  assert.equal(keyOf(sent[0].init).get("x-cg-pro-api-key"), GT_KEY);
  assert.equal(r.headers.get("access-control-allow-origin"), "zerofee-app://app");
  assert.equal(r.headers.get("cache-control"), "public, s-maxage=30, stale-while-revalidate=30", "kept 30 s at the edge, then served stale while it asks again");
  assert.equal(r.headers.get("vary"), "Origin");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-upstream-secret"), null);
  assert.ok(!(await r.text()).includes(GT_KEY));

  // As Vercel rewrites it: /v0/market/gt/<path> → ?route=market&src=gt&mpath=<path>, the caller's query alongside.
  await get(`/api/relay?route=market&src=gt&mpath=networks/bsc/pools/${BSC_POOL}/ohlcv/hour&aggregate=1&limit=100&currency=usd&token=${BSC_POOL}`);
  assert.equal(sent[1].url, `https://pro-api.coingecko.com/api/v3/onchain/networks/bsc/pools/${BSC_POOL}/ohlcv/hour?aggregate=1&currency=usd&limit=100&token=${BSC_POOL}`, "the query in one order");

  await get("/v0/market/cg/simple/price?ids=solana,binancecoin,ethereum&vs_currencies=usd");
  assert.equal(sent[2].url, "https://pro-api.coingecko.com/api/v3/simple/price?ids=solana%2Cbinancecoin%2Cethereum&vs_currencies=usd");
  assert.equal(keyOf(sent[2].init).get("x-cg-pro-api-key"), CG_KEY);

  // Every shape Trade uses.
  for (const path of [
    "networks/trending_pools?include=base_token&page=1",
    "search/pools?query=bonk&network=solana&include=base_token&page=1",
    `networks/robinhood/tokens/${BSC_POOL}?include=top_pools`,
    `networks/solana/tokens/${SOL_TOKEN}/info`,
    `simple/networks/solana/token_price/${SOL_TOKEN},${SOL_TOKEN}`,
  ]) assert.equal((await get(`/v0/market/gt/${path}`)).status, 200, path);
});

test("market (data stream): a coin's info is kept six hours for everyone, one upstream call; a coin not listed yet only a minute", async () => {
  let t = 1_000_000;
  const { sent, get } = market({ now: () => t });
  const info = `/v0/market/gt/networks/solana/tokens/${SOL_TOKEN}/info`;
  const first = await get(info, "zerofee-app://app");
  assert.equal(first.headers.get("cache-control"), "public, s-maxage=21600, stale-while-revalidate=21600");
  t += 3 * 3600_000;
  for (const o of ["zerofee-app://app", "https://localhost:5180"]) assert.equal((await get(info, o)).status, 200);
  assert.equal(sent.length, 1, "three hours later, any origin: the kept answer, no second upstream call");
  // control: a coin page's price read stays short
  const price = await get(`/v0/market/gt/simple/networks/solana/token_price/${SOL_TOKEN}`, "zerofee-app://app");
  assert.equal(price.headers.get("cache-control"), "public, s-maxage=10, stale-while-revalidate=10");
  const none = market({ answer: () => new Response("{}", { status: 404 }), now: () => t });
  const miss = await none.get(info, "zerofee-app://app");
  assert.equal(miss.status, 404);
  assert.equal(miss.headers.get("cache-control"), "public, s-maxage=60, stale-while-revalidate=60", "a new coin is listed within minutes: its 404 isn't kept six hours");
  t += 61_000;
  await none.get(info, "zerofee-app://app");
  assert.equal(none.sent.length, 2, "asked again after a minute");
});

test("market: a Demo key goes to CoinGecko's free API with its own header", async () => {
  const { sent, get } = market({ plan: "demo" });
  await get(`/v0/market/gt/networks/solana/tokens/${SOL_TOKEN}/info`);
  assert.equal(sent[0].url, `https://api.coingecko.com/api/v3/onchain/networks/solana/tokens/${SOL_TOKEN}/info`);
  assert.equal(keyOf(sent[0].init).get("x-cg-demo-api-key"), GT_KEY);
  assert.equal(keyOf(sent[0].init).get("x-cg-pro-api-key"), null);
});

test("market: anything but Trade's shapes is a 404 and never reaches CoinGecko", async () => {
  const { sent, get } = market();
  for (const path of [
    "/v0/market/gt/networks/eth/trending_pools",
    "/v0/market/gt/coins/list",
    "/v0/market/gt/networks/solana/../../coins/list",
    `/v0/market/gt/networks/solana/tokens/${SOL_TOKEN}/info?x_cg_pro_api_key=mine`,
    "/v0/market/gt/search/pools?query=a&network=ethereum",
    `/v0/market/gt/networks/solana/pools/${SOL_TOKEN}/ohlcv/second`,
    `/v0/market/gt/simple/networks/solana/token_price/${Array(31).fill(SOL_TOKEN).join(",")}`,
    "/v0/market/cg/coins/markets?vs_currency=usd",
    "/v0/market/xx/simple/price",
    `/v0/market/gt/search/pools?query=${"a".repeat(65)}`,
  ]) {
    const r = await get(path, "zerofee-app://app");
    assert.equal(r.status, 404, path);
    assert.equal(r.headers.get("access-control-allow-origin"), "zerofee-app://app", `${path}: CORS on the refusal too`);
  }
  assert.equal((await get("/v0/market/cg/simple/price?ids=solana&vs_currencies=usd", undefined, "POST")).status, 404);
  assert.equal(sent.length, 0);
});

test("market: CoinGecko's answer passes through: a 404 stays, a 429 keeps retry-after, CORS on each; other sites refused", async () => {
  const { sent, get } = market({
    answer: (url) => url.includes("token_price")
      ? new Response('{"status":{"error_code":429}}', { status: 429, headers: { "retry-after": "12" } })
      : new Response('{"errors":[{"status":"404","title":"Not Found"}]}', { status: 404 }),
  });
  const busy = await get(`/v0/market/gt/simple/networks/solana/token_price/${SOL_TOKEN}`, "https://localhost:5180");
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get("retry-after"), "12");
  assert.equal(busy.headers.get("access-control-allow-origin"), "https://localhost:5180");
  assert.equal(busy.headers.get("cache-control"), "no-store");
  const unknown = await get(`/v0/market/gt/networks/solana/tokens/${SOL_TOKEN}`, "zerofee-app://app");
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).code, "quotes.market.none");
  assert.equal(unknown.headers.get("cache-control"), "public, s-maxage=60, stale-while-revalidate=60");
  const elsewhere = await get(`/v0/market/gt/networks/solana/tokens/${SOL_TOKEN}`, "https://not-zerofee.example");
  assert.equal(elsewhere.status, 403);
  assert.equal(elsewhere.headers.get("access-control-allow-origin"), null);
  assert.equal(sent.length, 2);
});

test("market: each answer is kept for its path's time, so CoinGecko is asked once per URL until then", async () => {
  let t = 1_000_000;
  let busy = false;
  const { sent, get } = market({ now: () => t, answer: () => (busy ? new Response("{}", { status: 429 }) : new Response('{"data":{}}', { status: 200 })) });
  const price = `/v0/market/gt/simple/networks/solana/token_price/${SOL_TOKEN}`;
  await get(price);
  t += 9_000;
  assert.equal((await get(price)).status, 200);
  assert.equal(sent.length, 1, "a price is kept 10 s");
  t += 1_001;
  await get(price);
  assert.equal(sent.length, 2, "then asked again");
  // A busy answer is never kept.
  busy = true;
  const pools = "/v0/market/gt/networks/bsc/trending_pools";
  await get(pools);
  await get(pools);
  assert.equal(sent.length, 4);
});

test("market: without the operator's key the market routes say so (503), and CoinGecko's answer never carries a key", async () => {
  const none = market({ keys: false });
  const r = await none.get("/v0/market/cg/simple/price?ids=solana&vs_currencies=usd", "zerofee-app://app");
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, "quotes.not-configured");
  assert.equal(none.sent.length, 0);
  const leaky = market({ answer: () => new Response(JSON.stringify({ echo: GT_KEY }), { status: 200 }) });
  const l = await leaky.get(`/v0/market/gt/networks/solana/tokens/${SOL_TOKEN}/info`);
  assert.equal(l.status, 502);
  assert.ok(!(await l.text()).includes(GT_KEY));
});

test("market: reads count apart from the quote routes per address, so a chart never locks out a payment", async () => {
  const { get, post } = market({ answer: (url) => new Response(JSON.stringify(url.includes("1click") ? { quote: { depositAddress: DEPOSIT, amountInUsd: "1" } } : { data: [] }), { status: url.includes("1click") ? 201 : 200 }) });
  // misses (product decision, 4 Nov: a kept answer counts against nothing), from a caller that isn't the app: its 60 a minute
  const chart = (i: number) => `/v0/market/gt/networks/solana/pools/${SOL_TOKEN}/ohlcv/hour?aggregate=${i}`;
  const codes: number[] = [];
  for (let i = 1; i <= 61; i++) codes.push((await get(chart(i))).status);
  assert.ok(codes.includes(429), "past its minute, a market read is refused");
  assert.equal((await post("quote", { dry: true, originAsset: USDC, depositType: "CONFIDENTIAL_INTENTS", refundType: "CONFIDENTIAL_INTENTS", refundTo: POCKET, confidentiality: "basic" })).status, 201, "a payment quote still goes through");
});

test("market: a budget of CoinGecko calls, a minute's and a day's; kept answers don't count; past it, 503 until it renews", async () => {
  let t = Date.UTC(2026, 9, 26, 3);
  const { sent, get } = market({ now: () => t, dailyCalls: 3 });
  const token = (i: number) => `/v0/market/gt/networks/solana/tokens/${String(i).padStart(32, "A")}/info`;
  // the app's own origin: the shared budget (a read with no Origin has its own, smaller share: audit-l13.test.ts)
  const APP = "zerofee-app://app";
  for (const i of [1, 2, 3]) assert.equal((await get(token(i), APP)).status, 200);
  assert.equal((await get(token(1), APP)).status, 200, "kept: not a call");
  const resting = await get(token(4), "zerofee-app://app");
  assert.equal(resting.status, 503);
  assert.equal((await resting.json()).code, "quotes.market.resting");
  assert.equal(resting.headers.get("access-control-allow-origin"), "zerofee-app://app");
  assert.equal(sent.length, 3);
  t += 86_400_000;
  assert.equal((await get(token(4), APP)).status, 200, "a new day");

  const minute = market({ now: () => t, dailyCalls: 1_000_000 });
  for (let i = 0; i < 300; i++) assert.equal((await minute.get(token(i), APP, "GET", `198.51.100.${i % 10}`)).status, 200);
  assert.equal((await minute.get(token(300), APP, "GET", "198.51.100.200")).status, 503, "300 calls a minute, from any number of addresses");
  t += 60_001;
  assert.equal((await minute.get(token(300), APP, "GET", "198.51.100.200")).status, 200);
});

test("market: the same question in another order is one kept answer", async () => {
  const { sent, get } = market();
  await get("/v0/market/gt/search/pools?query=bonk&page=1&include=base_token");
  await get("/v0/market/gt/search/pools?include=base_token&query=bonk&page=1");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://pro-api.coingecko.com/api/v3/onchain/search/pools?include=base_token&page=1&query=bonk");
});

// ---- logo by address and pool trades ----
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const EVM = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const png = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
const none = () => new Response("", { status: 404 });
function metaplexAccount(uri: string) {
  const str = (s: string) => { const b = Buffer.from(s); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
  return Buffer.concat([Buffer.alloc(65), str("Name"), str("SYM"), str(uri)]).toString("base64");
}
const rpc = (uri: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: { data: [metaplexAccount(uri), "base64"] } } }), { status: 200 });

test("logo: addresses are checked before anything is fetched", async () => {
  const { sent, get } = market({ answer: none });
  for (const q of [`c=sol&a=${EVM}`, "c=sol&a=short", `c=sol&a=${MINT}0`, "c=sol&a=" + "1".repeat(33), `c=bsc&a=${MINT}`, "c=bsc&a=0x123", `c=hood&a=${EVM}00`, `c=eth&a=${EVM}`, `c=bsc`, `c=bsc&a=${EVM}&u=https://evil.example/x.png`]) {
    assert.equal((await get(`/v0/market/logo?${q}`)).status, 400, q);
  }
  assert.equal((await get(`/api/relay?route=market&src=logo&mpath=&c=bsc&a=0x12`)).status, 400, "the rewritten address too");
  assert.equal((await get(`/v0/market/logo?c=bsc&a=${EVM}`, undefined, "POST")).status, 404);
  assert.equal(sent.length, 0);
});

test("logo: Solana walks the mint's metadata uri to its image; a week at the edge; never svg; nothing off the allowlist", async () => {
  const urls: string[] = [];
  const { get } = market({ answer: (url) => { urls.push(url); return url.includes("rpc") || url.includes("pocket") ? rpc("https://arweave.net/meta") : url.endsWith("/meta") ? new Response(JSON.stringify({ image: "ar://img" }), { status: 200, headers: { "content-type": "application/json" } }) : url === "https://arweave.net/img" ? png() : none(); } });
  const r = await get(`/v0/market/logo?c=sol&a=${MINT}`, "zerofee-app://app");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.equal(r.headers.get("cache-control"), "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400");
  assert.equal(r.headers.get("access-control-allow-origin"), "zerofee-app://app");
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [...PNG]);
  assert.ok(urls.includes("https://arweave.net/meta") && urls.includes("https://arweave.net/img"));

  const svg = market({ answer: (url) => (url.includes("rpc") || url.includes("pocket") ? rpc("https://arweave.net/meta") : url.endsWith("/meta") ? new Response(JSON.stringify({ image: "https://arweave.net/i" }), { status: 200, headers: { "content-type": "application/json" } }) : url.includes("raw.github") || url.includes("geckoterminal") ? none() : new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } })) });
  assert.equal((await svg.get(`/v0/market/logo?c=sol&a=${MINT}`)).status, 404, "svg is never served");

  const evil = market({ answer: (url) => (url.includes("rpc") || url.includes("pocket") ? rpc("https://arweave.net/meta") : url.endsWith("/meta") ? new Response(JSON.stringify({ image: "https://evil.example/i.png" }), { status: 200, headers: { "content-type": "application/json" } }) : none()) });
  assert.equal((await evil.get(`/v0/market/logo?c=sol&a=${MINT}`)).status, 404);
  assert.ok(evil.sent.every((s) => !s.url.includes("evil.example")), "a host off the allowlist is never asked");
});

test("logo: the type comes from the first bytes; a mismatch or an unknown signature is no logo and the next source is tried", async () => {
  const sigs: [string, number[]][] = [
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 1, 2, 3]],
    ["image/jpeg", [0xff, 0xd8, 0xff, 0xe0, 1, 2]],
    ["image/gif", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    ["image/webp", [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]],
  ];
  for (const [type, bytes] of sigs) {
    const ok = market({ answer: (url) => (url.includes("trustwallet") ? new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": type } }) : none()) });
    const r = await ok.get(`/v0/market/logo?c=bsc&a=${EVM}`);
    assert.equal(r.status, 200, type);
    assert.equal(r.headers.get("content-type"), type);
  }
  const lie = (declared: string, bytes: number[]) => market({ answer: (url) => (url.includes("trustwallet") ? new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": declared } }) : none()) });
  assert.equal((await lie("image/png", sigs[1][1]).get(`/v0/market/logo?c=bsc&a=${EVM}`)).status, 404, "jpeg bytes declared png");
  assert.equal((await lie("image/png", [0x3c, 0x73, 0x76, 0x67, 0x2f, 0x3e]).get(`/v0/market/logo?c=bsc&a=${EVM}`)).status, 404, "unknown bytes");
  // the first source lies, the next source is used
  const next = market({ answer: (url) => (url.includes("trustwallet") ? new Response(new Uint8Array(sigs[1][1]), { status: 200, headers: { "content-type": "image/png" } }) : url.includes("pancake") && !url.includes("json") ? none() : url.includes("pancakeswap-extended") ? new Response(JSON.stringify({ tokens: [{ chainId: 56, address: EVM, logoURI: "https://assets.coingecko.com/x/small/x.png" }] }), { status: 200, headers: { "content-type": "application/json" } }) : url.startsWith("https://assets.coingecko.com/") ? png() : none()) });
  const r = await next.get(`/v0/market/logo?c=bsc&a=${EVM}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
});

test("logo: BNB asks Trust Wallet by checksum address, then the lists; Robinhood the Uniswap list; size caps hold; the 404 is kept ten minutes", async () => {
  const bsc = market({ answer: (url) => (url.endsWith("/assets/0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed/logo.png") ? png() : none()) });
  const hit = await bsc.get(`/v0/market/logo?c=bsc&a=${EVM}`);
  assert.equal(hit.status, 200);
  // the phone keeps a logo a day (a cold open draws it without asking); the edge a week, stale while it refreshes
  assert.equal(hit.headers.get("cache-control"), "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400");
  assert.ok(bsc.sent.some((s) => s.url === "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed/logo.png"));

  const list = { tokens: [{ chainId: 4663, address: EVM, logoURI: "https://assets.coingecko.com/coins/images/1/small/x.png" }] };
  const hood = market({ answer: (url) => (url === "https://tokens.uniswap.org/" || url === "https://tokens.uniswap.org" ? new Response(JSON.stringify(list), { status: 200, headers: { "content-type": "application/json" } }) : url.startsWith("https://assets.coingecko.com/") ? png() : none()) });
  assert.equal((await hood.get(`/v0/market/logo?c=hood&a=${EVM.toUpperCase().replace("0X", "0x")}`)).status, 200);
  assert.ok(hood.sent.every((s) => !s.url.includes("pancake") && !s.url.includes("trustwallet")), "Robinhood: the Uniswap list only (then GeckoTerminal)");

  const big = market({ answer: (url) => (url.includes("trustwallet") ? new Response(new Uint8Array(401 * 1024), { status: 200, headers: { "content-type": "image/png" } }) : none()) });
  assert.equal((await big.get(`/v0/market/logo?c=bsc&a=${EVM}`)).status, 404, "an image over 400 KB is not served");

  const missing = market({ answer: none });
  const r = await missing.get(`/v0/market/logo?c=bsc&a=${EVM}`);
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("cache-control"), "public, max-age=600, s-maxage=600", "a miss: ten minutes, here and on the phone");
  assert.equal(((await r.json()) as { code: string }).code, "quotes.logo.none");
  assert.ok(missing.sent.at(-1)!.url.startsWith("https://pro-api.coingecko.com/api/v3/onchain/networks/bsc/tokens/"), "GeckoTerminal's image is asked last, with the key");
});

const POOL = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2";
const HPOOL = "0x172fcd41e0913e95784454622d1c3724f546f849";
const trades = (net: string, pool: string, q = "") => `/v0/market/cg/onchain/networks/${net}/pools/${pool}/trades${q}`;

test("trades: the paid CoinGecko call, one numeric query name, ten seconds at the edge", async () => {
  const { sent, get } = market({ answer: () => new Response('{"data":[]}', { status: 200 }) });
  const r = await get(trades("solana", POOL, "?trade_volume_in_usd_greater_than=250.5"), "zerofee-app://app");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "public, s-maxage=10, stale-while-revalidate=10");
  assert.equal(sent[0].url, `https://pro-api.coingecko.com/api/v3/onchain/networks/solana/pools/${POOL}/trades?trade_volume_in_usd_greater_than=250.5`);
  assert.equal((sent[0].init.headers as Record<string, string>)["x-cg-pro-api-key"], CG_KEY);
  assert.equal((await get(trades("bsc", HPOOL))).status, 200);
  assert.equal((await get(trades("robinhood", HPOOL, "?trade_volume_in_usd_greater_than=0"))).status, 200);
  assert.equal(sent.length, 3);
});

test("trades: other networks, pools and query names are refused before CoinGecko is asked", async () => {
  const { sent, get } = market({ answer: () => new Response("{}", { status: 200 }) });
  for (const p of [trades("ethereum", HPOOL), trades("solana", HPOOL), trades("bsc", POOL), trades("solana", "short"), trades("bsc", HPOOL + "0"),
    trades("solana", POOL, "?page=2"), trades("solana", POOL, "?trade_volume_in_usd_greater_than=abc"), trades("solana", POOL, "?trade_volume_in_usd_greater_than=1e3"),
    trades("solana", POOL, "?trade_volume_in_usd_greater_than=-1"), trades("solana", POOL, "?trade_volume_in_usd_greater_than=1&trade_volume_in_usd_greater_than=2"),
    trades("solana", POOL, "?trade_volume_in_usd_greater_than=1&include=x"), `/v0/market/cg/onchain/networks/solana/pools/${POOL}/trades/x`]) {
    assert.equal((await get(p)).status, 404, p);
  }
  assert.equal(sent.length, 0);
  const demo = market({ plan: "demo", answer: () => new Response("{}", { status: 200 }) });
  await demo.get(trades("bsc", HPOOL));
  assert.ok(demo.sent[0].url.startsWith("https://pro-api.coingecko.com/"));
});

test("trades: without the key 503, a 429 keeps retry-after, the key never comes back", async () => {
  assert.equal((await market({ keys: false }).get(trades("solana", POOL))).status, 503);
  const busy = market({ answer: () => new Response("{}", { status: 429, headers: { "retry-after": "7" } }) });
  const r = await busy.get(trades("solana", POOL));
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("retry-after"), "7");
  assert.equal(r.headers.get("cache-control"), "no-store");
  const leaky = market({ answer: () => new Response(JSON.stringify({ k: CG_KEY }), { status: 200 }) });
  assert.equal((await leaky.get(trades("solana", POOL))).status, 502);
});

// POST /v0/sol/send: one signed Solana transaction to Helius, fixed method and params, {signature} or a short error.
const HELIUS_KEY = "helius-key-SECRET-abcdef0123";
const SIG = "5".repeat(87);
const compact = (n: number) => (n < 0x80 ? [n] : n < 0x4000 ? [(n & 0x7f) | 0x80, n >> 7] : [(n & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, n >> 14]);
const PAYER = generateKeyPairSync("ed25519");
const PAYER_KEY = Buffer.from(PAYER.publicKey.export({ format: "jwk" }).x!, "base64url");
/**
 * A system transfer's shape: one signer (the fee payer, PAYER, its signature real unless `badSig`), three keys, one
 * instruction with `data` bytes; v0 adds one lookup table.
 */
function solTx({ v0 = false, data = 12, badSig = false } = {}) {
  const message: number[] = [];
  if (v0) message.push(0x80);
  message.push(1, 0, 1, ...compact(3), ...PAYER_KEY, ...new Array(64).fill(9), ...new Array(32).fill(3));
  message.push(...compact(1), 2, ...compact(2), 0, v0 ? 3 : 1, ...compact(data), ...new Array(data).fill(1));
  if (v0) message.push(...compact(1), ...new Array(32).fill(4), ...compact(1), 0, ...compact(0));
  const sig = badSig ? Buffer.alloc(64, 7) : cryptoSign(null, Buffer.from(message), PAYER.privateKey);
  return Buffer.from([...compact(1), ...sig, ...message]);
}
function solSetup(o: { helius?: string | null; answer?: () => Response; ip?: string } = {}) {
  let caller = 0;
  const sent: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return o.answer ? o.answer() : new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: SIG, echo: url }), { headers: { "x-upstream-secret": "s" } });
  };
  const relay = createRelay({ key: KEY, secret: SECRET, origins: APP_ORIGINS, helius: o.helius === null ? undefined : o.helius ?? HELIUS_KEY, fetchFn });
  const send = (body: string, type = "application/json", path = "/api/relay?route=sol-send", method = "POST") =>
    relay(new Request(`https://quotes.example${path}`, { method, headers: { "content-type": type }, ...(method === "POST" ? { body } : {}) }), o.ip ?? `203.0.113.${++caller}`);
  return { sent, send };
}

test("sol/send: a signed transaction goes to Helius as sendTransaction with the fixed params only, and only its signature comes back", async () => {
  for (const tx of [solTx(), solTx({ v0: true })]) {
    const { sent, send } = solSetup();
    const b64 = tx.toString("base64");
    const r = await send(JSON.stringify({ tx: b64 }), "application/json; charset=utf-8", "/v0/sol/send");
    const text = await r.text();
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(text), { signature: SIG });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, `${HELIUS_RPC}?api-key=${HELIUS_KEY}`);
    assert.equal(HELIUS_RPC, "https://mainnet.helius-rpc.com/");
    assert.equal(sent[0].init.method, "POST");
    assert.equal(sent[0].init.body, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [b64, { encoding: "base64", skipPreflight: true, maxRetries: 0 }] }));
    assert.ok(!text.includes(HELIUS_KEY) && !text.includes("helius"), "never the key or Helius's address");
    assert.equal(r.headers.get("x-upstream-secret"), null);
  }
});

test("sol/send: a JSON-RPC call, an oversized or non-transaction body, a wrong content type or method are refused before Helius", async () => {
  const { sent, send } = solSetup();
  const good = solTx().toString("base64");
  const status = async (r: Promise<Response>) => (await r).status;
  assert.equal(await status(send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: ["11111111111111111111111111111111"] }))), 400, "getBalance");
  assert.equal(await status(send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [good, { skipPreflight: false }] }))), 400, "the caller's own RPC call");
  assert.equal(await status(send(JSON.stringify({ tx: good, method: "getBalance" }))), 400, "{tx} and nothing else");
  const big = solTx({ data: 1233 - solTx({ data: 0 }).length - 1 }); // data over 127 bytes takes a 2-byte length
  assert.equal(big.length, 1233);
  assert.equal(await status(send(JSON.stringify({ tx: big.toString("base64") }))), 400, "1,233 bytes");
  assert.equal(await status(send(JSON.stringify({ tx: "A".repeat(8000) }))), 400, "an oversized body");
  assert.equal(await status(send(JSON.stringify({ tx: Buffer.from("hello, this is not a transaction").toString("base64") }))), 400, "not a transaction");
  assert.equal(await status(send(JSON.stringify({ tx: Buffer.concat([solTx(), Buffer.from([0])]).toString("base64") }))), 400, "one transaction and a byte more");
  assert.equal(await status(send(JSON.stringify({ tx: Buffer.concat([solTx(), solTx()]).toString("base64") }))), 400, "two transactions");
  assert.equal(await status(send(JSON.stringify({ tx: `${good.slice(0, -4)}!!!!` }))), 400, "not base64");
  assert.equal(await status(send(JSON.stringify({ tx: 42 }))), 400);
  assert.equal(await status(send("not json")), 400);
  assert.equal(await status(send(JSON.stringify({ tx: good }), "text/plain")), 415, "wrong content type");
  assert.equal(await status(send(JSON.stringify({ tx: good }), "application/x-www-form-urlencoded")), 415);
  assert.equal(await status(send("", "application/json", "/api/relay?route=sol-send", "GET")), 404);
  assert.equal(sent.length, 0, "nothing reached Helius");
  // The largest a transaction can be still goes.
  const max = solTx({ data: 1232 - solTx({ data: 0 }).length - 1 });
  assert.equal(max.length, 1232);
  assert.equal(await status(send(JSON.stringify({ tx: max.toString("base64") }))), 200);
});

test("sol/send: unset key is 503; Helius's errors and failures are a short error, never its reply, address or key; 10 a minute", async () => {
  const off = solSetup({ helius: null });
  const r = await off.send(JSON.stringify({ tx: solTx().toString("base64") }));
  assert.deepEqual([r.status, (await r.json()).whatHappened, off.sent.length], [503, "Sending on Solana is not set up yet.", 0]);

  const no = solSetup({ answer: () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32002, message: `Transaction simulation failed ${HELIUS_KEY}` } }), { status: 200 }) });
  const e = await no.send(JSON.stringify({ tx: solTx().toString("base64") }));
  const text = await e.text();
  assert.equal(e.status, 502);
  assert.equal(JSON.parse(text).code, "quotes.sol.refused");
  assert.ok(!text.includes(HELIUS_KEY) && !text.includes("simulation") && !text.includes("helius"));

  const down = solSetup({ answer: () => { throw new Error(`down ${HELIUS_KEY}`); } });
  const d = await down.send(JSON.stringify({ tx: solTx().toString("base64") }));
  const dText = await d.text();
  assert.equal(d.status, 502);
  assert.ok(!dText.includes(HELIUS_KEY));

  const busy = solSetup({ ip: "203.0.113.9" });
  const codes = [];
  for (let i = 0; i < 11; i++) codes.push((await busy.send(JSON.stringify({ tx: solTx().toString("base64") }))).status);
  assert.deepEqual(codes, [...new Array(10).fill(200), 429]);
  assert.equal(busy.sent.length, 10);
});

// Audit 28 Oct (network + supply chain): NF-08, NF-20, NF-07, NF-03, NF-18.
test("sol/send (NF-08): a transaction not signed by its own fee payer never reaches Helius", async () => {
  const { sent, send } = solSetup();
  const r = await send(JSON.stringify({ tx: solTx({ badSig: true }).toString("base64") }));
  assert.deepEqual([r.status, (await r.json()).code, sent.length], [400, "quotes.sol.unsigned", 0]);
  // One flipped byte of the message after signing: the signature no longer covers it.
  const tx = solTx();
  tx[tx.length - 1] ^= 1;
  assert.equal((await send(JSON.stringify({ tx: tx.toString("base64") }))).status, 400);
  assert.equal(sent.length, 0);
  assert.equal((await send(JSON.stringify({ tx: solTx().toString("base64") }))).status, 200, "the same transaction, signed: goes");
});

test("sol/send (NF-08): a relay-wide minute's and day's cap across every address; optional app-only origin", async () => {
  let t = Date.UTC(2026, 9, 28, 1);
  let calls = 0;
  let live = true;
  // audit S4: past the general part (80%), a send needs Helius to say its blockhash is still valid
  const fetchFn = async (_url: string, init: RequestInit) => {
    if (JSON.parse(String(init.body)).method === "isBlockhashValid") return new Response(JSON.stringify({ result: { value: live } }));
    calls++;
    return new Response(JSON.stringify({ result: SIG }));
  };
  const relay = createRelay({ key: KEY, secret: SECRET, origins: APP_ORIGINS, helius: HELIUS_KEY, solSend: { minute: 5, day: 7 }, now: () => t, fetchFn });
  const send = (ip: string, origin?: string) => relay(new Request("https://quotes.example/v0/sol/send", { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify({ tx: solTx().toString("base64") }) }), ip);
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await send(`198.51.100.${i}`)).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 503], "five a minute, from any number of addresses (four, then the reserve's one)");
  live = false;
  t += 60_001;
  assert.equal((await send("198.51.100.19")).status, 503, "past the general part, a dead blockhash never uses the reserve");
  live = true;
  for (let m = 0; m < 5; m++, t += 60_001) for (let i = 0; i < 3; i++) await send(`198.51.100.${30 + m * 3 + i}`);
  const sent = calls;
  assert.ok(sent <= 7, `at most seven a day reach Helius: ${sent}`);
  t += 86_400_000;
  assert.equal((await send("198.51.100.99")).status, 200, "a new day");

  const appOnly = createRelay({ key: KEY, secret: SECRET, origins: APP_ORIGINS, helius: HELIUS_KEY, solSend: { requireOrigin: true }, fetchFn: async () => new Response(JSON.stringify({ result: SIG })) });
  const req = (origin?: string) => appOnly(new Request("https://quotes.example/v0/sol/send", { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify({ tx: solTx().toString("base64") }) }), "203.0.113.70");
  assert.deepEqual([(await req()).status, (await req("zerofee-app://app")).status], [403, 200]);
});

test("quote (NF-20): 1Click gets a request rebuilt from ZeroFee's own fields; app fees, referrals and the rest never go on", async () => {
  const { sent, post } = setup();
  assert.equal((await post("quote", { ...pay, slippageTolerance: 100, deadline: "2026-10-28T03:00:00.000Z", appFees: [{ recipient: "thief.near", fee: 5000 }], referral: "thief", quoteWaitingTimeMs: 0, sessionId: "x" })).status, 201);
  assert.deepEqual(JSON.parse(String(sent[0].init.body)), { ...pay, slippageTolerance: 100, deadline: "2026-10-28T03:00:00.000Z" });
  assert.equal((await post("quote", { ...pay, dry: "false" })).status, 400, "a known field of the wrong type is refused");
  assert.equal((await post("generate-intent", { type: "swap_transfer", standard: "nep413", signerId: POCKET, depositAddress: DEPOSIT, extra: 1 })).status, 200);
  assert.deepEqual(JSON.parse(String(sent[1].init.body)), { type: "swap_transfer", standard: "nep413", signerId: POCKET, depositAddress: DEPOSIT });
  const s = signed.signedData;
  assert.equal((await post("submit-intent", { ...signed, extra: 1, signedData: { ...s, more: 2, payload: { ...s.payload, other: 3 } } })).status, 200);
  assert.deepEqual(JSON.parse(String(sent[2].init.body)), signed);
  assert.equal(sent.length, 3);
});

test("logo (NF-07): GeckoTerminal's image is asked with the operator's key only inside the CoinGecko budget, and a miss isn't asked again", async () => {
  const keyed: string[] = [];
  const answer = (url: string) => (url.includes("coingecko") ? (keyed.push(url), new Response("{}", { status: url.includes("simple/price") ? 200 : 404 })) : new Response("no", { status: 404 }));
  const { get } = market({ answer, dailyCalls: 2 });
  const addr = (i: number) => `0x${String(i).padStart(40, "0")}`;
  assert.equal((await get(`/v0/market/logo?c=bsc&a=${addr(1)}`, undefined, "GET", "198.51.100.1")).status, 404);
  assert.equal(keyed.length, 1, "the logo's keyed call counted");
  assert.equal((await get(`/v0/market/logo?c=bsc&a=${addr(1)}`, undefined, "GET", "198.51.100.2")).status, 404);
  assert.equal(keyed.length, 1, "a miss isn't asked again");
  assert.equal((await get("/v0/market/cg/simple/price?ids=solana&vs_currencies=usd")).status, 200, "the second of two");
  for (let i = 2; i < 12; i++) assert.equal((await get(`/v0/market/logo?c=bsc&a=${addr(i)}`, undefined, "GET", `198.51.100.${i}`)).status, 404);
  assert.equal(keyed.length, 2, "past the budget: no keyed call");
});

test("alerts (NF-03): one action from one source; two different names are a 404", () => {
  const a = (u: string) => alertsActionOf(new URL(`https://q.example${u}`));
  assert.equal(a("/v0/alerts/subscribe"), "subscribe");
  assert.equal(a("/api/relay?route=alerts&action=check"), "check");
  assert.equal(a("/v0/alerts/check?action=subscribe"), "");
  assert.equal(a("/api/relay?route=alerts&action=check&action=subscribe"), "");
  assert.equal(a("/v0/alerts/check?action=check"), "check");
});

test("NF-18: the caller's address only from a trusted proxy's header; IPv6 counted by its /64; limits shared through a Redis", async () => {
  const h = (o: Record<string, string>) => new Headers(o);
  assert.equal(callerAddress(h({ "x-forwarded-for": "6.6.6.6" }), {}), "unknown", "x-forwarded-for alone is never trusted");
  assert.equal(callerAddress(h({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "1.2.3.4" }), { VERCEL: "1" }), "1.2.3.4", "Vercel's own x-real-ip");
  assert.equal(callerAddress(h({ "x-real-ip": "1.2.3.4" }), {}), "unknown", "off Vercel, no header without the flag");
  assert.equal(callerAddress(h({ "x-forwarded-for": "6.6.6.6, 7.7.7.7" }), { RELAY_TRUST_PROXY: "1" }), "6.6.6.6");
  assert.equal(addressBucket("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(addressBucket("2001:0db8:0000:0000:ffff:0:0:2"), "2001:db8:0:0::/64");
  assert.equal(addressBucket("203.0.113.5"), "203.0.113.5");
  // A Redis counter: one pipelined SET NX PX + INCR; when the Redis fails, it throws (fail closed).
  const bodies: unknown[] = [];
  let n = 0;
  let down = false;
  const c = redisCounter({ url: "https://redis.example", token: "t", fetchFn: async (url: string, init: RequestInit) => {
    if (down) throw new Error("down");
    assert.equal(url, "https://redis.example/pipeline");
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify([{ result: "OK" }, { result: ++n }]));
  } });
  assert.deepEqual([await c.hit("k", 60_000), await c.hit("k", 60_000)], [1, 2]);
  assert.deepEqual(bodies[0], [["SET", "k", "0", "PX", "60000", "NX"], ["INCR", "k"]]);
  down = true;
  await assert.rejects(() => c.hit("k", 60_000), /rate guard unavailable/, "fails closed, no memory stand-in");
  const m = memoryCounter(() => 0);
  assert.deepEqual([await m.hit("a", 10), await m.hit("a", 10), await m.hit("b", 10)], [1, 2, 1]);
});

test("D152 SR3 L14: AgentZero's plain wallet goes home to the Safe privately: plain USDC into a deposit address, delivered into the Safe's NEAR Intents balance, refunded to AgentZero's own account; nothing else of that shape", async () => {
  // kim.near runs the Safe's current release (audit L14: only a Safe is delivered into)
  const quoteAnswer = { quote: { depositAddress: DEPOSIT, amountIn: "1000000", amountInUsd: "0.999631000000" }, quoteRequest: {} };
  const { post } = setup({ fastnear: "fixture-fastnear-key", answer: (url, init) => (url.includes("fastnear") ? new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { code_hash: JSON.parse(String(init.body)).params.account_id === "kim.near" ? "8vPUrwYWp5cPDJGEuMg73d5tCJM29YkhytTsJR33AAyu" : "11111111111111111111111111111111" } }), { status: 200 }) : new Response(JSON.stringify(quoteAnswer), { status: 201 })) });
  const home = { dry: true, swapType: "EXACT_INPUT", originAsset: USDC, destinationAsset: USDC, depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN", refundTo: "a9".repeat(32), recipient: "kim.near", recipientType: "INTENTS", amount: "7500000", confidentiality: "basic" };
  assert.equal((await post("quote", home)).status, 201, "AgentZero's USDC home to the Safe");
  for (const [name, bend] of [
    ["another coin out", { destinationAsset: "nep141:wrap.near" }],
    ["another coin in", { originAsset: "nep141:wrap.near" }],
    ["exact output", { swapType: "EXACT_OUTPUT" }],
    ["to another chain", { recipientType: "DESTINATION_CHAIN" }],
    ["a refund not to a 64-hex account", { refundTo: "alice.near" }],
    ["a recipient that isn't a NEAR account", { recipient: "Kim..near" }],
    ["public", { confidentiality: "public" }],
  ] as const) assert.equal((await post("quote", { ...home, ...bend })).status, 400, name);
});

test("product decision, 4 Nov (charts accurate on every time frame): minute candles are kept 15 s, hours a minute, days five minutes", async () => {
  const { get } = market({ answer: () => new Response(JSON.stringify({ data: { attributes: { ohlcv_list: [] } } }), { status: 200 }) });
  const at = (tf: string) => get(`/v0/market/gt/networks/solana/pools/${SOL_TOKEN}/ohlcv/${tf}?aggregate=1&limit=60&currency=usd&token=${SOL_TOKEN}`);
  assert.equal((await at("minute")).headers.get("cache-control"), "public, s-maxage=15, stale-while-revalidate=15");
  assert.equal((await at("hour")).headers.get("cache-control"), "public, s-maxage=60, stale-while-revalidate=60");
  assert.equal((await at("day")).headers.get("cache-control"), "public, s-maxage=300, stale-while-revalidate=300");
  assert.equal((await at("second")).status, 404, "control: a timeframe Trade doesn't ask for isn't relayed");
});

test("case (h) (QA's real path, 5 Nov): the web wallet's Send, ONE confidential quote from its SOL or Robinhood wallet straight to the payee, refunded to that wallet; the same coin on the same network only (the audit's MUST); up to $10,000, never the opening's $25; nothing wider (controls: each changed field refused)", async () => {
  const send = { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: "nep141:sol.omft.near", depositType: "ORIGIN_CHAIN", destinationAsset: "nep141:sol.omft.near", amount: "50000000", refundTo: SOL_WALLET, refundType: "ORIGIN_CHAIN", recipient: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", recipientType: "DESTINATION_CHAIN", deadline: "2026-11-05T18:00:00.000Z", confidentiality: "basic" };
  const evm = { ...send, originAsset: "nep141:hood.omft.near", destinationAsset: "nep141:hood.omft.near", refundTo: EVM_WALLET, recipient: "0x12345678901234567890123456789012345678ab", amount: "2000000000000000" };
  const { post, sent } = setup({ usd: "60.00" });
  assert.equal((await post("quote", send)).status, 201, "SOL to a Solana address, $60: past the opening's $25");
  assert.equal((await post("quote", evm)).status, 201, "Robinhood to a Robinhood Chain address");
  assert.deepEqual(JSON.parse(String(sent[0].init.body)), send, "rebuilt from ZeroFee's own fields, nothing added");
  const before = sent.length;
  const refused = async (b: unknown, why: string) => assert.equal((await post("quote", b)).status, 400, why);
  await refused({ ...send, confidentiality: "public" }, "in public");
  await refused({ ...send, refundTo: EVM_WALLET }, "an EVM refund for a Solana coin");
  await refused({ ...evm, refundTo: SOL_WALLET }, "a Solana refund for an EVM coin");
  await refused({ ...send, refundTo: POCKET }, "a 64-hex refund on the origin chain");
  await refused({ ...send, recipient: POCKET }, "a 64-hex payee");
  await refused({ ...send, recipient: "two words" }, "not one address");
  await refused({ ...send, swapType: "FLEX_INPUT" }, "exact input only");
  await refused({ ...send, originAsset: "nep141:base.omft.near", refundTo: EVM_WALLET }, "only the web wallet's own coins");
  await refused({ ...send, originAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near" }, "a pinned token paying out as SOL: another coin (W4: a token lands as itself)");
  await refused({ ...send, destinationAsset: "nep245:v2_1.omni.hot.tg:56_11111111111111111111" }, "a nep245 payout");
  // QA's MUST: the app's own scope only, the same coin on the same network, never an open cross-chain swap
  await refused({ ...send, destinationAsset: "nep141:btc.omft.near", recipient: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" }, "SOL to BTC");
  await refused({ ...send, destinationAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", recipient: "bob.near" }, "SOL to USDC on NEAR");
  await refused({ ...send, destinationAsset: "nep141:hood.omft.near" }, "SOL to Robinhood");
  await refused({ ...evm, destinationAsset: "nep141:sol.omft.near" }, "Robinhood to SOL");
  await refused({ ...send, recipientType: "INTENTS", recipient: "bob.near" }, "into someone's NEAR Intents balance");
  await refused({ ...send, depositType: "INTENTS" }, "not from the wallet's own chain");
  assert.equal(sent.length, before, "none of these reached 1Click");
  const big = await setup({ usd: "10000.01" }).post("quote", send);
  assert.equal(big.status, 400);
  assert.match(await big.text(), /quotes\.request\.too-big/, "the private send's own $10,000");
});

test("case (h), W4 every coin held (the audit's MUST, 5 Nov): a token the core pins (hidden-coins.ts) goes on the web Send's quote, landing as itself on its own chain; controls: an unpinned token, a pinned token paying out as another coin, a pinned token of the other chain, all refused before 1Click", async () => {
  const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
  const USDG_HOOD = "nep141:hood-0x5fc5360d0400a0fd4f2af552add042d716f1d168.omft.near";
  const send = { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: USDC_SOL, depositType: "ORIGIN_CHAIN", destinationAsset: USDC_SOL, amount: "2500000", refundTo: SOL_WALLET, refundType: "ORIGIN_CHAIN", recipient: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", recipientType: "DESTINATION_CHAIN", deadline: "2026-11-05T18:00:00.000Z", confidentiality: "basic" };
  const evm = { ...send, originAsset: USDG_HOOD, destinationAsset: USDG_HOOD, refundTo: EVM_WALLET, recipient: "0x12345678901234567890123456789012345678ab", amount: "3000000" };
  const { post, sent } = setup({ usd: "3.00" });
  assert.equal((await post("quote", send)).status, 201, "USDC on Solana to a Solana address");
  assert.equal((await post("quote", evm)).status, 201, "USDG on Robinhood Chain to a Robinhood Chain address");
  assert.deepEqual(JSON.parse(String(sent[0].init.body)), send, "rebuilt from ZeroFee's own fields, nothing added");
  const before = sent.length;
  const refused = async (b: unknown, why: string) => assert.equal((await post("quote", b)).status, 400, why);
  // an SPL token the core doesn't pin (BONK's 1Click id), and one made up
  await refused({ ...send, originAsset: "nep141:sol-1f5e8b1f2a0c6f0f2a6b6b1b2c8c8d7d3a5e1f00.omft.near", destinationAsset: "nep141:sol-1f5e8b1f2a0c6f0f2a6b6b1b2c8c8d7d3a5e1f00.omft.near" }, "an unpinned SPL token");
  await refused({ ...evm, originAsset: "nep141:hood-0x1111111111111111111111111111111111111111.omft.near", destinationAsset: "nep141:hood-0x1111111111111111111111111111111111111111.omft.near" }, "an unpinned ERC-20");
  await refused({ ...send, destinationAsset: "nep141:sol.omft.near" }, "pinned USDC paying out as SOL");
  await refused({ ...send, destinationAsset: "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near" }, "pinned USDC paying out as pinned USDT");
  await refused({ ...evm, destinationAsset: USDC_SOL, recipient: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK" }, "USDG to USDC on Solana: another network");
  await refused({ ...send, refundTo: EVM_WALLET }, "an EVM refund for a Solana token");
  await refused({ ...evm, refundTo: SOL_WALLET }, "a Solana refund for an ERC-20");
  assert.equal(sent.length, before, "none of these reached 1Click");
});

test("case (h): the relay's web Send tokens are exactly the core's pinned list (hidden-coins.ts), both ways, so the two can't drift", async () => {
  const { WEB_SEND_TOKENS } = await import("./web-send-coins.mjs");
  const { HIDDEN_COINS } = await import("../../packages/core/src/hidden-coins.ts");
  assert.deepEqual([...WEB_SEND_TOKENS].sort(), Object.keys(HIDDEN_COINS).sort());
  assert.ok(WEB_SEND_TOKENS.length > 0);
});

test("case (h), the audit's SHOULD: each refund wallet has its own day beside the address's (addresses rotate, wallets don't): $2,000 of quotes and 30 asks; one over is taken back off so a smaller one fits; control: another wallet is untouched", async () => {
  const send = { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: "nep141:sol.omft.near", depositType: "ORIGIN_CHAIN", destinationAsset: "nep141:sol.omft.near", amount: "50000000", refundTo: SOL_WALLET, refundType: "ORIGIN_CHAIN", recipient: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", recipientType: "DESTINATION_CHAIN", deadline: "2026-11-05T18:00:00.000Z", confidentiality: "basic" };
  let usd = "600.00";
  const { post, sent } = setup({ answer: (url) => new Response(JSON.stringify({ quote: { depositAddress: DEPOSIT, amountIn: "1000000", amountInUsd: usd }, quoteRequest: {} }), { status: url.includes("/quote") ? 201 : 200 }) });
  for (let i = 0; i < 3; i++) assert.equal((await post("quote", send)).status, 201, `$600 #${i + 1}`);
  const over = await post("quote", send);
  assert.equal(over.status, 400, "$1,800 + $600 is past the wallet's $2,000");
  assert.match(await over.text(), /a day privately/);
  usd = "150.00";
  assert.equal((await post("quote", send)).status, 201, "the refused $600 was taken back off: $150 still fits ($1,950)");
  usd = "50.00";
  assert.equal((await post("quote", send)).status, 201, "$2,000 exactly fits");
  const asked = sent.length;
  assert.equal((await post("quote", send)).status, 429, "the wallet's dollars are spent today");
  assert.equal(sent.length, asked, "and 1Click isn't asked");
  const other = { ...send, refundTo: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", recipient: SOL_WALLET };
  assert.equal((await post("quote", other)).status, 201, "control: another wallet");
  usd = "1.00";
  const third = { ...send, refundTo: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" };
  for (let i = 0; i < 30; i++) assert.equal((await post("quote", third)).status, 201, `ask #${i + 1}`);
  assert.equal((await post("quote", third)).status, 429, "the 31st ask from one wallet today");
});

test("Move's fill (QA, 5 Nov): a NEAR coin paid inside intents.near (INTENTS) into the pot itself, its own refund, goes; controls: INTENTS to another balance, INTENTS changing the coin, INTENTS with a coin from another chain, and INTENTS to a chain address are refused", async () => {
  const fill = { ...moveIn, depositType: "INTENTS", originAsset: USDC, destinationAsset: USDC };
  const ok = setup();
  assert.equal((await ok.post("quote", fill)).status, 201);
  assert.equal(ok.sent.length, 1, "forwarded to 1Click");
  const { sent, post } = setup();
  assert.equal((await post("quote", { ...fill, recipient: "a2".repeat(32) })).status, 400, "into another balance");
  assert.equal((await post("quote", { ...fill, destinationAsset: "nep141:wrap.near" })).status, 400, "changing the coin");
  assert.equal((await post("quote", { ...fill, originAsset: "nep141:sol.omft.near", destinationAsset: "nep141:sol.omft.near" })).status, 400, "a coin from another chain");
  assert.equal((await post("quote", { ...fill, recipient: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", recipientType: "DESTINATION_CHAIN" })).status, 400, "out to a chain");
  assert.equal(sent.length, 0, "nothing refused was forwarded");
});
