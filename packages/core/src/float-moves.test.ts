import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { FLOAT_MOVES_PER_DAY } from "./float.ts";
import { FLOAT_USDC, type FloatRelay } from "./float-moves.ts";
import { HL_USDC_ASSET } from "./float-perps.ts";
import { nep413Hash } from "./private-pocket.ts";
import { base64, fromBase58 } from "./sol/bytes.ts";
import type { PlainWords } from "./signer.ts";
import type { SolChain } from "./solana.ts";
import { decodeSolTx } from "./sol/decode.ts";
import { parseTx } from "./evm/wire.ts";
import type { EvmChain } from "./evm.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { HOT_ROOT, hotRoot } from "./hot-keys.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

/** 1Click's confidential coins are wrapped by this minter (recorded 25 Oct, private-pocket.ts). */
const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const MAIN = "kim.near";
const SOL_DEPOSIT = "5SbU76n3zBhLtzfyMyTQaN3vcpNrRmo6HW4cWKEY1qfn";  // generated sample
const EVM_DEPOSIT = "0x00000000000000000000000000000000000d3f05";
const key = (n: number) => `trade-job-${String(n).padStart(8, "0")}`;

/**
 * A stand-in for ZeroFee's relay in front of 1Click, as recorded on 25 and 27 Oct: a real quote answers with a one-time
 * deposit address, generate-intent with the one transfer that pays it, and status with the quote as asked, signed the way
 * 1Click signs it (by the test key). `lie` changes what 1Click's signed quote says; `forge` swaps in other terms after signing
 * (given the signed ones and the ones asked for), as a relay that lies would; `submit` decides what submit-intent does.
 */
function relay(o: { amountIn?: (req: any) => string; minOut?: (req: any) => string; lie?: (req: any) => any; forge?: (signed: any, asked: any) => any; submit?: () => Promise<unknown>; status?: string; deposit?: (req: any) => string | undefined; details?: (req: any) => unknown; deadlineMs?: number; memo?: string } = {}) {
  const asked: any[] = [];
  const submitted: any[] = [];
  const quotes = new Map<string, { req: any; amountIn: string; deadline: string }>();
  let state = o.status ?? "PENDING_DEPOSIT";
  /** One deposit's own status, over the shared one (a Move back: its first leg done, its second still to pay). */
  const each = new Map<string, string>();
  const r: FloatRelay = {
    quote: async (req) => {
      asked.push(req);
      const depositAddress = o.deposit?.(req) ?? (req.depositType === "ORIGIN_CHAIN" ? (req.originAsset.includes("sol") ? SOL_DEPOSIT : EVM_DEPOSIT) : (asked.length.toString(16) + "d".repeat(64)).slice(0, 64));
      const amountIn = o.amountIn?.(req) ?? (req.swapType === "EXACT_OUTPUT" ? "15300000" : req.amount);
      const deadline = new Date(Date.now() + (o.deadlineMs ?? 3 * 86_400_000)).toISOString();
      quotes.set(depositAddress, { req, amountIn, deadline });
      return { quote: { depositAddress, amountIn, amountOut: req.amount, deadline }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async (signerId, depositAddress) => {
      const q = quotes.get(depositAddress)!;
      const message = JSON.stringify({ deadline: q.deadline, intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [`imt:${MINTER}:${q.req.originAsset}`]: q.amountIn } }], signer_id: signerId });
      return { intent: { standard: "nep413", payload: { message, nonce: base64(new Uint8Array(32).fill(7)), recipient: "intents.far" } } };
    },
    submitIntent: async (signed) => (submitted.push(signed), o.submit ? o.submit() : { intentHash: "h" }),
    status: async (depositAddress) => {
      const q = quotes.get(depositAddress);
      if (!q) return null;
      const req = o.lie ? o.lie(q.req) : q.req;
      // A move in: what the coin is worth in USDC at the demo's prices, less 2 %.
      const worth = (r: any) => String(Math.floor((Number(r.amount) / (r.originAsset.includes("sol") ? 1e9 : 1e18)) * (r.originAsset.includes("sol") ? 150 : 3000) * 0.98 * 1e6));
      const minAmountOut = o.minOut?.(req) ?? (req.swapType === "EXACT_OUTPUT" ? req.amount : req.depositType === "ORIGIN_CHAIN" ? worth(req) : String((BigInt(req.amount) * 99n) / 100n));
      const signed = signedQuote({ quoteRequest: req, quote: { depositAddress, amountIn: q.amountIn, minAmountOut, deadline: q.deadline, ...(o.memo ? { depositMemo: o.memo } : {}) } });
      const quoteResponse = o.forge ? { ...signed, quoteRequest: o.forge(req, q.req) } : signed;
      return { status: each.get(depositAddress) ?? state, quoteResponse, ...(o.details ? { swapDetails: o.details(q.req) } : {}) };
    },
  };
  return { r, asked, submitted, set: (s: string) => (state = s), mark: (depositAddress: string, s: string) => each.set(depositAddress, s) };
}

async function setup(o: Parameters<typeof relay>[0] = {}, answer = true, took = true, solStatus?: () => ("ok" | "failed" | null)[]) {
  const shown: PlainWords[] = [];
  const fake = relay(o);
  const sent: string[] = [];
  const sol: SolChain = {
    blockhashValid: async () => true,
    simulate: async () => ({ ok: true, agreed: true, lamportsBefore: 0n, lamportsAfter: 0n }),
    lookupTables: async () => [],
    latestBlockhash: async () => "11111111111111111111111111111111",
    balance: async () => 400_005_000n,
    send: async (signed) => (sent.push(signed), took),
    ...(solStatus ? { status: async () => solStatus() } : {}),
  };
  const evm = {
    nonce: async () => 3,
    estimateGas: async () => 23_300n, // Robinhood Chain wants 23,300 gas for a plain transfer while its L1 price is on (mainnet 2 Nov)
    fees: async () => ({ tip: 1_000_000_000n, maxFee: 2_000_000_000n }),
    read: async () => "0x" + (10n ** 16n).toString(16),
    send: async (_c: string, signed: string) => (sent.push(signed), took),
  } as unknown as EvmChain;
  const vault = new MemoryVault();
  // `reopen`: the same phone after the app was closed (a new core over the same vault: nothing kept in memory)
  const reopen = () => new SubWallets({ vault, sol, evm, floatRelay: fake.r, mainAccount: async () => MAIN, usdPrice: async (c) => (c === "sol" ? 150 : c === "hood" ? 3000 : 600), approve: async (words) => (shown.push(words), answer), emit: () => {}, quoteKey: TEST_QUOTE_KEY });
  const w = reopen();
  const float = await w.create("trade", "near");
  const sol0 = await w.create("trade", "sol", 0);
  return { w, float, sol0, shown, sent, vault, reopen, ...fake };
}

test("out: the core asks 1Click itself, for its own wallet, with refunds to the float; checks the transfer, signs it as the float, and sends it", async () => {
  const { w, float, sol0, asked, submitted, shown, set } = await setup();
  // 0.1 SOL is $15 at $150: 1Click asks $15.30 of USDC for it.
  const m = await w.floatOut("sol", 0, "100000000", key(1));
  assert.ok(!("declined" in m));
  assert.deepEqual([m.kind, m.chain, m.slot, m.status, m.where], ["out", "sol", 0, "pending", "in-flight"]);
  assert.deepEqual(m.sent, { tokenId: FLOAT_USDC, amount: "15300000" });
  assert.deepEqual(m.expected, { tokenId: "nep141:sol.omft.near", amount: "100000000" });
  const req = asked[0];
  assert.deepEqual(
    [req.originAsset, req.depositType, req.destinationAsset, req.swapType, req.amount, req.recipient, req.recipientType, req.refundTo, req.refundType, req.confidentiality],
    [FLOAT_USDC, "CONFIDENTIAL_INTENTS", "nep141:sol.omft.near", "EXACT_OUTPUT", "100000000", sol0.address, "DESTINATION_CHAIN", float.address, "CONFIDENTIAL_INTENTS", "basic"],
  );
  assert.equal(submitted.length, 1);
  const s = submitted[0];
  assert.equal(s.public_key, `ed25519:${(await import("./sol/bytes.ts")).base58(fromHex(float.address))}`, "signed by the float's own key");
  assert.ok(ed25519.verify(fromBase58(s.signature.slice(8)), nep413Hash(s.payload), fromHex(float.address)));
  assert.equal(shown.length, 0, "no sheet: inside the fee guard");
  assert.equal((await w.floatLimits()).movesLeftToday, FLOAT_MOVES_PER_DAY - 1);
  // UI's AgentZero walk (3 Nov): asked for, the core's own price of each open chain's coin, read only (a sheet refuses
  // before the Approve when its own is too far from it); control: not asked, none
  const lim = await w.floatLimits(true);
  assert.deepEqual(Object.fromEntries(lim.open.map((c) => [c, lim.prices?.[c]])), Object.fromEntries(lim.open.map((c) => [c, c === "sol" ? 150 : c === "hood" ? 3000 : 600])));
  assert.equal((await w.floatLimits()).prices, undefined);
  set("SUCCESS");
  const done = await w.floatMove(m.id);
  assert.deepEqual([done.status, done.where], ["done", "chain"]);
});

