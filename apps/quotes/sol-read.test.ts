// POST /v0/sol/read (finding 3, 4 Nov): Solana reads through Helius, the key on the relay only. Reads pass, rebuilt from
// known fields; sends, simulations, scans and anything else are refused before Helius is asked; no key is a 503; the
// app's own origin gets a real session's minute, any other caller the old 60, and each origin shares a minute too.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain JS, deployed as is (no build step)
import { APP_ORIGINS, HELIUS_RPC, createRelay } from "./relay.mjs";
// @ts-ignore: plain JS
import { ALCHEMY_SOL_RPC, solReadOf } from "./sol-read.mjs";
// @ts-ignore: plain JS
import { READS_APP_PER_IP_DAY, READS_PER_IP_MINUTE, READS_PER_ORIGIN_MINUTE, SOL_READ_METHODS } from "./read-limits.mjs";

/** A fixture standing in for the relay's Helius key (never a real one). */
const FIXTURE_KEY = "fixture-helius-key-0000";
const WALLET = "GBPDDnczHRaVUgKFXrPhkcRYjyhCb7JsTdaeuJqhpTJJ";  // generated sample
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const APP = "zerofee-app://app";

function setup(o: { helius?: string | null; answer?: () => Response } = {}) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return o.answer ? o.answer() : new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: 5_000_000 } }), { status: 200 });
  };
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, fetchFn, helius: o.helius === null ? undefined : o.helius ?? FIXTURE_KEY });
  const post = (body: unknown, extra: { path?: string; origin?: string; method?: string; ip?: string } = {}) => {
    const headers = new Headers({ "content-type": "application/json" });
    if (extra.origin) headers.set("origin", extra.origin);
    return relay(new Request(`https://quotes.example${extra.path ?? "/api/relay?route=sol-read"}`, { method: extra.method ?? "POST", body: extra.method === "GET" ? undefined : JSON.stringify(body), headers }), extra.ip ?? "203.0.113.9");
  };
  return { sent, post };
}
const balance = { jsonrpc: "2.0", id: 7, method: "getBalance", params: [WALLET, { commitment: "confirmed" }] };

test("finding 3: a getBalance goes to Helius with the key, rebuilt from known fields only, and only its result comes back", async () => {
  const { sent, post } = setup();
  const r = await post({ ...balance, id: "caller-id", extra: "never-passed" }, { origin: APP, path: "/v0/sol/read" });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body, { jsonrpc: "2.0", id: "zf", result: { context: { slot: 1 }, value: 5_000_000 } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, `${HELIUS_RPC}?api-key=${FIXTURE_KEY}`);
  assert.equal(sent[0].init.redirect, "error", "a redirect never carries the key's address on");
  assert.deepEqual(JSON.parse(String(sent[0].init.body)), { jsonrpc: "2.0", id: "zf", method: "getBalance", params: [WALLET, { commitment: "confirmed" }] });
  assert.equal(r.headers.get("access-control-allow-origin"), APP);
});

test("finding 3: sends, simulations, scans, unknown options and odd arguments are refused before Helius is asked", async () => {
  const { sent, post } = setup();
  const refused = [
    { jsonrpc: "2.0", id: 1, method: "sendTransaction", params: ["AAAA"] },
    { jsonrpc: "2.0", id: 1, method: "simulateTransaction", params: ["AAAA"] },
    { jsonrpc: "2.0", id: 1, method: "getProgramAccounts", params: [MINT] },
    { jsonrpc: "2.0", id: 1, method: "requestAirdrop", params: [WALLET, 1] },
    { ...balance, params: [WALLET, { commitment: "confirmed", filters: [] }] },
    { ...balance, params: ["not an address"] },
    { ...balance, params: [WALLET, {}, "third"] },
    { jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [Array(101).fill(WALLET)] },
    { jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [WALLET, { mint: MINT, programId: MINT }] },
    { jsonrpc: "2.0", id: 1, method: "toString", params: [] },
    { id: 1, method: "getBalance", params: [WALLET] },
    [balance],
  ];
  for (const body of refused) assert.equal((await post(body, { origin: APP })).status, 400, JSON.stringify(body).slice(0, 80));
  assert.equal((await post(balance, { method: "GET" })).status, 404);
  assert.equal(sent.length, 0, "Helius was never asked");
});

