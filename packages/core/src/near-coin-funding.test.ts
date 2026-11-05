// D153/D70 (review, 3 Nov): the NEAR coin wallet is filled and emptied ONLY through NEAR Confidential. Make ready: a
// confidential 1Click quote from Spending's USDC delivers NEAR to the NEAR coin wallet (never a public send from the Safe);
// Put away: the wallet pays a confidential quote's one-time NEAR address, arriving as USDC in Spending's confidential
// balance. Each with controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { base64ToBytes } from "@fastnear/utils";
import type { Block, Chain, ChainAccount } from "./chain.ts";
import { FLOAT_USDC, NEAR_COIN_TOKEN, type FloatRelay } from "./float-moves.ts";
import { NEAR_GATE, WNEAR } from "./near-trade.ts";
import type { EvmChain } from "./evm.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";
import { decodeTransaction } from "./tx-decode.ts";

const DEPOSIT = "d".repeat(64);
const NEAR = 10n ** 24n;

function relay(o: { recipient?: (req: any) => string } = {}) {
  const asked: any[] = [], submitted: any[] = [];
  const quotes = new Map<string, { req: any; amountIn: string; deadline: string }>();
  const r: FloatRelay = {
    quote: async (req) => {
      asked.push(req);
      const depositAddress = req.depositType === "ORIGIN_CHAIN" ? DEPOSIT : (asked.length.toString(16) + "e".repeat(64)).slice(0, 64);
      const amountIn = req.swapType === "EXACT_OUTPUT" ? "2000000" : req.amount;
      const deadline = new Date(Date.now() + 86_400_000).toISOString();
      quotes.set(depositAddress, { req, amountIn, deadline });
      return { quote: { depositAddress, amountIn, amountOut: req.amount, deadline }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async (signerId, depositAddress) => {
      const q = quotes.get(depositAddress)!;
      const message = JSON.stringify({ deadline: q.deadline, intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [`imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:${q.req.originAsset}`]: q.amountIn } }], signer_id: signerId });
      return { intent: { standard: "nep413", payload: { message, nonce: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))), recipient: "intents.far" } } };
    },
    submitIntent: async (signed) => (submitted.push(signed), { intentHash: "h" }),
    status: async (depositAddress) => {
      const q = quotes.get(depositAddress);
      if (!q) return null;
      const req = o.recipient ? { ...q.req, recipient: o.recipient(q.req) } : q.req;
      // a Put away of 0.5 NEAR at $4: about $1.96 of USDC
      const minAmountOut = req.swapType === "EXACT_OUTPUT" ? req.amount : req.depositType === "ORIGIN_CHAIN" ? String(Math.floor((Number(BigInt(req.amount) / 10n ** 18n) / 1e6) * 4 * 0.98 * 1e6)) : req.amount;
      return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({ quoteRequest: req, quote: { depositAddress, amountIn: q.amountIn, minAmountOut, deadline: q.deadline } }) };
    },
  };
  return { r, asked, submitted };
}

/** NEAR's two nodes, agreeing: the NEAR coin wallet's account, its key, its wNEAR; every signed transaction kept. */
function nearChain(o: { native: bigint; wnear?: bigint }) {
  const sent: string[] = [];
  const block: Block = { hash: "11111111111111111111111111111111", height: 1 };
  const chain = {
    network: "mainnet",
    commonBlock: async () => block,
    account: async (): Promise<ChainAccount> => ({ balanceYocto: o.native, storageBytes: 200n } as ChainAccount),
    accessKey: async (_a: string, pk: string) => ({ handle: pk, nonce: 9n, permission: { kind: "full" } }),
    view: async (c: string, m: string) => (c === WNEAR && m === "ft_balance_of" ? String(o.wnear ?? 0n) : null),
    send: async (signed: string) => (sent.push(signed), { status: "done" }),
  } as unknown as Chain;
  return { chain, sent };
}

async function setup(o: { native: bigint; wnear?: bigint; recipient?: (req: any) => string }) {
  const fake = relay(o);
  const near = nearChain(o);
  const w = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm: {} as EvmChain, near: near.chain, floatRelay: fake.r, mainAccount: async () => "kim.near", usdPrice: async (c) => (c === "near" ? 4 : 150), approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY });
  const float = await w.create("trade", "near");
  const coins = await w.create("browser", "near");
  return { w, float, coins, ...fake, ...near };
}

test("Make ready for the NEAR coin wallet: a confidential 1Click quote from Spending's USDC, NEAR delivered to that wallet, refunds back into Spending; never the Safe", async () => {
  NEAR_GATE.open = true;
  try {
    const { w, float, coins, asked, submitted, sent } = await setup({ native: 0n });
    const m = await w.floatNearOut(String(NEAR / 2n), "speed-near-test-0001");
    assert.ok(!("declined" in m));
    const req = asked[0];
    assert.deepEqual(
      [req.originAsset, req.depositType, req.destinationAsset, req.swapType, req.amount, req.recipient, req.recipientType, req.refundTo, req.refundType, req.confidentiality],
      [FLOAT_USDC, "CONFIDENTIAL_INTENTS", NEAR_COIN_TOKEN, "EXACT_OUTPUT", String(NEAR / 2n), coins.address, "DESTINATION_CHAIN", float.address, "CONFIDENTIAL_INTENTS", "basic"],
    );
    assert.equal(submitted.length, 1, "Spending's own confidential intent pays it");
    assert.equal(sent.length, 0, "no NEAR transaction at all: nothing public from the Safe or anywhere");
    assert.equal(m.wallet, coins.id);
  } finally { NEAR_GATE.open = false; }
});

