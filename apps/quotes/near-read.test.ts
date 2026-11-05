// POST /v0/near (D139): NEAR reads through FastNEAR's paid plan, the key on the relay only. Reads pass, rebuilt; sends
// and anything else are refused before FastNEAR is asked; no key is a 503; the key goes upstream and nowhere else.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain JS, deployed as is (no build step)
import { APP_ORIGINS, createRelay } from "./relay.mjs";
// @ts-ignore: plain JS
import { FASTNEAR_RPC, nearReadOf } from "./near-read.mjs";
// @ts-ignore: plain JS
import { READS_PER_IP_MINUTE } from "./read-limits.mjs";
const NEAR_PER_MINUTE = READS_PER_IP_MINUTE.other;

/** A fixture standing in for the operator's key (never a real one). */
const FIXTURE_KEY = "fixture-fastnear-key-0000";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

function setup(o: { fastnear?: string | null; answer?: () => Response } = {}) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return o.answer ? o.answer() : new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", result: { amount: "1", block_hash: "h" } }), { status: 200 });
  };
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, fetchFn, fastnear: o.fastnear === null ? undefined : o.fastnear ?? FIXTURE_KEY });
  const post = (body: unknown, extra: { path?: string; origin?: string; method?: string } = {}) => {
    const headers = new Headers({ "content-type": "application/json" });
    if (extra.origin) headers.set("origin", extra.origin);
    return relay(new Request(`https://quotes.example${extra.path ?? "/api/relay?route=near"}`, { method: extra.method ?? "POST", body: extra.method === "GET" ? undefined : JSON.stringify(body), headers }), "203.0.113.9");
  };
  return { sent, post };
}
const view = { jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", account_id: "safe.near", finality: "final" } };

test("D139: a read goes to FastNEAR's fixed address with the key in its header, rebuilt from known fields only", async () => {
  const { sent, post } = setup();
  const r = await post({ ...view, params: { ...view.params, extra: "never-passed" }, id: "caller-id" }, { origin: "zerofee-app://app" });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).result, { amount: "1", block_hash: "h" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, FASTNEAR_RPC);
  assert.equal(new Headers(sent[0].init.headers).get("authorization"), `Bearer ${FIXTURE_KEY}`);
  const forwarded = JSON.parse(String(sent[0].init.body));
  assert.deepEqual(forwarded.params, { request_type: "view_account", account_id: "safe.near", finality: "final" }, "only the read's own fields go on");
  assert.equal(forwarded.id, "zf", "the caller's id never goes on");
  assert.ok(!sent[0].url.includes(FIXTURE_KEY), "never in a URL");
  // the key never comes back
  assert.ok(!JSON.stringify(await (await post(view)).json()).includes(FIXTURE_KEY));
});