test("lap FAIL 3 (QA, 5 Nov: \"Done in 51 s\" 1 m 27 s before the SOL landed): a move out is done only once its chain shows 1Click's landing; 1Click's SUCCESS alone keeps it on its way (control: the chain shows it, done; no landing named, 1Click's word as before)", async () => {
  const LANDING = "5d8qHUaSm3aPq7LrNnZfY4u3wP5d8qHUaSm3aPq7LrNnZfY4u3wP";
  let chain: ("ok" | "failed" | null)[] = [null, null];
  const { w, set } = await setup({ details: () => ({ amountOut: "100000000", destinationChainTxHashes: [{ hash: LANDING }] }) }, true, true, () => chain);
  const m = await w.floatOut("sol", 0, "100000000", key(91));
  assert.ok(!("declined" in m));
  set("SUCCESS");
  const early = await w.floatMove(m.id);
  assert.deepEqual([early.status, early.where], ["pending", "in-flight"], "1Click said SUCCESS; the chain's nodes don't show it yet");
  chain = ["ok", null];
  const done = await w.floatMove(m.id);
  assert.deepEqual([done.status, done.where], ["done", "chain"], "the chain shows the landing: done");
  assert.equal(done.proof?.end?.hash, LANDING);
  // control: 1Click names no landing (nothing to read): its word, as before
  const plain = await setup({}, true, true, () => [null, null]);
  const n = await plain.w.floatOut("sol", 0, "100000000", key(92));
  assert.ok(!("declined" in n));
  plain.set("SUCCESS");
  assert.equal((await plain.w.floatMove(n.id)).status, "done");
});

test("out: the same key gives the same move and never a second one; a key reused for another move is refused", async () => {
  const { w, asked, submitted } = await setup();
  const first = await w.floatOut("sol", 0, "100000000", key(2));
  const again = await w.floatOut("sol", 0, "100000000", key(2));
  assert.deepEqual(again, first);
  assert.equal(asked.length, 1);
  assert.equal(submitted.length, 1);
  await assert.rejects(w.floatOut("sol", 0, "200000000", key(2)), (e: any) => e.problem.code === "security.request.invalid");
  await assert.rejects(w.floatOut("sol", 0, "100000000", "short"), (e: any) => e.problem.code === "security.request.invalid");
  assert.equal((await w.floatMoveList()).length, 1);
});

test("out: a quote that isn't the one asked for is never signed, and the move gives its place back", async () => {
  const cases: [string, Parameters<typeof relay>[0]][] = [
    ["another recipient", { lie: (q) => ({ ...q, recipient: "So11111111111111111111111111111111111111112" }) }],
    ["another coin", { lie: (q) => ({ ...q, destinationAsset: "nep141:eth.omft.near" }) }],
    ["refunds elsewhere", { lie: (q) => ({ ...q, refundTo: "e".repeat(64) }) }],
    ["paid from somewhere else", { lie: (q) => ({ ...q, depositType: "INTENTS" }) }],
    ["a price far over the core's", { amountIn: () => "17000000" }],
  ];
  for (const [what, o] of cases) {
    const { w, submitted } = await setup(o);
    await assert.rejects(w.floatOut("sol", 0, "100000000", key(3)), (e: any) => e.problem.code === "security.subwallet.refused", what);
    assert.equal(submitted.length, 0, `${what}: nothing sent`);
    assert.equal((await w.floatLimits()).movesLeftToday, FLOAT_MOVES_PER_DAY, `${what}: its place is back`);
    const [m] = await w.floatMoveList();
    assert.deepEqual([m.status, m.where], ["failed", "float"], what);
  }
});

test("out: with no answer from 1Click the signed move stays pending, and asking where it is sends it again", async () => {
  let down = true;
  const { w, submitted } = await setup({ submit: async () => { if (down) throw new Error("no answer"); return { intentHash: "h" }; } });
  const m = await w.floatOut("sol", 0, "100000000", key(4));
  assert.ok(!("declined" in m));
  assert.deepEqual([m.status, m.where], ["pending", "float"]);
  down = false;
  const later = await w.floatMove(m.id);
  assert.equal(later.where, "in-flight");
  assert.equal(submitted.length, 2, "the same signed transfer, sent again");
});

test("out: 1Click's own no ends the move there, with its place back", async () => {
  const { w } = await setup({ submit: async () => { throw Object.assign(new Error("Not enough balance"), { refused: true }); } });
  await assert.rejects(w.floatOut("sol", 0, "100000000", key(5)), (e: any) => e.problem.code === "security.subwallet.refused" && e.problem.more === "NEAR Intents didn't take it. Check Activity for where your money is." && e.cause?.message === "Not enough balance", "QA 16's MUST: its own words on the cause only");
  assert.equal((await w.floatLimits()).movesLeftToday, FLOAT_MOVES_PER_DAY);
  const [m] = await w.floatMoveList();
  assert.equal(m.status, "failed");
});

test("home: to the account's own main balance inside NEAR Intents, never anywhere else; a refund comes back to the float", async () => {
  const { w, float, asked, set } = await setup();
  const m = await w.floatHome("25000000", key(6));
  assert.ok(!("declined" in m));
  const req = asked[0];
  assert.deepEqual([req.originAsset, req.destinationAsset, req.swapType, req.amount, req.recipient, req.recipientType, req.refundTo], [FLOAT_USDC, FLOAT_USDC, "EXACT_INPUT", "25000000", MAIN, "INTENTS", float.address]);
  set("REFUNDED");
  const back = await w.floatMove(m.id);
  assert.deepEqual([back.status, back.where], ["refunded", "float"]);
});

test("past 20 moves in 24 hours a move out or in is refused, named (D143: no sheet); nothing moves; its place is given back; home and a Move back still go", async () => {
  const { w, shown, submitted, sent, asked } = await setup();
  const site = await w.create("site", "sol", undefined, "pump");
  const places = [];
  for (let i = 0; i < FLOAT_MOVES_PER_DAY; i++) places.push(await w.floatGuard.take(5));
  const pastMoves = (e: any) => e.problem?.code === "security.subwallet.refused" && e.problem.more === `Your NEAR wallet made ${FLOAT_MOVES_PER_DAY} moves in 24 hours. Each costs fees, so the next one waits a day. Nothing moved.`;
  await assert.rejects(w.floatOut("sol", 0, "100000000", key(7)), pastMoves);
  await assert.rejects(w.floatIn("sol", 0, "100000000", key(77)), pastMoves);
  assert.equal(asked.length + submitted.length + sent.length, 0, "nothing asked, signed or sent");
  assert.equal(shown.length, 0, "no sheet");
  assert.equal((await w.floatMoveList()).length, 0, "nothing kept");
  // each refused move gave its place back: with one of the day's 20 freed, the next move out goes (had the two refused
  // ones kept theirs, it would be refused too)
  await places[0]!.release();
  const m = await w.floatOut("sol", 0, "100000000", key(78));
  assert.ok(!("declined" in m) && m.status === "pending");
  assert.equal(submitted.length, 1);
  await assert.rejects(w.floatOut("sol", 0, "100000000", key(79)), pastMoves, "past it again");
  // control: money going home to the Safe and a site wallet's Move back always go, past the guard too
  const home = await w.floatHome("25000000", key(80));
  assert.ok(!("declined" in home) && home.kind === "home");
  const back = await w.siteMoveBack(site.id, "all", "moveback-key-pastguard");
  assert.ok(!("declined" in back) && back.kind === "in");
  assert.equal(shown.length, 0);
});

