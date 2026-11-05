// D152 on the relay: each AgentZero reply is paid after it, exactly, by a plain USDC transfer on NEAR that the relay reads
// on chain (agentzero-pay.mjs). The store is the faithful Upstash fake; Anthropic and NEAR's nodes are recorded; no
// network. Every rule has a control that passes.
import { test } from "node:test";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { privateCounter, redisCounter } from "./guards.mjs";
/** The relay-only store key (QA): 32+ random bytes; a fixed one for the tests. */
const STORE_KEY = "test-store-key-0123456789abcdef0123456789abcdef";
import { createRelay } from "./relay.mjs";
import { costMicros, issueToken, tokenId, PRICES } from "./agentzero.mjs";
import { CHAT_CALL_MICROS } from "./agentzero-chat.mjs";
import { BIND_PREFIX, PAY_NODES, PINNED_RECEIVE, SETTLE_AT_MICROS, bindProofOk, USDC_CONTRACT, memoOf, paymentOf, replyLedger, verifyPayment } from "./agentzero-pay.mjs";
import { fakeUpstash } from "./testing/fake-upstash.ts";
import { agentKey } from "./testing/agent-key.ts";

const APP = "zerofee-app://app";
const RECEIVE = "37764cf3c4418f8b0a963768bcaa1ddddc201cad32c040db2dfc919936465822";
/** AgentZero's own key (QA): its account, and its proof that an id is its own. */
const KEY = agentKey();
const AGENT = KEY.account;
const TOKEN_SECRET = "token-secret";
const idOf = (t: string) => tokenId(TOKEN_SECRET, t)!;

const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const textSse = (input = 1000, output = 50) =>
  ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: input, output_tokens: 1 } } }) +
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
  ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hi! Ask me anything." } }) +
  ev("content_block_stop", { index: 0 }) +
  ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: output } }) +
  ev("message_stop", {});
/** 1000 in × $4/M + 50 out × $20/M: what Anthropic charges for textSse() on Opus 5.5, in micro-dollars. */
const REPLY_MICROS = 1000 * 4 + 50 * 20;

/** A final ft_transfer of USDC as NEAR's `tx` RPC answers it; each field can be bent for a refusal. */
function txResult(o: { from?: string; amount?: string; memo?: string; receive?: string; contract?: string; final?: string; ok?: boolean; event?: boolean; eventAmount?: string; method?: string; deposit?: string; actions?: number }) {
  const from = o.from ?? AGENT;
  const amount = o.amount ?? String(REPLY_MICROS);
  const receive = o.receive ?? RECEIVE;
  const args = Buffer.from(JSON.stringify({ receiver_id: receive, amount, memo: o.memo })).toString("base64");
  const action = { FunctionCall: { method_name: o.method ?? "ft_transfer", args, gas: 30_000_000_000_000, deposit: o.deposit ?? "1" } };
  const log = `EVENT_JSON:${JSON.stringify({ standard: "nep141", version: "1.0.0", event: "ft_transfer", data: [{ old_owner_id: from, new_owner_id: receive, amount: o.eventAmount ?? amount, memo: o.memo }] })}`;
  return {
    final_execution_status: o.final ?? "FINAL",
    status: o.ok === false ? { Failure: { ActionError: {} } } : { SuccessValue: "" },
    transaction: { signer_id: from, receiver_id: o.contract ?? USDC_CONTRACT, actions: Array.from({ length: o.actions ?? 1 }, () => action), hash: "h" },
    receipts_outcome: [{ outcome: { executor_id: o.contract ?? USDC_CONTRACT, status: o.ok === false ? { Failure: {} } : { SuccessValue: "" }, logs: o.event === false ? [] : [log] } }],
    transaction_outcome: { block_hash: "4reUv2gyKfdJmnmqQXRf8BK3m3JLmK6U3Ph2DSAbWvyr" },
  };
}

/** The relay with per-reply payment on: Anthropic recorded, three NEAR nodes answering from `chain` (by tx hash). */
/** `secret`: the relay's sign-up secret (a rotation: another); `up`: the store, shared with another world (one relay, its
 *  secret changed). */
function world(o: { receive?: string | undefined; anthropic?: () => Response; nodeLies?: (url: string, r: any) => any; usage?: [number, number]; balance?: bigint | null; account?: string | null; bind?: (token: string) => string; secret?: string; up?: ReturnType<typeof fakeUpstash> } = {}) {
  const clock = { t: Date.now() };
  const now = () => clock.t;
  const up = o.up ?? fakeUpstash(now);
  const counter = privateCounter(redisCounter({ url: "https://redis.test", token: "t", fetchFn: up.fetchFn as never, now }), STORE_KEY);
  const asked: any[] = [];
  const nodeCalls: string[] = [];
  /** Transactions NEAR knows, by hash. */
  const chain = new Map<string, any>();
  /** AgentZero's USDC on NEAR, as ft_balance_of answers it (null: no node answers); $10 unless a test says. */
  const held = { v: "balance" in o ? o.balance! : 10_000_000n };
  const balanceReads: string[] = [];
  const fetchFn = async (input: any, init: any = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.anthropic.com/")) {
      asked.push(init);
      return o.anthropic ? o.anthropic() : new Response(textSse(...(o.usage ?? [1000, 50])), { headers: { "content-type": "text/event-stream" } });
    }
    if (PAY_NODES.includes(url)) {
      const { method, params } = JSON.parse(init.body);
      // D37: AgentZero's balance, read before each reply (kept apart from the payment reads)
      if (method === "query" && params.method_name === "ft_balance_of") {
        balanceReads.push(JSON.parse(Buffer.from(params.args_base64, "base64").toString()).account_id);
        if (held.v === null) return new Response("{}", { status: 502 });
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", result: { result: [...Buffer.from(JSON.stringify(held.v.toString()))] } }));
      }
      nodeCalls.push(url);
      // a payment's block: made now (by the relay's clock)
      if (method === "block") return new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", result: { header: { timestamp_nanosec: (BigInt(clock.t) * 1_000_000n).toString() } } }));
      const known = chain.get(params.tx_hash);
      if (!known) return new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_TRANSACTION" } } }));
      const r = o.nodeLies ? o.nodeLies(url, known) : known;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", result: r }));
    }
    return new Response("{}", { status: 404 });
  };
  const relay = createRelay({ key: "partner-key", secret: "s", origins: [APP], anthropicKey: "sk-ant-zerofee-test-0000", agentZeroSecret: o.secret ?? TOKEN_SECRET, counter, fetchFn, now, ...("receive" in o ? (o.receive ? { agentZeroReceive: o.receive } : {}) : { agentZeroReceive: RECEIVE }) });
  let ip = 1;
  const account = o.account === undefined ? AGENT : o.account;
  const post = (path: string, body: unknown, token: string, extra: Record<string, string> = {}) => {
    const headers = { origin: APP, "content-type": "application/json", authorization: `Bearer ${token}`, ...(account ? { "x-zf-agent-account": account, "x-zf-agent-bind": (o.bind ?? KEY.bindFor)(token) } : {}), ...extra };
    return relay(new Request(`https://relay.test${path}`, { method: "POST", headers, body: JSON.stringify(body) }), `10.7.0.${ip++}`);
  };
  // D158: a body with no model is Sonnet 5.5 now; these tests price an Opus 5.5 reply, so they name it
  const chat = async (token: string, model: string | undefined = "claude-opus-5-5", extra: Record<string, string> = {}) => {
    const r = await post("/v0/agentzero/chat", { messages: [{ role: "user", content: "hi" }], ...(model ? { model } : {}) }, token, extra);
    if (r.status !== 200) return { status: r.status, body: (await r.json()) as any, z: null as any };
    const z = /event: zerofee\ndata: (.+)\n/.exec(await r.text())?.[1];
    return { status: 200, body: null, z: z ? JSON.parse(z) : null };
  };
  const pay = async (token: string, tx: string, from = AGENT) => {
    const r = await post("/v0/agentzero/pay", { tx, from }, token);
    return { status: r.status, body: (await r.json()) as any };
  };
  /** What the id owes now (the pay route with an empty body). */
  const owes = async (token: string) => (await (await post("/v0/agentzero/pay", {}, token)).json()) as any;
  return { relay, up, counter, asked, nodeCalls, chain, chat, pay, owes, post, clock, held, balanceReads };
}
/** Anthropic and NEAR for a relay a test builds itself: the reply's usage, and AgentZero's USDC ($10 unless said). */
const azFetch = (usage: [number, number], balance = { v: 10_000_000n }, asked: unknown[] = []) => (async (input: any, init: any = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://api.anthropic.com/")) return asked.push(init), new Response(textSse(...usage), { headers: { "content-type": "text/event-stream" } });
  if (JSON.parse(init.body ?? "{}").params?.method_name === "ft_balance_of") return new Response(JSON.stringify({ result: { result: [...Buffer.from(JSON.stringify(balance.v.toString()))] } }));
  return new Response("{}", { status: 404 });
}) as never;
/** A chat request to a relay a test builds itself, naming AgentZero's account (D37). */
/** Each sign-up here is its own phone, with its own AgentZero (the caps these tests count are per address and network,
 *  never one account's unpaid ids). */
