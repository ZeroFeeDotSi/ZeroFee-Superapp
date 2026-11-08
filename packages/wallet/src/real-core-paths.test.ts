// Real-core sign paths (QA and QA, 5 Nov): the Sim (MockBridge) skips the core's checks, so a Move the
// real core refuses (security.quote.mismatch on the fill's mt_transfer) landed on main and only showed on the phone. Here
// each money flow's EXACT tx, as the app's own builder makes it, goes through the real core's signer (the DevSigner that
// DemoCore's tx.request hands every request to: demo-core.ts "tx.request" -> ready() -> deviceSigner): describe ->
// checkIntents -> sign (a test key) -> send on a FakeChain. Never MockBridge. Each accepted flow has a control with one
// field changed (payee, amount or coin) that the core refuses before any sheet. In the full gate ('packages/**/*.test.ts').
// Type check: no tsconfig in the repo checks test files and there is no @types/node; this file is clean under
// apps/web/tsconfig.json but for node:test and node:assert (checked by hand, 5 Nov).
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { SoftwareKey } from "@zerofee/core/device-key";
import { DevSigner } from "@zerofee/core/dev-signer";
import { INTENTS, PRIVATE_POCKET, TRADING_BALANCE, type OneClickLookup } from "@zerofee/core/intents";
import { signedBy1Click } from "@zerofee/core/quote-signature";
import { signedQuote, TEST_QUOTE_KEY } from "@zerofee/core/quote-test-key";
import type { PlainWords, TxRequest } from "@zerofee/core/signer";
import { FakeChain } from "@zerofee/core/testing/fake-chain";
import { SWAP_USDC } from "./intents-swap.ts";
import { mtTransfer } from "./moves.ts";
import { fundingSteps } from "./convert.ts";

const USDC = SWAP_USDC.slice("nep141:".length);
const NEAR = "nep141:wrap.near";

/**
 * A GENUINE 1Click quote, signed by 1Click's own key (ONE_CLICK_QUOTE_KEY), recorded 27 Oct 2026 from 1Click's status
 * (core quote-signature.test.ts REAL): 1 NEAR to USDC, INTENTS in and out, paid into and refunded to the implicit account
 * eefa…e9a8 (a random account made for the check), never funded. Exactly the Safe swap's shape (safeQuoteRequest).
 */
const LIVE = {
  timestamp: "2026-10-27T17:30:56.206Z",
  signature: "ed25519:Sy8BWr8oTzLDHA8SFkANFFmCQP7wFEqmgqZPxcVSgq36nhxYPTUSJtVLDAGGQkDqb4U4cpMTH9TfJ1H5iswcSYY",
  quoteRequest: {
    dry: false, swapType: "EXACT_INPUT", depositMode: "SIMPLE", slippageTolerance: 100, originAsset: "nep141:wrap.near", depositType: "INTENTS",
    destinationAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", amount: "1000000000000000000000000",
    refundTo: "eefa2582f7054b4813d46d94475f39abd5b74144bb1cf8532de88965cdb5e9a8", refundType: "INTENTS",
    recipient: "eefa2582f7054b4813d46d94475f39abd5b74144bb1cf8532de88965cdb5e9a8", recipientType: "INTENTS", deadline: "2026-10-27T17:50:55.000Z",
    appFees: [{ limitOrderId: null, recipient: "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd", fee: 20 }],
    virtualChainRecipient: null, virtualChainRefundRecipient: null, referral: null, confidentiality: "public",
  },
  quote: {
    amountIn: "1000000000000000000000000", amountInFormatted: "1.0", amountInUsd: "4.610000000000", minAmountIn: "1000000000000000000000000",
    amountOut: "4588691", amountOutFormatted: "4.588691", amountOutUsd: "4.586465484865", minAmountOut: "4542804",
    timeWhenInactive: "2026-10-30T17:50:55.000Z", depositAddress: "8b513d9c8761018b13a538e4e5b70e899725b88920fdf1fb9100e316e8f48c0b",
    deadline: "2026-10-30T17:50:55.000Z", timeEstimate: 12, refundFee: "0", withdrawFee: "0",
  },
};
const LIVE_ACCOUNT = LIVE.quoteRequest.recipient;
const LIVE_DEPOSIT = LIVE.quote.depositAddress;