test("finding 3: every read the app's display needs is one this route takes", () => {
  const reads = [
    ["getBalance", [WALLET, { commitment: "confirmed" }]],
    ["getTokenAccountsByOwner", [WALLET, { programId: MINT }, { encoding: "jsonParsed", commitment: "confirmed" }]],
    ["getMultipleAccounts", [[WALLET, MINT], { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 82 } }]],
    ["getSignaturesForAddress", [WALLET, { limit: 20 }]],
    ["getLatestBlockhash", [{ commitment: "confirmed" }]],
  ] as const;
  for (const [method, params] of reads) assert.ok(solReadOf({ jsonrpc: "2.0", id: 1, method, params }), method);
  // a send never passes; a trade's test run does since the test phone bugs (5 Nov: a trade never waits on a free node)
  assert.ok(!SOL_READ_METHODS.includes("sendTransaction") && SOL_READ_METHODS.includes("simulateTransaction"));
});

test("finding 3: no key is a 503 (the app asks the free nodes); an answer carrying the key back is never passed on", async () => {
  assert.equal((await setup({ helius: null }).post(balance, { origin: APP })).status, 503);
  const leak = setup({ answer: () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: `bad key ${FIXTURE_KEY}` } }), { status: 200 }) });
  const r = await leak.post(balance, { origin: APP });
  assert.equal(r.status, 502);
  assert.ok(!(await r.text()).includes(FIXTURE_KEY));
  assert.equal((await setup({ answer: () => new Response("{}", { status: 429 }) }).post(balance, { origin: APP })).status, 429, "Helius busy: the app moves on");
});

test("finding 3: the app's origin gets a real session's minute; any other caller the old 60", async () => {
  const app = setup();
  let last = 0;
  for (let i = 0; i < READS_PER_IP_MINUTE.app; i++) last = (await app.post(balance, { origin: APP })).status;
  assert.equal(last, 200, `a session's ${READS_PER_IP_MINUTE.app} reads a minute all pass`);
  assert.equal((await app.post(balance, { origin: APP })).status, 429, "one more is refused");
  const other = setup();
  for (let i = 0; i < READS_PER_IP_MINUTE.other; i++) last = (await other.post(balance)).status;
  assert.equal(last, 200);
  assert.equal((await other.post(balance)).status, 429, "a caller with no app origin keeps the old minute");
});

test("finding 3: an origin's callers together share its minute", async () => {
  const { post } = setup();
  const per = READS_PER_IP_MINUTE.other;
  let last = 0;
  for (let i = 0; i < READS_PER_ORIGIN_MINUTE.other; i++) last = (await post(balance, { ip: `198.51.${Math.floor(i / per)}.1` })).status;
  assert.equal(last, 200);
  assert.equal((await post(balance, { ip: "192.0.2.200" })).status, 429, "a fresh address from the same (no) origin waits for the minute");
});

test("product decision, 4 Nov: one address is many phones (a carrier's NAT): the app's day per address is READS_APP_PER_IP_DAY, far past any other caller's, and still a cap (review MUST: the Origin can be made up)", async () => {
  let today = 30_000;
  // a counter where this address already read `today` times today (past SOL_PER_DAY and NEAR_PER_DAY), and nothing else counted
  const counter = { hit: async (key: string) => (/^rate:(sol-read|near)-day:/.test(key) ? today : 1) };
  const fetchFn = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: 1 } }), { status: 200 });
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, fetchFn, helius: FIXTURE_KEY, counter });
  const post = (origin?: string) => relay(new Request("https://quotes.example/v0/sol/read", { method: "POST", body: JSON.stringify(balance), headers: { "content-type": "application/json", ...(origin ? { origin } : {}) } }), "203.0.113.9");
  assert.equal((await post(APP)).status, 200, "the app's phones behind one address read on");
  assert.equal((await post()).status, 429, "control: any other caller still has its day");
  today = READS_APP_PER_IP_DAY + 1;
  assert.equal((await post(APP)).status, 429, "one address claiming the app's Origin can't take the relay-wide day");
});