const keyOfToken = new Map<string, ReturnType<typeof agentKey>>();
const chatReq = (token: string, extra: Record<string, string> = {}) => {
  const k = keyOfToken.get(token) ?? keyOfToken.set(token, agentKey()).get(token)!;
  const headers = { origin: APP, "content-type": "application/json", authorization: `Bearer ${token}`, "x-zf-agent-account": k.account, "x-zf-agent-bind": k.bindFor(token), ...extra };
  return new Request("https://relay.test/v0/agentzero/chat", { method: "POST", headers, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], model: "claude-opus-5-5" }) });
};
const hash = (n: number) => `${"1".repeat(42)}${"ABCDEFGHJK"[n]!}${"L"}`;

test("D152: a reply's exact cost is owed; the closing line says it and what the id owes in all", async () => {
  const w = world();
  const token = issueToken(TOKEN_SECRET);
  const first = await w.chat(token);
  assert.equal(first.status, 200);
  assert.equal(first.z.turnUsd, REPLY_MICROS / 1e6, "this reply's own cost");
  assert.equal(first.z.owedMicros, REPLY_MICROS, "Anthropic's usage × the published price, nothing added");
  assert.equal(first.z.owedMicros, costMicros({ input_tokens: 1000, output_tokens: 50 }, PRICES["claude-opus-5-5"]));
  assert.deepEqual(first.z.byModel, { "claude-opus-5-5": { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  assert.deepEqual(first.z.usage, { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, "a phone from before batches reads one model's usage");
  assert.equal(first.z.model, "claude-opus-5-5");
  assert.equal(first.z.replies, 1);
  assert.equal(first.z.paidMicros, 0);
  assert.equal(first.z.memo, memoOf(idOf(token)));
  // no id goes to Anthropic
  assert.ok(!w.asked[0].body.includes(idOf(token)));
});

test("D37 (QA 4 Nov: a $0 wallet got three replies on credit): no credit: after one reply the next is 402 (pay first), Claude not asked; its payment clears it and the next goes", async () => {
  const w = world({ usage: [15_000, 1_000] });
  const token = issueToken(TOKEN_SECRET);
  const memo = memoOf(idOf(token));
  const each = 15_000 * 4 + 1_000 * 20;
  const first = await w.chat(token);
  assert.equal(first.status, 200);
  assert.equal(first.z.owedMicros, each);
  const held = await w.chat(token);
  assert.deepEqual([held.status, held.body.code], [402, "agentzero.reply.unpaid"]);
  assert.equal(held.body.owedMicros, each);
  assert.equal(held.body.memo, memo, "the id's one memo");
  assert.equal(w.asked.length, 1, "Claude not asked while a reply is unpaid");
  const now = await w.owes(token);
  assert.deepEqual([now.state, now.owedMicros, now.reply], ["owed", each, held.body.reply]);
  w.chain.set(hash(1), txResult({ memo, amount: String(each) }));
  assert.deepEqual(await w.pay(token, hash(1)), { status: 200, body: { state: "paid", micros: each, owedMicros: 0 } });
  assert.deepEqual(await w.owes(token), { state: "paid", micros: 0, owedMicros: 0 });
  const next = await w.chat(token);
  assert.equal(next.status, 200, "control: paid, the next goes");
  assert.notEqual(next.z.reply, held.body.reply, "with its own number");
});

test("D37: prepaid only: AgentZero's own USDC on NEAR must cover the reply's most before Claude is asked; $0, too little, no account or an unread balance is refused (control: enough goes)", async () => {
  for (const [name, o, status, code] of [
    ["$0", { balance: 0n }, 402, "agentzero.reply.unfunded"],
    ["a cent under the most", { balance: BigInt(CHAT_CALL_MICROS - 1) }, 402, "agentzero.reply.unfunded"],
    ["no account named", { account: null }, 402, "agentzero.reply.unfunded"],
    ["not an account", { account: "bob.near" }, 402, "agentzero.reply.unfunded"],
    ["no node answers", { balance: null }, 503, "agentzero.reply.unread"],
  ] as const) {
    const w = world(o as never);
    const token = issueToken(TOKEN_SECRET);
    const r = await w.chat(token);
    assert.deepEqual([r.status, r.body?.code], [status, code], name);
    assert.equal(w.asked.length, 0, `${name}: Claude never asked`);
    assert.equal((await w.owes(token)).owedMicros, 0, `${name}: nothing owed`);
    if (status === 402) assert.equal(r.body.needMicros, CHAT_CALL_MICROS, `${name}: says what it needs`);
  }
  // control: exactly the most goes, its balance read for the account named
  const w = world({ balance: BigInt(CHAT_CALL_MICROS) });
  const token = issueToken(TOKEN_SECRET);
  assert.equal((await w.chat(token)).status, 200);
  assert.deepEqual(w.balanceReads, [AGENT]);
  // the id is free again after a refusal (the hold let go): funded now, it goes
  const z = world({ balance: 0n });
  const t2 = issueToken(TOKEN_SECRET);
  assert.equal((await z.chat(t2)).status, 402);
  z.held.v = 5_000_000n;
  assert.equal((await z.chat(t2)).status, 200);
});

test("D37: anything unpaid holds the next reply (1 micro-dollar), the app's copy the same; the app asks for what the relay checks", async () => {
  assert.equal(SETTLE_AT_MICROS, 1);
  const { SETTLE_AT_MICROS: app, BATCH_CAP_MICROS, REPLY_HOLD_MICROS } = await import("../../packages/core/src/agent-price.ts");
  assert.equal(app, SETTLE_AT_MICROS, "the app's copy is the relay's");
  assert.equal(REPLY_HOLD_MICROS, CHAT_CALL_MICROS, "the app refuses below what the relay refuses below");
  assert.ok(BATCH_CAP_MICROS >= CHAT_CALL_MICROS, "the phone pays any honest reply");
});

test("a payment of less than what is owed takes off exactly that; the rest stays owed and holds the next reply; the same hash again takes nothing more", async () => {
  const w = world({ usage: [15_000, 1_000] });
  const token = issueToken(TOKEN_SECRET);
  const memo = memoOf(idOf(token));
  const each = 80_000;
  await w.chat(token);
  w.chain.set(hash(2), txResult({ memo, amount: String(each / 2) }));
  const part = await w.pay(token, hash(2));
  assert.equal(part.status, 200);
  assert.equal(part.body.micros, each / 2);
  assert.equal(part.body.owedMicros, each / 2, "the rest still owed");
  assert.equal((await w.pay(token, hash(2))).body.owedMicros, each / 2, "never taken off twice");
  assert.equal((await w.chat(token)).status, 402, "half paid: the next waits");
  w.chain.set(hash(3), txResult({ memo, amount: String(each / 2) }));
  assert.equal((await w.pay(token, hash(3))).body.owedMicros, 0);
  assert.equal((await w.chat(token)).status, 200, "control: all paid, it goes");
});

test("product decision, 4 Nov: a payment is counted under the id's hold: while a reply is running it is 409 (try again), never counted against a moving total (control: after, it counts)", async () => {
  const w = world();
  const token = issueToken(TOKEN_SECRET);
  const memo = memoOf(idOf(token));
  await w.chat(token);
  await w.counter.setOnce(`az:reply:busy:${idOf(token)}`, "1", 60_000);
  w.chain.set(hash(4), txResult({ memo }));
  const r = await w.pay(token, hash(4));
  assert.deepEqual([r.status, r.body.code], [409, "agentzero.reply.running"]);
  assert.equal(w.nodeCalls.length, 0, "NEAR not even asked");
  await w.counter.del(`az:reply:busy:${idOf(token)}`);
  assert.equal((await w.pay(token, hash(4))).body.owedMicros, 0);
  assert.equal(await w.counter.get(`az:reply:busy:${idOf(token)}`), null, "the hold let go after counting");
});

test("D152 replay: a transaction counts once, for anyone; a later batch can't be paid with an earlier one's hash (control: a new hash pays)", async () => {
  const w = world();
  const token = issueToken(TOKEN_SECRET);
  const memo = memoOf(idOf(token));
  await w.chat(token);
  w.chain.set(hash(1), txResult({ memo }));
  assert.equal((await w.pay(token, hash(1))).status, 200);
  await w.chat(token);
  const again = await w.pay(token, hash(1));
  assert.deepEqual([again.status, again.body.code], [409, "agentzero.pay.used"]);
  assert.equal((await w.owes(token)).owedMicros, REPLY_MICROS, "still owed");
  // five claims of one new transaction at once: it counts once, and the batch is paid
  w.chain.set(hash(2), txResult({ memo }));
  const all = await Promise.all(Array.from({ length: 5 }, () => w.pay(token, hash(2))));
  assert.ok(all.filter((r) => r.status === 200).length >= 1);
  assert.equal((await w.owes(token)).owedMicros, 0);
  // and it pays nothing of the next batch
  await w.chat(token);
  assert.equal((await w.pay(token, hash(2))).status, 409);
  assert.equal((await w.owes(token)).owedMicros, REPLY_MICROS);
});

test("D152: a payment names its id in its memo: another id can't claim it (front-running a public transfer); control: its own id can", async () => {
  const w = world();
  const a = issueToken(TOKEN_SECRET);
  const b = issueToken(TOKEN_SECRET);
  await w.chat(a);
  await w.chat(b);
  w.chain.set(hash(3), txResult({ memo: memoOf(idOf(a)) }));
  const stolen = await w.pay(b, hash(3));
  assert.deepEqual([stolen.status, stolen.body.code], [402, "agentzero.pay.unverified"]);
  assert.equal((await w.pay(a, hash(3))).status, 200, "its own id pays with it");
});

test("D152: what isn't exactly a final, successful USDC ft_transfer to ZeroFee pays nothing; the batch stays owed", async () => {
  for (const [name, bend] of [
    ["to someone else", { receive: "77".repeat(32) }],
    ["another coin's contract", { contract: "wrap.near" }],
    ["not final", { final: "EXECUTED_OPTIMISTIC" }],
    ["it failed", { ok: false }],
    ["no USDC event", { event: false }],
    ["an event of another amount", { eventAmount: "999999999" }],
    ["not ft_transfer", { method: "ft_transfer_call" }],
    ["more than 1 yocto attached", { deposit: "2" }],
    ["two actions", { actions: 2 }],
    ["another signer", { from: "b1".repeat(32) }],
  ] as const) {
    const w = world();
    const token = issueToken(TOKEN_SECRET);
    await w.chat(token);
    w.chain.set(hash(4), txResult({ memo: memoOf(idOf(token)), ...bend }));
    const r = await w.pay(token, hash(4));
    assert.ok(r.status === 402 || r.status === 400, `${name}: ${r.status}`);
    assert.equal((await w.owes(token)).owedMicros, REPLY_MICROS, `${name}: still owed`);
  }
  // control: the same, unbent, pays
  const w = world();
  const token = issueToken(TOKEN_SECRET);
  await w.chat(token);
  w.chain.set(hash(5), txResult({ memo: memoOf(idOf(token)), amount: String(REPLY_MICROS + 7) }));
  assert.equal((await w.pay(token, hash(5))).status, 200, "more than the cost is fine (never asked for)");
});

test("D152: two of NEAR's nodes must agree: one node that lies about an amount, or about a payment, credits nothing (control: both honest)", async () => {
  const w = world({ nodeLies: (url, r) => (url === PAY_NODES[1] ? { ...r, transaction: { ...r.transaction, receiver_id: "evil.near" } } : r) });
  const token = issueToken(TOKEN_SECRET);
  await w.chat(token);
  w.chain.set(hash(6), txResult({ memo: memoOf(idOf(token)) }));
  assert.equal((await w.pay(token, hash(6))).status, 402);
  // node 1 says the same payment moved $5: amounts differ, nothing is credited
  const memo = memoOf(idOf(token));
  const nodes = (bend: (url: string) => any) => (async (url: string, init: any) => new Response(JSON.stringify({ result: JSON.parse(init.body).method === "block" ? { header: { timestamp_nanosec: "1800000000000000000" } } : bend(url) }))) as never;
  const v = await verifyPayment({ tx: hash(6), from: AGENT, receive: RECEIVE, memo, fetchFn: nodes((u) => txResult({ memo, amount: u === PAY_NODES[0] ? "5000000" : String(REPLY_MICROS) })) });
  assert.equal(v.why, "NEAR's nodes disagree");
  const honest = await verifyPayment({ tx: hash(6), from: AGENT, receive: RECEIVE, memo: memoOf(idOf(token)), fetchFn: (async (_u: string, init: any) => { const b = JSON.parse(init.body); return new Response(JSON.stringify({ result: b.method === "block" ? { header: { timestamp_nanosec: "1800000000000000000" } } : w.chain.get(b.params.tx_hash) })); }) as never });
  assert.equal(honest.amount, String(REPLY_MICROS));
});

test("D37: one reply at a time per id; any amount unpaid holds the next (control: paid, it goes; a reply that cost nothing frees the id)", async () => {
  const ledger = replyLedger({ ...fakeStore() });
  assert.deepEqual(await ledger.open("id1"), { ok: true });
  assert.deepEqual(await ledger.open("id1"), { running: true });
  assert.equal((await ledger.owe("id1", 1, { input_tokens: 1 }, "claude-opus-5-5"))!.micros, 1);
  const held = await ledger.open("id1");
  assert.equal(held.unpaid?.micros, 1, "a millionth of a dollar unpaid: the next waits");
  await ledger.paidUpTo("id1", held.unpaid!.batch, 1);
  assert.equal(await ledger.owed("id1"), null);
  assert.deepEqual(await ledger.open("id1"), { ok: true });
  await ledger.owe("id1", 0, null, "");
  assert.deepEqual(await ledger.open("id1"), { ok: true }, "a reply that cost nothing frees the id");
});
function fakeStore() {
  const m = new Map<string, string>();
  return { setOnce: async (k: string, v: string) => (m.has(k) ? false : (m.set(k, v), true)), get: async (k: string) => m.get(k) ?? null, del: async (k: string) => void m.delete(k), incr: async () => 0 };
}

test("D152: a reply that dropped before Anthropic answered costs nothing and frees the id; Anthropic's error too", async () => {
  const w = world({ anthropic: () => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } }), { status: 529, headers: { "content-type": "application/json" } }) });
  const token = issueToken(TOKEN_SECRET);
  const r = await w.chat(token);
  assert.equal(r.status, 200);
  assert.equal(r.z, null, "no paid closing line");
  const next = await w.chat(token);
  assert.notEqual(next.status, 402, "nothing owed");
});