// Fake clock: inside the live quote's signed life (27 Oct, its deadline 30 Oct). Date only; timers stay real.
beforeEach(() => mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-27T17:31:00.000Z") }));
afterEach(() => mock.timers.reset());

/** The real core's signer for `accountId`, as DemoCore's deviceSigner wires it: 1Click's lookup, the core's own wallets. */
function realCore(o: { accountId: string; quoteKey?: string; lookup: OneClickLookup; ownWallets?: Map<string, string>; balances: Record<string, string>; intentOf?: Record<string, "swap" | "move"> }) {
  const chain = new FakeChain("mainnet");
  const key = SoftwareKey.generate();
  chain.fund(o.accountId, key.publicKey);
  chain.contract(INTENTS.account, INTENTS.codeHashBase58, { mt_balance_of: ({ token_id }) => o.balances[String(token_id)] ?? "0" });
  chain.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  chain.contract("wrap.near", "wrap", { ft_metadata: () => ({ symbol: "wNEAR", decimals: 24 }) });
  const shown: PlainWords[] = [];
  const signer = new DevSigner({
    accountId: o.accountId, chain, key, approve: async (w) => (shown.push(w), true), oneClick: o.lookup,
    ...(o.quoteKey ? { quoteKey: o.quoteKey } : {}), ...(o.ownWallets ? { ownWallets: async () => o.ownWallets! } : {}),
    // DemoCore's wiring (fix/bind-intent): the core's own quote doors' record of what it asked each address for
    ...(o.intentOf ? { intentOf: async (a: string) => o.intentOf![a] ?? null } : {}),
  });
  return { signer, chain, shown };
}

/** Accepted: signed and sent, one sheet. */
async function accepted(core: ReturnType<typeof realCore>, request: TxRequest) {
  const out = await core.signer.request(request);
  assert.equal(out.status, "done", JSON.stringify(out));
  assert.equal(core.chain.sent.length, 1, "sent once");
  assert.equal(core.shown.length, 1, "one sheet");
  return core.shown[0]!;
}
/** Refused by the core's own check, before any sheet and with nothing sent. */
async function refused(core: ReturnType<typeof realCore>, request: TxRequest, code: RegExp, why: string, intent?: { kind: "swap" | "move"; depositAddress?: string }) {
  const out = await core.signer.request(request, intent);
  assert.ok(out.status === "problem" && code.test(out.problem.code), `${why}: ${JSON.stringify(out)}`);
  assert.equal(core.shown.length, 0, `${why}: no sheet`);
  assert.equal(core.chain.sent.length, 0, `${why}: nothing sent`);
}
const withArgs = (r: TxRequest, over: Record<string, unknown>): TxRequest => {
  const a = r.actions[0]!;
  assert.equal(a.kind, "call");
  return { ...r, actions: [{ ...a, args: { ...(a as { args: Record<string, unknown> }).args, ...over } } as TxRequest["actions"][number], ...r.actions.slice(1)] };
};

// ── 2. Swap in the Safe (intents-swap.ts) ──────────────────────────────────────────────────────────────────────────────

/** The old public Safe swap's one step (an mt_transfer of exactly amountIn to the quote's deposit address), built here: the
 *  ledger no longer makes it (product decision, 8 Nov: every Safe swap goes through NEAR Confidential, safe-send.ts swapFromSafe), but
 *  the real core must still read it right and refuse a changed one if an app ever asks (builder 15). */
async function safeSwapSteps(): Promise<TxRequest[]> {
  return [mtTransfer({ to: LIVE_DEPOSIT, tokenId: NEAR, units: BigInt(LIVE.quote.amountIn), why: "Swap 1 in your Safe" })];
}
const liveLookup: OneClickLookup = async (a) => (a === LIVE_DEPOSIT ? { status: "PENDING_DEPOSIT", quoteResponse: LIVE } : null);
const safe = () => realCore({ accountId: LIVE_ACCOUNT, lookup: liveLookup, balances: { [NEAR]: (5n * 10n ** 24n).toString() } });

test("2. Swap in the Safe: intents-swap's own mt_transfer, on a GENUINE 1Click-signed quote (1Click's real key), is accepted by the real core, its sheet saying the amount, the Safe as payee and the refund", async () => {
  assert.equal(signedBy1Click(LIVE), true, "the fixture is 1Click's own signature");
  const [step] = await safeSwapSteps();
  assert.deepEqual([step!.receiverId, (step!.actions[0] as { method: string }).method], [INTENTS.account, "mt_transfer"]);
  const words = await accepted(safe(), step!);
  assert.equal(words.title, "Swap $4.61 (1 NEAR) for USDC", "the amount, from the signed quote");
  assert.equal(words.lines[0], "At least 4.5428 USDC lands in your Safe.", "the payee (the Safe) and the signed minimum");
  assert.equal(words.lines[1], "If it doesn't swap, your NEAR comes back to your Safe.", "the signed refund");
  assert.equal(words.amount, "about $4.61 (1 wNEAR)");
});

test("2. control: the Safe swap's tx with another amount or coin is refused by the real core; another payee (in the tx, or a forged quote) or another key is refused under the core's swap tag, never said as a plain send (fix/bind-intent)", async () => {
  const [step] = await safeSwapSteps();
  await refused(safe(), withArgs(step!, { amount: "1000000000000000000000001" }), /^security\.quote\.mismatch$/, "amount");
  await refused(safe(), withArgs(step!, { token_id: SWAP_USDC, amount: LIVE.quote.amountIn }), /^security\./, "coin");
  // the core's record: its Swap door (subwallet.safeSwapQuote) asked LIVE_DEPOSIT, so a request paying it is under the swap tag
  const asked = { [LIVE_DEPOSIT]: "swap" as const };
  const balances = { [NEAR]: (5n * 10n ** 24n).toString() };
  const changed = /^security\.intent\.changed$/;
  // payee: the quote handed back pays someone else (a relay's swap of the recipient): 1Click's signature breaks, refused
  const thief = "ee".repeat(32);
  const forged = { ...LIVE, quoteRequest: { ...LIVE.quoteRequest, recipient: thief } };
  const forgedLookup: OneClickLookup = async (a) => (a === LIVE_DEPOSIT ? { status: "PENDING_DEPOSIT", quoteResponse: forged } : null);
  await refused(realCore({ accountId: LIVE_ACCOUNT, lookup: forgedLookup, balances, intentOf: asked }), step!, changed, "a forged quote");
  // payee: the tx paid to another address than the quote's, under the core's swap tag (a core caller's, bound to its address)
  await refused(safe(), withArgs(step!, { receiver_id: thief }), changed, "another address", { kind: "swap", depositAddress: LIVE_DEPOSIT });
  // the genuine signature is believed only under 1Click's own key: under any other (the test key) it is refused
  await refused(realCore({ accountId: LIVE_ACCOUNT, lookup: liveLookup, quoteKey: TEST_QUOTE_KEY, balances, intentOf: asked }), step!, changed, "under another key");
  // untagged (no record, no tag: the plain Send door), the same address keeps its outside sheet
  const fw = await realCore({ accountId: LIVE_ACCOUNT, lookup: forgedLookup, balances }).signer.describe(step!);
  assert.equal(fw.title, `Send 1 wNEAR to ${LIVE_DEPOSIT}`);
  assert.ok(fw.warnings.some((x) => x.kind === "first-time-recipient"), "flagged as a first-time payee");
});

// ── 8. Move via Private: the Safe's fill (to-private.ts payIntoPocket -> convert.ts fundingSteps "intents", moveFill) ──

const SAFE = "kim.near";
const POCKET = "a1".repeat(32);
const FILL_DEPOSIT = "1c".repeat(32);
const SOON = new Date(Date.parse("2026-10-27T17:31:00.000Z") + 10 * 60_000).toISOString();
/** No genuine 1Click quote can pay a pocket made here (1Click signs only what it was asked), so this one is signed by the
 *  test key, through the same signature check (DemoCore's quoteKey option): subwallets privateQuoteIn with `intents`. */
const fillQuote = signedQuote({
  quoteRequest: { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: SWAP_USDC, depositType: "INTENTS", destinationAsset: SWAP_USDC, amount: "20000000", refundTo: POCKET, refundType: "CONFIDENTIAL_INTENTS", recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS", deadline: SOON, confidentiality: "basic" },
  quote: { depositAddress: FILL_DEPOSIT, amountIn: "20000000", minAmountOut: "19800000", deadline: SOON },
}, "2026-10-27T17:30:30.000Z");
const fillStep = (): TxRequest => {
  // to-private.ts:133, exactly: fundingSteps(route "intents"), the last step marked moveFill
  const steps = fundingSteps("intents", { tokenId: SWAP_USDC, units: 20_000_000n, depositAddress: FILL_DEPOSIT, registered: true, storageYocto: "0", me: SAFE, why: "Move $20.00" })
    .map((s, i, all) => (i === all.length - 1 ? { ...s, moveFill: true as const } : s));
  assert.equal(steps.length, 1);
  return steps[0]!;
};
const fillCore = () => realCore({ accountId: SAFE, quoteKey: TEST_QUOTE_KEY, lookup: async (a) => (a === FILL_DEPOSIT ? { status: "PENDING_DEPOSIT", quoteResponse: fillQuote } : null), ownWallets: new Map([[POCKET, PRIVATE_POCKET]]), balances: { [SWAP_USDC]: "900000000" } });

// Refused on train 21b (security.quote.mismatch: checkIntents' intoOwn took only ft_withdraw or a plain ft_transfer), the
// bug that reached the phone; accepted since the hotfix, train 21h (75d827dd5). The same fill pays a site's top-up when
// Private is short (private-move.ts sendFromSafe, fillOpen + whole) and Home's Send from the Safe with `fill` (ledger.ts).
test("8. Move via Private (and 4. a site top-up's fill): the Safe's one mt_transfer into its own pocket (fundingSteps 'intents', moveFill) is accepted by the real core, its sheet naming Private and the amount", async () => {
  const w = await accepted(fillCore(), fillStep());
  assert.equal(w.title, "Move $20.00 to Private");
  assert.equal(w.amount, "$20.00 (20 USDC)");
  assert.ok(w.lines.includes("At least 19.8 USDC lands in your private balance. The swap service promises it."), String(w.lines));
  assert.ok(w.lines.includes("If it can't, the money comes back to your private balance"), "the signed refund: Private");
});

test("8. control: the Move fill with another amount, coin or pocket is refused by the real core", async () => {
  await refused(fillCore(), withArgs(fillStep(), { amount: "20000001" }), /^security\.quote\.mismatch$/, "amount");
  await refused(fillCore(), withArgs(fillStep(), { token_id: NEAR }), /^security\./, "coin");
  await refused(realCore({ accountId: SAFE, quoteKey: TEST_QUOTE_KEY, lookup: async (a) => (a === FILL_DEPOSIT ? { status: "PENDING_DEPOSIT", quoteResponse: fillQuote } : null), balances: { [SWAP_USDC]: "900000000" } }), fillStep(), /^security\.quote\.mismatch$/, "a pocket not on the core's own list");
});

// ── 1. Add from the Safe: into the NEAR wallet (ledger.ts:1840 trading Add) and into Private (to-private payIntoPocket,
// route B). Both pay a confidential quote the core asked for itself (relay rule (b): recipient === refundTo, one of the
// core's own wallets), by ft_withdraw out of NEAR Intents, or for NEAR on the account by wrap.near's own ft_transfer. ──

const FLOAT = "f1".repeat(32);
const ADD_DEPOSIT = "ad".repeat(32);
const addQuote = (o: { origin: string; amount: string; to: string }) => signedQuote({
  quoteRequest: { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: o.origin, depositType: "ORIGIN_CHAIN", destinationAsset: SWAP_USDC, amount: o.amount, refundTo: o.to, refundType: "CONFIDENTIAL_INTENTS", recipient: o.to, recipientType: "CONFIDENTIAL_INTENTS", deadline: SOON, confidentiality: "basic" },
  quote: { depositAddress: ADD_DEPOSIT, amountIn: o.amount, minAmountOut: "9900000", deadline: SOON },
}, "2026-10-27T17:30:30.000Z");
const addCore = (q: ReturnType<typeof addQuote>, own: Map<string, string>) => {
  const lookup: OneClickLookup = async (a) => (a === ADD_DEPOSIT ? { status: "PENDING_DEPOSIT", quoteResponse: q } : null);
  const c = realCore({ accountId: SAFE, quoteKey: TEST_QUOTE_KEY, lookup, ownWallets: own, balances: { [SWAP_USDC]: "900000000" } });
  return c;
};
// ledger.ts:1840 and to-private.ts:133, exactly: fundingSteps("near-ledger"), the deposit address already registered
const ledgerAdd = (why: string) => fundingSteps("near-ledger", { tokenId: SWAP_USDC, units: 10_000_000n, depositAddress: ADD_DEPOSIT, registered: true, storageYocto: "0", me: SAFE, why });

test("1. Add from the Safe into the NEAR wallet (ft_withdraw out of NEAR Intents to the core's own quote) is accepted by the real core, its sheet naming the NEAR wallet and the amount", async () => {
  const steps = ledgerAdd("Move 10 USDC to your NEAR wallet");
  assert.deepEqual(steps.map((s) => (s.actions[0] as { method: string }).method), ["ft_withdraw"]);
  const w = await accepted(addCore(addQuote({ origin: SWAP_USDC, amount: "10000000", to: FLOAT }), new Map([[FLOAT, TRADING_BALANCE]])), steps[0]!);
  assert.equal(w.title, "Move 10 USDC to your NEAR wallet", "the payee (the core's own wallet) and the amount");
  assert.deepEqual(w.lines, ["From your Safe."]);
});

test("1. Add from the Safe into Private (route B, ft_withdraw) is accepted by the real core, its sheet naming Private", async () => {
  const w = await accepted(addCore(addQuote({ origin: SWAP_USDC, amount: "10000000", to: POCKET }), new Map([[POCKET, PRIVATE_POCKET]])), ledgerAdd("Move 10 USDC to Private")[0]!);
  assert.match([w.title, ...w.lines].join(" | "), /[Pp]rivate/, w.title);
});

test("1. control: the Add with another amount, coin, or into a wallet that isn't the core's own is refused by the real core", async () => {
  const q = addQuote({ origin: SWAP_USDC, amount: "10000000", to: FLOAT });
  const own = new Map([[FLOAT, TRADING_BALANCE]]);
  const [step] = ledgerAdd("Move 10 USDC to your NEAR wallet");
  await refused(addCore(q, own), withArgs(step!, { amount: "10000001" }), /^security\.quote\.mismatch$/, "amount");
  await refused(addCore(q, own), withArgs(step!, { token: "wrap.near" }), /^security\./, "coin");
  await refused(addCore(q, new Map()), step!, /^security\.quote\.mismatch$/, "payee: a wallet not on the core's own list");
});

// ── 8 and 3/4 through the app's own entry (5 Nov): the phone's Move failed BEFORE checkIntents, at the
// core's join (send-words.ts throughJoinRefusal, via SubWallets.privatePay with inDeposit). So here the Safe's leg 1 is
// the core's own quote (SubWallets.privateQuoteIn, `intents` as safe-send.ts fromSafe asks it), the pocket's payment
// joins it (privatePay with inDeposit), and only then the fill tx goes through the signer wired as DemoCore's
// deviceSigner wires it (ownWallets from the core's list, ownQuote = privateInFacts, privateLeg = the join's record).
// FAILS on main without hotfix 21h2 (56790bff9, fix/intents-mt-fill: the join took leg 1 ORIGIN_CHAIN only); passes with it.

const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const SOL_IN = "nep141:sol.omft.near";
const OUT = "d".repeat(64);
const STRANGER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

async function appEntry(o: { to: "own" | "outside"; intents: boolean }) {
  const { SubWallets } = await import("@zerofee/core/subwallets");
  const { MemoryVault } = await import("@zerofee/core/vault");
  const { base64 } = await import("@zerofee/core/sol/bytes");
  const deadline = new Date(Date.now() + 10 * 60_000).toISOString();
  const quoted = new Map<string, Record<string, unknown>>();
  let n = 0, pocket = "", payee = "";
  const relay = {
    quote: async (req: Record<string, unknown>) => {
      const depositAddress = `${(n++).toString(16).padStart(2, "0")}${"e".repeat(62)}`;
      quoted.set(depositAddress, req);
      return { quote: { depositAddress }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async () => null, submitIntent: async () => null, status: async () => null,
  };
  // 1Click's status, as it signs it: leg 2's quote (the pocket to the payee), and leg 1 read back as it was asked
  const privateStatus = async (a: string) => {
    if (a === OUT) return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({
      quoteRequest: { dry: false, originAsset: SWAP_USDC, destinationAsset: SOL_IN, refundTo: pocket, refundType: "CONFIDENTIAL_INTENTS", recipient: payee, recipientType: "DESTINATION_CHAIN", depositType: "CONFIDENTIAL_INTENTS", deadline, swapType: "EXACT_INPUT", confidentiality: "basic" },
      quote: { depositAddress: OUT, amountIn: "19800000", amountInUsd: "19.80", minAmountOut: "100000000", amountOut: "101000000", deadline },
    }) };
    const req = quoted.get(a);
    return req ? { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({ quoteRequest: req, quote: { depositAddress: a, amountIn: req.amount, amountInUsd: "20.00", minAmountOut: ((BigInt(String(req.amount)) * 99n) / 100n).toString(), deadline } }) } : null;
  };
  const sol = { balance: async () => 10n ** 12n, latestBlockhash: async () => "11111111111111111111111111111111", send: async () => true, status: async () => ["ok", "ok"] };
  const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {}, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY, floatRelay: relay, privateStatus, pocketUsd: async () => 0, confirm: { everyMs: 1, forMs: 5 } } as never);
  const p = await w.create("private", "near");
  pocket = p.address;
  const solWallet = (await w.create("trade", "sol")).address;
  payee = o.to === "own" ? solWallet : STRANGER;
  // safe-send.ts fromSafe: leg 1, then leg 2 joined to it
  const leg1 = await w.privateQuoteIn(SWAP_USDC, "20000000", false, true, o.intents);
  const intent = { payload: { message: JSON.stringify({ deadline, intents: [{ intent: "transfer", receiver_id: OUT, tokens: { [`imt:${MINTER}:${SWAP_USDC}`]: "19800000" } }], signer_id: pocket }), nonce: base64(new Uint8Array(32).fill(3)), recipient: "intents.far" } };
  const two = (await w.privatePay(p.id, OUT, intent, "Move", "tag-for-this-quote-0001", leg1.depositAddress, undefined, { recipient: payee, recipientType: "DESTINATION_CHAIN", destinationAsset: SOL_IN })) as { signedData?: { signature?: string } };
  assert.ok(two.signedData?.signature, "leg 2 joined and signed");
  // to-private.ts payIntoPocket: the fill tx for leg 1's own deposit address (route "intents", or route B)
  const fill = fundingSteps(o.intents ? "intents" : "near-ledger", { tokenId: SWAP_USDC, units: BigInt(leg1.amountIn), depositAddress: leg1.depositAddress, registered: true, storageYocto: "0", me: SAFE, why: "Move $20.00" })
    .map((s) => ({ ...s, moveFill: true as const }))[0]!;
  // DemoCore's deviceSigner, wired to this core (demo-core.ts: ownWallets, oneClick via ownQuote, ownQuote, privateLeg)
  const chain = new FakeChain("mainnet");
  const key = SoftwareKey.generate();
  chain.fund(SAFE, key.publicKey);
  chain.contract(INTENTS.account, INTENTS.codeHashBase58, { mt_balance_of: () => "900000000" });
  chain.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }), storage_balance_of: () => ({ total: "1", available: "0" }) });
  const names = (x: { kind: string; chain: string }) => (x.kind === "private" ? PRIVATE_POCKET : x.kind === "trade" && x.chain === "near" ? TRADING_BALANCE : x.chain === "sol" ? "your SOL wallet" : `your ${x.chain} wallet`);
  const shown: PlainWords[] = [];
  const own = (a: string) => w.privateInFacts(a);
  const signer = new DevSigner({
    accountId: SAFE, chain, key, approve: async (x) => (shown.push(x), true), quoteKey: TEST_QUOTE_KEY,
    ownWallets: async () => new Map((await w.list()).map((x: { address: string; kind: string; chain: string }) => [x.address, names(x)])),
    oneClick: async (a) => (await own(a)) ?? null, ownQuote: own, privateLeg: async (a) => w.privateLeg(a),
    // fix/bind-intent: the core's own record of what its Swap and Move doors asked (demo-core.ts intentOf): the fill is under the move tag
    intentOf: (a) => w.intentOf(a),
  });
  return { core: { signer, chain, shown }, fill, leg1 };
}

