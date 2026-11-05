// Audit H2 / fix #5 (3 Nov): the relay's day of quotes under ZeroFee's partner key (H2), Send's tagged status polls in a
// bucket of their own (M9), and no upstream call follows a redirect with a key (L12).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { QUOTES_DAY_LINE, QUOTES_DAY_SPENT, UPSTREAM, createRelay } from "./relay.mjs";

const KEY = "partner-key-SECRET-1234567890";
const SECRET = "relay-tag-secret";
const POCKET = "a1".repeat(32);
const DEPOSIT = "818473a0072ed5084b4ec9f665b47d7c244546ca9a0ebc76d71fe1e6274ef8ba";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const TAG = createHmac("sha256", SECRET).update(DEPOSIT).digest("base64url");
const pay = { dry: true, swapType: "EXACT_OUTPUT", originAsset: USDC, depositType: "CONFIDENTIAL_INTENTS", refundType: "CONFIDENTIAL_INTENTS", refundTo: POCKET, recipient: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", recipientType: "DESTINATION_CHAIN", amount: "1000000", confidentiality: "basic" };

function relayAt(o: { quotesDaily?: number; now?: () => number; answer?: (url: string, init: RequestInit) => Response | Promise<Response> } = {}) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    if (o.answer) return o.answer(url, init);
    return new Response(JSON.stringify(url.includes("/status") ? { status: "PENDING_DEPOSIT" } : { quote: { depositAddress: DEPOSIT, amountIn: "1000000", amountInUsd: "0.999631" }, quoteRequest: {} }), { status: url.includes("/quote") ? 201 : 200 });
  };
  const relay = createRelay({ key: KEY, secret: SECRET, origins: [], fetchFn, now: o.now ?? (() => Date.UTC(2026, 10, 3, 12)), ...(o.quotesDaily ? { quotesDaily: o.quotesDaily } : {}) });
  const quote = (ip: string, body: unknown = pay) => relay(new Request("https://quotes.example/v0/quote", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), ip);
  const status = (ip: string, tag?: string) => relay(new Request(`https://quotes.example/v0/status?depositAddress=${DEPOSIT}`, { headers: tag ? { "x-zerofee-status-tag": tag } : {} }), ip);
  const intent = (ip: string) => relay(new Request("https://quotes.example/v0/generate-intent", { method: "POST", body: JSON.stringify({ type: "swap_transfer", standard: "nep413", signerId: POCKET, depositAddress: DEPOSIT }), headers: { "content-type": "application/json" } }), ip);
  return { sent, quote, status, intent };
}

