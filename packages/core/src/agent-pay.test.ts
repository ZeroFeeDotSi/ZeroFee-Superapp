// D152 on the phone: AgentZero pays each reply exactly, from its own plain wallet, with one plain USDC transfer (agent-pay.ts).
// NEAR is a recording fake (testing/agent-near.ts): nothing real is signed or sent. Every refusal has a control that pays.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { AgentPay, EMPTY_AFTER_MS, PAY_KEYS, USDC_CONTRACT, VALID_BLOCKS, ZEROFEE_RECEIVE, payAmount } from "./agent-pay.ts";
import { BATCH_CAP_MICROS, REPLY_CAP_MICROS, SETTLE_AT_MICROS, batchMicros, replyMicros } from "./agent-price.ts";
import { agentKey } from "./agent-wallet.ts";
import { HOT_ROOT, hotRoot } from "./hot-keys.ts";
import { MemoryVault } from "./vault.ts";
import { AGENT_USDC } from "./agent-route.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";
import { agentNear } from "./testing/agent-near.ts";

const MEMO = `agentzero ${"ab".repeat(16)}`;
const USAGE = { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const OWED = { owedMicros: 5000, usage: USAGE, model: "claude-opus-5-5", memo: MEMO, reply: "0123456789abcdef" };
const OWED2 = { ...OWED, owedMicros: 4000, reply: "fedcba9876543210" };
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const args = (a: { kind: string; args?: Uint8Array }) => JSON.parse(new TextDecoder().decode((a as { args: Uint8Array }).args));

async function rig(o: Parameters<typeof agentNear>[0] = {}, extra: { strong?: () => Promise<void>; approve?: () => Promise<boolean> } = {}) {
  const vault = new MemoryVault();
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(5)));
  const near = agentNear(o);
  const clock = { t: 1_800_000_000_000 };
  const pay = new AgentPay({ vault, chain: near.chain, key: () => agentKey(vault, "near"), now: () => clock.t, ...extra });
  const secret = await agentKey(vault, "near");
  return { pay, near, vault, clock, agent: hex(ed25519.getPublicKey(secret)) };
}

test("a reply is paid exactly: one plain ft_transfer of USDC to ZeroFee's pinned account, its memo, 1 yocto, signed by AgentZero's own key", async () => {
  const r = await rig();
  assert.equal(replyMicros(USAGE, "claude-opus-5-5"), 5000, "1000 in × $4/M + 50 out × $20/M");
  const p = await r.pay.pay(OWED);
  assert.deepEqual([p.micros, p.from], [5000, r.agent]);
  assert.equal(r.near.sent.length, 1);
  const { tx, hash, signer } = r.near.sent[0]!;
  assert.equal(hash, p.tx);
  assert.equal(signer, r.agent);
  assert.equal(tx.signerId, r.agent);
  assert.equal(tx.receiverId, USDC_CONTRACT);
  assert.equal(tx.actions.length, 1);
  const a = tx.actions[0] as { kind: string; method: string; depositYocto: bigint; args: Uint8Array };
  assert.deepEqual([a.kind, a.method, a.depositYocto], ["call", "ft_transfer", 1n]);
  assert.deepEqual(args(a), { receiver_id: ZEROFEE_RECEIVE, amount: "5000", memo: MEMO });
  assert.deepEqual(await r.pay.month(), { capUsd: 20, spentUsd: 0.005, endsAtIso: new Date(r.clock.t + 30 * 86_400_000).toISOString() });
});