test("8. Move via Private through the app's own entry (leg 1 privateQuoteIn intents → privatePay with inDeposit → the fill's mt_transfer): joined and accepted by the real core, the sheet naming the person's SOL wallet and the amount [fails on main without 21h2]", async () => {
  const { core, fill } = await appEntry({ to: "own", intents: true });
  const w = await accepted(core, fill);
  assert.equal(w.title, "Move $19.80 to your SOL wallet", "the Move's payee, the person's own wallet, and what it pays");
  assert.equal(w.amount, "about $20.00 (20 USDC)", "what leaves the Safe");
  assert.ok(w.lines.includes("At least 19.8 USDC lands in your private balance. The swap service promises it."), String(w.lines));
});

test("3/4. Send from the Safe via Private (a site's top-up or a payee) through the same entry (leg 2 to an outside payee): joined and accepted by the real core, the Safe's sheet saying its own leg into Private and the amount [fails on main without 21h2]", async () => {
  const { core, fill } = await appEntry({ to: "outside", intents: true });
  const w = await accepted(core, fill);
  assert.equal(w.title, "Move $20.00 to Private", "the Safe's own leg: into Private");
  assert.equal(w.amount, "about $20.00 (20 USDC)");
});

test("control: route B (leg 1 ORIGIN_CHAIN, ft_withdraw) through the same entry is accepted, as before 21h2; the fill with another amount is refused", async () => {
  const b = await appEntry({ to: "own", intents: false });
  await accepted(b.core, b.fill);
  const t = await appEntry({ to: "own", intents: true }).catch((e) => e);
  if (t instanceof Error || !("fill" in t)) return; // without 21h2 the join refuses first: the tests above say so
  // under the core's move tag (its own record of leg 1), another amount is that move changed (fix/bind-intent)
  await refused(t.core, withArgs(t.fill, { amount: String(BigInt(t.leg1.amountIn) + 1n) }), /^security\.intent\.changed$/, "amount");
});

