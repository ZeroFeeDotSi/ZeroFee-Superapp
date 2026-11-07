// S21 (rule 11: a step ticks only on a chain read): a move home (Take out: the NEAR wallet -> the Safe) was done on
// 1Click's SUCCESS alone. Now it is done only once intents.near itself (mt_balance_of on the Safe for that coin, the
// core's own agreed NEAR read) shows it landed; until then it is on its way. Past LANDED_WAIT_MS with no read showing it,
// it is the third state (the copy review's ruling): on its way, saying HOME_UNREAD, until a read shows it. Whole path from the Take out entry (subwallet.float.home -> SubWallets.floatHome,
// then subwallet.float.move -> floatMove, as DemoCore dispatches them), through the real FloatMoves and a FakeChain
// intents.near. The clock is the core's injected now(), never the wall clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOAT_USDC, HOME_UNREAD, type FloatRelay } from "./float-moves.ts";
import { INTENTS } from "./intents.ts";
import { base64 } from "./sol/bytes.ts";
import type { SolChain } from "./solana.ts";
import type { EvmChain } from "./evm.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const SAFE = "kim.near";
const key = (n: number) => `take-out-${String(n).padStart(8, "0")}`;

/** 1Click's relay as recorded (float-moves.test.ts relay): a one-time deposit address, the one transfer that pays it,
 *  and its signed quote; `set` changes the status every deposit reads. */
function relay() {
  const quotes = new Map<string, { req: any; deadline: string }>();
  let state = "PENDING_DEPOSIT";
  let n = 0;
  const r: FloatRelay = {
    quote: async (req) => {
      const depositAddress = `${(++n).toString(16).padStart(2, "0")}${"d".repeat(62)}`;
      const deadline = new Date(Date.now() + 3 * 86_400_000).toISOString();
      quotes.set(depositAddress, { req, deadline });
      return { quote: { depositAddress, amountIn: req.amount, amountOut: req.amount, deadline }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async (signerId, depositAddress) => {
      const q = quotes.get(depositAddress)!;
      const message = JSON.stringify({ deadline: q.deadline, intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [`imt:${MINTER}:${q.req.originAsset}`]: q.req.amount } }], signer_id: signerId });
      return { intent: { standard: "nep413", payload: { message, nonce: base64(new Uint8Array(32).fill(7)), recipient: "intents.far" } } };
    },
    submitIntent: async () => ({ intentHash: "h" }),
    status: async (depositAddress) => {
      const q = quotes.get(depositAddress);
      if (!q) return null;
      return { status: state, quoteResponse: signedQuote({ quoteRequest: q.req, quote: { depositAddress, amountIn: q.req.amount, minAmountOut: String((BigInt(q.req.amount) * 99n) / 100n), deadline: q.deadline } }) };
    },
  };
  return { r, set: (s: string) => (state = s) };
}

/** The core as the phone wires it, with intents.near on a FakeChain: the Safe holds `safe.held` USDC there (`safe.down`:
 *  the nodes don't answer). `near: false`: a core with no NEAR reads. */
async function takeOut(o: { near?: boolean } = {}) {
  let clock = Date.now(); // from here only the injected clock moves; a fixed date expired against the quote's real deadline above (6 Nov)
  const safe = { held: 100_000_000n, down: false, reads: 0 };
  const chain = new FakeChain("mainnet");
  chain.contract(INTENTS.account, INTENTS.codeHashBase58, {
    mt_balance_of: ({ account_id, token_id }) => {
      safe.reads++;
      if (safe.down) throw new Error("no node answered");
      return account_id === SAFE && token_id === FLOAT_USDC ? safe.held.toString() : "0";
    },
  });
  const fake = relay();
  const w = new SubWallets({
    vault: new MemoryVault(), sol: {} as SolChain, evm: {} as EvmChain, ...(o.near === false ? {} : { near: chain }), floatRelay: fake.r, mainAccount: async () => SAFE,
    usdPrice: async () => 150, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY, now: () => clock,
  });
  await w.create("trade", "near");
  return { w, safe, set: fake.set, step: (ms: number) => (clock += ms) };
}

