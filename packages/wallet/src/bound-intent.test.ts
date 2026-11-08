// The core's own Swap and Move tag (QA's MUST, 5 Nov): a Safe swap built on a forged quote (its payee swapped),
// a quote checked against another key, or a payment to another address signed as a plain "Send 1 wNEAR to <address>"
// with a first-time warning, so a relay or a man in the middle could hand an honest app a forged deposit address and the
// person who tapped Swap approved it with Face ID. Now a request under the core's tag (a core caller's BoundIntent, or
// the core's own record of what its quote doors asked: DemoCore -> subwallets.intentOf) must describe as exactly that
// swap or move, or the REAL core (DevSigner: describe -> checkIntents -> checkBoundIntent -> sign; never MockBridge)
// refuses it before any sheet. Plain Sends keep their own door and their outside sheet.
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { SoftwareKey } from "@zerofee/core/device-key";
import { DevSigner } from "@zerofee/core/dev-signer";
import { INTENTS, PRIVATE_POCKET, type IntentKind, type OneClickLookup } from "@zerofee/core/intents";
import { signedBy1Click } from "@zerofee/core/quote-signature";
import { signedQuote, TEST_QUOTE_KEY } from "@zerofee/core/quote-test-key";
import type { BoundIntent, PlainWords, TxRequest } from "@zerofee/core/signer";
import { FakeChain } from "@zerofee/core/testing/fake-chain";
import { SWAP_USDC } from "./intents-swap.ts";
import { mtTransfer } from "./moves.ts";
import { fundingSteps } from "./convert.ts";
import { saidOnSheet } from "./app/money/swap-corridor.ts";

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
function realCore(o: { accountId: string; quoteKey?: string; lookup: OneClickLookup; ownWallets?: Map<string, string>; balances: Record<string, string>; intentOf?: Record<string, IntentKind> }) {
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
    // DemoCore's wiring: its own quote doors' record (subwallets.intentOf), here the addresses the test says it asked
    ...(o.intentOf ? { intentOf: async (a: string) => o.intentOf![a] ?? null } : {}),
  });
  return { signer, chain, shown };
}