// Rules 3 and 9 (5 Nov): a trade's test run reads through the paid door, and behind Helius stands
// Alchemy's Solana node: a Helius that is dead, slow or busy is asked of Alchemy in the same request, silently.
const ALCHEMY_FIXTURE = "fixture-alchemy-key-0000";
const TX = "A".repeat(400);
const sim = { jsonrpc: "2.0", id: 1, method: "simulateTransaction", params: [TX, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed", minContextSlot: 5, accounts: { encoding: "base64", addresses: [WALLET, MINT] } }] };
const ok = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 9 }, value: { err: null } } }), { status: 200 });
function doors(helius: (url: string) => Response | Promise<Response>) {
  const sent: string[] = [];
  const fetchFn = async (url: string) => {
    sent.push(url.startsWith(HELIUS_RPC) ? "helius" : url.startsWith(ALCHEMY_SOL_RPC) ? "alchemy" : url);
    return url.startsWith(HELIUS_RPC) ? helius(url) : ok();
  };
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, fetchFn, helius: FIXTURE_KEY, alchemy: ALCHEMY_FIXTURE });
  const post = (body: unknown, path = "/v0/sol/read") => relay(new Request(`https://quotes.example${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: APP } }), "203.0.113.9");
  return { sent, post };
}

test("phone bugs: a trade's test run passes, rebuilt from its known fields; a send, a run that checks signatures or swaps the blockhash, or a run's options on another read are refused", () => {
  assert.deepEqual(solReadOf(sim)?.params, sim.params);
  for (const bad of [
    { ...sim, method: "sendTransaction" },
    { ...sim, params: [TX, { ...sim.params[1], sigVerify: true }] },
    { ...sim, params: [TX, { ...sim.params[1], replaceRecentBlockhash: true }] },
    { ...sim, params: [TX, { ...sim.params[1], encoding: "base58" }] },
    { ...sim, params: [TX] },
    { ...sim, params: ["A".repeat(1_648), sim.params[1]] },
    { ...sim, params: ["not base64!", sim.params[1]] },
    { ...sim, params: [TX, { ...sim.params[1], accounts: { encoding: "base64", addresses: Array(65).fill(WALLET) } }] },
    { ...balance, params: [WALLET, { sigVerify: false }] },
  ]) assert.equal(solReadOf(bad), null, JSON.stringify(bad).slice(0, 120));
});

test("phone bugs: Helius dead, slow or busy: the same read is asked of Alchemy at once and answers 200 (control: a Helius that answers is the only door asked)", async () => {
  for (const [name, helius] of [
    ["dead", () => { throw new TypeError("fetch failed"); }],
    ["busy", () => new Response("{}", { status: 429 })],
    ["down", () => new Response("{}", { status: 503 })],
    ["busy inside a 200", () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32429, message: "rate limited" } }), { status: 200 })],
    ["slow", () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); }],
  ] as const) {
    const { sent, post } = doors(helius as () => Response);
    const r = await post(sim);
    assert.equal(r.status, 200, name);
    assert.deepEqual((await r.json()).result, { context: { slot: 9 }, value: { err: null } }, name);
    assert.deepEqual(sent, ["helius", "alchemy"], name);
  }
  // control
  const { sent, post } = doors(ok);
  assert.equal((await post(sim)).status, 200);
  assert.deepEqual(sent, ["helius"]);
});

test("phone bugs: ?door=alchemy asks Alchemy first (two paid servers to compare); with no Alchemy key Helius alone answers, and only every door failing reaches the app", async () => {
  const a = doors(ok);
  assert.equal((await a.post(sim, "/api/relay?route=sol-read&door=alchemy")).status, 200);
  assert.deepEqual(a.sent, ["alchemy"]);
  // every door down: one 429 by name, never a key
  const sent: string[] = [];
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, fetchFn: async (url: string) => (sent.push(url), new Response("{}", { status: 429 })), helius: FIXTURE_KEY, alchemy: ALCHEMY_FIXTURE });
  const r = await relay(new Request("https://quotes.example/v0/sol/read", { method: "POST", body: JSON.stringify(sim), headers: { "content-type": "application/json", origin: APP } }), "203.0.113.9");
  assert.equal(r.status, 429);
  const text = await r.text();
  assert.ok(!text.includes(FIXTURE_KEY) && !text.includes(ALCHEMY_FIXTURE));
  assert.equal(sent.length, 2);
  // control: no Alchemy key, Helius alone
  const solo: string[] = [];
  const one = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, fetchFn: async (url: string) => (solo.push(url), new Response("{}", { status: 503 })), helius: FIXTURE_KEY });
  assert.equal((await one(new Request("https://quotes.example/v0/sol/read", { method: "POST", body: JSON.stringify(sim), headers: { "content-type": "application/json", origin: APP } }), "203.0.113.9")).status, 502);
  assert.equal(solo.length, 1);
});
