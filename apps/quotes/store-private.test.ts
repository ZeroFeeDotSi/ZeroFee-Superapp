// QA's store rule (3 Nov, the product privacy question: Upstash is OK only if it holds NOTHING linkable): every command
// the relay sends the shared store, across its routes (AgentZero's sign-up, paid replies, each prepaid (D37),
// the next held (402) until paid, what is owed asked, one payment, and the next reply; quotes,
// status, market reads, NEAR reads, Solana sends, alerts, pairing, from IPv4 and IPv6 callers), is scanned. No key or
// value may carry a 64-hex account, a NEAR name, an IP, an AgentZero id or a transaction hash; every value is a number
// or a flag; every count lives at most 24 h and every set-once value at most 7 days. Control: the same requests through
// the raw store (no AGENTZERO_STORE_KEY) leave the IPs and the id in plain sight, so the scan can fire.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRelay } from "./relay.mjs";
import { memoryCounter, privateCounter, redisCounter } from "./guards.mjs";
import { issueToken, tokenId } from "./agentzero.mjs";
import { PAY_NODES, PINNED_RECEIVE, USDC_CONTRACT, memoOf } from "./agentzero-pay.mjs";
import { fakeUpstash } from "./testing/fake-upstash.ts";
import { agentKey } from "./testing/agent-key.ts";
import { SIM_CALL_MICROS, SIM_SYSTEM } from "./agentzero-sim.mjs";

const APP = "zerofee-app://app";
/** The Sim's own origin (D157): its AgentZero route answers the web app only. */
const WEB = "https://superapp.zerofee.si";
const SECRET = "token-secret";
const STORE_KEY = "scan-store-key-0123456789abcdef0123456789abcdef";
const KEY = agentKey();
const AGENT = KEY.account;
const TX = `${"1".repeat(42)}AL`;
const IPS = ["203.0.113.77", "2001:db8:85a3::8a2e:370:7334"];

const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const sse = () =>
  ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 15000, output_tokens: 1 } } }) +
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
  ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hi." } }) +
  ev("content_block_stop", { index: 0 }) +
  ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1000 } }) +
  ev("message_stop", {});