// ── From the app's own entry: the ledger's Move (Move sheet → "spending.topUp"/"ledger.moveFromPrivate", private-move.ts),
// Home's Send from the Safe ("ledger.sendFromSafe", safe-send.ts) — the real ledger service, its real safe-send and
// to-private code, against the REAL core for every money call DemoCore routes (demo-core.ts:1478 privateQuoteIn,
// :1558 privatePay, :1636 tx.request → the deviceSigner): join (send-words.ts) → quote check → describe → checkIntents →
// sign. Only reads the core answers for the screens (account.state, list, balances) come from the replay core.
// FAILS on main ff77b6a01 without 737644f57 (fix/intents-join-intents: the join took leg 1 ORIGIN_CHAIN only); passes with it.

async function ledgerEntry(o: { pocketUnits: string; solNamed?: boolean; /** the Safe's coin that pays (USDC by default; NEAR: T-F, 6 Nov) */ coin?: string; /** the Safe's NEAR on the account ("near"), not in NEAR Intents */ onAccount?: boolean; /** the Safe on wrap.near (onAccount): set up, not (the default), or its read fails */ wrap?: "registered" | "unregistered" | "fails"; /** what reaches the core instead of the app's own request */ tamper?: (r: TxRequest) => TxRequest; /** the NEAR wallet (the float) set up, and the relay answering the core's own Add quote (subwallet.float.quoteAdd), as the core reads it */ float?: boolean }) {
  const COIN = o.coin ?? SWAP_USDC;
  const { SubWallets } = await import("@zerofee/core/subwallets");
  const { MemoryVault } = await import("@zerofee/core/vault");
  const { base64 } = await import("@zerofee/core/sol/bytes");
  const { createLedgerService } = await import("./ledger.ts");
  const { createApis } = await import("./apis.ts");
  const { fakeCore, fakeNear, replayFetch, QUOTE_ADDRESS } = await import("./testing/replay.ts");
  const ME = "kid.near", RELAY = "https://quotes.example";
  const asked: Record<string, any>[] = [];
  const quoted = new Map<string, Record<string, unknown>>();
  let n = 0, pocket = "";
  const sign = (req: Record<string, any>, dep: string, amountOut: string, minOut: string) => signedQuote({ quoteRequest: req, quote: { depositAddress: dep, amountIn: req.amount, amountInUsd: "1.00", amountOutUsd: ((Number(req.amount) * 0.99) / 1e6).toFixed(2), amountOut, minAmountOut: minOut, deadline: req.deadline } });
  const relay = {
    quote: async (req: Record<string, unknown>) => {
      const depositAddress = `${(n++).toString(16).padStart(2, "0")}${"e".repeat(62)}`;
      quoted.set(depositAddress, req);
      return { quote: { depositAddress }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async () => null, submitIntent: async () => null,
    // the Add's quote read back through the relay as 1Click signs it (float-moves.ts quoteAdd, addFacts); off by default
    status: async (a: string) => {
      const req = o.float ? quoted.get(a) : undefined;
      return req ? { status: "PENDING_DEPOSIT", quoteResponse: sign(req as Record<string, any>, a, ((BigInt(String(req.amount)) * 99n) / 100n).toString(), "10000000") } : null;
    },
  };
  // 1Click's status as it signs it: leg 1 (the core's own ask) and leg 2 (the ledger's ask), each read back as asked
  const privateStatus = async (a: string) => {
    const req = quoted.get(a) ?? asked.find((q) => !q.dry && q.__dep === a);
    if (!req) return null;
    const { __dep, ...clean } = req as Record<string, any>;
    return { status: "PENDING_DEPOSIT", quoteResponse: sign(clean, a, ((BigInt(clean.amount) * 99n) / 100n).toString(), ((BigInt(clean.amount) * 98n) / 100n).toString()) };
  };
  const sol = { balance: async () => 10n ** 12n, latestBlockhash: async () => "11111111111111111111111111111111", send: async () => true, status: async () => ["ok", "ok"] };
  const chain = new FakeChain("mainnet");
  const key = SoftwareKey.generate();
  chain.fund(ME, key.publicKey, o.onAccount ? 100n : undefined);
  // the core's own reads for a Move's plan (the audit's MUST, 7 Nov): Private as the screens' ledger holds it, the Safe on the
  // same chain the signer reads, wNEAR at 1Click's price (the catalogue's)
  const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {}, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY, floatRelay: relay, privateStatus, pocketUsd: async () => 0, pocketHeld: async (t: string) => (t === COIN ? BigInt(o.pocketUnits) : 0n), near: chain, mainAccount: async () => ME, tokenPrice: async (t: string) => (t === NEAR ? { usd: 4.39, decimals: 24 } : null), confirm: { everyMs: 1, forMs: 5 } } as never);
  const p = await w.create("private", "near");
  pocket = p.address;
  await w.create("trade", "sol");
  if (o.float) await w.create("trade", "near");
  const list = (await w.list()) as { id: string; kind: string; chain: string; address: string }[];
  // the real core's signer, as DemoCore's deviceSigner wires it
  chain.contract(INTENTS.account, INTENTS.codeHashBase58, { mt_balance_of: () => (COIN === NEAR && !o.onAccount ? (100n * 10n ** 24n).toString() : "500000000") });
  chain.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  if (COIN === NEAR) chain.contract("wrap.near", "wrap", { ft_metadata: () => ({ symbol: "wNEAR", decimals: 24 }) });
  // the payout's coin, named with its decimals (the audit's ruling, 5 Nov: unnamed, the fill is refused before its sheet)
  if (o.solNamed) chain.contract("sol.omft.near", "sol", { ft_metadata: () => ({ symbol: "SOL", decimals: 9 }) });
  const names = (x: { kind: string; chain: string }) => (x.kind === "private" ? PRIVATE_POCKET : x.kind === "trade" && x.chain === "near" ? TRADING_BALANCE : x.chain === "sol" ? "your SOL wallet" : `your ${x.chain} wallet`);
  // DemoCore's ownQuote (demo-core.ts): the Add's quote, then Private's move in
  const shown: PlainWords[] = [];
  /** the core's approval.asked and job.signed (demo-core.ts onAsked, onSigned) around each sheet, in order */
  const events: string[] = [];
  const own = async (a: string) => (await w.floatAddFacts(a)) ?? (await w.privateInFacts(a));
  const signer = new DevSigner({
    accountId: ME, chain, key, approve: async (x) => (shown.push(x), events.push("sheet"), true), quoteKey: TEST_QUOTE_KEY,
    onAsked: (j) => events.push(`asked:${j}`), onSigned: (j) => events.push(`signed:${j ?? ""}`),
    ownWallets: async () => new Map(list.map((x) => [x.address, names(x)])), oneClick: own, ownQuote: own, privateLeg: async (a) => w.privateLeg(a), sendPayout: async (a) => w.sendPayout(a),
    // fix/bind-intent: the core's own record of what its Swap and Move doors asked (demo-core.ts intentOf)
    intentOf: (a) => w.intentOf(a),
  });
  const screens = fakeCore({ accountId: ME, pocket: [{ tokenId: COIN, amount: o.pocketUnits }], subwallets: list as never });
  const real: string[] = [];
  /** each tx the real core was asked to sign: its methods and the core's answer */
  const txs: { methods: string[]; args: Record<string, unknown>[]; outcome: { status?: string; problem?: { code: string } } }[] = [];
  const route = async (m: string, q: Record<string, any>) => {
    if (m === "subwallet.private.quoteIn") return { ok: await w.privateQuoteIn(q.tokenId, q.amount, q.outside === true, q.through === true, q.intents === true, q.job) };
    if (m === "subwallet.movePlan") return { ok: await w.movePlan(q.job, q.tokenId, q.parts, q.share, q.price, q.decimals, q.whole, q.safeHas) };
    if (m === "subwallet.float.quoteAdd" && o.float) return { ok: await w.floatQuoteAdd(q.amount, q.tokenId, q.job) };
    if (m === "subwallet.privatePay") return { ok: await w.privatePay(q.id, q.depositAddress, q.intent, q.why, q.statusTag, q.inDeposit, q.send === true, q.payee, q.pair === true && q.app === "wallet", q.job) };
    if (m === "tx.request") {
      const req = o.tamper ? o.tamper(q.request as TxRequest) : (q.request as TxRequest);
      const out = await signer.request(req);
      txs.push({ methods: req.actions.map((a: any) => a.method), args: req.actions.map((a: any) => a.args), outcome: out as any });
      return { ok: out };
    }
    return null;
  };
  const bridgeFor = (app: string) => ({
    call: async (m: string, q?: Record<string, unknown>) => {
      try {
        const r = await route(m, { ...(q ?? {}), app });
        if (r) { real.push(m); return r; }
      } catch (e) {
        real.push(`${m}!`);
        return { problem: (e as { problem?: unknown }).problem ?? { code: String(e) } };
      }
      return screens.call(m, { ...(q ?? {}), app });
    },
    on: (e: string, h: (v: unknown) => void) => screens.on(e, h),
  }) as never;
  const base = createApis(replayFetch({ privateQuotes: `${RELAY}/v0` }));
  let k = 0;
  const apis = {
    ...base,
    quote: async (req: any) => {
      const dep = req.dry ? undefined : `${(0x80 + k++).toString(16)}${"d".repeat(62)}`;
      asked.push({ ...req, __dep: dep });
      return { quote: { depositAddress: dep, amountIn: req.amount, amountOut: ((BigInt(req.amount) * 99n) / 100n).toString(), minAmountOut: ((BigInt(req.amount) * 98n) / 100n).toString() }, zerofeeStatusTag: "tag-for-this-quote-0001" } as any;
    },
    generateIntent: async (_via: string, signerId: string, dep: string) => {
      const req = asked.find((q) => q.__dep === dep)!;
      return { payload: { message: JSON.stringify({ deadline: req.deadline, intents: [{ intent: "transfer", receiver_id: dep, tokens: { [`imt:${MINTER}:${req.originAsset ?? SWAP_USDC}`]: req.amount } }], signer_id: signerId }), nonce: base64(new Uint8Array(32).fill(3)), recipient: "intents.far" } };
    },
    submitIntent: async () => ({ intentHash: "h" }),
    status: async () => ({ status: "SUCCESS" }) as any,
  };
  const ledger = createLedgerService({ bridgeFor, chain: fakeNear(ME, o.onAccount ? { ledger: {}, nearYocto: 100n * 10n ** 24n, ...(o.wrap === "registered" ? {} : o.wrap === "fails" ? { storageReadFails: true } : { unregistered: ["wrap.near"] }) } : { ledger: COIN === NEAR ? { [NEAR]: (100n * 10n ** 24n).toString() } : { [SWAP_USDC]: "500000000" } }, { [QUOTE_ADDRESS]: { ledger: {} } }), apis, routes: { intents: false, nearOrigin: false }, trackMs: 2, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY, safeFillOpen: true } as never);
  const sol1 = list.find((x) => x.kind === "trade" && x.chain === "sol")!;
  return { ledger, shown, real, txs, sol1, events, pocket: () => pocket, sent: () => chain.sent.length };
}
const said = (r: any) => ("problem" in r ? `${r.problem.code}: ${r.problem.whatHappened} ${r.problem.more ?? ""}` : "");