test("past $1,000 moved in 24 hours a move out or in is refused in dollars, named; nothing moves; its dollars are given back; home still goes", async () => {
  // 1Click asks 2 % over the core's price for an exact SOL out
  const { w, shown, submitted, sent, asked } = await setup({ amountIn: (req) => (req.swapType === "EXACT_OUTPUT" ? String(Math.round((Number(req.amount) / 1e9) * 150 * 1.02 * 1e6)) : req.amount) });
  await w.floatGuard.take(990);
  const pastDollars = (e: any) => e.problem?.code === "security.subwallet.refused" && e.problem.more === "Over $1,000 moved inside your NEAR wallet in 24 hours. Each move costs fees, so the next one waits a day. Nothing moved.";
  await assert.rejects(w.floatOut("sol", 0, "100000000", key(8)), pastDollars, "$15 more would pass $1,000");
  await assert.rejects(w.floatIn("sol", 0, "100000000", key(9)), pastDollars);
  assert.equal(asked.length + submitted.length + sent.length, 0, "nothing asked, signed or sent");
  assert.equal(shown.length, 0, "no sheet");
  // their dollars were given back: $9 more still fits under $1,000 (it wouldn't with a refused $15 still counted)
  const m = await w.floatOut("sol", 0, "60000000", key(10));
  assert.ok(!("declined" in m) && m.status === "pending");
  assert.equal(submitted.length, 1);
  // control: money going home never counts against the dollars
  const home = await w.floatHome("25000000", key(11));
  assert.ok(!("declined" in home) && home.kind === "home");
});

test("what isn't open or set up yet is refused before anything is asked", async () => {
  const { w, asked } = await setup();
  await assert.rejects(w.floatOut("bsc", 0, "1000000000000000", key(8)), (e: any) => e.problem.code === "security.subwallet.refused", "BNB Chain waits for its test");
  await assert.rejects(w.floatOut("sol", 3, "100000000", key(9)), (e: any) => e.problem.code === "security.subwallet.unknown", "no wallet in slot 3");
  await assert.rejects(w.floatOut("sol", 0, "1000000", key(10)), (e: any) => e.problem.code === "security.request.not-allowed", "$0.15 is under $2");
  assert.equal(asked.length, 0);
  const bare = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, usdPrice: async () => 150, approve: async () => true, emit: () => {} });
  await bare.create("trade", "near");
  await bare.create("trade", "sol");
  await assert.rejects(bare.floatOut("sol", 0, "100000000", key(11)), (e: any) => e.problem.code === "security.subwallet.refused", "no relay: not set up");
  await assert.rejects(w.floatMove("fm-nothing"), (e: any) => e.problem.code === "security.float.unknown-move");
});

test("in: a fresh one-time deposit address for each move, then the core's own transfer of exactly the quote's amount, as the wallet", async () => {
  const { w, float, sol0, asked, sent, set } = await setup();
  const m = await w.floatIn("sol", 0, "100000000", key(20));
  assert.ok(!("declined" in m));
  assert.deepEqual([m.kind, m.status, m.where], ["in", "pending", "in-flight"]);
  const req = asked[0];
  assert.deepEqual(
    [req.originAsset, req.depositType, req.destinationAsset, req.swapType, req.amount, req.recipient, req.recipientType, req.refundTo, req.refundType, req.confidentiality],
    ["nep141:sol.omft.near", "ORIGIN_CHAIN", FLOAT_USDC, "EXACT_INPUT", "100000000", float.address, "CONFIDENTIAL_INTENTS", float.address, "CONFIDENTIAL_INTENTS", "basic"],
  );
  assert.equal(sent.length, 1);
  const d = decodeSolTx(sent[0]);
  assert.equal(d.feePayer, sol0.address);
  assert.deepEqual(d.transfers, [{ to: SOL_DEPOSIT, lamports: "100000000" }]);
  assert.deepEqual(d.unknownPrograms, []);
  set("SUCCESS");
  const done = await w.floatMove(m.id);
  assert.deepEqual([done.status, done.where], ["done", "float"]);
  // "all": what the wallet holds less its network fee (a new quote, still waiting).
  set("PENDING_DEPOSIT");
  await w.floatIn("sol", 0, "all", key(21));
  assert.equal(asked[1].amount, "400000000");
});

test("in from Robinhood Chain: a plain ETH transfer the core builds, after the wallet's own earlier ones", async () => {
  const { w, sent } = await setup();
  await w.create("trade", "hood", 2);
  const m = await w.floatIn("hood", 2, "5000000000000000", key(22));
  assert.ok(!("declined" in m));
  const t = parseTx(fromBase64Signed(sent[0]));
  assert.deepEqual([t.to, t.value, t.data, t.nonce, t.gas], [EVM_DEPOSIT, 5_000_000_000_000_000n, "0x", 3, 27_960n], "the nodes' 23,300 and a fifth more, never a fixed 21,000");
});

test("in: its network fee, signed with no sheet, is at most 2% of the move (audit NF-16), and never more than it was checked at", async () => {
  const { w, sent, vault } = await setup();
  await w.create("trade", "hood", 2);
  // 21,000 gas at 2 gwei is about $0.13 of ETH at $3,000: more than 2% of a $3 move.
  await assert.rejects(w.floatIn("hood", 2, "1000000000000000", key(23)), (e: any) => e.problem?.code === "security.fee.high");
  assert.equal(sent.length, 0, "nothing signed");
  assert.ok(!("declined" in (await w.floatIn("hood", 2, "5000000000000000", key(24)))), "$15: 0.8%, it goes");
  // The fee rises between the check and the transfer: refused, not paid at the higher fee.
  let asked = 0;
  const signedAt: string[] = [];
  const rising = { nonce: async () => 3, estimateGas: async () => 23_300n, fees: async () => ({ tip: 1_000_000_000n, maxFee: (asked++ === 0 ? 2n : 4n) * 1_000_000_000n }), read: async () => "0x" + (10n ** 16n).toString(16), send: async (_c: string, s: string) => (signedAt.push(s), true) } as unknown as EvmChain;
  const w2 = new SubWallets({ vault, sol: {} as SolChain, evm: rising, floatRelay: relay().r, mainAccount: async () => MAIN, usdPrice: async () => 3000, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY });
  const m = await w2.floatIn("hood", 2, "5000000000000000", key(25));
  assert.ok(!("declined" in m) && m.where === "chain", "never in flight");
  assert.equal(signedAt.length, 0, "not signed at twice the fee it was checked at");
});

test("in: a quote that isn't the one asked for is never paid", async () => {
  const cases: [string, Parameters<typeof relay>[0]][] = [
    ["pays someone else", { lie: (q) => ({ ...q, recipient: "e".repeat(64) }) }],
    ["refunds to the wallet (a link)", { lie: (q) => ({ ...q, refundTo: "e".repeat(64), refundType: "ORIGIN_CHAIN" }) }],
    ["another amount", { amountIn: () => "200000000" }],
    ["a price far under the core's", { minOut: () => "10000000" }],
  ];
  for (const [what, o] of cases) {
    const { w, sent } = await setup(o);
    await assert.rejects(w.floatIn("sol", 0, "100000000", key(23)), (e: any) => e.problem.code === "security.subwallet.refused", what);
    assert.equal(sent.length, 0, `${what}: nothing sent`);
    assert.equal((await w.floatLimits()).movesLeftToday, FLOAT_MOVES_PER_DAY, what);
  }
});