/** One run of every route against the store; `wrap`: the private store, or not (the control). → every command sent. */
async function run(wrap: boolean) {
  const up = fakeUpstash();
  const sent: string[][] = [];
  const fetchStore = (async (url: string, init: { body: string }) => {
    for (const c of JSON.parse(init.body) as string[][]) sent.push(c.map(String));
    return up.fetchFn(url, init);
  }) as never;
  const raw = redisCounter({ url: "https://redis.test", token: "t", fetchFn: fetchStore });
  const counter = wrap ? privateCounter(raw, STORE_KEY) : raw;
  const token = issueToken(SECRET);
  const memo = memoOf(tokenId(SECRET, token)!);
  // each reply $0.08 (15,000 in, 1,000 out at Opus 5.5's price, asked for by name: the default is Sonnet 5.5, D158): four go, the fifth is 402, one payment of $0.32 settles them
  const args = Buffer.from(JSON.stringify({ receiver_id: PINNED_RECEIVE, amount: "320000", memo })).toString("base64");
  const log = `EVENT_JSON:${JSON.stringify({ standard: "nep141", event: "ft_transfer", data: [{ old_owner_id: AGENT, new_owner_id: PINNED_RECEIVE, amount: "320000" }] })}`;
  const txResult = { final_execution_status: "FINAL", status: { SuccessValue: "" }, transaction: { signer_id: AGENT, receiver_id: USDC_CONTRACT, actions: [{ FunctionCall: { method_name: "ft_transfer", args, deposit: "1" } }] }, receipts_outcome: [{ outcome: { executor_id: USDC_CONTRACT, status: { SuccessValue: "" }, logs: [log] } }], transaction_outcome: { block_hash: "4reUv2gyKfdJmnmqQXRf8BK3m3JLmK6U3Ph2DSAbWvyr" } };
  let simCalls = 0;
  // the payment's block time, one figure on every node (two nodes must agree on it)
  const blockAt = (BigInt(Date.now() + 1_000) * 1_000_000n).toString();
  const fetchFn = async (input: any, init: any = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.anthropic.com/") && String(init.body ?? "").includes(JSON.stringify(SIM_SYSTEM).slice(1, 60))) simCalls++;
    if (url.startsWith("https://api.anthropic.com/")) return new Response(sse(), { headers: { "content-type": "text/event-stream" } });
    if (PAY_NODES.includes(url)) {
      const b = JSON.parse(init.body);
      // D37: AgentZero's own USDC ($10), read before each reply
      if (b.params?.method_name === "ft_balance_of") return new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", result: { result: [...Buffer.from(JSON.stringify("10000000"))] } }));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", result: b.method === "block" ? { header: { timestamp_nanosec: blockAt } } : txResult }));
    }
    return new Response(JSON.stringify({ quote: { depositAddress: "d".repeat(64), amountInUsd: "1" }, quoteRequest: {} }), { status: 201 });
  };
  const relay = createRelay({ key: "k", secret: "s", origins: [APP, WEB], anthropicKey: "sk-ant-scan-0000", agentZeroSecret: SECRET, agentZeroReceive: PINNED_RECEIVE, counter, fetchFn, pairStore: undefined as never });
  const codes: number[] = [];
  for (const ip of IPS) {
    const req = (path: string, body?: unknown, auth = true) => relay(new Request(`https://relay.test${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin: APP, "content-type": "application/json", ...(auth ? { authorization: `Bearer ${token}`, "x-zf-agent-account": AGENT, "x-zf-agent-bind": KEY.bindFor(token) } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), ip);
    await (await req("/v0/agentzero/signup", {}, false)).text();
    // the prepaid path (D37): a reply, the next held (402) until it is paid, what is owed asked, one payment, the next reply
    const done = async (r: Response) => (await r.text(), codes.push(r.status));
    for (let i = 0; i < 2; i++) await done(await req("/v0/agentzero/chat", { messages: [{ role: "user", content: `hi ${i}` }], model: "claude-opus-5-5" }));
    await (await req("/v0/agentzero/pay", {})).text();
    await done(await req("/v0/agentzero/pay", { tx: TX, from: AGENT }));
    await (await req("/v0/agentzero/pay", {})).text();
    await done(await req("/v0/agentzero/chat", { messages: [{ role: "user", content: "after" }], model: "claude-opus-5-5" }));
    await (await req("/api/relay?route=quote", { dry: true, swapType: "EXACT_INPUT", originAsset: "nep141:x", depositType: "CONFIDENTIAL_INTENTS", refundType: "CONFIDENTIAL_INTENTS", refundTo: AGENT, recipient: AGENT, recipientType: "CONFIDENTIAL_INTENTS", amount: "1", confidentiality: "basic" }, false)).text();
    await (await req(`/api/relay?route=status&depositAddress=${"d".repeat(64)}`, undefined, false)).text();
    await (await req("/v0/market/gecko/networks", undefined, false)).text();
    await (await req("/v0/near", { jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", account_id: "kim.near", finality: "final" } }, false)).text();
    await (await req("/v0/sol/send", { tx: "AAAA" }, false)).text();
    await (await req("/v0/alerts/subscribe", { email: "kim@example.com" }, false)).text();
    // AgentZero in the Sim (D157): its visitor's minute and day, keyed by the caller's address, and the relay's dollars
    for (const words of ["hi", "what can you do"]) await (await relay(new Request("https://relay.test/v0/agentzero/sim", { method: "POST", headers: { origin: WEB, "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: words }] }) }), ip)).text();
  }
  return { sent, token, simCalls, codes };
}

const LEAKS: [string, RegExp][] = [
  ["a 64-hex account or deposit", /[0-9a-f]{64}/i],
  ["a NEAR name", /[a-z0-9_-]+\.(near|testnet)\b/i],
  ["an IPv4 address", /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/],
  ["an IPv6 address", /[0-9a-f]{1,4}:[0-9a-f]{0,4}:[0-9a-f]{0,4}/i],
  ["a transaction hash", new RegExp(TX)],
];

test("QA: nothing linkable in the shared store: every key HMAC'd, every value a number or a flag, every life within its cap (control: the raw store leaks)", async () => {
  const { sent, token, simCalls, codes } = await run(true);
  // the Sim's route ran (two replies a caller) and wrote its counts: the dollars reserved, then settled
  assert.equal(simCalls, 4, "the Sim's replies reached Claude");
  assert.ok(sent.some((c) => c[0] === "INCRBY" && c[2] === String(SIM_CALL_MICROS)), "the Sim's dollars, reserved");
  const id = tokenId(SECRET, token)!;
  assert.ok(sent.length > 20, "the routes did write");
  // the prepaid path really ran: a reply, the next held, one payment counted, the next reply goes
  assert.deepEqual(codes.slice(0, 4), [200, 402, 200, 200]);
  // a batch owed (its numbers), and once paid, the id's "has paid" flag and the used hash
  const sets = sent.filter((c) => c[0] === "SET");
  assert.ok(sets.some((c) => /^\d+(,\d+){12}$/.test(c[2]!)), "a batch's record (numbers only)");
  assert.ok(sets.filter((c) => c[2] === "1").length >= 2, "flags: each reply's hold");
  assert.ok(sets.some((c) => /^\d+:\d+$/.test(c[2]!)), "a used transaction, kept as its batch's number and paid total");
  const writes = sent.filter((c) => c[0] === "SET" || c[0] === "INCR" || c[0] === "INCRBY" || c[0] === "DEL" || c[0] === "GET");
  for (const c of writes) {
    const text = c.slice(1).join(" ");
    for (const [name, re] of LEAKS) assert.ok(!re.test(text), `${name} in ${c[0]} ${text}`);
    assert.ok(!text.includes(id), `the AgentZero id in ${c[0]} ${text}`);
    assert.match(c[1]!, /^z:[A-Za-z0-9_-]{32}$/, `every key is an HMAC: ${c[1]}`);
    if (c[0] === "SET") {
      assert.match(c[2]!, /^[0-9][0-9:,.]*$/, `a value that isn't a number or a flag: ${c[2]}`);
      const px = c.indexOf("PX");
      assert.ok(px > 0 && Number(c[px + 1]) <= 7 * 86_400_000, `no value lives past 7 days: ${c.join(" ")}`);
      if (c[2] === "0") assert.ok(Number(c[px + 1]) <= 86_400_000, `no count lives past 24 h: ${c.join(" ")}`);
    }
  }
  // control: without the store key, the same requests put the callers' IPs and the id in the keys
  const plain = await run(false);
  const all = plain.sent.map((c) => c.slice(1).join(" ")).join("\n");
  assert.ok(LEAKS.some(([, re]) => re.test(all)) || all.includes(tokenId(SECRET, plain.token)!), "the raw store shows what the private one hides");
  assert.ok(IPS.some((ip) => all.includes(ip)), "an IP in a raw key");
});