test("ENTRY 8. Move via Private with the Safe's top-up, from the ledger's own Move (ledger.moveFromPrivate, fill open): Private's share, the join, the Safe's fill, all through the real core; one Safe sheet titled as the Move [fails on main without 737644f57]", async () => {
  const s = await ledgerEntry({ pocketUnits: "12500000" });
  const r = await s.ledger.call<any>("ledger.moveFromPrivate", { parts: [{ wallet: s.sol1.id, usd: 30 }], job: "move-private-0123456789abcdef0123", caller: "trade" });
  assert.ok("ok" in r && !r.ok.parts.some((x: any) => x.stopped), `${said(r)} ${JSON.stringify("ok" in r ? r.ok : null)} via ${s.real.join(", ")}`);
  assert.ok(s.real.includes("subwallet.privatePay") && s.real.includes("subwallet.private.quoteIn") && s.real.includes("tx.request"), s.real.join(", "));
  assert.equal(s.shown.length, 1, "one Safe sheet");
  assert.match(s.shown[0]!.title, /^Move \$[\d.]+ to your SOL wallet$/, s.shown[0]!.title);
  assert.equal(s.sent(), 1, "the fill sent");
});

test("the audit's MUST (7 Nov): a Move via Private whose Safe fills it after all (ledger.moveFromPrivate with its job key): the Safe's request carries the key, and the real core says approval.asked with it just before the one sheet, then job.signed with it (control: a Send from the Safe, no job, says none)", async () => {
  const s = await ledgerEntry({ pocketUnits: "12500000" });
  const job = "home-swap-2123456789abcdef01234567";
  const r = await s.ledger.call<any>("ledger.moveFromPrivate", { parts: [{ wallet: s.sol1.id, usd: 30 }], job, caller: "trade" });
  assert.ok("ok" in r && !r.ok.parts.some((x: any) => x.stopped), `${said(r)} via ${s.real.join(", ")}`);
  assert.deepEqual(s.events, [`asked:${job}`, "sheet", `signed:${job}`]);
  const c = await ledgerEntry({ pocketUnits: "0", solNamed: true });
  const rc = await c.ledger.call<any>("ledger.sendFromSafe", { tokenId: SWAP_USDC, amount: "20", to: { kind: "chain", chain: "sol", address: STRANGER }, fill: true }, "wallet" as never);
  assert.ok("ok" in rc, said(rc));
  assert.deepEqual(c.events, ["sheet", "signed:"], "a Send that names no job: nothing asked by key");
});

test("the audit's MUST, B13's one fill (7 Nov): a two-part Move (fillMove: one leg 1, both legs held) says approval.asked with the Move's key once, just before its ONE sheet", async () => {
  const s = await ledgerEntry({ pocketUnits: "12500000", solNamed: true, float: true });
  const job = "home-move-3123456789abcdef01234567";
  const r = await s.ledger.call<any>("ledger.moveFromPrivate", { parts: [{ wallet: s.sol1.id, usd: 30 }, { wallet: "near", usd: 5 }], job, caller: "trade" });
  assert.ok("ok" in r && !r.ok.parts.some((x: any) => x.stopped), `${said(r)} via ${s.real.join(", ")}`);
  assert.equal(s.shown.length, 1, "one Safe sheet");
  assert.deepEqual(s.events, [`asked:${job}`, "sheet", `signed:${job}`]);
});

test("the audit's MUST (7 Nov): the Safe's Send with the fill (ledger.sendFromSafe with its job) and the Safe's Add to the NEAR wallet (ledger.toTrading with its job: Swap's and the top-up's way) each say approval.asked with their own key just before their one sheet, then job.signed with it", async () => {
  const c = await ledgerEntry({ pocketUnits: "0", solNamed: true });
  const send = "home-send-4123456789abcdef01234567";
  const rc = await c.ledger.call<any>("ledger.sendFromSafe", { tokenId: SWAP_USDC, amount: "20", to: { kind: "chain", chain: "sol", address: STRANGER }, fill: true, job: send }, "wallet" as never);
  assert.ok("ok" in rc, said(rc));
  assert.deepEqual(c.events, [`asked:${send}`, "sheet", `signed:${send}`]);
  const a = await ledgerEntry({ pocketUnits: "0", coin: NEAR, onAccount: true, float: true });
  const add = "home-swap-5123456789abcdef01234567";
  const ra = await a.ledger.call<any>("ledger.toTrading", { amount: "5", tokenId: "near", caller: "trade", job: add });
  assert.ok("ok" in ra, said(ra));
  assert.deepEqual(a.events, [`asked:${add}`, "sheet", `signed:${add}`]);
});