test("H2: quotes under the partner key have a relay-wide UTC day; past it, refused by name and 1Click isn't asked (controls: a new day, other routes, a refused shape doesn't count)", async () => {
  let t = Date.UTC(2026, 10, 3, 12);
  const r = relayAt({ quotesDaily: 3, now: () => t });
  // from three addresses: the day is the relay's, never one address's
  assert.deepEqual([(await r.quote("198.51.100.1")).status, (await r.quote("198.51.100.2")).status, (await r.quote("198.51.100.3")).status], [201, 201, 201]);
  const asked = r.sent.length;
  const over = await r.quote("198.51.100.4");
  assert.equal(over.status, 503);
  const body = await over.json();
  assert.equal(body.code, QUOTES_DAY_SPENT);
  assert.equal(body.whatHappened, QUOTES_DAY_LINE);
  assert.match(QUOTES_DAY_LINE, /^ZeroFee's /, "by name");
  assert.doesNotMatch(QUOTES_DAY_LINE, /we can't|something went wrong|error|please|!/i);
  assert.equal(r.sent.length, asked, "1Click is not asked past the day");
  assert.equal((await r.status("198.51.100.4", TAG)).status, 200, "control: status still answers");
  assert.equal((await r.intent("198.51.100.4")).status, 200, "control: a quote already made still goes on");
  t += 86_400_000;
  assert.equal((await r.quote("198.51.100.5")).status, 201, "control: a new UTC day");

  const shape = relayAt({ quotesDaily: 1 });
  assert.equal((await shape.quote("198.51.100.6", { ...pay, confidentiality: "public" })).status, 400);
  assert.equal((await shape.quote("198.51.100.6")).status, 201, "control: a refused shape spends nothing of the day");
});

test("H2: unset, the day is 10,000 quotes (QUOTES_DAILY sets it)", async () => {
  const r = relayAt();
  for (let i = 0; i < 10_000; i++) assert.equal((await r.quote(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`)).status, 201);
  assert.equal((await r.quote("198.51.100.9")).status, 503);
  assert.match(String((await import("node:fs")).readFileSync(new URL("./api/relay.mjs", import.meta.url), "utf8")), /quotesDaily: env\.QUOTES_DAILY,/);
});

test("M9: Send's status polls with their own tag count in a bucket of their own (600 a minute), never in the 60 that quotes use (controls: no tag or a wrong tag counts as before)", async () => {
  const r = relayAt();
  const ip = "203.0.113.50";
  const polls: number[] = [];
  for (let i = 0; i < 601; i++) polls.push((await r.status(ip, TAG)).status);
  assert.deepEqual([polls[0], polls[599], polls[600]], [200, 200, 429], "600 tagged reads a minute from one address");
  assert.equal((await r.quote(ip)).status, 201, "a quote from the same address still goes: the polls didn't use up its 60");

  const plain = relayAt();
  const bare: number[] = [];
  for (let i = 0; i < 61; i++) bare.push((await plain.status("203.0.113.51")).status);
  assert.deepEqual([bare[59], bare[60]], [200, 429], "control: with no tag, the 60 a minute as before");
  const wrong = relayAt();
  for (let i = 0; i < 60; i++) await wrong.status("203.0.113.52", "x".repeat(TAG.length));
  assert.equal((await wrong.quote("203.0.113.52")).status, 429, "control: a wrong tag counts in the quotes bucket");
});

test("L12: no upstream call follows a redirect with a key: 1Click, Helius and the market reads all ask with redirect \"error\" (control: a call that follows would hand the key on)", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("./relay.mjs", import.meta.url), "utf8");
  for (const call of ["r = await fetchFn(upstream.url, {", "await fetchFn(`${HELIUS_RPC}?api-key=", "r = await fetchFn(target, {"]) {
    const at = src.indexOf(call);
    assert.ok(at > 0, call);
    assert.match(src.slice(at, src.indexOf("\n", at)), /redirect: "error"/, call);
  }
  const pay = (await import("node:fs")).readFileSync(new URL("./agentzero-pay.mjs", import.meta.url), "utf8");
  assert.match(pay, /method: "POST", redirect: "error", headers/, "AgentZero's payment check asks NEAR's nodes the same way (D152)");
  // a 1Click that answers with a redirect to another host: fetch's own rule, redirect "error" throws, "follow" goes on
  const leaked: string[] = [];
  const redirecting = async (url: string, init: RequestInit) => {
    if (init.redirect === "error") throw new TypeError("fetch failed: redirect");
    leaked.push(new Headers(init.headers).get("authorization") ?? "");
    return new Response(JSON.stringify({ status: "PENDING_DEPOSIT" }), { status: 200 });
  };
  const r = relayAt({ answer: redirecting });
  const res = await r.status("203.0.113.60", TAG);
  assert.equal(res.status, 502, "1Click's redirect is refused, never followed");
  assert.deepEqual(leaked, [], "the partner key went nowhere else");
  assert.equal(r.sent[0].url, `${UPSTREAM}/status?depositAddress=${DEPOSIT}`);
  await redirecting("https://elsewhere.example", { headers: { authorization: `Bearer ${KEY}` } });
  assert.deepEqual(leaked, [`Bearer ${KEY}`], "control: a call without redirect \"error\" would have handed the key on");
});