const methods = (signed: string) => decodeTransaction(base64ToBytes(signed).slice(0, -65));
const argsOf = (a: { kind: string; args?: Uint8Array }) => JSON.parse(new TextDecoder().decode(a.args!));

test("Put away from the NEAR coin wallet: a confidential quote into Spending, paid as wNEAR (re-review H: never native NEAR to a quote for wrap.near): one wrap.near transaction, storage for the wallet and the deposit address, the wrap, and an ft_transfer of exactly the amount (control: a quote paying elsewhere is refused, nothing sent)", async () => {
  NEAR_GATE.open = true;
  try {
    const { w, float, coins, asked, sent } = await setup({ native: NEAR });
    const m = await w.floatNearIn(String(NEAR / 2n), "speed-near-home-01");
    assert.ok(!("declined" in m));
    const req = asked[0];
    assert.deepEqual([req.originAsset, req.depositType, req.destinationAsset, req.recipient, req.recipientType, req.refundTo, req.refundType], [NEAR_COIN_TOKEN, "ORIGIN_CHAIN", FLOAT_USDC, float.address, "CONFIDENTIAL_INTENTS", float.address, "CONFIDENTIAL_INTENTS"]);
    assert.equal(sent.length, 1, "one transaction");
    const tx = methods(sent[0]!);
    assert.deepEqual([tx.signerId, tx.receiverId], [coins.address, WNEAR]);
    assert.deepEqual(tx.actions.map((a) => (a.kind === "call" ? a.method : a.kind)), ["storage_deposit", "storage_deposit", "near_deposit", "ft_transfer"]);
    assert.deepEqual(tx.actions.slice(0, 2).map((a) => argsOf(a).account_id), [coins.address, DEPOSIT], "the wallet's own wNEAR account, then the deposit address's");
    const pay = tx.actions[3]!;
    assert.ok(pay.kind === "call" && pay.depositYocto === 1n);
    assert.deepEqual(argsOf(pay), { receiver_id: DEPOSIT, amount: String(NEAR / 2n) }, "exactly the quote's amount, to its own address");
    assert.ok(!tx.actions.some((a) => a.kind === "transfer"), "no native NEAR sent to the quote");
    assert.deepEqual([m.status, m.where], ["pending", "in-flight"]);
    // control: 1Click's signed quote pays someone else: refused, and the wallet pays nothing
    const bad = await setup({ native: NEAR, recipient: () => "evil.near" });
    await assert.rejects(bad.w.floatNearIn(String(NEAR / 2n), "speed-near-home-02"), (e: { problem?: { more?: string } }) => /pay into your NEAR wallet/.test(e.problem?.more ?? ""));
    assert.equal(bad.sent.length, 0);
  } finally { NEAR_GATE.open = false; }
});

test("Put away of all: its wNEAR first, only the rest wrapped, one transaction; storage and gas kept (re-review H)", async () => {
  NEAR_GATE.open = true;
  try {
    const { w, sent } = await setup({ native: 2n * 10n ** 23n, wnear: NEAR });
    const m = await w.floatNearIn("all", "speed-near-home-03");
    assert.ok(!("declined" in m));
    assert.equal(sent.length, 1);
    const tx = methods(sent[0]!);
    // 0.2 NEAR less 200 bytes' storage (0.002), 0.05 of gas, room for two wNEAR accounts (0.0025) and the transfer's
    // 1 yocto, plus 1 wNEAR
    const all = 2n * 10n ** 23n - 2n * 10n ** 21n - 5n * 10n ** 22n - 25n * 10n ** 20n - 1n + NEAR;
    const wrap = tx.actions.find((a) => a.kind === "call" && a.method === "near_deposit");
    assert.equal(wrap && wrap.kind === "call" && wrap.depositYocto, all - NEAR, "only what isn't wNEAR yet");
    assert.equal(argsOf(tx.actions.at(-1)!).amount, String(all));
  } finally { NEAR_GATE.open = false; }
});

test("re-review L: two Put aways at once never share a nonce (one turn with the trades, past the last this core signed); control: one alone takes the chain's next", async () => {
  NEAR_GATE.open = true;
  try {
    // two $2.40 Put aways (0.6 NEAR each, over Spending's $2 least) at once
    const { w, sent } = await setup({ native: 3n * NEAR });
    await Promise.all([w.floatNearIn(String((NEAR * 6n) / 10n), "speed-near-home-05"), w.floatNearIn(String((NEAR * 6n) / 10n), "speed-near-home-06")]);
    assert.deepEqual(sent.map((x) => methods(x).nonce).sort(), [10n, 11n]);
    const one = await setup({ native: 3n * NEAR });
    await one.w.floatNearIn(String((NEAR * 6n) / 10n), "speed-near-home-07");
    assert.equal(methods(one.sent[0]!).nonce, 10n);
  } finally { NEAR_GATE.open = false; }
});

test("shut (every phone until the test run): neither Make ready nor Put away moves anything (control above: open)", async () => {
  const { w, asked, sent } = await setup({ native: NEAR });
  await assert.rejects(w.floatNearOut(String(NEAR), "speed-near-test-0002"), (e: { problem?: { more?: string } }) => /open soon/.test(e.problem?.more ?? ""));
  await assert.rejects(w.floatNearIn("all", "speed-near-home-04"), (e: { problem?: { more?: string } }) => /open soon/.test(e.problem?.more ?? ""));
  assert.equal(asked.length + sent.length, 0);
});