test("the audit's SHOULD (7 Nov): Home's and Trade's Safe-only \"Move to your NEAR wallet\" each ask spending.topUp with their own job key (topUpAsk), which the core hands its engine's Add and the real ledger's toTrading puts on the Safe's request: the real core says approval.asked with that key just before the one sheet, then job.signed with it (control: the old ask, no key, says none) [fails before: the sheets sent no key]", async () => {
  const { createSpendingService } = await import("@zerofee/core/spending");
  const { topUpAsk } = await import("@zerofee/shell-api/topup-ask.ts");
  /** the core's spending.topUp over the real ledger and core: the engine's Add asks ledger.toTrading with the call's key
   *  (float-core.ts add: `job: jobKey` on the Add's ask), as the app's engine does */
  const topUp = async (params: Record<string, unknown>) => {
    const a = await ledgerEntry({ pocketUnits: "0", coin: NEAR, onAccount: true, float: true });
    const engine = {
      snapshot: () => ({ loaded: true, totalUsd: 0, reserveUsd: 0, takeableUsd: 0, chains: [], moves: [] }),
      subscribe: () => () => undefined, refresh: async () => undefined, setCap() {},
      async add(usd: number, _from: unknown, _ready: unknown, _legs: unknown, _then: unknown, _asker: unknown, jobKey?: string) {
        const r = await a.ledger.call<any>("ledger.toTrading", { amount: "5", tokenId: "near", caller: "trade", ...(jobKey ? { job: jobKey } : {}) });
        assert.ok("ok" in r, said(r));
        return { id: `mv-${jobKey ?? "x"}`, kind: "add", usd, status: "moving", at: 0 };
      },
      async takeOut() { throw new Error("not here"); }, async moveNow() { throw new Error("not here"); },
    };
    const store = new Map<string, string>();
    const svc = createSpendingService({
      engine: () => engine as never,
      async call<T>(method: string, q: Record<string, unknown>): Promise<T> {
        if (method === "device.store.get") return { value: store.get(String(q.key)) ?? null } as T;
        if (method === "device.store.set") { store.set(String(q.key), String(q.value)); return { ok: true } as T; }
        if (method === "account.protection.get") return { bands: [{ up_to: null, level: "FaceId" }], usd: [{ upToUsd: 500, level: "faceid" }] } as T;
        if (method === "ledger.balances") return [{ tokenId: "near", symbol: "NEAR", amount: "40", usd: "160", listed: true }] as T;
        throw new Error(`no answer for ${method}`);
      },
    });
    const r = await svc.call("spending.topUp", params);
    assert.ok("ok" in r, JSON.stringify(r));
    return a;
  };
  for (const prefix of ["home-topup", "trade-topup"]) {
    const ask = topUpAsk(new Map(), "5", prefix);
    assert.match(ask.key, new RegExp(`^${prefix}-[0-9a-f]{24}$`));
    const a = await topUp(ask.params);
    assert.equal(a.shown.length, 1, `${prefix}: one Safe sheet`);
    assert.deepEqual(a.events, [`asked:${ask.key}`, "sheet", `signed:${ask.key}`], prefix);
  }
  // control: the ask as both sheets made it before (no key): the core names no job, so runJob had nothing to match
  const old = await topUp({ usd: "5" });
  assert.deepEqual(old.events, ["sheet", "signed:"]);
});

test("ENTRY 3. Send from the Safe with the fill (ledger.sendFromSafe, fill), to an outside Solana payee, Private empty: leg 1, the join, the payout bound, the Safe's fill under one sheet naming the payee, all through the real core (SAFE_SEND_FILL_OPEN)", async () => {
  const s = await ledgerEntry({ pocketUnits: "0", solNamed: true });
  const r = await s.ledger.call<any>("ledger.sendFromSafe", { tokenId: SWAP_USDC, amount: "20", to: { kind: "chain", chain: "sol", address: STRANGER }, fill: true }, "wallet" as never);
  assert.ok("ok" in r, `${said(r)} via ${s.real.join(", ")}`);
  assert.ok(s.real.includes("subwallet.privatePay") && s.real.includes("tx.request"), s.real.join(", "));
  assert.equal(s.shown.length, 1, "one Safe sheet");
  // the bound sheet (feat/safe-send-fill, QA's MUST 1): the Send, the Safe's whole step over the $20 payout,
  // the full address first, unfolded, then where it lands (the audit's D37 condition, the copy review's words)
  assert.match(s.shown[0]!.title, /^Send \$[\d.]+ from your Safe$/, s.shown[0]!.title);
  // the UI lead's ruling (5 Nov): what they get (the payout's amountIn), what the Safe sends, what stays; Y = Z + T + the move in's own cost
  const legs = s.shown[0]!.lines.filter((l) => /^(They get|Your Safe sends|Private keeps the rest|Stays in Private|From your Safe|Together|Fees) · /.test(l));
  assert.match(legs[0]!, /^They get · \d[\d,]*(\.\d{1,4})? SOL \(about \$19\.40\)$/, `the named coin's signed figure, then what it is worth to them: ${legs[0]}`);
  assert.deepEqual(legs.slice(1), ["From your Safe · $30.00", "Private keeps the rest · about $10.10", "Fees · about $0.50"], "the fill: a whole step over the $20 payout; the move in brings $29.70 (audit, 6 Nov: its $0.30 is a fee, not money staying); $30.00 = $10.10 + T $19.60 + $0.30; T $19.60 = $19.40 + $0.20");
  assert.ok(!s.shown[0]!.lines.some((l) => /unnamed coin/.test(l)), "control: never the unnamed words");
  assert.deepEqual(s.shown[0]!.lines.slice(0, 2), [`To ${STRANGER}`, "Public on Solana. Anyone can see the Safe's part on NEAR."], s.shown[0]!.lines.join(" | ")); // the copy review (6 Nov): one public line
  assert.equal(s.shown[0]!.hint, `Wallet says: Send 20 USDC to ${STRANGER}`);
  assert.equal(s.sent(), 1, "the fill sent");
});

test("ENTRY 3, unnamed (the audit's ruling, 5 Nov): the payout lands as a coin the core can't name with its decimals: refused before the sheet, nothing signed, never \"an amount of an unnamed coin\" (control: ENTRY 3, named, shows its sheet)", async () => {
  const s = await ledgerEntry({ pocketUnits: "0" });
  const r = await s.ledger.call<any>("ledger.sendFromSafe", { tokenId: SWAP_USDC, amount: "20", to: { kind: "chain", chain: "sol", address: STRANGER }, fill: true }, "wallet" as never);
  assert.ok("problem" in r, JSON.stringify(r));
  assert.equal(r.problem.code, "security.send.coin-unknown");
  assert.deepEqual([r.problem.whatHappened, r.problem.more], ["ZeroFee couldn't tell which coin they would get, so it stopped. Nothing left your Safe.", "Try again in a moment, or send a coin from the list."]);
  assert.deepEqual([r.problem.next, r.problem.next2], [{ kind: "retry", label: "Try again" }, { label: "Pick a coin", kind: "open", screen: "send-pick-coin" }]);
  assert.deepEqual([s.shown.length, s.sent()], [0, 0], "the sheet never opened; nothing signed or sent");
});

test("ENTRY 4. A site's top-up, Private short (ledger.moveFromPrivate with whole: the call Spending's topUp makes, spending.ts): one fill of the whole, the join, through the real core [fails on main without 737644f57]", async () => {
  const s = await ledgerEntry({ pocketUnits: "1000000" });
  const r = await s.ledger.call<any>("ledger.moveFromPrivate", { parts: [{ wallet: s.sol1.id, usd: 5 }], whole: true, job: "site-topup-0123456789abcdef01234", caller: "trade" });
  assert.ok("ok" in r && !r.ok.parts.some((x: any) => x.stopped), `${said(r)} ${JSON.stringify("ok" in r ? r.ok : null)} via ${s.real.join(", ")}`);
  assert.ok(s.real.includes("subwallet.privatePay") && s.real.includes("tx.request"), s.real.join(", "));
  assert.equal(s.shown.length, 1, "one Safe sheet");
  assert.match(s.shown[0]!.title, /^Move \$[\d.]+ to your SOL wallet$/, s.shown[0]!.title);
  assert.ok(s.shown[0]!.lines.includes("From your Safe · $10.00"), `one fill of the whole, a $10 step: ${s.shown[0]!.lines.join(" | ")}`);
  assert.equal(s.sent(), 1, "the fill sent");
});

