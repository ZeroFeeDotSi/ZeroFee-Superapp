// ONE fill for the whole Move, in the real core (QA's ruling, 7 Nov; the owner's "prompt, success, prompt"):
// SubWallets works out the plan itself (movePlan), sizes the one fill's quote from it (privateQuoteIn `job`), holds every
// leg 2 of the Move under that one fill for the Safe's ONE sheet (one hash), checks each leg against the kept plan, and
// hands each leg to 1Click only once leg 1 landed, the legs that fit, smallest first. Each test fails on 31472605d (none
// of movePlan, `job`, or a second leg joined to one fill existed: the second join was refused or replaced the first).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SubWallets } from "./subwallets.ts";
import type { FloatRelay } from "./float-moves.ts";
import { MemoryVault } from "./vault.ts";
import { base64 } from "./sol/bytes.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";
import { ProblemError } from "./problem.ts";

const USDC_ID = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC = `nep141:${USDC_ID}`;
const SOL_IN = "nep141:sol.omft.near";
const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const STRANGER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const DEADLINE = new Date(Date.now() + 3 * 86_400_000).toISOString();
const JOB = "move-one-fill-0123456789abcdef";
const OUT = { sol: "d1".repeat(32), near: "d2".repeat(32), x: "d3".repeat(32) };

/** The core's own reads for a Move's plan (the audit's MUST, 7 Nov): what Private holds, what the Safe holds on intents.near
 *  (null: no nodes, no read), the account's NEAR, 1Click's token list for a coin that isn't a stablecoin. */
interface Reads { pocket?: bigint; safe?: bigint | null; safeNear?: bigint; price?: { usd: number; decimals: number } | null }
async function setup(o: { leg1Status?: () => { status: string; amountOut?: string }; reads?: Reads } = {}) {
  const r: Required<Pick<Reads, "pocket" | "safe">> & Reads = { pocket: 0n, safe: 500_000_000n, ...(o.reads ?? {}) };
  const near = { commonBlock: async () => ({ hash: "b", height: 1 }), view: async (c: string, m: string, a: { account_id: string; token_id: string }) => (c === "intents.near" && m === "mt_balance_of" && a.account_id === "kid.near" ? String(r.safe) : null), account: async () => ({ balanceYocto: r.safeNear ?? 0n }) };
  const quoted = new Map<string, any>();
  const legs2 = new Map<string, { recipient: string; recipientType: string; destinationAsset: string; amountIn: string }>();
  let n = 0;
  const submitted: unknown[] = [];
  const relay: FloatRelay = {
    quote: async (req) => { const depositAddress = `${(n++).toString(16).padStart(2, "0")}${"e".repeat(62)}`; quoted.set(depositAddress, req); return { quote: { depositAddress }, zerofeeStatusTag: "tag-for-this-quote-0001" }; },
    generateIntent: async () => null, submitIntent: async (signed: unknown) => (submitted.push(signed), null), status: async () => null,
  };
  let pocket = "";
  const privateStatus = async (a: string) => {
    const l2 = legs2.get(a);
    if (l2) {
      const quoteRequest = { dry: false, originAsset: USDC, destinationAsset: l2.destinationAsset, refundTo: pocket, refundType: "CONFIDENTIAL_INTENTS", recipient: l2.recipient, recipientType: l2.recipientType, depositType: "CONFIDENTIAL_INTENTS", deadline: DEADLINE, swapType: "EXACT_INPUT", confidentiality: "basic" };
      return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({ quoteRequest, quote: { depositAddress: a, amountIn: l2.amountIn, amountInUsd: (Number(l2.amountIn) / 1e6).toFixed(2), amountOutUsd: "1.00", minAmountOut: "1", amountOut: "2", deadline: DEADLINE } }) };
    }
    const req = quoted.get(a);
    if (!req) return null;
    const st = o.leg1Status?.() ?? { status: "PENDING_DEPOSIT" };
    return { status: st.status, ...(st.amountOut ? { swapDetails: { amountOut: st.amountOut } } : {}), quoteResponse: signedQuote({ quoteRequest: req, quote: { depositAddress: a, amountIn: req.amount, amountInUsd: (Number(req.amount) / 1e6).toFixed(2), minAmountOut: ((BigInt(req.amount) * 99n) / 100n).toString(), deadline: DEADLINE } }) };
  };
  const sol = { balance: async () => 10n ** 12n, latestBlockhash: async () => "11111111111111111111111111111111", send: async () => true, status: async () => ["ok", "ok"] };
  const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {}, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY, floatRelay: relay, privateStatus, pocketUsd: async () => 0, pocketHeld: async () => r.pocket, ...(r.safe === null ? {} : { near, mainAccount: async () => "kid.near" }), tokenPrice: async () => r.price ?? null, confirm: { everyMs: 1, forMs: 5 } } as never);
  pocket = (await w.create("private", "near")).address;
  const solW = await w.create("trade", "sol");
  const nearW = await w.create("trade", "near");
  const pocketId = (await w.list()).find((x) => x.address === pocket)!.id;
  /** Leg 2 to `to` for `units`, as the wallet's fillMove asks it: held for the one sheet (pair), naming the Move (`job`). */
  const leg = async (inDeposit: string, to: "sol" | "near" | "x", units: string, job: string | null = JOB) => {
    const recipient = to === "sol" ? solW.address : to === "near" ? nearW.address : STRANGER;
    const payee = to === "near" ? { recipient, recipientType: "CONFIDENTIAL_INTENTS", destinationAsset: USDC } : { recipient, recipientType: "DESTINATION_CHAIN", destinationAsset: SOL_IN };
    legs2.set(OUT[to], { ...payee, amountIn: units });
    const payload = { message: JSON.stringify({ deadline: DEADLINE, intents: [{ intent: "transfer", receiver_id: OUT[to], tokens: { [`imt:${MINTER}:${USDC}`]: units } }], signer_id: pocket }), nonce: base64(new Uint8Array(32).fill(to === "sol" ? 3 : to === "near" ? 4 : 5)), recipient: "intents.far" };
    return w.privatePay(pocketId, OUT[to], { payload }, "Move", "tag-for-this-quote-0001", inDeposit, undefined, payee, true, job ?? undefined);
  };
  const plan = (share = "0", parts = [{ wallet: solW.id, units: "30000000" }, { wallet: "near", units: "5000000" }]) => w.movePlan(JOB, USDC, parts, share, 1, 6);
  return { w, leg, plan, solW, nearW, submitted, reads: r };
}
const refusal = async (p: Promise<unknown>): Promise<string> => { try { await p; return "went"; } catch (e) { return e instanceof ProblemError ? e.problem.more ?? e.problem.whatHappened : String(e); } };