test("a relay that changes what 1Click signed is refused on every path: nothing paid, signed or kept (outside study item 2)", async () => {
  // The relay asks 1Click for a quote that pays the thief, then shows the core the terms it asked for: the signature
  // is 1Click's, but over the thief's terms, so the core believes none of what it's shown, however right it looks.
  const thief = "e".repeat(64);
  const asked = (_signed: any, asked: any) => asked;
  const cases: [string, Parameters<typeof relay>[0]][] = [
    ["1Click's quote pays the thief", { lie: (q) => ({ ...q, recipient: thief }), forge: asked }],
    ["1Click's quote refunds to the thief", { lie: (q) => ({ ...q, refundTo: thief }), forge: asked }],
    ["1Click's quote is for more", { lie: (q) => ({ ...q, amount: String(BigInt(q.amount) * 10n) }), forge: asked }],
  ];
  for (const [what, o] of cases) {
    const into = await setup(o);
    await assert.rejects(into.w.floatIn("sol", 0, "all", key(41)), (e: any) => e.problem.code === "security.subwallet.refused", `in, ${what}`);
    assert.equal(into.sent.length, 0, `in, ${what}: nothing paid`);
    const out = await setup(o);
    await assert.rejects(out.w.floatOut("sol", 0, "100000000", key(42)), (e: any) => e.problem.code === "security.subwallet.refused", `out, ${what}`);
    assert.equal(out.submitted.length, 0, `out, ${what}: nothing signed or sent`);
    const add = await setup({ ...o, deposit: () => "a".repeat(64) });
    await assert.rejects(add.w.floatQuoteAdd("10000000"), (e: any) => e.problem.code === "security.subwallet.refused", `Add, ${what}`);
    assert.equal(await add.w.floatAddFacts("a".repeat(64)), null, `Add, ${what}: never kept for the main sheet`);
  }
  // A real 1Click signature for ANOTHER deposit address doesn't vouch for this one.
  const swapped = await setup({ deposit: (req) => (req.depositType === "ORIGIN_CHAIN" ? SOL_DEPOSIT : "b".repeat(64)) });
  const status = swapped.r.status;
  swapped.r.status = async (a, t) => {
    const s: any = await status(a, t);
    return s && { ...s, quoteResponse: { ...s.quoteResponse, quote: { ...s.quoteResponse.quote, depositAddress: "c".repeat(64) } } };
  };
  await assert.rejects(swapped.w.floatIn("sol", 0, "100000000", key(43)), (e: any) => e.problem.code === "security.subwallet.refused");
  assert.equal(swapped.sent.length, 0);
});

test("in: when no node takes the transfer, the move stays pending on the chain, and its price running out ends it there", async () => {
  const { w } = await setup({}, true, false);
  const m = await w.floatIn("sol", 0, "100000000", key(24));
  assert.ok(!("declined" in m));
  assert.deepEqual([m.status, m.where], ["pending", "chain"]);
});

function fromBase64Signed(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

function fromHex(h: string): Uint8Array {
  return Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
}

test("the Add's quote: the core asks for it itself, USDC into the float with refunds to the float; only that quote is read for the main sheet", async () => {
  const hex = (n: number) => n.toString(16).padStart(64, "a");
  let n = 0;
  const { w, float, asked } = await setup({ deposit: () => hex(++n), minOut: (req) => String((BigInt(req.amount) * 99n) / 100n) });
  const q = await w.floatQuoteAdd("10000000");
  assert.deepEqual(q, { depositAddress: hex(1), amountIn: "10000000", minAmountOut: "9900000", deadlineIso: q.deadlineIso });
  const req = asked[0];
  assert.deepEqual([req.originAsset, req.depositType, req.destinationAsset, req.swapType], [FLOAT_USDC, "ORIGIN_CHAIN", FLOAT_USDC, "EXACT_INPUT"]);
  assert.deepEqual([req.recipient, req.recipientType, req.refundTo, req.refundType], [float.address, "CONFIDENTIAL_INTENTS", float.address, "CONFIDENTIAL_INTENTS"]);
  assert.equal(JSON.stringify(req).includes(MAIN), false, "the main account's name is never in it");
  const facts: any = await w.floatAddFacts(hex(1));
  assert.equal(facts.quoteResponse.quoteRequest.recipient, float.address);
  assert.equal(await w.floatAddFacts(hex(9)), null, "an address this core didn't ask for is 1Click's to answer");

  await assert.rejects(w.floatQuoteAdd("1000000"), (e: any) => e.problem.code === "security.request.not-allowed", "$1 is under $2");
  await assert.rejects(w.floatQuoteAdd("10.5"), (e: any) => e.problem.code === "security.request.invalid");
  assert.equal(asked.length, 1, "refused before anything is asked");

  const lying = await setup({ deposit: () => hex(++n), lie: (r) => ({ ...r, recipient: "e".repeat(64) }) });
  await assert.rejects(lying.w.floatQuoteAdd("10000000"), (e: any) => e.problem.code === "security.subwallet.refused");
  assert.equal(await lying.w.floatAddFacts(hex(n)), null, "a quote that isn't the one asked for is never kept");
});

test("the Add paid in another coin: converted inside it, USDC promised to the float; under $2 promised, or another coin, refused", async () => {
  const WNEAR = "nep141:wrap.near";
  const hex = (n: number) => n.toString(16).padStart(64, "c");
  let n = 0;
  // 5 NEAR: 1Click promises 12.40 USDC to the float.
  const { w, float, asked, set } = await setup({ deposit: () => hex(++n), minOut: (req) => (req.originAsset === WNEAR ? (BigInt(req.amount) >= 10n ** 24n ? "12400000" : "1500000") : String(req.amount)) });
  const q = await w.floatQuoteAdd(String(5n * 10n ** 24n), WNEAR);
  assert.deepEqual([q.amountIn, q.minAmountOut], [String(5n * 10n ** 24n), "12400000"]);
  const req = asked[0];
  assert.deepEqual([req.originAsset, req.depositType, req.destinationAsset, req.swapType, req.amount], [WNEAR, "ORIGIN_CHAIN", FLOAT_USDC, "EXACT_INPUT", String(5n * 10n ** 24n)]);
  assert.deepEqual([req.recipient, req.recipientType, req.refundTo, req.refundType], [float.address, "CONFIDENTIAL_INTENTS", float.address, "CONFIDENTIAL_INTENTS"]);
  assert.ok(await w.floatAddFacts(hex(1)), "kept for the main sheet, which matches the paid coin to the quote's");
  await assert.rejects(w.floatQuoteAdd(String(10n ** 23n), WNEAR), (e: any) => e.problem.code === "security.request.not-allowed", "0.1 NEAR promises $1.50: under $2");
  await assert.rejects(w.floatQuoteAdd("5", "wrap.near"), (e: any) => e.problem.code === "security.request.invalid", "not a nep141 id");
  await assert.rejects(w.floatQuoteAdd("0", WNEAR), (e: any) => e.problem.code === "security.request.invalid");
  // Once 1Click says it settled, the float counts the USDC it got.
  set("SUCCESS");
  assert.deepEqual((await w.floatBalance()).tokens, [{ tokenId: FLOAT_USDC, amount: "12400000" }]);
  const lying = await setup({ deposit: () => hex(++n), lie: (r) => ({ ...r, originAsset: FLOAT_USDC }), minOut: () => "12400000" });
  await assert.rejects(lying.w.floatQuoteAdd(String(5n * 10n ** 24n), WNEAR), (e: any) => e.problem.code === "security.subwallet.refused", "a quote for another coin");
});

test("the balance is the core's own count: an Add once 1Click says it settled, a move out once signed, a refund back; Take out \"all\" takes that", async () => {
  const hex = (n: number) => n.toString(16).padStart(64, "b");
  let n = 0;
  const isAdd = (req: any) => req.originAsset === FLOAT_USDC && req.depositType === "ORIGIN_CHAIN";
  const { w, asked, set } = await setup({
    deposit: (req) => (isAdd(req) ? hex(++n) : undefined),
    minOut: (req) => (isAdd(req) ? "49500000" : undefined) as string,
    // The Add: 49.90 USDC settled into the float. A move out: all of it came back.
    details: (req) => (isAdd(req) ? { amountOut: "49900000", refundedAmount: "0" } : { refundedAmount: "15300000" }),
  });
  const usdc = async () => (await w.floatBalance()).tokens.find((t) => t.tokenId === FLOAT_USDC)?.amount ?? "0";
  assert.deepEqual((await w.floatBalance()).tokens, []);
  await w.floatQuoteAdd("50000000");
  assert.equal(await usdc(), "0", "an Add not yet paid is nothing");
  set("SUCCESS");
  assert.equal(await usdc(), "49900000", "what 1Click says settled, not what was asked");
  assert.equal((await w.floatBalance()).usd, 49.9);
  assert.deepEqual(await w.floatMoveList(), [], "an Add isn't one of Trade's moves");

  set("PENDING_DEPOSIT");
  const out = await w.floatOut("sol", 0, "100000000", key(30));
  assert.ok(!("declined" in out));
  assert.equal(await usdc(), String(49_900_000 - 15_300_000), "gone once signed");
  set("REFUNDED");
  assert.equal(await usdc(), "49900000", "refunded: back in the float");

  set("PENDING_DEPOSIT");
  const home = await w.floatHome("all", key(31));
  assert.ok(!("declined" in home));
  assert.equal(asked.at(-1).amount, "49900000");
  assert.deepEqual((await w.floatBalance()).tokens, []);
  const again: any = await w.floatHome("all", key(31));
  assert.deepEqual([again.id, again.sent], [home.id, (home as any).sent], "the same key, the same move");
  await assert.rejects(w.floatHome("all", key(32)), (e: any) => e.problem.code === "security.request.invalid", "nothing left to take out");
});

test("a move in that 1Click refunds leaves the chain's coin in the float; moves let go after a week stay counted", async () => {
  const { w, vault, set } = await setup({ details: () => ({ refundedAmount: "100000000" }) });
  const m = await w.floatIn("sol", 0, "100000000", key(40));
  assert.ok(!("declined" in m));
  set("REFUNDED");
  const b = await w.floatBalance();
  assert.deepEqual(b.tokens, [{ tokenId: "nep141:sol.omft.near", amount: "100000000" }]);
  assert.equal(b.usd, 15, "0.1 SOL at $150");

  // A record from before float.balance (the list alone), with a move in settled eight days ago.
  const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
  const settled = { key: key(41), fields: "x", depositAddress: SOL_DEPOSIT, settled: { amountOut: "7000000" }, move: { id: `fm-${key(41)}`, kind: "in", chain: "sol", slot: 0, status: "done", where: "float", sent: { tokenId: "nep141:sol.omft.near", amount: "50000000" }, expected: { tokenId: FLOAT_USDC, amount: "6900000" }, usd: 7.5, startedAtIso: old, updatedAtIso: old } };
  await vault.put("float-move-log", new TextEncoder().encode(JSON.stringify([settled])));
  assert.equal((await w.floatBalance()).tokens.find((t) => t.tokenId === FLOAT_USDC)?.amount, "7000000");
  await w.floatOut("sol", 0, "100000000", key(42)).catch(() => undefined);
  const after = JSON.parse(new TextDecoder().decode((await vault.get("float-move-log"))!));
  assert.ok(!after.kept.some((k: any) => k.key === key(41)), "let go");
  assert.equal(after.base[FLOAT_USDC], "7000000", "and folded into the base");
});

test("a relay that says a move went through when it didn't: within minutes the balance is what 1Click itself holds", async () => {
  let held = "0";
  const oneClickFetch = (async (url: string) =>
    url.endsWith("/auth/authenticate") ? new Response(JSON.stringify({ accessToken: "s" })) : new Response(JSON.stringify({ balances: [{ tokenId: FLOAT_USDC, available: held, source: "private" }] }))) as typeof fetch;
  const fake = relay({ deposit: () => "ab".repeat(32), details: () => ({ amountOut: "10000000" }) });
  const w = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm: {} as EvmChain, floatRelay: fake.r, mainAccount: async () => MAIN, usdPrice: async () => 150, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY, intentsSalt: async () => "252812b3", oneClickFetch });
  await w.create("trade", "near");
  assert.deepEqual((await w.floatBalance()).tokens, [], "starts from what 1Click holds: nothing");
  await w.floatQuoteAdd("10000000");
  // The relay says the Add went through; 1Click itself still holds nothing for the float.
  fake.set("SUCCESS");
  assert.deepEqual((await w.floatBalance()).tokens, [{ tokenId: FLOAT_USDC, amount: "10000000" }], "the count believes it at first");
  const realNow = Date.now;
  Date.now = () => realNow() + 6 * 60_000;
  try {
    assert.deepEqual((await w.floatBalance()).tokens, [], "held against 1Click's own balance: corrected");
    held = "10000000";
    Date.now = () => realNow() + 12 * 60_000;
    assert.deepEqual((await w.floatBalance()).tokens, [{ tokenId: FLOAT_USDC, amount: "10000000" }], "and when it does arrive, it shows");
  } finally {
    Date.now = realNow;
  }
});