test("the amount is the phone's own: the relay may ask less (a Stop's estimate), never more; never over $0.50; the memo is ZeroFee's shape only", async () => {
  for (const [name, bend] of [
    ["more than the usage costs", { owedMicros: 5001 }],
    ["an unknown model", { model: "claude-anything" }],
    ["a usage that isn't whole tokens", { usage: { ...USAGE, output_tokens: 1.5 } }],
    ["a memo that isn't ZeroFee's", { memo: "pay bob.near" }],
    ["nothing owed", { owedMicros: 0 }],
    ["no reply id", { reply: undefined }],
    ["more output than one reply can have", { usage: { ...USAGE, output_tokens: 4001 }, owedMicros: 5000 }],
  ] as const) {
    const r = await rig();
    await assert.rejects(r.pay.pay({ ...OWED, ...bend }), undefined, name);
    assert.equal(r.near.sent.length, 0, `${name}: nothing sent`);
  }
  const big = { input_tokens: 200_000, output_tokens: 4000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  assert.ok(replyMicros(big, "claude-opus-5-5")! > REPLY_CAP_MICROS);
  assert.ok("why" in payAmount({ owedMicros: replyMicros(big, "claude-opus-5-5"), usage: big, model: "claude-opus-5-5", memo: MEMO, reply: OWED.reply }));
  assert.equal(REPLY_CAP_MICROS, 250_000, "$0.25 a reply at most");
  // control: a Stop's estimate under the usage's own figure is paid as asked
  const r = await rig();
  assert.equal((await r.pay.pay({ ...OWED, owedMicros: 4000 })).micros, 4000);
});

test("one transfer pays what is owed: its usage summed per model (an older relay's batch of replies too); never more than its own figure, never over the one-payment cap", async () => {
  const opus = { input_tokens: 10_000, output_tokens: 4_500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const sonnet = { input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const byModel = { "claude-opus-5-5": opus, "claude-sonnet-5-5": sonnet };
  const own = batchMicros(byModel, 2)!;
  assert.equal(own, 10_000 * 4 + 4_500 * 20 + 10_000 * 2 + 2_000 * 10, "each model at its own price");
  const batch = { owedMicros: own, usage: opus, model: "claude-opus-5-5", byModel, replies: 2, paidMicros: 0, memo: MEMO, reply: OWED.reply };
  const r = await rig();
  const p = await r.pay.pay(batch);
  assert.equal(p.micros, own);
  assert.equal(r.near.sent.length, 1, "one transfer");
  assert.deepEqual(args(r.near.sent[0]!.tx.actions[0] as never), { receiver_id: ZEROFEE_RECEIVE, amount: String(own), memo: MEMO });
  for (const [name, bend] of [
    ["more than the batch costs", { owedMicros: own + 1 }],
    ["more output than its replies can have", { replies: 1 }],
    ["an unknown model in it", { byModel: { ...byModel, "gpt-5": opus } }],
    ["a paid part that isn't a whole amount", { paidMicros: -1 }],
  ] as const) {
    const x = await rig();
    await assert.rejects(x.pay.pay({ ...batch, ...bend }), undefined, name);
    assert.equal(x.near.sent.length, 0, `${name}: nothing sent`);
  }
  // never over the cap in one go, whatever the usage says (a relay that lies about usage)
  const huge = { "claude-opus-5-5": { input_tokens: 200_000, output_tokens: 8_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  assert.ok("why" in payAmount({ ...batch, byModel: huge, owedMicros: BATCH_CAP_MICROS + 1 }));
  assert.ok(!("why" in payAmount({ ...batch, byModel: huge, owedMicros: BATCH_CAP_MICROS })), "control: the cap itself is paid");
  assert.equal(BATCH_CAP_MICROS, SETTLE_AT_MICROS + REPLY_CAP_MICROS);
  // a batch the relay says was partly paid already is a new figure: paid once, then never again
  await r.pay.counted(p.tx);
  const rest = await r.pay.pay({ ...batch, owedMicros: 1000, paidMicros: own - 1000 });
  assert.notEqual(rest.tx, p.tx);
  await r.pay.counted(rest.tx);
  await assert.rejects(r.pay.pay({ ...batch, owedMicros: 1000, paidMicros: own - 1000 }), (e: any) => /already paid/.test(String(e?.problem?.more)));
  await assert.rejects(r.pay.pay(batch), (e: any) => /already paid/.test(String(e?.problem?.more)), "control: the first figure too");
});

test("one payment per reply: asked again (a retry, a crash, the relay's 402 after a Stop), the SAME transaction is sent again, never a second; the month counts it once", async () => {
  const r = await rig();
  const a = await r.pay.pay(OWED);
  const b = await r.pay.pay(OWED);
  assert.equal(b.tx, a.tx);
  assert.equal(r.near.sent.length, 2);
  assert.equal(r.near.sent[1]!.signed, r.near.sent[0]!.signed, "the same signed bytes");
  assert.equal((await r.pay.month()).spentUsd, 0.005);
  // another reply while this one isn't counted yet: this one is sent again, the new one waits
  await assert.rejects(r.pay.pay(OWED2), (e: any) => /still on its way/.test(String(e?.problem?.more)));
  // counted by the relay: the next reply pays (control)
  await r.pay.counted(a.tx);
  assert.equal(await r.vault.get(`${PAY_KEYS.pending}`), null);
  const c = await r.pay.pay(OWED2);
  assert.notEqual(c.tx, a.tx);
  // SR3 M7: a reply already paid and counted is never paid again (a stale or repeated ask)
  await r.pay.counted(c.tx);
  await assert.rejects(r.pay.pay(OWED), (e: any) => /already paid/.test(String(e?.problem?.more)));
});

test("a send whose outcome is unknown keeps the payment (it may land): asked again, the same bytes; never a second signature", async () => {
  const r = await rig({ fail: "throw" });
  await assert.rejects(r.pay.pay(OWED), (e: any) => e?.problem?.code === "agentzero.pay.sending");
  const kept = await r.pay.pending();
  assert.ok(kept);
  r.near.state.fail = undefined;
  const again = await r.pay.pay(OWED);
  assert.equal(again.tx, kept!.tx);
  assert.equal(new Set(r.near.sent.map((s) => s.signed)).size, 1, "one signature only");
});

test("a transaction NEAR ran and refused is dropped and its amount goes back to the month (nothing moved)", async () => {
  const r = await rig({ fail: "failed" });
  await assert.rejects(r.pay.pay(OWED), (e: any) => /didn't go through/.test(String(e?.problem?.more)));
  assert.equal(await r.pay.pending(), null);
  assert.equal((await r.pay.month()).spentUsd, 0);
});

test("forget (SR3 H1/H2): a kept payment is forgotten only once NEAR is past the last block it was valid for; before, it is sent again (it may still land)", async () => {
  const r = await rig({ fail: "throw" });
  await assert.rejects(r.pay.pay(OWED));
  const kept = (await r.pay.pending())!;
  assert.deepEqual(await r.pay.forget(kept.tx), { forgotten: false }, "still valid: kept");
  r.near.state.height = kept.height + VALID_BLOCKS;
  assert.deepEqual(await r.pay.forget(kept.tx), { forgotten: false }, "the last valid block: kept");
  r.near.state.height = kept.height + VALID_BLOCKS + 1;
  assert.deepEqual(await r.pay.forget(kept.tx), { forgotten: true });
  assert.equal(await r.pay.pending(), null);
  assert.equal((await r.pay.month()).spentUsd, 0);
});

test("AgentZero's wallet can't pay: no account yet, no NEAR for the fee, or not enough USDC; each said by name, nothing signed", async () => {
  // SR3 H2: under 0.004 NEAR a payment's 30 Tgas could be refused by NEAR, so it isn't signed (0.003 NEAR here)
  for (const [o, code] of [[{ exists: false }, "agentzero.pay.empty"], [{ nearYocto: 3n * 10n ** 21n }, "agentzero.pay.fees"], [{ usdcMicros: 4999n }, "agentzero.pay.empty"]] as const) {
    const r = await rig(o);
    await assert.rejects(r.pay.pay(OWED), (e: any) => e?.problem?.code === code, code);
    assert.equal(r.near.sent.length, 0);
    assert.equal(await r.pay.pending(), null);
  }
});

test("the month's cap: counted before signing; over it refused by name; lowering holds at once; raising needs D103's check and the sheet", async () => {
  const asked: string[] = [];
  const r = await rig({}, { strong: async () => void asked.push("strong"), approve: async () => (asked.push("sheet"), true) });
  assert.deepEqual(await r.pay.setCap(0), { capUsd: 0 });
  assert.deepEqual(asked, [], "lowering asks nothing");
  await assert.rejects(r.pay.pay(OWED), (e: any) => e?.problem?.code === "agentzero.pay.cap");
  assert.equal(r.near.sent.length, 0);
  assert.deepEqual(await r.pay.setCap(5), { capUsd: 5 });
  assert.deepEqual(asked, ["strong", "sheet"]);
  assert.equal((await r.pay.pay(OWED)).micros, 5000, "control: inside the cap it pays");
  const no = await rig({}, { strong: async () => {}, approve: async () => false });
  assert.deepEqual(await no.pay.setCap(50), { declined: true });
});

/** ZeroFee's relay in front of 1Click (fake): its quote, and the quote read back as 1Click signed it; `lie` bends it. */
function homeRelay(lie?: (req: any) => any) {
  const asked: any[] = [];
  const quotes = new Map<string, any>();
  const relay = {
    quote: async (req: any) => {
      asked.push(req);
      const depositAddress = "d0".repeat(32);
      quotes.set(depositAddress, req);
      return { quote: { depositAddress }, zerofeeStatusTag: "tag" };
    },
    status: async (dep: string) => {
      const req = quotes.get(dep);
      if (!req) return null;
      const r = lie ? lie(req) : req;
      return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({ quoteRequest: r, quote: { depositAddress: dep, amountIn: r.amount, amountOut: r.amount, minAmountOut: ((BigInt(r.amount) * 995n) / 1000n).toString(), deadline: new Date(Date.now() + 3_600_000).toISOString() } }) };
    },
    generateIntent: async () => null,
    submitIntent: async () => null,
  };
  return { relay, asked };
}
async function homeRig(o: Parameters<typeof agentNear>[0] = {}, lie?: (req: any) => any) {
  const vault = new MemoryVault();
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(5)));
  const near = agentNear(o);
  const h = homeRelay(lie);
  const pay = new AgentPay({ vault, chain: near.chain, key: () => agentKey(vault, "near"), relay: h.relay as never, quoteKey: TEST_QUOTE_KEY, now: () => Date.now() });
  return { pay, near, asked: h.asked, agent: hex(ed25519.getPublicKey(await agentKey(vault, "near"))) };
}

test("Move all to my Safe, PRIVATELY (SR3 L14): one 1Click quote home into the Safe's NEAR Intents balance, read back as signed; then one plain ft_transfer to its deposit address, never a transfer that names the Safe", async () => {
  const r = await homeRig({ usdcMicros: 7_500_000n });
  const shown: number[] = [];
  const m = await r.pay.empty("kim.near", async (usd) => (shown.push(usd), true));
  assert.ok(!("declined" in m));
  assert.deepEqual(shown, [7.5]);
  const q = r.asked[0];
  assert.deepEqual([q.originAsset, q.depositType, q.destinationAsset, q.amount, q.recipient, q.recipientType, q.refundTo, q.refundType, q.swapType], [AGENT_USDC, "ORIGIN_CHAIN", AGENT_USDC, "7500000", "kim.near", "INTENTS", r.agent, "ORIGIN_CHAIN", "EXACT_INPUT"]);
  const { tx } = r.near.sent[0]!;
  assert.equal(tx.receiverId, USDC_CONTRACT);
  const a = tx.actions[0] as { method: string; args: Uint8Array };
  assert.equal(a.method, "ft_transfer");
  assert.deepEqual(args(a as never), { receiver_id: "d0".repeat(32), amount: "7500000" });
  assert.ok(!new TextDecoder().decode(a.args).includes("kim.near"), "the Safe is named nowhere in the public transfer");
  // a signed quote that pays anyone else, refunds elsewhere, or isn't all of it: refused, nothing sent
  for (const [name, lie] of [["another payee", (x: any) => ({ ...x, recipient: "thief.near" })], ["a refund elsewhere", (x: any) => ({ ...x, refundTo: "ee".repeat(32) })], ["part of it", (x: any) => ({ ...x, amount: "1" })], ["to another chain", (x: any) => ({ ...x, recipientType: "DESTINATION_CHAIN" })]] as const) {
    const bad = await homeRig({ usdcMicros: 7_500_000n }, lie);
    await assert.rejects(bad.pay.empty("kim.near", async () => true), undefined, name);
    assert.equal(bad.near.sent.length, 0, name);
  }
  // declined: nothing sent; empty: refused; a payment just sent: refused, two minutes on: goes
  const no = await homeRig({ usdcMicros: 7_500_000n });
  assert.deepEqual(await no.pay.empty("kim.near", async () => false), { declined: true });
  assert.equal(no.near.sent.length, 0);
  const none = await homeRig({ usdcMicros: 0n });
  await assert.rejects(none.pay.empty("kim.near", async () => true), (e: any) => /is empty/.test(String(e?.problem?.more)));
  const poor = await homeRig({ usdcMicros: 7_500_000n, nearYocto: 3n * 10n ** 21n });
  await assert.rejects(poor.pay.empty("kim.near", async () => true), (e: any) => /no NEAR left/.test(String(e?.problem?.more)));
});

test("Move all waits two minutes after a reply's payment was sent, then goes (never locked out of one's money)", async () => {
  const vault = new MemoryVault();
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(5)));
  const near = agentNear({ usdcMicros: 7_500_000n, fail: "throw" });
  const clock = { t: Date.now() };
  const pay = new AgentPay({ vault, chain: near.chain, key: () => agentKey(vault, "near"), relay: homeRelay().relay as never, quoteKey: TEST_QUOTE_KEY, now: () => clock.t });
  await assert.rejects(pay.pay(OWED));
  await assert.rejects(pay.empty("kim.near", async () => true), (e: any) => /still on its way/.test(String(e?.problem?.more)));
  clock.t += EMPTY_AFTER_MS + 1;
  near.state.fail = undefined;
  assert.ok(!("declined" in (await pay.empty("kim.near", async () => true))));
});

test("its balance: plain USDC and NEAR, and whether its NEAR is too low for fees (the next fill tops it up)", async () => {
  const r = await rig({ usdcMicros: 4_210_000n, nearYocto: 11n * 10n ** 21n });
  const b = await r.pay.balance();
  assert.deepEqual([b.address, b.usdcMicros, b.nearYocto, b.feesLow], [r.agent, 4_210_000n, 11n * 10n ** 21n, true], "under 0.012 NEAR: the next fill tops it up");
  assert.equal((await (await rig({ nearYocto: 10n ** 23n })).pay.balance()).feesLow, false);
});