test("condition 2: the owner's Move (Private $0, parts $30 SOL + $5 NEAR wallet): the core plans ONE $40 fill; both legs held under it for ONE sheet, one hash over both; released together, kept as two legs (31472605d: no movePlan; a second leg replaced the first)", async () => {
  const s = await setup();
  const p = await s.plan();
  assert.equal(p.fill, "40000000", "one fill, a whole step over $35");
  assert.deepEqual(p.parts.map((x) => [x.fromPrivate, x.viaFill]), [["0", "30000000"], ["0", "5000000"]]);
  const leg1 = await s.w.privateQuoteIn(USDC, p.fill, false, true, true, JOB);
  const a = await s.leg(leg1.depositAddress, "near", "4950000");
  const b = await s.leg(leg1.depositAddress, "sol", "29700000");
  assert.ok("pair" in a && "pair" in b);
  const one = await s.w.pairOf([leg1.depositAddress]);
  assert.equal(one?.hash, (b as { pair: { hash: string } }).pair.hash, "the one sheet carries one hash over both legs");
  assert.notEqual((a as { pair: { hash: string } }).pair.hash, one?.hash, "the first leg's own hash alone no longer releases it");
  assert.equal(await s.w.releasePair(leg1.depositAddress, (a as { pair: { hash: string } }).pair.hash), null, "control: the first leg's hash alone releases nothing");
});

