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
import { createIntentsSwap, SWAP_USDC } from "./intents-swap.ts";
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

/** The Safe swap's steps, from intents-swap.ts's own swap(): the core's quote answers with the live deposit address. */
async function safeSwapSteps(): Promise<TxRequest[]> {
  let steps: TxRequest[] = [];
  const now = () => Date.now();
  const swaps = createIntentsSwap({
    bridgeFor: () => ({ call: async (method: string) => (method === "subwallet.safeSwapQuote" ? { ok: { depositAddress: LIVE_DEPOSIT, amountIn: LIVE.quote.amountIn, minAmountOut: LIVE.quote.minAmountOut } } : { problem: { code: "x" } }) }) as never,
    myAccount: async () => ({ accountId: LIVE_ACCOUNT }),
    coin: async (t) => (t === NEAR ? { decimals: 24, symbol: "NEAR" } : t === SWAP_USDC ? { decimals: 6, symbol: "USDC" } : null),
    status: async () => null,
    ledgerBalance: async () => 5n * 10n ** 24n,
    canChain: async () => false,
    dryQuote: async () => ({ quote: { amountIn: LIVE.quote.amountIn, amountOut: LIVE.quote.amountOut, minAmountOut: LIVE.quote.minAmountOut, amountInUsd: LIVE.quote.amountInUsd, amountOutUsd: LIVE.quote.amountOutUsd } }) as never,
    signAll: async (s) => ((steps = s), { txHash: "h", explorerUrls: [], hold: { reason: "test" } as never }),
    approvals: (s) => s,
    remember: async () => {},
    follow: () => {},
    now, iso: () => new Date(now()).toISOString(),
  });
  const q = await swaps.swapQuote({ from: NEAR, to: SWAP_USDC, amountIn: "1", source: "safe" }, "wallet" as never);
  await swaps.swap({ quoteId: q.id }, "wallet" as never);
  assert.equal(steps.length, 1, "one mt_transfer");
  return steps;
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

async function ledgerEntry(o: { pocketUnits: string; solNamed?: boolean }) {
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
    generateIntent: async () => null, submitIntent: async () => null, status: async () => null,
  };
  // 1Click's status as it signs it: leg 1 (the core's own ask) and leg 2 (the ledger's ask), each read back as asked
  const privateStatus = async (a: string) => {
    const req = quoted.get(a) ?? asked.find((q) => !q.dry && q.__dep === a);
    if (!req) return null;
    const { __dep, ...clean } = req as Record<string, any>;
    return { status: "PENDING_DEPOSIT", quoteResponse: sign(clean, a, ((BigInt(clean.amount) * 99n) / 100n).toString(), ((BigInt(clean.amount) * 98n) / 100n).toString()) };
  };
  const sol = { balance: async () => 10n ** 12n, latestBlockhash: async () => "11111111111111111111111111111111", send: async () => true, status: async () => ["ok", "ok"] };
  const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {}, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY, floatRelay: relay, privateStatus, pocketUsd: async () => 0, confirm: { everyMs: 1, forMs: 5 } } as never);
  const p = await w.create("private", "near");
  pocket = p.address;
  await w.create("trade", "sol");
  const list = (await w.list()) as { id: string; kind: string; chain: string; address: string }[];
  // the real core's signer, as DemoCore's deviceSigner wires it
  const chain = new FakeChain("mainnet");
  const key = SoftwareKey.generate();
  chain.fund(ME, key.publicKey);
  chain.contract(INTENTS.account, INTENTS.codeHashBase58, { mt_balance_of: () => "500000000" });
  chain.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  // the payout's coin, named with its decimals (the audit's ruling, 5 Nov: unnamed, the fill is refused before its sheet)
  if (o.solNamed) chain.contract("sol.omft.near", "sol", { ft_metadata: () => ({ symbol: "SOL", decimals: 9 }) });
  const names = (x: { kind: string; chain: string }) => (x.kind === "private" ? PRIVATE_POCKET : x.kind === "trade" && x.chain === "near" ? TRADING_BALANCE : x.chain === "sol" ? "your SOL wallet" : `your ${x.chain} wallet`);
  const shown: PlainWords[] = [];
  const own = (a: string) => w.privateInFacts(a);
  const signer = new DevSigner({
    accountId: ME, chain, key, approve: async (x) => (shown.push(x), true), quoteKey: TEST_QUOTE_KEY,
    ownWallets: async () => new Map(list.map((x) => [x.address, names(x)])), oneClick: own, ownQuote: own, privateLeg: async (a) => w.privateLeg(a), sendPayout: async (a) => w.sendPayout(a),
    // fix/bind-intent: the core's own record of what its Swap and Move doors asked (demo-core.ts intentOf)
    intentOf: (a) => w.intentOf(a),
  });
  const screens = fakeCore({ accountId: ME, pocket: [{ tokenId: SWAP_USDC, amount: o.pocketUnits }], subwallets: list as never });
  const real: string[] = [];
  const route = async (m: string, q: Record<string, any>) => {
    if (m === "subwallet.private.quoteIn") return { ok: await w.privateQuoteIn(q.tokenId, q.amount, q.outside === true, q.through === true, q.intents === true) };
    if (m === "subwallet.privatePay") return { ok: await w.privatePay(q.id, q.depositAddress, q.intent, q.why, q.statusTag, q.inDeposit, q.send === true, q.payee) };
    if (m === "tx.request") return { ok: await signer.request(q.request) };
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
      return { payload: { message: JSON.stringify({ deadline: req.deadline, intents: [{ intent: "transfer", receiver_id: dep, tokens: { [`imt:${MINTER}:${SWAP_USDC}`]: req.amount } }], signer_id: signerId }), nonce: base64(new Uint8Array(32).fill(3)), recipient: "intents.far" } };
    },
    submitIntent: async () => ({ intentHash: "h" }),
    status: async () => ({ status: "SUCCESS" }) as any,
  };
  const ledger = createLedgerService({ bridgeFor, chain: fakeNear(ME, { ledger: { [SWAP_USDC]: "500000000" } }, { [QUOTE_ADDRESS]: { ledger: {} } }), apis, routes: { intents: false, nearOrigin: false }, trackMs: 2, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY, safeFillOpen: true } as never);
  const sol1 = list.find((x) => x.kind === "trade" && x.chain === "sol")!;
  return { ledger, shown, real, sol1, pocket: () => pocket, sent: () => chain.sent.length };
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