test("QA: without AGENTZERO_STORE_KEY the relay stores nothing new in the shared store and refuses paid mode, saying so on its pay route (control: with it, paid mode is on)", async () => {
  // the relay entry builds the counter from the env (api/relay.mjs): no key → this instance's memory, never shared
  assert.throws(() => privateCounter(memoryCounter(), "short"), /32\+ random bytes/);
  const relay = createRelay({ key: "k", secret: "s", origins: [APP], anthropicKey: "sk-ant-scan-0000", agentZeroSecret: SECRET, agentZeroReceive: PINNED_RECEIVE, counter: { ...memoryCounter(), shared: true } });
  const r = await relay(new Request("https://relay.test/v0/agentzero/pay", { method: "POST", headers: { origin: APP, "content-type": "application/json", authorization: `Bearer ${issueToken(SECRET)}` }, body: "{}" }), "10.1.1.1");
  assert.deepEqual([r.status, ((await r.json()) as { code: string }).code], [503, "agentzero.pay.store-key-unset"]);
  const on = createRelay({ key: "k", secret: "s", origins: [APP], anthropicKey: "sk-ant-scan-0000", agentZeroSecret: SECRET, agentZeroReceive: PINNED_RECEIVE, counter: privateCounter({ ...memoryCounter(), shared: true }, STORE_KEY) });
  const r2 = await on(new Request("https://relay.test/v0/agentzero/pay", { method: "POST", headers: { origin: APP, "content-type": "application/json", authorization: `Bearer ${issueToken(SECRET)}` }, body: '{"tx":"junk"}' }), "10.1.1.1");
  assert.equal(r2.status, 400, "control: paid mode on, a junk pay is refused as junk");
  // the relay entry's own wiring
  const entry = (await import("node:fs")).readFileSync(new URL("./api/relay.mjs", import.meta.url), "utf8");
  assert.match(entry, /counter: redis && typeof env\.AGENTZERO_STORE_KEY === "string" && env\.AGENTZERO_STORE_KEY\.length >= STORE_KEY_MIN \? privateCounter\(redisCounter\(redis\), env\.AGENTZERO_STORE_KEY\) : memoryCounter\(\),/);
});