test("condition 1: the one fill's quote is exactly the plan's; a leg to a wallet not in the plan, above its kept amount, naming no plan, or a second time for the same wallet, is refused by name (control: the kept legs pass)", async () => {
  const s = await setup();
  const p = await s.plan();
  assert.equal(await refusal(s.w.privateQuoteIn(USDC, "35000000", false, true, true, JOB)), "Your Safe's fill isn't the one this Move planned, so ZeroFee stopped this. Nothing moved.", "the page's sum, not the plan's fill");
  const leg1 = await s.w.privateQuoteIn(USDC, p.fill, false, true, true, JOB);
  assert.equal(await refusal(s.w.privateQuoteIn(USDC, p.fill, false, true, true, JOB)), "Your Safe's fill isn't the one this Move planned, so ZeroFee stopped this. Nothing moved.", "one fill per plan");
  assert.equal(await refusal(s.leg(leg1.depositAddress, "x", "1000000")), "That wallet isn't in this Move's plan, so ZeroFee stopped this. Nothing moved.");
  assert.equal(await refusal(s.leg(leg1.depositAddress, "sol", "30000001")), "That wallet would get more than this Move planned, so ZeroFee stopped this. Nothing moved.");
  assert.equal(await refusal(s.leg(leg1.depositAddress, "sol", "1000000", null)), "Private's payment isn't part of this Move, so ZeroFee stopped this. Nothing moved.", "a leg into a planned fill always names its plan");
  assert.equal(await refusal(s.leg(leg1.depositAddress, "sol", "29700000")), "went", "control: the kept leg");
  assert.equal(await refusal(s.leg(leg1.depositAddress, "near", "4950000")), "went", "control: the other kept leg");
  assert.equal(await refusal(s.leg(leg1.depositAddress, "sol", "300001")), "That wallet would get more than this Move planned, so ZeroFee stopped this. Nothing moved.", "the same wallet again: only what is left of its kept $30.00 ($0.30)");
  assert.equal(await refusal(s.w.movePlan(JOB, USDC, [{ wallet: s.solW.id, units: "90000000" }], "0", 1, 6)), "This Move is already on its way, so ZeroFee stopped this. Nothing more moved.", "a plan in use is never made again");
});

test("condition 4 (R2) in the core: Private's share near the cap sizes the fill down; the Safe can't cover the step: exactly what the fill pays (control: Private $0 steps)", async () => {
  const s = await setup({ reads: { pocket: 480_000_000n } });
  const parts = [{ wallet: s.solW.id, units: "600000000" }];
  assert.equal((await s.plan("480000000", parts)).fill, "120000000", "Private's $480 goes in; $480 + the step passes $500: exactly $120");
  s.reads.pocket = 0n;
  assert.equal((await s.w.movePlan(JOB, USDC, [{ wallet: s.solW.id, units: "30000000" }, { wallet: "near", units: "5000000" }], "0", 1, 6, false, "36000000")).fill, "35000000", "the Safe holds $36: no step");
  assert.equal((await s.plan()).fill, "40000000", "control");
});

test("condition 3: once leg 1 landed, the core hands the legs that fit what landed, smallest first, never one in pieces; the rest stays in Private (control: enough hands both)", async () => {
  for (const [landed, want] of [["39600000", ["sol", "near"]], ["30000000", ["near"]], ["4000000", []]] as const) {
    let now: { status: string; amountOut?: string } = { status: "PENDING_DEPOSIT" };
    const s = await setup({ leg1Status: () => now });
    const p = await s.plan();
    const leg1 = await s.w.privateQuoteIn(USDC, p.fill, false, true, true, JOB);
    await s.leg(leg1.depositAddress, "near", "4950000");
    const b = await s.leg(leg1.depositAddress, "sol", "29700000") as { pair: { hash: string } };
    assert.equal(await s.w.releasePair(leg1.depositAddress, b.pair.hash), true, "the one signature releases both");
    now = { status: "SUCCESS", amountOut: landed };
    const handed: string[] = [];
    for (const to of ["sol", "near"] as const) if ((await s.w.pairHand(leg1.depositAddress, OUT[to])).handed) handed.push(to);
    assert.deepEqual(handed.sort(), [...want].sort(), `landed ${landed}`);
    // a leg's end deletes only its own kept signature; it still counts against what landed (never paid twice over)
    await s.w.pairEnd(leg1.depositAddress, OUT.near);
    assert.equal((await s.w.pairHand(leg1.depositAddress, OUT.near)).handed, false, "the ended leg is gone");
    assert.equal((await s.w.pairHand(leg1.depositAddress, OUT.sol)).handed, (want as readonly string[]).includes("sol"), "the other leg stays as it was");
    await s.w.pairEnd(leg1.depositAddress, OUT.sol);
    assert.equal((await s.w.pairHand(leg1.depositAddress, OUT.sol)).handed, false, "the last leg's end: the record is gone");
  }
});