// T-F (the UI reviewer's walk, 6 Nov, B-9): Home's Swap of the Safe's NEAR to the SOL wallet, Private short. Spending
// the copy review's (a) and (c), 7 Nov: the wallet's Move carries its whole plan to the core (private-move.ts -> safe-send.ts FillMark ->
// to-private.ts TxRequest.movePlan), and the core says it only once it finds the leg it built among the parts; a Swap
// (spending's then.swap -> float-private -> ledger.moveFromPrivate swap) is titled as one once the core's own record of
// the payment pays out SOL. Leg 1 here signs a 2 % minimum, so the payment is the part's asked share of it ($29.40 of $30).
test("the copy review's (a), (c) and J4 through the real ledger and core: a two-part Move ($30.00 to the SOL wallet, $5.00 to the NEAR wallet) is titled \"Your Safe adds $29.40 to this $34.40 Move\" and says \"$29.40 from your Safe, $5.00 from Private. $34.40 in all.\" under its title, then the rows; with swap, \"Swap $29.40 of USDC for SOL\" (controls: one part, no line; no swap, the Move's title)", async () => {
  const run = async (parts: (sol: string) => { wallet: string; usd: number }[], swap: boolean) => {
    const s = await ledgerEntry({ pocketUnits: "12500000", solNamed: true, float: true });
    const r = await s.ledger.call<any>("ledger.moveFromPrivate", { parts: parts(s.sol1.id), job: "move-private-7123456789abcdef0123", caller: "trade", ...(swap ? { swap: true } : {}) });
    assert.ok("ok" in r && !r.ok.parts.some((x: any) => x.stopped), `${said(r)} ${JSON.stringify("ok" in r ? r.ok : null)} via ${s.real.join(", ")}`);
    assert.equal(s.shown.length, 1, "one Safe sheet");
    return s.shown[0]!;
  };
  const two = (sol: string) => [{ wallet: sol, usd: 30 }, { wallet: "near", usd: 5 }];
  const move = await run(two, false);
  // the copy review's layout (7 Nov, the one fill's sheet): the person's action, every wallet, was "Your Safe adds $29.40 to this $34.40 Move"
  assert.equal(move.title, "Move $34.40 to your SOL and NEAR wallets", "J4: the whole Move, every wallet, never the leg's figure alone");
  // the audit (7 Nov): what stays is what the fill's quote brings ($39.60 of the $40.00 step) less the leg, about (its minimum is
  // less); the fee is the step less what it brings, about; the rows add up (J2-1, Private by its net change): $40.00 = $34.40 + $5.20 + $0.40
  // fix/move-row-truth (QA's rule, the copy review's words, 7 Nov): no sources line, no why sentence
  // the audit's ruling (c), 8 Nov: each wallet what its leg 2's signed quote gives (the fake 1Click's amountOutUsd), at least its
  // minAmountOut; what the legs keep joins the fill's $0.40: $40.00 = $29.11 + $4.95 + $5.20 + $0.74
  assert.deepEqual(move.lines.slice(0, 7), ["Your SOL wallet gets · about $29.11, at least $28.81", "Your NEAR wallet gets · about $4.95, at least $4.90", "From your Safe · $40.00", "Private keeps the rest · about $5.20", "Fee · about $0.74", "Face ID approves the Safe's part. Private sends on its own.", "Anyone can see the Safe's part."], move.lines.join(" | "));
  const swap = await run(two, true);
  assert.equal(swap.title, move.title, "a Move of more parts is titled by the whole, Swap or not");
  assert.deepEqual(swap.lines.slice(0, 7), move.lines.slice(0, 7));
  const one = await run((sol) => [{ wallet: sol, usd: 30 }], false);
  assert.deepEqual([one.title, one.lines[0]], ["Move $29.40 to your SOL wallet", "Your SOL wallet gets · about $29.11, at least $28.81"], "control: a single-leg Move keeps its title; its destination first, from its quote");
  const oneSwap = await run((sol) => [{ wallet: sol, usd: 30 }], true);
  assert.equal(oneSwap.title, "Swap $29.40 of USDC for SOL", "Home's Swap (one leg) through the real ledger and core");
});

// sends it as a Move paid in NEAR (spending.ts topUp, swap "NEAR": ledger.moveFromPrivate with tokenId NEAR); the real
// ledger pays Private's wNEAR first and fills the rest from the Safe's NEAR (safe-send.ts fillUnits, at NEAR's price),
// exactly as for USDC. This proves the real core takes that NEAR fill: leg 1, the join, the Safe's mt_transfer of wNEAR.
test("ENTRY 8, NEAR (T-F): a Swap of the Safe's NEAR to the SOL wallet with Private short (ledger.moveFromPrivate, tokenId NEAR, fill open): Private's wNEAR, the join, the Safe's NEAR fill, all through the real core; one Safe sheet titled as the Move (control: the same Move in USDC, ENTRY 8 above)", async () => {
  const s = await ledgerEntry({ pocketUnits: (2n * 10n ** 24n).toString(), coin: NEAR, solNamed: true });
  const amount = (25 / 4.39).toFixed(6);
  const r = await s.ledger.call<any>("ledger.moveFromPrivate", { parts: [{ wallet: s.sol1.id, usd: 25, amount }], tokenId: NEAR, job: "home-swap-0123456789abcdef01234567", caller: "trade" });
  assert.ok("ok" in r && !r.ok.parts.some((x: any) => x.stopped), `${said(r)} ${JSON.stringify("ok" in r ? r.ok : null)} via ${s.real.join(", ")}`);
  assert.ok(s.real.includes("subwallet.privatePay") && s.real.includes("subwallet.private.quoteIn") && s.real.includes("tx.request"), s.real.join(", "));
  assert.equal(s.shown.length, 1, "one Safe sheet");
  assert.match(s.shown[0]!.title, /^Move .+ to your SOL wallet$/, s.shown[0]!.title);
  assert.equal(s.sent(), 1, "the fill sent");
  const ids = r.ok.parts[0].ids as string[];
  // one Face ID (6 Nov): Private's share folds into the Safe's one fill while Private stays under its buffer (the audit's R2)
  assert.deepEqual(ids.map((id) => id.split(":")[0]), ["safe-send"], `the Safe's one fill, Private's share folded in: ${ids.join(", ")}`);
});

// T-F, fixed (the audit's ruling, 6 Nov): the Safe's NEAR on its ACCOUNT fills Private. The fill's tx (convert.ts fundingSteps
// near-account: nearAsWnearTo) wraps on wrap.near, and opens with a storage_deposit for the Safe itself when it isn't set
// up there. The core's move tag (intents.ts checkBoundIntent) now allows exactly that one step (ownWrapStorage: wrap.near,
// the signer, registration_only, at most 0.00125 NEAR); before, it refused it (security.intent.changed) after Private's
// own share already went: "Only the part from Private was sent." Already set up, the step is left out (wrapRegistered).
const onAccountSwap = async (o: { wrap?: "registered" | "unregistered" | "fails"; tamper?: (r: TxRequest) => TxRequest }, refused = false) => {
  const s = await ledgerEntry({ pocketUnits: (2n * 10n ** 24n).toString(), coin: NEAR, solNamed: true, onAccount: true, ...o });
  const amount = (25 / 4.39).toFixed(6);
  const r = await s.ledger.call<any>("ledger.moveFromPrivate", { parts: [{ wallet: s.sol1.id, usd: 25, amount }], tokenId: "near", job: "home-swap-1123456789abcdef01234567", caller: "trade" });
  if (!refused) assert.ok("ok" in r, said(r));
  return { s, r, fill: s.txs.find((t) => t.methods.includes("near_deposit")) };
};
const filled = ({ s, r, fill }: Awaited<ReturnType<typeof onAccountSwap>>) => {
  assert.ok(fill, JSON.stringify(s.txs));
  assert.equal(fill!.outcome.status, "done", JSON.stringify(fill!.outcome));
  assert.ok(!r.ok.parts.some((x: any) => x.stopped), `no part stopped: ${JSON.stringify(r.ok)}`);
  assert.equal(s.shown.length, 1, "one Safe sheet");
  assert.match(s.shown[0]!.title, /^Move .+ to your SOL wallet$/, s.shown[0]!.title);
  assert.equal(s.sent(), 1, "the fill sent");
  const ids = r.ok.parts[0].ids as string[];
  // one Face ID (6 Nov): Private's share folds into the Safe's one fill while Private stays under its buffer (the audit's R2)
  assert.deepEqual(ids.map((id) => id.split(":")[0]), ["safe-send"], `the Safe's one fill, Private's share folded in: ${ids.join(", ")}`);
};
const selfStorage = (fill: { methods: string[]; args: Record<string, unknown>[] }) => fill.methods.filter((m, i) => m === "storage_deposit" && fill.args[i]?.account_id === "kid.near").length;

test("T-F, fixed: a Swap of the Safe's NEAR on its account with Private short, the Safe not set up on wrap.near: Private's share, then the Safe's wrap-and-fill with its own storage step, accepted by the real core; one sheet, sent, no part stopped [fails without ownWrapStorage]", async () => {
  const run = await onAccountSwap({});
  filled(run);
  assert.equal(run.fill!.methods[0], "storage_deposit");
  assert.equal(selfStorage(run.fill!), 1, "the Safe's own storage, once");
  // the sheet is the Move's, its set-up one line (words.ts prepFold with intents.ts `folds`), never "and 3 more steps"
  const sheet = run.s.shown[0]!;
  assert.ok(sheet.lines.includes("Setting up the coin costs at most 0.0025 NEAR."), sheet.lines.join(" | "));
  assert.ok(!sheet.lines.some((l) => /^Let (your account|the swap service) hold/.test(l)) && !/more step/.test(sheet.title), sheet.title);
});

test("T-F, the saving: the Safe already set up on wrap.near: its storage step is left out, accepted by the real core [fails without wrapRegistered]", async () => {
  const run = await onAccountSwap({ wrap: "registered" });
  filled(run);
  assert.equal(selfStorage(run.fill!), 0, `no storage step for the Safe: ${run.fill!.methods.join(", ")}`);
});

test("T-F, unknown: wrap.near's storage read fails: the Safe's storage step stays (never skipped on an unknown), accepted by the real core", async () => {
  const run = await onAccountSwap({ wrap: "fails" });
  filled(run);
  assert.equal(selfStorage(run.fill!), 1, "kept on a failed read");
});