test("S21: a Take out stays on its way while 1Click says SUCCESS but intents.near still shows the Safe's old figure; it ticks done the moment the read shows it landed", async () => {
  const t = await takeOut();
  const m = await t.w.floatHome("25000000", key(1));
  assert.ok(!("declined" in m));
  assert.deepEqual([m.kind, m.status, m.where], ["home", "pending", "in-flight"]);
  const least = BigInt(m.expected.amount);
  assert.equal(m.expected.tokenId, FLOAT_USDC);
  t.set("SUCCESS");
  const early = await t.w.floatMove(m.id);
  assert.deepEqual([early.status, early.where], ["pending", "in-flight"], "1Click's SUCCESS alone: still on its way (the Safe still reads $100)");
  assert.equal(early.reason, undefined, "nothing said yet");
  // part of it shows (a read mid-landing, or other money): less than its least is not its landing
  t.safe.held += least - 1n;
  assert.equal((await t.w.floatMove(m.id)).status, "pending", "less than its least: still on its way");
  t.safe.held += 1n;
  t.step(1_000);
  const done = await t.w.floatMove(m.id);
  assert.deepEqual([done.status, done.where], ["done", "main"], "intents.near shows it in the Safe: done");
  assert.equal(done.reason, undefined, "landed by the read: no extra words");
});

test("S21, the copy review's ruling: the read never shows it (the old figure, or nodes that don't answer): after LANDED_WAIT_MS it is the third state, still pending and in-flight, never done, saying HOME_UNREAD; it is read again on every refresh, and the first read that shows it ends it done at that read's time", async () => {
  for (const down of [false, true]) {
    const t = await takeOut();
    const m = await t.w.floatHome("25000000", key(2));
    assert.ok(!("declined" in m));
    t.safe.down = down;
    t.set("SUCCESS");
    assert.equal((await t.w.floatMove(m.id)).status, "pending", `down ${down}: first SUCCESS`);
    t.step(9 * 60_000);
    const nine = await t.w.floatMove(m.id);
    assert.deepEqual([nine.status, nine.unshown, nine.reason], ["pending", undefined, undefined], `down ${down}: 9 minutes on, on its way, nothing said yet`);
    t.step(60_000);
    const late = await t.w.floatMove(m.id);
    assert.deepEqual([late.status, late.where, late.unshown, late.reason], ["pending", "in-flight", true, HOME_UNREAD], `down ${down}: the third state, never done on 1Click's word`);
    t.step(60 * 60_000);
    const reads = t.safe.reads;
    assert.equal((await t.w.floatMove(m.id)).status, "pending", `down ${down}: an hour on, still on its way`);
    assert.ok(t.safe.reads > reads, `down ${down}: read again on this refresh`);
    // the first read that shows it: Done, at that read's time
    t.safe.down = false;
    t.safe.held += BigInt(m.expected.amount);
    t.step(5_000);
    const landedAt = new Date(t.step(0)).toISOString();
    const done = await t.w.floatMove(m.id);
    assert.deepEqual([done.status, done.where, done.unshown, done.reason, done.updatedAtIso], ["done", "main", undefined, undefined, landedAt], `down ${down}: Done on the read, its line gone`);
  }
});

test("S21 control: what the Safe held is read beside the move (before it was sent), so money already there never counts as its landing; a core with no NEAR reads keeps 1Click's word, as before", async () => {
  const t = await takeOut();
  t.safe.held = 500_000_000n; // a big Safe: its old figure is far over the move's least
  const m = await t.w.floatHome("25000000", key(3));
  assert.ok(!("declined" in m));
  assert.ok(t.safe.reads >= 1, "the Safe's figure was read with the move");
  t.set("SUCCESS");
  assert.equal((await t.w.floatMove(m.id)).status, "pending", "the Safe's own old money is not the landing");
  // no NEAR reads at all (no chain to read): 1Click's word, as before
  const plain = await takeOut({ near: false });
  const n = await plain.w.floatHome("25000000", key(4));
  assert.ok(!("declined" in n));
  plain.set("SUCCESS");
  const d = await plain.w.floatMove(n.id);
  assert.deepEqual([d.status, d.where, d.reason], ["done", "main", undefined]);
});