// the audit's MUST (7 Nov), condition 1 in full: every figure that sizes the fill or R2 is the core's own. Each failed on fe25026d8
// (movePlan took the page's price, decimals, share and safeHas as they came)
test("the audit's MUST (a): a page price 1000 times too low, or the wrong decimals, leaves the plan's fill unchanged; a coin that isn't a stablecoin is priced by 1Click's token list as the core reads it, none: refused by name", async () => {
  const s = await setup();
  const parts = [{ wallet: s.solW.id, units: "30000000" }, { wallet: "near", units: "5000000" }];
  const right = (await s.w.movePlan(JOB, USDC, parts, "0", 1, 6)).fill;
  assert.equal(right, "40000000");
  assert.equal((await s.w.movePlan(JOB, USDC, parts, "0", 0.001, 6)).fill, right, "fe25026d8: a $10 step at $0.001 a coin, $10,000 of USDC");
  assert.equal((await s.w.movePlan(JOB, USDC, parts, "0", 1, 18)).fill, right, "the page's decimals");
  // wNEAR at 1Click's $4.00: $35 of it, a $40 step, whatever the page says it is worth
  const n = await setup({ reads: { price: { usd: 4, decimals: 24 }, safe: 0n, safeNear: 100n * 10n ** 24n } });
  const nearParts = [{ wallet: n.solW.id, units: (875n * 10n ** 22n).toString() }];
  // the step in units goes through a float (fillStepUsd's dollars at the price): 10 NEAR to within a millionth of a NEAR
  const nf = BigInt((await n.w.movePlan(JOB, "nep141:wrap.near", nearParts, "0", 0.004, 24)).fill);
  assert.ok(nf > 10n ** 25n - 10n ** 18n && nf <= 10n ** 25n, `$35 of wNEAR: a $40 step, 10 NEAR, from the Safe's NEAR on the account (${nf})`);
  const unpriced = await setup({ reads: { price: null } });
  assert.equal(await refusal(unpriced.w.movePlan(JOB, "nep141:wrap.near", [{ wallet: unpriced.solW.id, units: nearParts[0]!.units }], "0", 4, 24)), "ZeroFee couldn't read this coin's price, so it stopped this. Nothing moved.");
});

test("the audit's MUST (b): the page says Private holds $0, the core reads $480: Private still ends at or under $500 after the Move (control: Private really empty, the step)", async () => {
  const s = await setup({ reads: { pocket: 480_000_000n } });
  const parts = [{ wallet: s.solW.id, units: "150000000" }];
  const p = await s.w.movePlan(JOB, USDC, parts, "0", 1, 6);
  const after = 480_000_000n - BigInt(p.parts[0]!.fromPrivate) + (BigInt(p.fill) - BigInt(p.parts[0]!.viaFill));
  assert.ok(after <= 500_000_000n, `Private ends at ${after} (fe25026d8: a $200 fill, $530)`);
  assert.equal(p.fill, "150000000", "exactly what the fill pays");
  // the page saying more than Private holds: the core's read wins (min of the two)
  const over = await setup({ reads: { pocket: 5_000_000n } });
  assert.deepEqual((await over.w.movePlan(JOB, USDC, [{ wallet: over.solW.id, units: "30000000" }], "30000000", 1, 6)).parts.map((x) => [x.fromPrivate, x.viaFill]), [["0", "30000000"]], "Private pays only what it holds");
  const empty = await setup();
  assert.equal((await empty.w.movePlan(JOB, USDC, [{ wallet: empty.solW.id, units: "150000000" }], "0", 1, 6)).fill, "200000000", "control: Private empty, the $200 step");
});

test("the audit's MUST (c): an omitted safeHas is the core's own read of the Safe, never unbounded; a Safe it can't read is refused by name; the page can only lower it", async () => {
  const s = await setup({ reads: { safe: 36_000_000n } });
  const parts = [{ wallet: s.solW.id, units: "30000000" }, { wallet: "near", units: "5000000" }];
  assert.equal((await s.w.movePlan(JOB, USDC, parts, "0", 1, 6)).fill, "35000000", "the Safe holds $36: no $40 step (fe25026d8: $40)");
  assert.equal((await s.w.movePlan(JOB, USDC, parts, "0", 1, 6, false, "900000000")).fill, "35000000", "a page saying more never raises it");
  const less = await setup();
  assert.equal((await less.w.movePlan(JOB, USDC, [{ wallet: less.solW.id, units: "30000000" }, { wallet: "near", units: "5000000" }], "0", 1, 6, false, "36000000")).fill, "35000000", "a page saying less lowers it");
  const blind = await setup({ reads: { safe: null } });
  assert.equal(await refusal(blind.w.movePlan(JOB, USDC, [{ wallet: blind.solW.id, units: "30000000" }], "0", 1, 6)), "ZeroFee couldn't read your Safe, so it stopped this. Nothing moved.");
});