test("a phone with no count (a restore) starts Trading's balance from what 1Click holds for the float; unread is never zero", async () => {
  const make = async (answer: () => Response) => {
    let calls = 0;
    const oneClickFetch = (async (url: string) => {
      calls++;
      return url.endsWith("/auth/authenticate") ? new Response(JSON.stringify({ accessToken: "s" })) : answer();
    }) as typeof fetch;
    const w = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm: {} as EvmChain, floatRelay: relay().r, mainAccount: async () => MAIN, usdPrice: async () => 150, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY, intentsSalt: async () => "252812b3", oneClickFetch });
    await w.create("trade", "near");
    return { w, calls: () => calls };
  };
  const restored = await make(() => new Response(JSON.stringify({ balances: [{ tokenId: FLOAT_USDC, available: "25000000", source: "private" }] })));
  const b = await restored.w.floatBalance();
  assert.deepEqual([b.tokens, b.usd, b.unread], [[{ tokenId: FLOAT_USDC, amount: "25000000" }], 25, undefined]);
  const reads = restored.calls();
  await restored.w.floatBalance();
  assert.equal(restored.calls(), reads, "read once: from then on it's the phone's own count");
  const down = await make(() => new Response("", { status: 503 }));
  const u = await down.w.floatBalance();
  assert.deepEqual([u.tokens, u.unread], [[], true], "1Click unreachable: the balance is unknown, not $0");
});

test("a fresh account (mainnet, 1 Nov): Trading's balance not made yet reads as what 1Click holds for the words' own address, $0, never unread for good", async () => {
  const make = async (answer: () => Response, root = true) => {
    const signers: string[] = [];
    const oneClickFetch = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/authenticate")) {
        signers.push(JSON.parse(JSON.parse(String(init?.body)).signedData.payload.message).signer_id);
        return new Response(JSON.stringify({ accessToken: "s" }));
      }
      return answer();
    }) as typeof fetch;
    const vault = new MemoryVault();
    if (root) await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(7)));
    const w = new SubWallets({ vault, sol: {} as SolChain, evm: {} as EvmChain, floatRelay: relay().r, mainAccount: async () => MAIN, usdPrice: async () => 150, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY, intentsSalt: async () => "252812b3", oneClickFetch });
    return { w, signers };
  };
  // the old code threw "Make the Trading balance first" here: unread, so Spending never loaded and a Top up (the one
  // thing that makes it) was refused as "still getting ready"
  const fresh = await make(() => new Response(JSON.stringify({ balances: [] })));
  const b = await fresh.w.floatBalance();
  assert.deepEqual([b.tokens, b.usd, b.unread], [[], 0, undefined], "1Click says the float's address holds nothing: $0, loaded");
  assert.deepEqual(await fresh.w.list(), [], "a read makes no wallet");
  const made = await fresh.w.create("trade", "near");
  assert.deepEqual(fresh.signers, [made.address], "it asked for the very address the first Top up then makes");
  // a restore: the words' float holds money and this phone has no count yet
  const restored = await make(() => new Response(JSON.stringify({ balances: [{ tokenId: FLOAT_USDC, available: "12000000", source: "private" }] })));
  assert.equal((await restored.w.floatBalance()).usd, 12, "a restore counts what the words' float holds");
  // the rule stands: a read that failed is never $0
  const down = await make(() => new Response("", { status: 503 }));
  const u = await down.w.floatBalance();
  assert.deepEqual([u.tokens, u.unread], [[], true], "1Click unreachable: unknown, not $0");
  // an account with no words' root makes its float from a random key, kept here first: none listed, none anywhere
  const noRoot = await make(() => assert.fail("nothing to ask 1Click about"), false);
  const n = await noRoot.w.floatBalance();
  assert.deepEqual([n.tokens, n.usd, n.unread], [[], 0, undefined]);
});

test("D56: a wallet whose key was shown is marked before the key leaves the core, stays its chain's one, and is filled as before", async () => {
  const { w, asked } = await setup();
  const current = await w.create("chain", "sol");
  // Security's own list exports straight through subwallet.export, not Spending's: the core's mark still holds
  await w.export(current.id);
  const listed = (await w.list()).find((x) => x.id === current.id)!;
  assert.deepEqual([listed.keyExported, listed.current], [true, true], "marked, and still the Solana wallet");
  const m = await w.floatOut("sol", undefined, "100000000", key(50));
  assert.ok(!("declined" in m), "filled as before, bounded by the cap and the fee guard");
  assert.equal(asked[0].recipient, current.address);
  const back = await w.floatIn("sol", undefined, "100000000", key(51), current.id);
  assert.ok(!("declined" in back) && back.kind === "in", "its money comes back to Trading as before");
});