test("QA: email alerts switched on with the shared store never write: every alerts route answers 503 alerts.store-shared and the store gets zero writes (control: the same alerts with their own store do write)", async () => {
  const { createAlerts } = await import("./alerts.mjs");
  const writes: unknown[][] = [];
  const recording = { get: async () => null, set: async (...a: unknown[]) => void writes.push(["set", ...a]), del: async (...a: unknown[]) => void writes.push(["del", ...a]), add: async (...a: unknown[]) => void writes.push(["add", ...a]), remove: async (...a: unknown[]) => void writes.push(["remove", ...a]), members: async () => [] };
  const make = (shared: boolean) => {
    const alerts = createAlerts({ store: recording as never, mail: (async () => undefined) as never, base: "https://relay.test", cronSecret: "cron-secret-0123456789" });
    return createRelay({ key: "k", secret: "s", origins: [APP], alerts, alertsStoreShared: shared, counter: privateCounter({ ...memoryCounter(), shared: true }, STORE_KEY) });
  };
  const call = (relay: ReturnType<typeof make>, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    relay(new Request(`https://relay.test${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), "10.2.2.2");
  const shared = make(true);
  for (const [path, body, headers] of [
    ["/v0/alerts/subscribe", { accountId: "kim.near", email: "kim@example.com", proof: { publicKey: "ed25519:x", signature: "x", nonce: "x", message: "x" } }, {}],
    ["/v0/alerts/check", undefined, { authorization: "Bearer cron-secret-0123456789" }],
    ["/v0/alerts/confirm?t=abc", undefined, {}],
  ] as const) {
    const r = await call(shared, path, body, headers);
    assert.deepEqual([r.status, ((await r.json()) as { code: string }).code], [503, "alerts.store-shared"], path);
  }
  assert.deepEqual(writes, [], "nothing written: no email, no account name");
  // the relay entry never even hands alerts the shared store: only ALERTS_STORE_* of its own, never `redis`
  const entry = (await import("node:fs")).readFileSync(new URL("./api/relay.mjs", import.meta.url), "utf8");
  assert.match(entry, /const alertsStoreShared = !alertsStore \|\| sharesRedis\(alertsStore\.url, redis\?\.url\);/);
  assert.match(entry, /store: alertsStore && !alertsStoreShared \? redisStore\(alertsStore\) : null,/);
  assert.doesNotMatch(entry, /redisStore\(redis\)/);
  // control: the same alerts on a store of their own (not shared) reach the store
  const own = make(false);
  await call(own, "/v0/alerts/check", undefined, { authorization: "Bearer cron-secret-0123456789" });
  assert.ok(writes.length > 0, "the control writes, so the scan above can fail");
});

test("QA: the relay entry's alerts store, from its env: no ALERTS_STORE_URL → shared (503, no store call); the shared URL → shared; the shared database by other credentials → shared; a Redis of its own → only it is called, never the shared one", async () => {
  const SHARED = "https://shared-db.upstash.test";
  const CRON = "cron-secret-0123456789";
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  const hosts: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    hosts.push(new URL(input instanceof Request ? input.url : String(input)).host);
    return new Response(JSON.stringify({ result: null }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  let n = 0;
  /** A fresh copy of api/relay.mjs under this env; → the cron's check round, its status and code, and the hosts called. */
  const checkWith = async (alertsUrl: string | undefined) => {
    for (const k of Object.keys(process.env)) if (/^(ALERTS_|KV_|AGENTZERO_|KEEP_|TRACE_)/.test(k)) delete process.env[k];
    Object.assign(process.env, { KV_REST_API_URL: SHARED, KV_REST_API_TOKEN: "shared-token", RESEND_API_KEY: "re_test", ALERTS_FROM: "alerts@relay.test", ALERTS_PUBLIC_URL: "https://relay.test", CRON_SECRET: CRON });
    if (alertsUrl !== undefined) Object.assign(process.env, { ALERTS_STORE_URL: alertsUrl, ALERTS_STORE_TOKEN: "alerts-token" });
    const { GET } = await import(`./api/relay.mjs?alerts-store=${n++}`);
    hosts.length = 0;
    const r: Response = await GET(new Request("https://relay.test/v0/alerts/check", { headers: { authorization: `Bearer ${CRON}` } }));
    const body = (await r.json()) as { code?: string };
    return { status: r.status, code: body.code, hosts: [...hosts] };
  };
  try {
    const none = await checkWith(undefined);
    assert.deepEqual([none.status, none.code, none.hosts], [503, "alerts.store-shared", []], "no ALERTS_STORE_URL: shared, nothing called");
    const same = await checkWith(SHARED);
    assert.deepEqual([same.status, same.code, same.hosts], [503, "alerts.store-shared", []], "the shared URL: shared");
    const otherCreds = await checkWith("https://someone:other-password@shared-db.upstash.test:443/");
    assert.deepEqual([otherCreds.status, otherCreds.code, otherCreds.hosts], [503, "alerts.store-shared", []], "the shared database by another credential string: still shared");
    // control: a Redis of its own is used, and the shared one is never called
    const own = await checkWith("https://alerts-db.upstash.test");
    assert.equal(own.status, 200, JSON.stringify(own));
    assert.ok(own.hosts.length > 0 && own.hosts.every((h) => h === "alerts-db.upstash.test"), `only the alerts' own store: ${own.hosts.join(", ")}`);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("QA (pairing): a computer's mailbox id is HMAC'd in the shared store like every key, its box (end-to-end sealed ciphertext) kept at most 10 minutes (control: memory without the key uses sha256)", async () => {
  const { createPair, PAIR_TTL_S } = await import("./pair.mjs");
  assert.ok(PAIR_TTL_S <= 600, "10 minutes at most");
  const puts: string[] = [];
  const store = { put: async (key: string, _box: string, ttl: number) => (puts.push(`${key} ${ttl}`), true), take: async () => null };
  const id = "ab".repeat(16);
  const pair = createPair({ store, counter: privateCounter({ ...memoryCounter(), shared: true }, STORE_KEY) });
  const answer = ({ status, body }: { status: number; body: unknown }) => new Response(JSON.stringify(body), { status });
  const problem = (status: number, code: string) => ({ status, body: { code } });
  await pair(new Request(`https://relay.test/v0/pair/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ box: "c2VhbGVk" }) }), id, "10.3.3.3", { answer, problem } as never);
  assert.equal(puts.length, 1);
  const [key, ttl] = puts[0]!.split(" ");
  assert.match(key!, /^z:[A-Za-z0-9_-]{32}$/, "the id under the store key's HMAC");
  assert.ok(!key!.includes(id));
  assert.ok(Number(ttl) <= 600);
  const plain = createPair({ store, counter: memoryCounter() });
  await plain(new Request(`https://relay.test/v0/pair/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ box: "c2VhbGVk" }) }), id, "10.3.3.3", { answer, problem } as never);
  assert.match(puts[1]!, /^pair:[0-9a-f]{64} /, "control: an instance's own memory, sha256");
});