/** Accepted: signed and sent, one sheet. */
async function accepted(core: ReturnType<typeof realCore>, request: TxRequest, intent?: BoundIntent) {
  const out = await core.signer.request(request, intent);
  assert.equal(out.status, "done", JSON.stringify(out));
  assert.equal(core.chain.sent.length, 1, "sent once");
  assert.equal(core.shown.length, 1, "one sheet");
  return core.shown[0]!;
}
/** Refused by the core's own check, before any sheet and with nothing sent. */
async function refused(core: ReturnType<typeof realCore>, request: TxRequest, code: RegExp, why: string, intent?: BoundIntent) {
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
 *  the core's swap tag must still refuse a forged one if an app ever asks. */
async function safeSwapSteps(): Promise<TxRequest[]> {
  return [mtTransfer({ to: LIVE_DEPOSIT, tokenId: NEAR, units: BigInt(LIVE.quote.amountIn), why: "Swap 1 in your Safe" })];
}
const liveLookup: OneClickLookup = async (a) => (a === LIVE_DEPOSIT ? { status: "PENDING_DEPOSIT", quoteResponse: LIVE } : null);
const safe = () => realCore({ accountId: LIVE_ACCOUNT, lookup: liveLookup, balances: { [NEAR]: (5n * 10n ** 24n).toString() } });

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


const SWAP_STOP = "The swap's price changed before it was signed, so ZeroFee stopped. Nothing moved.";
const MOVE_STOP = "The move's price changed before it was signed, so ZeroFee stopped. Nothing moved.";
const CHANGED = /^security\.intent\.changed$/;
const thief = "ee".repeat(32);
const forged = { ...LIVE, quoteRequest: { ...LIVE.quoteRequest, recipient: thief } };
const balances = { [NEAR]: (5n * 10n ** 24n).toString() };
const forgedLookup: OneClickLookup = async (a) => (a === LIVE_DEPOSIT ? { status: "PENDING_DEPOSIT", quoteResponse: forged } : null);
const SWAP: BoundIntent = { kind: "swap", depositAddress: LIVE_DEPOSIT };
const MOVE: BoundIntent = { kind: "move", depositAddress: FILL_DEPOSIT };
/** The core's record: its Swap door (subwallet.safeSwapQuote) asked LIVE_DEPOSIT, its Move door FILL_DEPOSIT. */
const ASKED: Record<string, IntentKind> = { [LIVE_DEPOSIT]: "swap", [FILL_DEPOSIT]: "move" };

async function says(core: ReturnType<typeof realCore>, request: TxRequest, line: string, intent?: BoundIntent) {
  const out = await core.signer.request(request, intent);
  assert.ok(out.status === "problem", JSON.stringify(out));
  assert.equal(out.problem.whatHappened, line);
  // one Try again, which the Swap and Move sheets answer with a new quote (SwapSheet: saidOnSheet, its stopped line)
  assert.deepEqual(out.problem.next, { kind: "retry", label: "Try again" });
  assert.equal(saidOnSheet(out.problem), true, "said on the sheet itself, with its button");
}

test("swap tag: the genuine 1Click-signed quote signs as the swap (a core caller's tag, and the core's own record)", async () => {
  assert.equal(signedBy1Click(LIVE), true);
  const [step] = await safeSwapSteps();
  const w = await accepted(safe(), step!, SWAP);
  assert.equal(w.title, "Swap $4.61 (1 NEAR) for USDC");
  const r = await accepted(realCore({ accountId: LIVE_ACCOUNT, lookup: liveLookup, balances, intentOf: ASKED }), step!);
  assert.equal(r.title, "Swap $4.61 (1 NEAR) for USDC", "the app's untagged request, under the core's own record");
});

test("swap tag: a forged recipient, another key or another address is refused before any sheet, with the swap's line", async () => {
  const [step] = await safeSwapSteps();
  // forged: the quote at the address pays someone else (1Click's signature breaks)
  await refused(realCore({ accountId: LIVE_ACCOUNT, lookup: forgedLookup, balances }), step!, CHANGED, "forged, tagged", SWAP);
  await refused(realCore({ accountId: LIVE_ACCOUNT, lookup: forgedLookup, balances, intentOf: ASKED }), step!, CHANGED, "forged, the core's record");
  // another key: the genuine signature checked under any key but 1Click's is no quote at all
  await refused(realCore({ accountId: LIVE_ACCOUNT, lookup: liveLookup, quoteKey: TEST_QUOTE_KEY, balances }), step!, CHANGED, "another key, tagged", SWAP);
  await refused(realCore({ accountId: LIVE_ACCOUNT, lookup: liveLookup, quoteKey: TEST_QUOTE_KEY, balances, intentOf: ASKED }), step!, CHANGED, "another key, the core's record");
  // another address: the tag is bound to the address the core asked for
  await refused(safe(), withArgs(step!, { receiver_id: thief }), CHANGED, "another address", SWAP);
  await refused(safe(), withArgs(step!, { receiver_id: thief }), CHANGED, "another address, any quoted", { kind: "swap" });
  // and the record: another amount on the asked address says the swap's line, never "doesn't match your price"
  await refused(realCore({ accountId: LIVE_ACCOUNT, lookup: liveLookup, balances, intentOf: ASKED }), withArgs(step!, { amount: "1000000000000000000000001" }), CHANGED, "amount, the core's record");
  await says(realCore({ accountId: LIVE_ACCOUNT, lookup: forgedLookup, balances }), step!, SWAP_STOP, SWAP);
  // a swap is never a move: the own-account swap under the move tag is refused too
  await says(safe(), step!, MOVE_STOP, { kind: "move", depositAddress: LIVE_DEPOSIT });
});

test("control: an untagged Send to that same address keeps its own door and its outside sheet (a plain send naming it)", async () => {
  const [step] = await safeSwapSteps();
  const core = realCore({ accountId: LIVE_ACCOUNT, lookup: forgedLookup, balances });
  const w = await core.signer.describe(step!);
  assert.equal(w.title, `Send 1 wNEAR to ${LIVE_DEPOSIT}`);
  assert.ok(w.warnings.some((x) => x.kind === "first-time-recipient"));
  const out = await core.signer.request(step!);
  assert.equal(out.status, "done", "the plain Send door still signs, on its outside sheet");
  assert.equal(core.shown[0]!.title, `Send 1 wNEAR to ${LIVE_DEPOSIT}`);
  // an address the core never asked for, under its record: untagged, the plain send as before
  const o = await realCore({ accountId: LIVE_ACCOUNT, lookup: liveLookup, balances, intentOf: ASKED }).signer.describe(withArgs(step!, { receiver_id: thief }));
  assert.equal(o.title, `Send 1 wNEAR to ${thief}`);
});

const foreignFill = () => realCore({ accountId: SAFE, quoteKey: TEST_QUOTE_KEY, lookup: async (a) => (a === FILL_DEPOSIT ? { status: "PENDING_DEPOSIT", quoteResponse: fillQuote } : null), balances: { [SWAP_USDC]: "900000000" }, intentOf: ASKED });

test("move tag: the genuine Move fill (the hotfix's one mt_transfer into its own pocket) signs as the move", async () => {
  const w = await accepted(fillCore(), fillStep(), MOVE);
  assert.equal(w.title, "Move $20.00 to Private");
  const r = await accepted(realCore({ accountId: SAFE, quoteKey: TEST_QUOTE_KEY, lookup: async (a) => (a === FILL_DEPOSIT ? { status: "PENDING_DEPOSIT", quoteResponse: fillQuote } : null), ownWallets: new Map([[POCKET, PRIVATE_POCKET]]), balances: { [SWAP_USDC]: "900000000" }, intentOf: ASKED }), fillStep());
  assert.equal(r.title, "Move $20.00 to Private", "the app's untagged fill, under the core's own record");
});

test("move tag: a foreign recipient (a pocket not on the core's own list), another address or a swap's quote is refused with the move's line", async () => {
  await refused(foreignFill(), fillStep(), CHANGED, "foreign recipient, the core's record");
  await says(foreignFill(), fillStep(), MOVE_STOP);
  await refused(realCore({ accountId: SAFE, quoteKey: TEST_QUOTE_KEY, lookup: async (a) => (a === FILL_DEPOSIT ? { status: "PENDING_DEPOSIT", quoteResponse: fillQuote } : null), balances: { [SWAP_USDC]: "900000000" } }), fillStep(), CHANGED, "foreign recipient, tagged", MOVE);
  await refused(fillCore(), withArgs(fillStep(), { receiver_id: thief }), CHANGED, "another address", MOVE);
  await refused(fillCore(), withArgs(fillStep(), { amount: "20000001" }), CHANGED, "another amount", MOVE);
  // a move is never a swap: the fill under the swap tag is refused
  await says(fillCore(), fillStep(), SWAP_STOP, { kind: "swap", depositAddress: FILL_DEPOSIT });
});

test("an app can't set or lift the tag: an `intent` in its request is never read", async () => {
  const [step] = await safeSwapSteps();
  // a page puts its own word on the request: ignored, so the core's record still decides (refused here)
  const sneaky = { ...step!, intent: { kind: "send" } } as unknown as TxRequest;
  await refused(realCore({ accountId: LIVE_ACCOUNT, lookup: forgedLookup, balances, intentOf: ASKED }), sneaky, CHANGED, "an app's word can't lift the tag");
  // and it can't put one on: untagged as ever (the plain send)
  const put = { ...step!, intent: { kind: "swap", depositAddress: LIVE_DEPOSIT } } as unknown as TxRequest;
  assert.equal((await realCore({ accountId: LIVE_ACCOUNT, lookup: forgedLookup, balances }).signer.describe(put)).title, `Send 1 wNEAR to ${LIVE_DEPOSIT}`);
  assert.ok(INTENTS.account);
});

test("move tag: the Safe's Add into its NEAR wallet (route B, ft_withdraw to the core's own Top up quote) still signs under the core's record", async () => {
  const FLOAT = "f1".repeat(32), ADD = "ad".repeat(32);
  const q = signedQuote({
    quoteRequest: { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: SWAP_USDC, depositType: "ORIGIN_CHAIN", destinationAsset: SWAP_USDC, amount: "10000000", refundTo: FLOAT, refundType: "CONFIDENTIAL_INTENTS", recipient: FLOAT, recipientType: "CONFIDENTIAL_INTENTS", deadline: SOON, confidentiality: "basic" },
    quote: { depositAddress: ADD, amountIn: "10000000", minAmountOut: "9900000", deadline: SOON },
  }, "2026-10-27T17:30:30.000Z");
  const [step] = fundingSteps("near-ledger", { tokenId: SWAP_USDC, units: 10_000_000n, depositAddress: ADD, registered: true, storageYocto: "0", me: SAFE, why: "Move 10 USDC to your NEAR wallet" });
  const core = (own: Map<string, string>) => realCore({ accountId: SAFE, quoteKey: TEST_QUOTE_KEY, lookup: async (a) => (a === ADD ? { status: "PENDING_DEPOSIT", quoteResponse: q } : null), ownWallets: own, balances: { [SWAP_USDC]: "900000000" }, intentOf: { [ADD]: "move" } });
  const w = await accepted(core(new Map([[FLOAT, "your NEAR wallet"]])), step!);
  assert.equal(w.title, "Move 10 USDC to your NEAR wallet");
  await says(core(new Map()), step!, MOVE_STOP);
});