test("ENTRY 3. Send from the Safe with the fill (ledger.sendFromSafe, fill), to an outside Solana payee, Private empty: leg 1, the join, the payout bound, the Safe's fill under one sheet naming the payee, all through the real core (SAFE_SEND_FILL_OPEN)", async () => {
  const s = await ledgerEntry({ pocketUnits: "0", solNamed: true });
  const r = await s.ledger.call<any>("ledger.sendFromSafe", { tokenId: SWAP_USDC, amount: "20", to: { kind: "chain", chain: "sol", address: STRANGER }, fill: true }, "wallet" as never);
  assert.ok("ok" in r, `${said(r)} via ${s.real.join(", ")}`);
  assert.ok(s.real.includes("subwallet.privatePay") && s.real.includes("tx.request"), s.real.join(", "));
  assert.equal(s.shown.length, 1, "one Safe sheet");
  // the bound sheet (feat/safe-send-fill, QA's MUST 1): the Send, the Safe's whole step over the $20 payout,
  // the full address first, unfolded, then where it lands (the audit's D37 condition, the copy review's words)
  assert.match(s.shown[0]!.title, /^Send \$[\d.]+ from your Safe$/, s.shown[0]!.title);
  // the UI lead's ruling (5 Nov): what they get (the payout's amountIn), what the Safe sends, what stays; Y = Z + T
  const legs = s.shown[0]!.lines.filter((l) => /^(They get|Your Safe sends|Stays in Private|From your Safe|Together|Network fees) · /.test(l));
  assert.match(legs[0]!, /^They get · \d[\d,]*(\.\d{1,4})? SOL \(\$19\.40\)$/, `the named coin's signed figure, then what it is worth to them: ${legs[0]}`);
  assert.deepEqual(legs.slice(1), ["Your Safe sends · $30.00", "Stays in Private · $10.40", "Network fees · about $0.20"], "the fill: a whole step over the $20 payout; T $19.60 = $19.40 + $0.20");
  assert.ok(!s.shown[0]!.lines.some((l) => /unnamed coin/.test(l)), "control: never the unnamed words");
  assert.deepEqual(s.shown[0]!.lines.slice(0, 2), [`To ${STRANGER}`, "Public on Solana."], s.shown[0]!.lines.join(" | "));
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
  assert.ok(s.shown[0]!.lines.includes("Your Safe adds $10.00 to Private first."), "one fill of the whole, a $10 step");
  assert.equal(s.sent(), 1, "the fill sent");
});