test("D139: sends and anything that isn't a read are refused before FastNEAR is asked (control: the same shape as a read passes)", async () => {
  const { sent, post } = setup();
  for (const method of ["send_tx", "broadcast_tx_commit", "broadcast_tx_async", "tx", "EXPERIMENTAL_tx_status", "EXPERIMENTAL_changes", "validators", "network_info"]) {
    const r = await post({ jsonrpc: "2.0", id: 1, method, params: { signed_tx_base64: "AAAA", tx_hash: "x" } });
    assert.equal(r.status, 400, method);
    assert.equal((await r.json()).code, "quotes.near.refused");
  }
  for (const params of [
    { request_type: "view_state", account_id: "safe.near", prefix_base64: "", finality: "final" },
    { request_type: "view_code", account_id: "safe.near", finality: "final" },
    { request_type: "view_account", account_id: "Not An Account", finality: "final" },
    { request_type: "view_account", account_id: "safe.near" },
    { request_type: "call_function", account_id: "intents.near", method_name: "x()", args_base64: "", finality: "final" },
  ]) assert.equal((await post({ jsonrpc: "2.0", id: 1, method: "query", params })).status, 400, JSON.stringify(params));
  assert.equal((await post({ jsonrpc: "2.0", method: "block", params: { finality: "final" } }, { method: "GET" })).status, 404, "POST only");
  assert.equal(sent.length, 0, "FastNEAR was never asked");
  // control: the reads it is for all pass
  for (const body of [
    view,
    { jsonrpc: "2.0", id: 1, method: "block", params: { finality: "final" } },
    { jsonrpc: "2.0", id: 1, method: "block", params: { block_id: 123 } },
    { jsonrpc: "2.0", id: 1, method: "status", params: [] },
    { jsonrpc: "2.0", id: 1, method: "gas_price", params: [null] },
    { jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_access_key_list", account_id: "safe.near", block_id: "11111111111111111111111111111111" } },
    { jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", account_id: "intents.near", method_name: "mt_tokens_for_owner", args_base64: b64({ account_id: "safe.near" }), finality: "final" } },
  ]) assert.equal((await post(body)).status, 200, JSON.stringify(body));
  assert.equal(sent.length, 7);
});

test("D139: without the key the route answers 503 and asks no one (control: with it, 200)", async () => {
  const off = setup({ fastnear: null });
  const r = await off.post(view);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, "quotes.not-configured");
  assert.equal(off.sent.length, 0);
  assert.equal((await setup().post(view)).status, 200);
});

test("D139: FastNEAR's 429 is said as busy (429), its failure as 502; a caller over its minute is limited", async () => {
  assert.equal((await setup({ answer: () => new Response("no", { status: 429 }) }).post(view)).status, 429);
  assert.equal((await setup({ answer: () => new Response("no", { status: 500 }) }).post(view)).status, 502);
  const { post } = setup();
  let last = 0;
  for (let i = 0; i <= NEAR_PER_MINUTE; i++) last = (await post(view)).status;
  assert.equal(last, 429, "one caller's minute has an end");
});

test("D139: the shape check alone (nearReadOf)", () => {
  assert.equal(nearReadOf({ jsonrpc: "2.0", method: "send_tx", params: {} }), null);
  assert.deepEqual(nearReadOf({ jsonrpc: "2.0", method: "status", params: { anything: 1 } }), { method: "status", params: [] });
});

test("review M2: 60 a minute per caller, 120 a minute per account across callers, and no free door to any contract's views (controls: within them, and the Safe's own views, pass)", async () => {
  // per caller: the 61st in a minute is limited
  const one = setup();
  let last = 0;
  for (let i = 0; i <= 60; i++) last = (await one.post(view)).status;
  assert.equal(last, 429);
  // per account: callers on many addresses reading one account are limited past 120 a minute; another account is not
  const sent: string[] = [];
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, fastnear: FIXTURE_KEY, fetchFn: async (url: string) => (sent.push(url), new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", result: {} }), { status: 200 })) });
  const from = (ip: string, body: unknown) => relay(new Request("https://quotes.example/api/relay?route=near", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), ip);
  const statuses: number[] = [];
  for (let i = 0; i < 121; i++) statuses.push((await from(`198.51.100.${i % 50}`, view)).status);
  assert.equal(statuses.filter((s) => s === 429).length, 1, "the 121st read of one account in a minute");
  assert.equal((await from("198.51.100.7", { ...view, params: { ...view.params, account_id: "other.near" } })).status, 200, "control: another account");
  // contracts: a public one with arguments, or any contract with none (the Safe's own views); never another's with arguments
  const q = (account_id: string, args: unknown) => ({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", account_id, method_name: "get", args_base64: b64(args), finality: "final" } });
  const c = setup();
  assert.equal((await c.post(q("some-dex.near", { pool: 1 }))).status, 400, "another contract's view with arguments: refused");
  assert.equal((await c.post({ ...q("safe.near", {}), params: { ...q("safe.near", {}).params, args_base64: "" } })).status, 200, "control: the Safe's own view, no arguments");
  assert.equal((await c.post(q("intents.near", { account_id: "safe.near" }))).status, 200, "control: a public contract asked about the Safe");
});

test("review L3: the key's request never follows a redirect, and an answer that carries the key is never passed on (control: a plain answer is)", async () => {
  const { sent, post } = setup({ answer: () => new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", result: { echo: `Bearer ${FIXTURE_KEY}` } }), { status: 200 }) });
  const r = await post(view);
  assert.equal(r.status, 502);
  assert.ok(!(await r.text()).includes(FIXTURE_KEY), "the key never comes back");
  assert.equal(sent[0].init.redirect, "error", "a redirect is an error, never followed");
  assert.equal((await setup().post(view)).status, 200, "control");
});