test("T-F, control: the same fill with its storage_deposit for another account is refused by the real core under the move's tag; nothing of the Safe's sent", async () => {
  const other = (r: TxRequest): TxRequest => ({ ...r, actions: r.actions.map((a: any) => (a.method === "storage_deposit" && a.args?.account_id === "kid.near" ? { ...a, args: { ...a.args, account_id: "someone-else.near" } } : a)) });
  const { s, r, fill } = await onAccountSwap({ tamper: other }, true);
  assert.ok(fill, JSON.stringify(s.txs));
  assert.deepEqual([fill!.outcome.status, (fill!.outcome as any).problem?.code], ["problem", "security.intent.changed"]);
  assert.equal(s.sent(), 0, "the Safe's part never went");
  // one Face ID (6 Nov): Private's share is folded into the fill, so no part went before it: the Move's own refusal
  assert.ok("problem" in r && r.problem.code === "security.intent.changed", said(r) || JSON.stringify(r.ok));
});

test("T-F, Send: Send from the Safe with the fill (ledger.sendFromSafe, fill), paid from the Safe's NEAR on its account, Private empty, the Safe not set up on wrap.near: its own storage step, the wrap and the move in, accepted by the real core under one sheet naming the Send; sent [fails without ownWrapStorage]", async () => {
  const s = await ledgerEntry({ pocketUnits: "0", coin: NEAR, solNamed: true, onAccount: true });
  const r = await s.ledger.call<any>("ledger.sendFromSafe", { tokenId: "near", amount: "5", to: { kind: "chain", chain: "sol", address: STRANGER }, fill: true }, "wallet" as never);
  assert.ok("ok" in r, `${said(r)} via ${s.real.join(", ")}`);
  const fill = s.txs.find((t) => t.methods.includes("near_deposit"));
  assert.ok(fill, JSON.stringify(s.txs));
  assert.deepEqual([fill!.outcome.status, selfStorage(fill!)], ["done", 1], JSON.stringify(fill!.outcome));
  assert.equal(s.shown.length, 1, "one Safe sheet");
  assert.match(s.shown[0]!.title, /^Send .+ from your Safe$/, s.shown[0]!.title);
  assert.ok(s.shown[0]!.lines.includes("Setting up the coin costs at most 0.0025 NEAR.") && !/more step/.test(s.shown[0]!.title), s.shown[0]!.lines.join(" | "));
  assert.equal(s.sent(), 1, "the fill sent");
});

// The Add of the Safe's NEAR on its account into the NEAR wallet (ledger.toTrading, tokenId "near"; 83, 6 Nov): the core's
// own Add quote (subwallet.float.quoteAdd, a move tag), then ONE wrap.near transaction from convert.ts fundingSteps
// near-account (nearAsWnearTo): the Safe's own storage step, the deposit address's, the wrap, the ft_transfer, through the
// real core. A proof of today's code (ownWrapStorage, 4a268691d; targetStorage keeps it): it passes on main.
const addNear = async (tamper?: (r: TxRequest) => TxRequest) => {
  const s = await ledgerEntry({ pocketUnits: "0", coin: NEAR, onAccount: true, float: true, ...(tamper ? { tamper } : {}) });
  const r = await s.ledger.call<any>("ledger.toTrading", { amount: "5", tokenId: "near", caller: "trade" });
  return { s, r };
};
const refusedAdd = ({ s, r }: Awaited<ReturnType<typeof addNear>>) => {
  assert.equal(s.txs.length, 1, JSON.stringify(s.txs));
  assert.deepEqual([s.txs[0]!.outcome.status, (s.txs[0]!.outcome as any).problem?.code], ["problem", "security.intent.changed"]);
  assert.ok("problem" in r, JSON.stringify(r));
  assert.deepEqual([s.shown.length, s.sent()], [0, 0], "no sheet, nothing sent");
};

test("ADD, NEAR (audit, 6 Nov): Add the Safe's NEAR on its account into the NEAR wallet (ledger.toTrading), the Safe not set up on wrap.near: one sheet, sent once, its own storage step accepted by the real core under the Add's move tag [a proof of today's code: passes on main]", async () => {
  const { s, r } = await addNear();
  assert.ok("ok" in r, `${said(r)} via ${s.real.join(", ")}`);
  assert.ok(s.real.includes("subwallet.float.quoteAdd") && s.real.includes("tx.request"), s.real.join(", "));
  assert.equal(s.txs.length, 1, "one transaction");
  const [t] = s.txs;
  assert.deepEqual(t!.methods, ["storage_deposit", "storage_deposit", "near_deposit", "ft_transfer"], "its own storage, the deposit address's, wrap, pay");
  assert.deepEqual([t!.args[0]!.account_id, t!.args[0]!.registration_only, t!.args[1]!.registration_only], ["kid.near", true, true]);
  assert.equal(t!.outcome.status, "done", JSON.stringify(t!.outcome));
  assert.equal(s.shown.length, 1, "one Safe sheet");
  // the core's Add-in-another-coin sheet (intents.ts intoOwnWords, audit 2 Nov S1): a swap for the NEAR wallet's USDC
  assert.match(s.shown[0]!.title, /^Swap \$[\d.]+ \(5 NEAR\) for USDC$/, s.shown[0]!.title);
  assert.match(s.shown[0]!.lines[0]!, /^From your Safe\. At least .+ lands in your NEAR wallet\.$/, s.shown[0]!.lines.join(" | "));
  assert.equal(s.sent(), 1, "sent once");
});

test("ADD, NEAR, control: the same Add with the Safe's own storage step one yocto over the bound is refused by the real core under the Add's move tag; no sheet, nothing sent", async () => {
  refusedAdd(await addNear((r) => ({ ...r, actions: r.actions.map((a: any) => (a.method === "storage_deposit" && a.args?.account_id === "kid.near" ? { ...a, depositYocto: (BigInt(a.depositYocto) + 1n).toString() } : a)) })));
});

test("ADD, NEAR, control: the deposit address's storage step without registration_only is refused by the real core under the Add's move tag (targetStorage, 83, 6 Nov) [fails without targetStorage]", async () => {
  refusedAdd(await addNear((r) => ({ ...r, actions: r.actions.map((a: any) => (a.method === "storage_deposit" && a.args?.account_id !== "kid.near" ? { ...a, args: { account_id: a.args.account_id } } : a)) })));
});

// The Sim's mirror (7 Nov): for the same Private balance and plan, the Sim (MockBridge) fills the Move exactly as the real
// ledger and core do. the audit's ruling (7 Nov, the owner's "prompt, success, prompt"): ONE fill for the whole Move, so ONE Safe
// sheet, its "From your Safe" the one fill (Private $0, $30 + $5: $40, never $10 then $40). Pin changed: it held one sheet
// per part (31472605d).
test("the Sim's fill matches the real ledger's: ONE Safe sheet for the whole Move, the same figure (Private $12.50, $5.00 or none; parts $30.00 SOL and $5.00 or $25.00 NEAR) [one sheet fails on 31472605d]", async () => {
  const { createMockBridge } = await import("@zerofee/shell-api/MockBridge.ts");
  const fromSafe = (w: PlainWords) => w.lines.find((l) => /^From your Safe · /.test(l)) ?? w.title;
  const cases: [string, number, number, string][] = [["12500000", 12.5, 5, "From your Safe · $40.00"], ["5000000", 5, 25, "From your Safe · $60.00"], ["0", 0, 5, "From your Safe · $40.00"]];
  for (const [pocketUnits, priv, near, one] of cases) {
    const s = await ledgerEntry({ pocketUnits, solNamed: true, float: true });
    const r = await s.ledger.call<any>("ledger.moveFromPrivate", { parts: [{ wallet: s.sol1.id, usd: 30 }, { wallet: "near", usd: near }], job: "move-private-7123456789abcdef0123", caller: "trade" });
    assert.ok("ok" in r, `${said(r)} via ${s.real.join(", ")}`);
    const real = s.shown.map(fromSafe);
    assert.deepEqual(real, [one], `Private $${priv}, parts $30 SOL and $${near} NEAR: one Safe sheet, the one fill`);
    assert.equal(s.sent(), 1, "one fill sent");
    const sim = createMockBridge({ latencyMs: 0, settleMs: 5, hiddenStart: { usdc: String(priv), near: "0" }, safeFillOpen: true } as any);
    const asked: string[] = [];
    sim.on("approval.needed", (e: any) => { asked.push(fromSafe(e.words)); void sim.call("approval.answer", { id: e.id, approve: true }); });
    const sol = await sim.call<any>("subwallet.create", { kind: "trade", chain: "sol" });
    assert.ok("ok" in sol, JSON.stringify(sol));
    const m = await sim.call<any>("ledger.moveFromPrivate", { parts: [{ wallet: sol.ok.id, usd: 30 }, { wallet: "near", usd: near }], job: "move-private-7123456789abcdef0123", app: "wallet" });
    assert.ok("ok" in m, JSON.stringify(m));
    assert.deepEqual(asked, real, `Private $${priv}, parts $30 SOL and $${near} NEAR: the Sim's sheets ${JSON.stringify(asked)}, the ledger's ${JSON.stringify(real)}`);
  }
});
