// NEAR trades on paid doors (rules 3 and 9, 5 Nov): /v0/near passes a Rhea trade's cheap views (TRADE_VIEWS, plain
// arguments) and still refuses heavy ones; /v0/near2 and /v0/near2/send are the same routes on the second paid door
// (NEAR_DOOR2_URL, its key inside the URL): unset, 503 and no one asked; set, its URL alone, no FastNEAR key sent to it.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain JS, deployed as is (no build step)
import { APP_ORIGINS, createRelay } from "./relay.mjs";
// @ts-ignore: plain JS
import { FASTNEAR_RPC, nearReadOf } from "./near-read.mjs";
// @ts-ignore: plain JS
import { memoryCounter } from "./guards.mjs";

/** Fixtures standing in for keys (never real ones). */
const FIXTURE_KEY = "fixture-fastnear-key-0000";
const DOOR2 = "https://door2.example/near/fixture-door2-key-1111";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const call = (account: string, method: string, args: unknown) => ({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: b64(args) } });

function setup(near2?: { url?: string; name?: string }) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    const body = JSON.parse(String(init.body));
    if (body.method === "send_tx") return new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", result: { final_execution_status: "NONE" } }), { status: 200 });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", result: { result: [49], block_height: 1 } }), { status: 200 });
  };
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, counter: memoryCounter(), fetchFn, fastnear: FIXTURE_KEY, ...(near2 ? { near2 } : {}) });
  const post = (path: string, body: unknown) => relay(new Request(`https://quotes.example${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: "zerofee-app://app" } }), "203.0.113.9");
  return { sent, post };
}

test("trade views pass /v0/near with plain arguments (control: a heavy view, an unknown one and nested arguments are refused)", () => {
  assert.ok(nearReadOf(call("v2.ref-finance.near", "get_pool", { pool_id: 79 })), "Rhea's pool");
  assert.ok(nearReadOf(call("v2.ref-finance.near", "get_return", { pool_id: 79, token_in: "wrap.near", amount_in: "1000000000000000000000000", token_out: "blackdragon.tkn.near" })), "Rhea's quote");
  assert.ok(nearReadOf(call("blackdragon.tkn.near", "ft_balance_of", { account_id: "abc123.near" })), "the coin wallet's coin");
  assert.ok(nearReadOf(call("v2.ref-finance.near", "get_deposits", { account_id: "abc123.near" })), "the wallet's Rhea balances");
  assert.ok(nearReadOf(call("v2.ref-finance.near", "get_user_storage_state", { account_id: "abc123.near" })), "the wallet's Rhea storage (near-fast)");
  // controls
  assert.equal(nearReadOf(call("v2.ref-finance.near", "get_pools", { from_index: 0, limit: 5000 })), null, "a list of everything: refused");
  assert.equal(nearReadOf(call("v2.ref-finance.near", "anything_heavy", { a: 1 })), null, "a view not on the list: refused");
  assert.equal(nearReadOf(call("blackdragon.tkn.near", "ft_balance_of", { account_id: { nested: "x" } })), null, "nested arguments: refused");
  assert.equal(nearReadOf(call("blackdragon.tkn.near", "ft_balance_of", { a: "1", b: "2", c: "3", d: "4", e: "5" })), null, "more than 4 arguments: refused");
});

test("door 2 unset: /v0/near2 and /v0/near2/send answer 503 and ask no one (control: /v0/near answers 200 from FastNEAR)", async () => {
  const { sent, post } = setup();
  assert.equal((await post("/v0/near2", call("blackdragon.tkn.near", "ft_balance_of", { account_id: "abc123.near" }))).status, 503);
  assert.equal((await post("/v0/near2/send", { tx: "AAAA" })).status, 503);
  assert.equal(sent.length, 0);
  const r = await post("/v0/near", call("blackdragon.tkn.near", "ft_balance_of", { account_id: "abc123.near" }));
  assert.equal(r.status, 200);
  assert.equal(sent[0]!.url, FASTNEAR_RPC);
});

test("door 2 set: a read goes to NEAR_DOOR2_URL alone, with no FastNEAR key; an answer carrying its URL is never passed on", async () => {
  const { sent, post } = setup({ url: DOOR2, name: "dRPC" });
  const r = await post("/v0/near2", call("blackdragon.tkn.near", "ft_balance_of", { account_id: "abc123.near" }));
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).result, { result: [49], block_height: 1 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.url, DOOR2);
  assert.equal(new Headers(sent[0]!.init.headers).get("authorization"), null, "FastNEAR's key never goes to door 2");
  assert.equal(String(sent[0]!.init.redirect), "error");
  // control: door 1's route is FastNEAR's, with its key
  await post("/v0/near", call("blackdragon.tkn.near", "ft_balance_of", { account_id: "abc123.near" }));
  assert.equal(sent[1]!.url, FASTNEAR_RPC);
  assert.equal(new Headers(sent[1]!.init.headers).get("authorization"), `Bearer ${FIXTURE_KEY}`);
});

test("door 2's answer that carries its own URL (its key) is refused, its failure is named by its operator", async () => {
  const sent: string[] = [];
  const fetchFn = async (url: string) => { sent.push(url); return new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", result: { echo: DOOR2 } }), { status: 200 }); };
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, counter: memoryCounter(), fetchFn, fastnear: FIXTURE_KEY, near2: { url: DOOR2, name: "dRPC" } });
  const r = await relay(new Request("https://quotes.example/v0/near2", { method: "POST", body: JSON.stringify(call("v2.ref-finance.near", "get_pool", { pool_id: 79 })), headers: { "content-type": "application/json" } }), "203.0.113.9");
  assert.equal(r.status, 502);
  const text = await r.text();
  assert.ok(!text.includes("fixture-door2-key"), "the key is never answered");
  assert.match(text, /dRPC didn't answer/);
});

test("D111's privacy line says what /v0/near sees: the Safe and your NEAR trading wallet, never the pocket or the float (pinned)", async () => {
  const { readFile } = await import("node:fs/promises");
  const here = new URL(".", import.meta.url);
  const said = [await readFile(new URL("README.md", here), "utf8"), await readFile(new URL("near-read.mjs", here), "utf8"), await readFile(new URL("../../packages/core/src/near-proxy.ts", here), "utf8")];
  for (const text of said) {
    assert.match(text, /\(D111\)[^.]*: the Safe\s+(?:\/\/\s+)?and your NEAR trading wallet\./, "the line, word for word");
    assert.doesNotMatch(text, /never the pocket's, the\s+(?:\/\/\s+)?float's or a chain wallet's/, "control: the old Safe-only line is gone");
  }
  // control: what it says matches what passes. The trading wallet's trade read passes; a pocket's balance inside NEAR
  // Intents (a public contract asked about another account) is still the core's own split (safeOnly), not widened here.
  assert.ok(nearReadOf(call("blackdragon.tkn.near", "ft_balance_of", { account_id: "abc123.near" })));
  assert.equal(nearReadOf(call("blackdragon.tkn.near", "ft_transfer", { receiver_id: "x.near", amount: "1" })), null, "a call that isn't a view: refused");
});

test("an unset door 2 has no upstream at all: no placeholder host anywhere, both routes 503, nothing fetched (control: set, its URL alone)", async () => {
  const { readFile } = await import("node:fs/promises");
  const relaySrc = await readFile(new URL("relay.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(relaySrc, /invalid\.invalid/, "no stand-in host for an unset door");
  assert.doesNotMatch(relaySrc, /NEAR's second node/, "voice: never \"node\"");
  // createNearRead/createNearSend without an upstream and without FastNEAR's bearer: never FastNEAR's address
  // @ts-ignore: plain JS
  const { createNearRead } = await import("./near-read.mjs");
  // @ts-ignore: plain JS
  const { createNearSend } = await import("./near-send.mjs");
  const sent: string[] = [];
  const fetchFn = async (url: string) => { sent.push(url); return new Response("{}", { status: 200 }); };
  const answer = ({ status, body }: { status: number; body: unknown }) => new Response(JSON.stringify(body), { status });
  const problem = (status: number, code: string) => ({ status, body: { code } });
  const req = (body: unknown) => new Request("https://quotes.example/v0/near2", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const unsetRead = createNearRead({ key: "x", rpc: undefined, bearer: false, fetchFn, limited: async () => false, within: async () => true, answer, problem });
  assert.equal((await unsetRead(req(call("v2.ref-finance.near", "get_pool", { pool_id: 79 })), "203.0.113.9")).status, 503);
  const unsetSend = createNearSend({ key: "x", rpc: undefined, bearer: false, fetchFn, limited: async () => false, within: async () => true, answer, problem });
  assert.equal((await unsetSend(req({ tx: "AAAA" }), "203.0.113.9", undefined)).status, 503);
  assert.deepEqual(sent, [], "nothing fetched, FastNEAR's address never used for door 2");
  // control: the relay with door 2 unset answers 503 on both routes; set, its URL alone
  const unset = setup();
  assert.equal((await unset.post("/v0/near2", call("v2.ref-finance.near", "get_pool", { pool_id: 79 }))).status, 503);
  assert.equal(unset.sent.length, 0);
  const set = setup({ url: DOOR2 });
  assert.equal((await set.post("/v0/near2", call("v2.ref-finance.near", "get_pool", { pool_id: 79 }))).status, 200);
  assert.deepEqual(set.sent.map((s) => s.url), [DOOR2]);
});

test("a door 2 URL that isn't https is never used (control: an https one is)", async () => {
  const { sent, post } = setup({ url: "http://door2.example/near/fixture-door2-key-1111" });
  assert.equal((await post("/v0/near2", call("v2.ref-finance.near", "get_pool", { pool_id: 79 }))).status, 503);
  assert.equal(sent.length, 0);
});