test("D55: after a restore every used wallet comes back unmarked; the words' index 0 is each chain's wallet, the rest are older and still drain", async () => {
  const { hotRoot } = await import("./hot-keys.ts");
  const { w, vault } = await setup();
  await vault.put("hot-root", hotRoot(new Uint8Array(32).fill(9)));
  const found = await w.rediscover(["trade", "private", "browser", "pay"]);
  assert.ok(found.length > 0);
  const list = await w.list();
  assert.ok(!list.some((x) => "fromRestore" in x), "no restore mark");
  for (const chain of ["sol", "bsc", "hood"]) assert.equal(list.filter((x) => x.chain === chain && x.current).length, 1, `${chain}: one current wallet`);
  const older = list.find((x) => x.chain === "sol" && x.slot === 2)!;
  assert.equal(older.current, false);
  const back = await w.floatIn("sol", undefined, "100000000", key(61), older.id);
  assert.ok(!("declined" in back) && back.kind === "in", "an older wallet's money comes back to Trading");
});

test("a declined key export marks nothing", async () => {
  const { w, sol0 } = await setup({}, false);
  assert.deepEqual(await w.export(sol0.id), { declined: true });
  assert.ok(!(await w.list()).some((x) => x.keyExported));
});

test("a site's own wallet (Job 3): Spending fills it by id (Make ready), and never takes money out of it; control: the chain wallet both ways", async () => {
  const { w, asked, sent } = await setup();
  const site = await w.create("site", "sol", undefined, "pump");
  const m = await w.floatOut("sol", undefined, "100000000", key(900), site.id);
  assert.ok(!("declined" in m) && m.status === "pending", "filled by its id");
  assert.equal(asked.at(-1).recipient, site.address, "to the site's own address");
  const before = sent.length;
  await assert.rejects(w.floatIn("sol", undefined, "100000000", key(901), site.id), (e: any) => e.problem.code === "security.subwallet.unknown", "never a move out of it");
  await assert.rejects(w.floatIn("sol", undefined, "all", key(902), site.id), (e: any) => e.problem.code === "security.subwallet.unknown");
  assert.equal(sent.length, before, "nothing signed or sent from it");
  const control = await w.floatIn("sol", 0, "100000000", key(903));
  assert.ok(!("declined" in control), "the chain wallet still moves back to Trading");
});