test("D152: Sonnet 5.5's reply owes Sonnet's price, half Opus's (control: Opus)", async () => {
  const owed: Record<string, number> = {};
  for (const model of ["claude-opus-5-5", "claude-sonnet-5-5"]) {
    const w = world();
    owed[model] = (await w.chat(issueToken(TOKEN_SECRET), model)).z.owedMicros;
  }
  assert.equal(owed["claude-sonnet-5-5"]! * 2, owed["claude-opus-5-5"]);
});

test("D152 off: without the receiving account the pay route is the 404 it was and the chat is the free reading (no owed line)", async () => {
  const w = world({ receive: undefined });
  const token = issueToken(TOKEN_SECRET);
  assert.equal((await w.pay(token, hash(1))).status, 404);
  const r = await w.chat(token);
  assert.ok(r.status === 200 || r.status === 402);
  if (r.z) assert.equal(r.z.owedMicros, undefined);
});

test("D152: the pay route takes only {tx, from}: junk, a long body or an address that isn't AgentZero's shape is refused, NEAR never asked", async () => {
  const w = world();
  const token = issueToken(TOKEN_SECRET);
  await w.chat(token);
  for (const body of [{ tx: "junk", from: AGENT }, { tx: hash(1), from: "alice.near" }, { tx: hash(1) }, { tx: hash(1), from: AGENT, extra: 1 }]) {
    const r = await w.post("/v0/agentzero/pay", body, token);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(w.nodeCalls.length, 0);
});

test("D152 paymentOf reads a recorded shape exactly (pure)", () => {
  const memo = memoOf("someid");
  assert.deepEqual(paymentOf(txResult({ memo }), { receive: RECEIVE, memo, from: AGENT }), { amount: String(REPLY_MICROS), from: AGENT, block: "4reUv2gyKfdJmnmqQXRf8BK3m3JLmK6U3Ph2DSAbWvyr" });
  assert.ok("why" in paymentOf(txResult({ memo: "agentzero 00" }), { receive: RECEIVE, memo, from: AGENT }));
  assert.ok(CHAT_CALL_MICROS > REPLY_MICROS);
});

test("SR3 M5: a reply that settles between the ledger's read and its hold counts; at $0.25 the second reply waits (control: paid, it goes)", async () => {
  const m = new Map<string, string>();
  let afterRead: (() => Promise<void>) | null = null;
  const store = {
    setOnce: async (k: string, v: string) => (m.has(k) ? false : (m.set(k, v), true)),
    get: async (k: string) => {
      const v = m.get(k) ?? null;
      if (afterRead && k.startsWith("az:reply:owed:")) { const f = afterRead; afterRead = null; await f(); }
      return v;
    },
    del: async (k: string) => void m.delete(k),
    incr: async () => 0,
  };
  const ledger = replyLedger(store);
  // reply A settles right after B read "nothing owed"
  afterRead = async () => void m.set("az:reply:owed:id1", "260000,0,1234567,1800000000,3,60000,500,0,0,0,0,0,0");
  const b = await ledger.open("id1");
  assert.equal(b.unpaid?.micros, 260_000, "B waits for the batch's payment");
  assert.equal(m.has("az:reply:busy:id1"), false, "B's hold is let go");
  await ledger.paidUpTo("id1", "1234567", 260_000);
  assert.deepEqual(await ledger.open("id1"), { ok: true });
});

test("SR3 M4: a payment counted for THIS id whose 'paid' write was lost heals on the retry (paid, never a second payment); another id still gets 409", async () => {
  const w = world();
  const token = issueToken(TOKEN_SECRET);
  await w.chat(token);
  w.chain.set(hash(7), txResult({ memo: memoOf(idOf(token)) }));
  // the store marked the hash used for this id's batch, but the batch's record wasn't brought down
  const owing = (await w.counter.get(`az:reply:owed:${idOf(token)}`))!.split(",");
  await w.counter.setOnce(`az:reply:tx:${hash(7)}`, `${owing[2]}:${owing[0]}`, 60_000);
  const r = await w.pay(token, hash(7));
  assert.deepEqual(r, { status: 200, body: { state: "paid", micros: 0, owedMicros: 0 } });
  assert.equal((await w.owes(token)).owedMicros, 0, "the batch is paid");
  const other = issueToken(TOKEN_SECRET);
  await w.chat(other);
  assert.equal((await w.pay(other, hash(7))).status, 409);
});

test("SR3 H3: never-paid ids' first replies have their own small day ($10 by default); an id that has paid is outside it (control)", async () => {
  const w = world();
  // the first-reply day already at its $10
  await w.counter.add(`agentzero:first:${Math.floor(w.clock.t / 86_400_000)}`, 10_000_000, 86_400_000);
  const fresh = issueToken(TOKEN_SECRET);
  const r = await w.chat(fresh);
  assert.equal(r.status, 503, "a farm of new sign-ups gets nothing more today");
  assert.equal(w.asked.length, 0);
  // an id that has paid before still thinks
  const payer = issueToken(TOKEN_SECRET);
  await w.counter.setOnce(`az:reply:payer:${idOf(payer)}`, "1", 60_000);
  assert.equal((await w.chat(payer)).status, 200);
});

test("the never-paid ceiling still bounds new ids (each prepaid, one reply until paid): a new id past the day is 503 (control: an id that has paid goes on)", async () => {
  // each reply $0.08; a $0.30 never-paid day for the test: the reservation ($0.152) is held on it while a reply runs
  const w = world({ usage: [15_000, 1_000] });
  const relay = createRelay({ key: "partner-key", secret: "s", origins: [APP], anthropicKey: "sk-ant-zerofee-test-0000", agentZeroSecret: TOKEN_SECRET, counter: w.counter, agentZeroReceive: RECEIVE, agentZeroFirstDailyUsd: 0.3,
    fetchFn: azFetch([15_000, 1_000]), now: () => w.clock.t });
  let n = 0;
  const chat = async (token: string) => {
    const r = await relay(chatReq(token), `10.9.0.${n++}`);
    await r.text();
    return r.status;
  };
  const a = issueToken(TOKEN_SECRET);
  assert.equal(await chat(a), 200, "a: $0.08, unpaid");
  assert.equal(await chat(a), 402, "a: nothing more until it pays");
  assert.equal(await chat(issueToken(TOKEN_SECRET)), 200, "b: the day holds $0.16");
  assert.equal(await chat(issueToken(TOKEN_SECRET)), 503, "c: its reservation would take the day past $0.30");
  const payer = issueToken(TOKEN_SECRET);
  await w.counter.setOnce(`az:reply:payer:${idOf(payer)}`, "1", 60_000);
  assert.equal(await chat(payer), 200, "control: an id that has paid");
});

test("SR3 H1/L11: 'NEAR doesn't know it' only when two archival nodes say so; a node without final_execution_status FINAL counts for nothing", async () => {
  const memo = memoOf("x");
  const said = (answers: Record<string, any>) => (async (url: string, init: any) => new Response(JSON.stringify(JSON.parse(init.body).method === "block" ? { result: { header: { timestamp_nanosec: "1800000000000000000" } } } : answers[url] ?? { error: { cause: { name: "UNKNOWN_TRANSACTION" } } }))) as never;
  const ok = { result: txResult({ memo }) };
  const unknown = { error: { cause: { name: "UNKNOWN_TRANSACTION" } } };
  // the two regular nodes don't know it (they forget old ones), the archival ones do: paid
  assert.equal((await verifyPayment({ tx: hash(8), from: AGENT, receive: RECEIVE, memo, fetchFn: said({ [PAY_NODES[0]!]: ok, [PAY_NODES[1]!]: ok, [PAY_NODES[2]!]: unknown, [PAY_NODES[3]!]: unknown }) })).amount, String(REPLY_MICROS));
  // one archival node doesn't know it yet, the other does, a regular one agrees: paid (control: never "unknown" on one)
  assert.equal((await verifyPayment({ tx: hash(8), from: AGENT, receive: RECEIVE, memo, fetchFn: said({ [PAY_NODES[0]!]: unknown, [PAY_NODES[1]!]: ok, [PAY_NODES[2]!]: ok }) })).amount, String(REPLY_MICROS));
  // both archival nodes don't know it: unknown
  assert.equal((await verifyPayment({ tx: hash(8), from: AGENT, receive: RECEIVE, memo, fetchFn: said({}) })).why, "NEAR doesn't know that payment");
  // no final status: not taken
  const { final_execution_status: _drop, ...noStatus } = txResult({ memo });
  void _drop;
  assert.ok("why" in paymentOf(noStatus, { receive: RECEIVE, memo, from: AGENT }));
});

test("D152: each reply's record carries its own number (the phone pays a figure once, by it), in the closing line, the 402 and the owed answer", async () => {
  const w = world({ usage: [40_000, 4_000] });
  const token = issueToken(TOKEN_SECRET);
  const a = await w.chat(token);
  assert.match(a.z.reply, /^[0-9a-f]{16}$/);
  const held = await w.chat(token);
  assert.equal(held.status, 402);
  assert.equal(held.body.reply, a.z.reply);
  assert.equal((await w.owes(token)).reply, a.z.reply);
});

test("SR3 L13: a relay whose receiving account isn't the app's pinned one never turns paid mode on; its pay route says why (503, its own code), which the deploy's live check stops on (control: the pinned one pays)", async () => {
  const wrong = world({ receive: "5e".repeat(32) });
  const token = issueToken(TOKEN_SECRET);
  const r = await wrong.pay(token, hash(1));
  assert.deepEqual([r.status, r.body.code], [503, "agentzero.pay.receive-mismatch"]);
  const c = await wrong.chat(token);
  assert.equal(c.z?.owedMicros, undefined, "no paid reply: nothing owed is ever asked of the phone");
  const { ZEROFEE_RECEIVE } = await import("../../packages/core/src/agent-pay.ts");
  assert.equal(PINNED_RECEIVE, ZEROFEE_RECEIVE, "the relay's copy is the app's");
  assert.equal((await world().pay(issueToken(TOKEN_SECRET), hash(1))).status, 200, "control: the pinned account pays");
});

test("SR3 L9: a Stop's estimate is added to the batch like any reply (the meter on the phone snaps to it with the next figure)", async () => {
  const ledger = replyLedger({ ...fakeStore() });
  await ledger.open("id1");
  await ledger.owe("id1", 150_000, { input_tokens: 1 }, "claude-opus-5-5");
  await ledger.open("id1");
  const o = await ledger.owe("id1", 5000, { input_tokens: 1 }, "claude-opus-5-5");
  assert.equal(o!.micros, 155_000);
  assert.equal(o!.replies, 2);
});

test("product decision, 4 Nov: the batch's record is numbers only and short enough for the private store, even near its most", async () => {
  const s = fakeStore();
  const ledger = replyLedger(s);
  for (let i = 0; i < 40; i++) {
    await ledger.open("id1");
    await ledger.owe("id1", 6_000, { input_tokens: 12_345, output_tokens: 3_999, cache_read_input_tokens: 123_456, cache_creation_input_tokens: 12_345 }, i % 2 ? "claude-sonnet-5-5" : "claude-opus-5-5");
  }
  const raw = (await s.get("az:reply:owed:id1"))!;
  assert.match(raw, /^[0-9][0-9:,.]{0,127}$/, raw);
});

test("audit #20: a dust payment doesn't lift the never-paid ceiling; payments that together reach $0.25 do (each reply paid on its own)", async () => {
  const ledger = replyLedger({ ...fakeStore() });
  await ledger.open("dust");
  const owed = await ledger.owe("dust", 1_000, { input_tokens: 1 }, "claude-opus-5-5");
  await ledger.paidUpTo("dust", owed!.batch, 1_000);
  assert.equal(await ledger.owed("dust"), null, "the tiny reply is paid");
  assert.equal(await ledger.everPaid("dust"), false, "but $0.001 doesn't make the id a payer");
  // the same payment counted again adds nothing
  await ledger.paidUpTo("dust", owed!.batch, 1_000);
  for (let i = 0; i < 10; i++) {
    await ledger.open("real");
    const o = await ledger.owe("real", 24_000, { input_tokens: 1 }, "claude-opus-5-5");
    await ledger.paidUpTo("real", o!.batch, 24_000);
  }
  assert.equal(await ledger.everPaid("real"), false, "$0.24 in all: not yet");
  await ledger.open("real");
  const last = await ledger.owe("real", 10_000, { input_tokens: 1 }, "claude-opus-5-5");
  await ledger.paidUpTo("real", last!.batch, 10_000);
  assert.equal(await ledger.everPaid("real"), true, "control: $0.25 paid in all");
});

test("audit #20 (second pass): throwaway sign-ups from one address or one /48 stop at its own never-paid day, inside the relay's (control: another network, an id that has paid)", async () => {
  // each reply $0.08 (reservation ~$0.152): an address's never-paid $0.50 takes about one batch, whatever the ids
  const w = world({ usage: [15_000, 1_000] });
  const relay = createRelay({ key: "partner-key", secret: "s", origins: [APP], anthropicKey: "sk-ant-zerofee-test-0000", agentZeroSecret: TOKEN_SECRET, counter: w.counter, agentZeroReceive: RECEIVE,
    fetchFn: azFetch([15_000, 1_000]), now: () => w.clock.t });
  const chat = async (token: string, ip: string) => {
    const r = await relay(chatReq(token), ip);
    await r.text();
    w.clock.t += 11_000;
    return r.status;
  };
  // ten fresh ids from one address, two replies each: the address's day ends it, far under the relay's $10
  let ok = 0;
  for (let i = 0; i < 10; i++) {
    const id = issueToken(TOKEN_SECRET);
    for (let j = 0; j < 2; j++) if ((await chat(id, "10.9.0.1")) === 200) ok++;
  }
  assert.equal(ok, 5, "one address: 5 never-paid replies of $0.08 (with the next one's reservation held, its $0.50)");
  // one /48: a new /64 per id; its $2 ends it
  let net = 0;
  for (let i = 0; i < 40; i++) if ((await chat(issueToken(TOKEN_SECRET), `2001:db8:7:${i.toString(16)}::1`)) === 200) net++;
  assert.equal(net, 24, "one /48: 24 never-paid replies (its $2)");
  assert.equal(await chat(issueToken(TOKEN_SECRET), "203.0.113.77"), 200, "control: another network");
  const payer = issueToken(TOKEN_SECRET);
  await w.counter.setOnce(`az:reply:payer:${idOf(payer)}`, "1", 60_000);
  assert.equal(await chat(payer, "10.9.0.1"), 200, "control: an id that has paid, from the same address");
});

test("product decision, 4 Nov: AGENTZERO_TEST_TOKEN lets its holder past the per-address and per-network sign-up caps only; a wrong, short or missing token is capped; every money cap stays", async () => {
  const TEST = "t".repeat(40);
  const w = world({ usage: [15_000, 1_000] });
  const at = (agentZeroTestToken?: string) => createRelay({ key: "partner-key", secret: "s", origins: [APP], anthropicKey: "sk-ant-zerofee-test-0000", agentZeroSecret: TOKEN_SECRET, counter: w.counter, agentZeroReceive: RECEIVE, ...(agentZeroTestToken ? { agentZeroTestToken } : {}),
    fetchFn: azFetch([15_000, 1_000]), now: () => w.clock.t });
  const relay = at(TEST);
  const signup = async (r: typeof relay, ip: string, token?: string) => {
    w.clock.t += 7_000; // under the minute's 10
    const res = await r(new Request("https://relay.test/v0/agentzero/signup", { method: "POST", headers: { origin: APP, "content-type": "application/json", ...(token !== undefined ? { "x-zf-test-token": token } : {}) }, body: "{}" }), ip);
    return { status: res.status, body: (await res.json()) as { token?: string } };
  };
  for (let i = 0; i < 3; i++) assert.equal((await signup(relay, "10.7.0.1")).status, 200);
  assert.equal((await signup(relay, "10.7.0.1")).status, 429, "no token: the address's 3 a day");
  assert.equal((await signup(relay, "10.7.0.1", "t".repeat(39) + "u")).status, 429, "a wrong token is no token");
  assert.equal((await signup(relay, "10.7.0.1", "")).status, 429);
  const tokens: string[] = [];
  for (let i = 0; i < 25; i++) {
    const s = await signup(relay, "10.7.0.1", TEST);
    assert.equal(s.status, 200, "the right token: past the address's and the network's caps");
    tokens.push(s.body.token!);
  }
  // off when unset or short
  for (const off of [at(), at("short-token")]) assert.equal((await signup(off, "10.7.0.1", "short-token")).status, 429);
  // the money caps are the same with the token: ten fresh ids from this address get the address's never-paid $0.50
  let ok = 0;
  for (const token of tokens.slice(0, 10)) {
    for (let j = 0; j < 2; j++) {
      w.clock.t += 11_000;
      const r = await relay(chatReq(token, { "x-zf-test-token": TEST }), "10.7.0.1");
      await r.text();
      if (r.status === 200) ok++;
    }
  }
  assert.equal(ok, 5, "never-paid replies: the address's $0.50, token or not");
});

test("D37: the test lane's x-zf-test-token never skips payment: a $0 AgentZero with the token is refused and Claude never asked (control: funded, with the token, it goes; unpaid, it waits)", async () => {
  const TEST = "t".repeat(40);
  const w = world({ usage: [15_000, 1_000] });
  const balance = { v: 0n };
  const asked: unknown[] = [];
  const relay = createRelay({ key: "partner-key", secret: "s", origins: [APP], anthropicKey: "sk-ant-zerofee-test-0000", agentZeroSecret: TOKEN_SECRET, counter: w.counter, agentZeroReceive: RECEIVE,
    agentZeroTestToken: TEST, fetchFn: azFetch([15_000, 1_000], balance, asked), now: () => w.clock.t });
  const token = issueToken(TOKEN_SECRET);
  const chat = async () => {
    const r = await relay(chatReq(token, { "x-zf-test-token": TEST }), "10.7.3.1");
    const body = r.status === 200 ? (await r.text(), null) : ((await r.json()) as { code?: string });
    return [r.status, body?.code ?? null];
  };
  assert.deepEqual(await chat(), [402, "agentzero.reply.unfunded"], "$0 with the token: refused");
  assert.equal(asked.length, 0, "Claude never asked");
  balance.v = 1_000_000n;
  assert.deepEqual(await chat(), [200, null], "control: $1, it goes");
  assert.deepEqual(await chat(), [402, "agentzero.reply.unpaid"], "and the token doesn't skip paying for it");
  assert.equal(asked.length, 1);
});

test("QA: an id thinks only on the AgentZero account it proved is its own: a farm id naming a funded account it never bound is refused, Claude never asked (control: the bound id is served, then without its proof too; a new account binds only with its own proof)", async () => {
  // the farm: a fresh id names the victim's funded account, with no proof, or a proof made for another id
  const victim = world({ bind: () => "" });
  const farm = issueToken(TOKEN_SECRET);
  const r = await victim.chat(farm);
  assert.deepEqual([r.status, r.body.code], [403, "agentzero.reply.account"]);
  assert.equal(victim.asked.length, 0, "Claude never asked");
  assert.equal(victim.balanceReads.length, 0, "not even its balance read");
  const other = issueToken(TOKEN_SECRET);
  const stolen = world({ bind: () => KEY.bindFor(other) });
  assert.equal((await stolen.chat(farm)).status, 403, "a proof for another id binds nothing");
  assert.equal((await stolen.chat(farm)).status, 403, "and never later");
  // control: the account's own phone binds with its proof and is served
  const w = world();
  const token = issueToken(TOKEN_SECRET);
  assert.equal((await w.chat(token)).status, 200, "bound by its proof, served");
  const bound = await w.counter.get(`az:reply:bound:${idOf(token)}`);
  assert.match(String(bound), /^\d+$/, "the store keeps a number, never the account");
  assert.ok(!String(bound).includes(AGENT));
  w.chain.set(hash(1), txResult({ memo: memoOf(idOf(token)) }));
  assert.equal((await w.pay(token, hash(1))).status, 200);
  assert.equal((await w.chat(token, "claude-opus-5-5", { "x-zf-agent-bind": "" })).status, 200, "bound: the header alone, matching, is served");
  // a different account for the same id: only with that account's own proof
  const k2 = agentKey();
  w.chain.set(hash(2), txResult({ memo: memoOf(idOf(token)) }));
  assert.equal((await w.pay(token, hash(2))).status, 200);
  assert.equal((await w.chat(token, "claude-opus-5-5", { "x-zf-agent-account": k2.account, "x-zf-agent-bind": "" })).status, 403, "another account without its proof");
  assert.equal((await w.chat(token, "claude-opus-5-5", { "x-zf-agent-account": k2.account, "x-zf-agent-bind": k2.bindFor(token) })).status, 200, "control: with its own proof, it binds anew");
});

test("QA: bindProofOk is a pure ed25519 check of BIND_PREFIX + id against the implicit account (no node asked)", () => {
  const token = issueToken(TOKEN_SECRET);
  const id = idOf(token);
  const proof = KEY.bindFor(token);
  assert.equal(bindProofOk(id, AGENT, proof), true);
  assert.equal(bindProofOk(idOf(issueToken(TOKEN_SECRET)), AGENT, proof), false, "another id");
  assert.equal(bindProofOk(id, agentKey().account, proof), false, "another account");
  assert.equal(bindProofOk(id, AGENT, proof.replace(/^./, (c) => (c === "0" ? "1" : "0"))), false, "a bent signature");
  assert.equal(bindProofOk(id, "a9".repeat(32), proof), false, "not a key");
  assert.equal(bindProofOk(id, AGENT, ""), false);
  assert.equal(BIND_PREFIX, "zerofee-agentzero-bind:");
});

test("QA: the phone's proof (packages/core agent-wallet.ts bindProof, AgentZero's own key) is what the relay checks; the same prefix on both; the wallet off or a bad id signs nothing", async () => {
  const { bindProof, BIND_PREFIX: app } = await import("../../packages/core/src/agent-wallet.ts");
  assert.equal(app, BIND_PREFIX, "the app's copy is the relay's");
  const secret = new Uint8Array(32).fill(7);
  const keys = async () => secret.slice();
  const token = issueToken(TOKEN_SECRET);
  const p = await bindProof(keys, idOf(token));
  assert.match(p.account, /^[0-9a-f]{64}$/);
  assert.equal(bindProofOk(idOf(token), p.account, p.proof), true);
  assert.equal(bindProofOk(idOf(issueToken(TOKEN_SECRET)), p.account, p.proof), false, "control: another id");
  await assert.rejects(bindProof(null, idOf(token)), "AgentZero's wallet off: nothing signed");
  await assert.rejects(bindProof(keys, "not an id"));
});

test("QA (LOW): at most two ids at a time with a reply unpaid per bound account: a third fresh id naming it is refused, Claude never asked (control: after one pays, the third goes; another account is free)", async () => {
  const w = world();
  const [a, b, c] = [issueToken(TOKEN_SECRET), issueToken(TOKEN_SECRET), issueToken(TOKEN_SECRET)];
  assert.equal((await w.chat(a)).status, 200, "a: unpaid");
  assert.equal((await w.chat(b)).status, 200, "b: unpaid");
  const third = await w.chat(c);
  assert.deepEqual([third.status, third.body.code], [402, "agentzero.reply.account-full"]);
  assert.equal(w.asked.length, 2, "Claude never asked for the third");
  assert.equal((await w.owes(c)).owedMicros, 0, "nothing owed by it");
  // another account (its own key, its own proof) is not held by these
  const k2 = agentKey();
  assert.equal((await w.chat(c, "claude-opus-5-5", { "x-zf-agent-account": k2.account, "x-zf-agent-bind": k2.bindFor(c) })).status, 200, "control: another account");
  // a pays: its slot frees, and a fresh id on the first account goes
  w.chain.set(hash(1), txResult({ memo: memoOf(idOf(a)) }));
  assert.equal((await w.pay(a, hash(1))).body.owedMicros, 0);
  const d = issueToken(TOKEN_SECRET);
  assert.equal((await w.chat(d)).status, 200, "control: after a payment the count frees");
  assert.equal((await w.chat(issueToken(TOKEN_SECRET))).status, 402, "and holds again at two");
  // what the store keeps for it: numbers only (the scan in store-private.test.ts covers every write)
  for (const [k, v] of w.up.dump?.() ?? []) assert.match(String(v), /^[0-9][0-9:,.]*$/, String(k));
});

test("QA (LOW): a reply refused before Claude (too little money) takes no slot; a reply that cost nothing frees its slot", async () => {
  const poor = world({ balance: 0n });
  for (let i = 0; i < 3; i++) assert.equal((await poor.chat(issueToken(TOKEN_SECRET))).status, 402);
  poor.held.v = 5_000_000n;
  assert.equal((await poor.chat(issueToken(TOKEN_SECRET))).status, 200, "the refused ones left no slot behind");
  const ledger = replyLedger({ ...fakeStore() });
  await ledger.bind("i1", "123");
  await ledger.bind("i2", "123");
  await ledger.bind("i3", "123");
  assert.deepEqual(await ledger.claim("123", "i1"), { ok: true });
  assert.deepEqual(await ledger.claim("123", "i2"), { ok: true });
  assert.deepEqual(await ledger.claim("123", "i3"), { full: true });
  assert.deepEqual(await ledger.claim("123", "i1"), { ok: true }, "its own slot again");
  await ledger.open("i1");
  await ledger.owe("i1", 0, null, "");
  assert.deepEqual(await ledger.claim("123", "i3"), { ok: true }, "control: i1 cost nothing, its slot freed");
});

test("QA (SHOULD): a full account heals itself: a leftover slot whose id paid (its list change never got the lock) is dropped and the new id goes; a slot whose id still owes is never dropped (control)", async () => {
  const w = world();
  const [a, b, c, d] = [issueToken(TOKEN_SECRET), issueToken(TOKEN_SECRET), issueToken(TOKEN_SECRET), issueToken(TOKEN_SECRET)];
  assert.equal((await w.chat(a)).status, 200);
  assert.equal((await w.chat(b)).status, 200);
  // a pays while the account's list is locked by something else: its slot is left behind in the list
  const mark = BigInt(`0x${createHmac("sha256", TOKEN_SECRET).update(`agentzero-account:${AGENT}`).digest("hex").slice(0, 24)}`).toString();
  assert.equal(await w.counter.setOnce(`az:reply:acct-lock:${mark}`, "1", 60_000), true);
  w.chain.set(hash(1), txResult({ memo: memoOf(idOf(a)) }));
  assert.equal((await w.pay(a, hash(1))).body.owedMicros, 0, "a paid");
  await w.counter.del(`az:reply:acct-lock:${mark}`);
  assert.equal((await w.counter.get(`az:reply:acct-ids:${mark}`))?.split(",").length, 2, "a's slot is still in the list");
  // c: the list looks full, but a's id owes nothing: dropped, c goes
  assert.equal((await w.chat(c)).status, 200, "healed: the new id goes through");
  // control: b and c both owe: d waits
  const held = await w.chat(d);
  assert.deepEqual([held.status, held.body.code], [402, "agentzero.reply.account-full"]);
  assert.equal(w.asked.length, 3);
});

test("QA (5 Nov): a sign-in of ours that no longer verifies (the secret changed) is its own 401, agentzero.signup.again, with its line; no token or one in no form of ours is still signup.needed (controls); Claude never asked", async () => {
  const w = world();
  const dead = issueToken("an-older-secret-0123456789abcdef0123456789abcdef");
  const r = await w.chat(dead);
  assert.deepEqual([r.status, r.body.code, r.body.whatHappened], [401, "agentzero.signup.again", "ZeroFee lost this phone's sign-in. Nothing was paid."]);
  const none = await w.chat("");
  assert.deepEqual([none.status, none.body.code], [401, "agentzero.signup.needed"], "control: no token");
  const junk = await w.chat("az1.not-a-token");
  assert.deepEqual([junk.status, junk.body.code], [401, "agentzero.signup.needed"], "control: not one of ours");
  assert.equal(w.asked.length, 0, "Claude never asked");
  assert.equal((await w.chat(issueToken(TOKEN_SECRET))).status, 200, "control: a live sign-in answers");
});

test("QA (5 Nov): an orphan can't lock the account: after the secret changes, every old id's slot is under the old account mark, so a new sign-in on the same account has its two slots (control: before the change, a third id is full)", async () => {
  const before = world();
  const [a, b] = [issueToken(TOKEN_SECRET), issueToken(TOKEN_SECRET)];
  assert.equal((await before.chat(a)).status, 200, "a: unpaid");
  assert.equal((await before.chat(b)).status, 200, "b: unpaid");
  const third = await before.chat(issueToken(TOKEN_SECRET));
  assert.deepEqual([third.status, third.body.code], [402, "agentzero.reply.account-full"], "control: full under the same secret");
  // the same store, the secret changed: a and b are orphans (their tokens dead, their batches left to expire)
  const NEW = "a-new-secret-after-rotation-0123456789abcdef0123456789";
  const after = world({ secret: NEW, up: before.up });
  assert.equal((await after.chat(a)).body.code, "agentzero.signup.again", "the old sign-in: sign in again");
  const [c, d] = [issueToken(NEW), issueToken(NEW)];
  assert.equal((await after.chat(c)).status, 200, "a new sign-in on the same account goes");
  assert.equal((await after.chat(d)).status, 200, "and a second: the account's two slots are its own again");
  assert.deepEqual([(await after.chat(issueToken(NEW))).body.code], ["agentzero.reply.account-full"], "control: the count still applies to new ids");
});