test("AgentZero's pocket (D90; P1's review): Spending never fills it by id, so no move nobody approved raises AgentZero's budget; control: pump.fun's wallet fills", async () => {
  const { w, asked, sent } = await setup();
  const pocket = await w.create("site", "sol", undefined, "agentzero");
  const site = await w.create("site", "sol", undefined, "pump");
  const asks = asked.length, sends = sent.length;
  await assert.rejects(w.floatOut("sol", undefined, "100000000", key(910), pocket.id), (e: any) => e.problem.code === "security.subwallet.refused" && /AgentZero's pocket is never filled/.test(e.problem.more));
  assert.equal(asked.length, asks, "no quote asked");
  assert.equal(sent.length, sends, "nothing signed or sent");
  await assert.rejects(w.floatIn("sol", undefined, "100000000", key(911), pocket.id), (e: any) => e.problem.code === "security.subwallet.unknown", "nor a move out of it");
  const m = await w.floatOut("sol", undefined, "100000000", key(912), site.id);
  assert.ok(!("declined" in m) && m.status === "pending", "control: a site's own wallet still fills by its id");
  assert.equal(asked.at(-1).recipient, site.address);
});

test("Social Trading's Move back: a site's wallet → Spending → the Safe, no sheet (D143: money only goes home); both legs confidential; Job 3's High still holds", async () => {
  const { w, float, asked, sent, shown, mark } = await setup();
  const site = await w.create("site", "sol", undefined, "pump");
  const m = await w.siteMoveBack(site.id, "all", "moveback-key-000001");
  assert.ok(!("declined" in m));
  assert.equal(shown.length, 0, "no sheet");
  // leg 1: the site's SOL into Spending's confidential balance, refunds there too, paid by the site's own wallet
  const req = asked.at(-1);
  assert.deepEqual([req.originAsset, req.depositType, req.recipient, req.recipientType, req.refundTo, req.refundType, req.confidentiality], ["nep141:sol.omft.near", "ORIGIN_CHAIN", float.address, "CONFIDENTIAL_INTENTS", float.address, "CONFIDENTIAL_INTENTS", "basic"]);
  assert.equal(decodeSolTx(sent.at(-1)!).feePayer, site.address);
  assert.deepEqual([m.kind, m.site, m.wallet], ["in", "pump", site.id]);
  // leg 2 starts by itself once leg 1 settles: exactly what arrived, home to the Safe inside NEAR Intents
  const [before] = await w.siteMoveBacks();
  assert.equal(before!.home, undefined, "control: not before leg 1 settled");
  mark(SOL_DEPOSIT, "SUCCESS");
  // D137 (product decision, 3 Nov): no private gap; the home leg starts on the same read that sees leg 1 settled, clock unmoved
  const [one] = await w.siteMoveBacks();
  assert.equal(one!.back.status, "done");
  assert.ok(one!.home, "home leg started at once (D137)");
  const home = asked.at(-1);
  assert.deepEqual([home.depositType, home.recipient, home.recipientType, home.refundTo, home.refundType], ["CONFIDENTIAL_INTENTS", MAIN, "INTENTS", float.address, "CONFIDENTIAL_INTENTS"]);
  // once: reading again starts no second home leg; the same key is the same move
  const n = asked.length;
  await w.siteMoveBacks();
  const again = await w.siteMoveBack(site.id, "all", "moveback-key-000001");
  assert.equal(asked.length, n);
  assert.ok(!("declined" in again) && again.id === m.id);
  assert.equal(shown.length, 0);
});

test("Move back: still nothing else takes from a site's wallet (Job 3's High), before or after one; another wallet or a bad key is refused; control: the Move back itself goes", async () => {
  const { w, sol0, asked, sent, shown } = await setup();
  const site = await w.create("site", "sol", undefined, "pump");
  await assert.rejects(w.floatIn("sol", undefined, "all", key(910), site.id), (e: any) => e.problem.code === "security.subwallet.unknown", "Trading's own move in can't");
  await assert.rejects(w.siteMoveBack("trade-sol-nope", "all", "moveback-key-000003"), (e: any) => e.problem.code === "security.subwallet.unknown", "a site's wallet only");
  await assert.rejects(w.siteMoveBack(sol0.id, "all", "moveback-key-000004"), (e: any) => e.problem.code === "security.subwallet.unknown", "never a chain wallet");
  await assert.rejects(w.siteMoveBack(site.id, "12", "short"), (e: any) => e.problem.code === "security.request.invalid", "a proper key");
  assert.equal(asked.length + sent.length, 0, "nothing asked, signed or sent");
  const m = await w.siteMoveBack(site.id, "all", "moveback-key-000002");
  assert.ok(!("declined" in m) && m.kind === "in" && m.wallet === site.id, "control: the Move back goes");
  assert.equal(sent.length, 1);
  await assert.rejects(w.floatIn("sol", undefined, "all", key(911), site.id), (e: any) => e.problem.code === "security.subwallet.unknown", "and after it, Trading's own move in still can't");
  assert.equal(sent.length, 1);
  assert.equal(shown.length, 0);
});

test("Move's take-out of every site wallet: each leg runs from its own wallet into Spending's confidential balance, no sheet (FLOW-V4; D143)", async () => {
  const { w, asked, sent, shown } = await setup();
  const pump = await w.create("site", "sol", undefined, "pump");
  const gmgn = await w.create("site", "sol", undefined, "gmgn");
  const asks = asked.length;
  const r = await w.siteMoveBackAll([{ id: pump.id, amount: "all", key: "movebackall-key-0001" }, { id: gmgn.id, amount: "all", key: "movebackall-key-0002" }]);
  assert.ok(Array.isArray(r), JSON.stringify(r));
  assert.equal(shown.length, 0, "no sheet");
  assert.equal(asked.length, asks + 2, "each leg its own confidential quote");
  assert.deepEqual(r.map((l) => [l.id, Boolean(l.move), l.move?.wallet]), [[pump.id, true, pump.id], [gmgn.id, true, gmgn.id]]);
  assert.deepEqual(sent.slice(-2).map((t) => decodeSolTx(t).feePayer).sort(), [pump.address, gmgn.address].sort(), "each from its own wallet");
});

test("Move's take-out of every site wallet: a wallet that isn't a site's, a repeat or a bad key is refused before any leg goes; control: the same legs then go", async () => {
  const { w, asked, sent, shown } = await setup();
  const pump = await w.create("site", "sol", undefined, "pump");
  const gmgn = await w.create("site", "sol", undefined, "gmgn");
  await assert.rejects(w.siteMoveBackAll([{ id: "trade-sol-nope", amount: "all", key: "movebackall-key-0005" }]), (e: any) => e.problem.code === "security.subwallet.unknown");
  await assert.rejects(w.siteMoveBackAll([{ id: pump.id, amount: "all", key: "movebackall-key-0008" }, { id: "trade-sol-nope", amount: "all", key: "movebackall-key-0009" }]), (e: any) => e.problem.code === "security.subwallet.unknown", "a good leg never goes before a bad one is checked");
  await assert.rejects(w.siteMoveBackAll([{ id: pump.id, amount: "all", key: "movebackall-key-0006" }, { id: pump.id, amount: "all", key: "movebackall-key-0007" }]), (e: any) => e.problem.code === "security.subwallet.unknown", "the same wallet twice");
  await assert.rejects(w.siteMoveBackAll([{ id: pump.id, amount: "all", key: "short" }]), (e: any) => e.problem.code === "security.request.invalid");
  await assert.rejects(w.siteMoveBackAll([]), (e: any) => e.problem.code === "security.request.invalid");
  assert.equal(asked.length + sent.length, 0, "nothing asked, signed or sent");
  // control: each refusal gave its wallet back (no reservation left behind), so the same two legs go
  const r = await w.siteMoveBackAll([{ id: pump.id, amount: "all", key: "movebackall-key-0003" }, { id: gmgn.id, amount: "all", key: "movebackall-key-0004" }]);
  assert.deepEqual(r.map((l) => Boolean(l.move)), [true, true]);
  assert.equal(sent.length, 2);
  assert.equal(shown.length, 0);
});

test("review M1: two move backs of one wallet at once: one goes, the second is refused as already starting (the wallet is reserved with no wait after its check)", async () => {
  const { w, sent } = await setup();
  const pump = await w.create("site", "sol", undefined, "pump");
  const [a, b] = await Promise.allSettled([w.siteMoveBack(pump.id, "all", "concurrent-key-00001"), w.siteMoveBackAll([{ id: pump.id, amount: "all", key: "concurrent-key-00002" }])]);
  const refused = [a, b].filter((x) => x.status === "rejected" && (x.reason as any).problem?.code === "security.subwallet.refused" && /already starting/.test((x.reason as any).problem.more));
  assert.equal(refused.length, 1, JSON.stringify([a.status, b.status]));
  assert.equal(sent.length, 1, "one move back signed and sent");
});

test("D119 landing 3, Put money in Perps: Trading's USDC → USDC on HyperCore at exactly the given Perps address, at least leastIn of it, refunds to Trading; checked and signed like any move out", async () => {
  const { w, float, asked, submitted } = await setup({ minOut: (req) => (req.destinationAsset.includes("hypercore") ? String(Number(req.amount) * 100 * 0.99) : req.amount) });
  const PERPS = "0x" + "ab".repeat(20);
  await assert.rejects(w.floatToPerps("25000000", key(70), "0xNOT"), (e: any) => /Perps account/.test(JSON.stringify(e.problem ?? e.message)));
  const m = await w.floatToPerps("25000000", key(71), PERPS);
  assert.ok(!("declined" in m));
  assert.deepEqual([m.kind, m.perps, m.chain, m.status, m.where], ["out", true, undefined, "pending", "in-flight"]);
  const req = asked.at(-1);
  assert.deepEqual(
    [req.originAsset, req.depositType, req.destinationAsset, req.swapType, req.amount, req.recipient, req.recipientType, req.refundTo, req.refundType],
    [FLOAT_USDC, "CONFIDENTIAL_INTENTS", HL_USDC_ASSET, "EXACT_INPUT", "25000000", PERPS, "DESTINATION_CHAIN", float.address, "CONFIDENTIAL_INTENTS"],
  );
  assert.equal(submitted.length, 1);
});

test("D119 landing 3, Put money in Perps: a quote that pays another address, or promises under the floor, is refused before anything is signed", async () => {
  const PERPS = "0x" + "ab".repeat(20);
  const lied = await setup({ lie: (req) => ({ ...req, recipient: "0x" + "cd".repeat(20) }), minOut: (req) => String(Number(req.amount) * 100) });
  await assert.rejects(lied.w.floatToPerps("25000000", key(72), PERPS), (e: any) => /doesn't pay the wallet ZeroFee picked/.test(JSON.stringify(e.problem ?? e.message)));
  assert.equal(lied.submitted.length, 0);
  const thin = await setup({ minOut: () => "100" });
  await assert.rejects(thin.w.floatToPerps("25000000", key(73), PERPS), (e: any) => /promises less/.test(JSON.stringify(e.problem ?? e.message)));
  assert.equal(thin.submitted.length, 0);
});

test("D119 landing 3, Take out of Perps: HyperCore USDC → Trading by a checked quote; the Perps service pays exactly its amount to its deposit address; a lie never reaches pay; Hyperliquid's no ends the move", async () => {
  const fair = (req: any) => String(Math.floor((Number(req.amount) / 100) * 0.99));
  const { w, float, asked, set } = await setup({ minOut: fair });
  const paid: [string, string][] = [];
  const m = await w.floatFromPerps("1000000000", key(74), async (d, a) => void paid.push([d, a]));
  assert.ok(!("declined" in m));
  assert.deepEqual([m.kind, m.perps, m.status, m.where], ["in", true, "pending", "in-flight"]);
  const req = asked.at(-1);
  assert.deepEqual([req.originAsset, req.depositType, req.destinationAsset, req.amount, req.recipient, req.recipientType, req.refundTo, req.refundType], [HL_USDC_ASSET, "ORIGIN_CHAIN", FLOAT_USDC, "1000000000", float.address, "CONFIDENTIAL_INTENTS", float.address, "CONFIDENTIAL_INTENTS"]);
  assert.deepEqual(paid, [[EVM_DEPOSIT, "1000000000"]]);
  set("SUCCESS");
  assert.deepEqual([(await w.floatMove(m.id)).status, (await w.floatMove(m.id)).where], ["done", "float"]);
  // a quote that doesn't pay Trading never reaches pay
  const lied = await setup({ minOut: fair, lie: (r) => ({ ...r, recipient: "e".repeat(64) }) });
  const never: unknown[] = [];
  await assert.rejects(lied.w.floatFromPerps("1000000000", key(75), async (...x) => void never.push(x)), (e: any) => /doesn't pay into your NEAR wallet/.test(JSON.stringify(e.problem ?? e.message)));
  assert.equal(never.length, 0);
  // Hyperliquid said no: the move ends, nothing left Perps
  const no = await setup({ minOut: fair });
  const { ProblemError } = await import("./problem.ts");
  const ended = await no.w.floatFromPerps("1000000000", key(76), async () => { throw new ProblemError({ code: "perps.hyperliquid.refused", whatHappened: "Hyperliquid said no. Nothing was traded.", money: { state: "safe" }, next: { kind: "nothing", label: "Go back" } } as never); });
  assert.ok(!("declined" in ended));
  assert.equal(ended.status, "failed");
});

test("D119 review L5: a Take out quote that asks for a deposit memo is refused before anything is paid", async () => {
  const { w } = await setup({ minOut: (req) => String(Math.floor((Number(req.amount) / 100) * 0.99)), memo: "12345" });
  const paid: unknown[] = [];
  await assert.rejects(w.floatFromPerps("1000000000", key(77), async (...x) => void paid.push(x)), (e: any) => /memo/.test(JSON.stringify(e.problem ?? e.message)));
  assert.equal(paid.length, 0);
});

test("D119 review L4: a Take out sent from Perps that 1Click never sees ends an hour past its price, and gives its place in the day's moves back; control: before then it waits", async () => {
  const { w } = await setup({ minOut: (req) => String(Math.floor((Number(req.amount) / 100) * 0.99)), deadlineMs: 10 * 60_000 });
  const left = (await w.floatLimits()).movesLeftToday;
  const m = await w.floatFromPerps("1000000000", key(78), async () => undefined);
  assert.ok(!("declined" in m));
  assert.equal((await w.floatLimits()).movesLeftToday, left - 1);
  const real = Date.now;
  try {
    Date.now = () => real() + 30 * 60_000;
    assert.equal((await w.floatMove(m.id)).status, "pending", "control: 20 minutes past its price, it still waits");
    Date.now = () => real() + 75 * 60_000;
    const ended = await w.floatMove(m.id);
    assert.deepEqual([ended.status, ended.where], ["failed", "chain"]);
    assert.match(ended.reason ?? "", /NEAR Intents returns it to your NEAR wallet/);
    assert.equal((await w.floatLimits()).movesLeftToday, left, "its place is back");
  } finally {
    Date.now = real;
  }
});

test("Home speed (3 Nov): the float's balance asks every coin's price at once, never one coin after another; the sum is the same", async () => {
  const vault = new MemoryVault();
  await vault.put("float-move-log", new TextEncoder().encode(JSON.stringify({ base: { [FLOAT_USDC]: "5000000", "nep141:sol.omft.near": "1000000000", "nep141:hood.omft.near": "1000000000000000000" }, kept: [] })));
  let flying = 0, most = 0;
  const usdPrice = async (c: string) => {
    flying++; most = Math.max(most, flying);
    await new Promise((r) => setTimeout(r, 20));
    flying--;
    return c === "sol" ? 150 : 3000;
  };
  const w = new SubWallets({ vault, sol: {} as SolChain, usdPrice, approve: async () => true, emit: () => {} });
  const b = await w.floatBalance();
  assert.equal(most, 2, "SOL's and ETH's prices were asked together");
  assert.equal(b.usd, 3155, "$5 USDC + 1 SOL at $150 + 1 ETH at $3,000");
  assert.deepEqual(b.tokens.map((t) => t.tokenId), [FLOAT_USDC, "nep141:sol.omft.near", "nep141:hood.omft.near"]);
});

test("Move back under $2 home (QA's real $2 Take out, 5 Nov: leg 1 landed $1.90, leg 2 never went): what arrived goes home whatever its size; control: $5 goes as before", async () => {
  for (const out of ["1900000", "5000000"]) {
    const { w, asked, mark } = await setup({ details: (req: any) => (req.depositType === "ORIGIN_CHAIN" ? { amountOut: out } : {}) });
    const site = await w.create("site", "sol", undefined, "pump");
    await w.siteMoveBack(site.id, "all", "moveback-key-small01");
    mark(SOL_DEPOSIT, "SUCCESS");
    const [one] = await w.siteMoveBacks();
    assert.equal(one!.back.status, "done");
    assert.ok(one!.home, `$${Number(out) / 1e6}: the home leg started`);
    assert.equal(asked.at(-1).amount, out, "exactly what arrived");
    // control: any other move home under $2 is still refused, nothing asked
    const n = asked.length;
    await assert.rejects(w.floatHome("1900000", "plain-home-small-01"), (e: any) => /under \$2/.test(e.problem.more ?? e.problem.title ?? ""));
    assert.equal(asked.length, n);
  }
});

test("Take out resumes after the app was closed (bug, 5 Nov): leg 1 landed while closed; reopened, reading the moves back sends leg 2 once, never twice", async () => {
  const { w, asked, mark, reopen } = await setup({ details: (req: any) => (req.depositType === "ORIGIN_CHAIN" ? { amountOut: "1900000" } : {}) });
  const site = await w.create("site", "sol", undefined, "pump");
  const m = await w.siteMoveBack(site.id, "all", "moveback-key-closed1");
  assert.ok(!("declined" in m));
  const [before] = await w.siteMoveBacks();
  assert.equal(before!.home, undefined, "control: no leg 2 before leg 1 landed");
  // the app is closed (this core is gone); leg 1 lands meanwhile
  mark(SOL_DEPOSIT, "SUCCESS");
  const n = asked.length;
  const [one] = await reopen().siteMoveBacks();
  assert.ok(one!.home, "reopened: leg 2 went, with no tap");
  assert.equal(asked.length, n + 1, "one quote for it");
  // reopened again, and two reads at once: the same leg 2, nothing new asked or signed
  const again = reopen();
  const [a, b] = await Promise.all([again.siteMoveBacks(), again.siteMoveBacks()]);
  assert.equal(asked.length, n + 1, "never twice");
  assert.equal(a[0]!.home!.id, one!.home!.id);
  assert.equal(b[0]!.home!.id, one!.home!.id);
});

test("Take out's leg 2 refused for good is said on the move back (homeStopped), never a silent loop; control: once it goes, the words are gone", async () => {
  let lie = true;
  const { w, mark } = await setup({ details: (req: any) => (req.depositType === "ORIGIN_CHAIN" ? { amountOut: "1900000" } : {}), minOut: (req: any) => (req.depositType === "CONFIDENTIAL_INTENTS" && req.recipientType === "INTENTS" && lie ? "1" : undefined as any) });
  const site = await w.create("site", "sol", undefined, "pump");
  await w.siteMoveBack(site.id, "all", "moveback-key-stopd1");
  mark(SOL_DEPOSIT, "SUCCESS");
  const [one] = await w.siteMoveBacks();
  assert.equal(one!.home, undefined, "1Click's price under the least: refused, nothing signed");
  assert.ok(one!.back.homeStopped && one!.back.homeStopped.length > 0, "its words kept on the move back");
  lie = false;
  const [two] = await w.siteMoveBacks();
  assert.ok(two!.home, "tried again on the next read: it goes");
  assert.equal(two!.back.homeStopped, undefined);
});

test("a parked remainder's move home (spending.putAway {parked}) goes under $2, still one of the day's moves; control: the same ask without parked is refused, nothing asked", async () => {
  const { w, asked } = await setup();
  const n = asked.length;
  await assert.rejects(w.floatHome("1800000", "parked-home-ctrl-01"), (e: any) => /under \$2/.test(e.problem.whatHappened + (e.problem.more ?? "")));
  assert.equal(asked.length, n, "control: refused before any quote");
  const m = await w.floatHome("1800000", "parked-home-key-001", true);
  assert.ok(!("declined" in m));
  assert.equal(m.kind, "home");
  const req = asked.at(-1);
  assert.deepEqual([req.amount, req.recipient, req.recipientType, req.refundTo, req.refundType], ["1800000", MAIN, "INTENTS", req.refundTo, "CONFIDENTIAL_INTENTS"]);
  // the same key again is the same move (never a second)
  const again = await w.floatHome("1800000", "parked-home-key-001", true);
  assert.ok(!("declined" in again) && again.id === m.id);
  assert.equal(asked.length, n + 1);
});

test("parked (QA's SHOULD): only under $2, and one open at a time on the float; controls: the same key is the same move, and once it ended another may go", async () => {
  const { w, asked, set } = await setup();
  const n = asked.length;
  await assert.rejects(w.floatHome("2500000", "parked-over-two-01", true), (e: any) => e.problem.code === "security.request.invalid");
  assert.equal(asked.length, n, "parked at $2.50: refused, nothing asked");
  const first = await w.floatHome("1800000", "parked-once-key-01", true);
  assert.ok(!("declined" in first));
  // a Trade bug asking again under new keys: refused while the first is open, nothing asked
  await assert.rejects(w.floatHome("1700000", "parked-once-key-02", true), (e: any) => e.problem.code === "security.subwallet.refused");
  assert.equal(asked.length, n + 1);
  // control: the same key again answers with the same move (a resume), never a second
  const same = await w.floatHome("1800000", "parked-once-key-01", true);
  assert.ok(!("declined" in same) && same.id === first.id);
  assert.equal(asked.length, n + 1);
  // control: once it ended, the next one goes
  set("SUCCESS");
  assert.equal((await w.floatMove(first.id)).status, "done");
  set("PENDING_DEPOSIT");
  const next = await w.floatHome("1700000", "parked-once-key-03", true);
  assert.ok(!("declined" in next) && next.id !== first.id);
});
