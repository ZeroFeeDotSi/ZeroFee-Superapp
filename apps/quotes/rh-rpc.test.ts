// POST /v0/rh/rpc: Robinhood Chain JSON-RPC through Alchemy, the key on the relay only. The app's reads and
// eth_sendRawTransaction pass, rebuilt; any other method, a batch or odd params are refused before Alchemy is asked; no
// key is a 503; the key never comes back in an answer; the read caps hold. A send passes only when it is one signed
// Robinhood Chain transaction whose sender recovers (rh-tx.mjs), under its own send caps (review LOW, QA).
// Alchemy is a mock here, never asked for real.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain JS, deployed as is (no build step)
import { APP_ORIGINS, createRelay } from "./relay.mjs";
// @ts-ignore: plain JS
import { ALCHEMY_RH_RPC, rhRpcOf } from "./rh-rpc.mjs";
// @ts-ignore: plain JS
import { READS_PER_IP_MINUTE } from "./read-limits.mjs";
// @ts-ignore: plain JS
import { RH_RPC_METHODS } from "./rh-methods.mjs";
// @ts-ignore: plain JS
import { RH_SEND_BUDGET, RH_SEND_LIGHT_DAY, RH_SEND_PER_ADDRESS_DAY, RH_SEND_PER_IP_MINUTE } from "./rh-rpc.mjs";
// @ts-ignore: plain JS
import { rhTxSender } from "./rh-tx.mjs";
// @ts-ignore: plain JS
import { memoryCounter } from "./guards.mjs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

// A small RLP encoder of the test's own (not rh-tx.mjs's), and transactions signed by a fixed test key.
const rlpLen = (n: number, short: number) => {
  if (n < 56) return [short + n];
  const b: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) b.unshift(x % 256);
  return [short + 55 + b.length, ...b];
};
type R = Uint8Array | R[];
const rlp = (v: R): Uint8Array => {
  if (Array.isArray(v)) {
    const body = Buffer.concat(v.map(rlp));
    return new Uint8Array([...rlpLen(body.length, 0xc0), ...body]);
  }
  if (v.length === 1 && v[0]! < 0x80) return v;
  return new Uint8Array([...rlpLen(v.length, 0x80), ...v]);
};
const n = (x: bigint): Uint8Array => (x === 0n ? new Uint8Array() : new Uint8Array(Buffer.from(x.toString(16).padStart(Math.ceil(x.toString(16).length / 2) * 2, "0"), "hex")));
const SECRET = new Uint8Array(32).fill(7);
const SENDER = `0x${Buffer.from(keccak_256(secp256k1.getPublicKey(SECRET, false).subarray(1)).subarray(12)).toString("hex")}`;
const CURVE_N = secp256k1.Point.CURVE().n;
const TO = new Uint8Array(20).fill(0x22);
/** One signed transaction: kind 2 (EIP-1559), 1 (EIP-2930) or 0 (legacy, EIP-155); `chain`, `tweak` change it after or before signing. */
function signed(kind: 0 | 1 | 2, o: { chain?: bigint; highS?: boolean; v?: bigint } = {}): string {
  const chain = o.chain ?? 4663n;
  const fields: R[] = kind === 2 ? [n(chain), n(3n), n(1000n), n(20_000_000n), n(21_000n), TO, n(10n ** 15n), new Uint8Array(), []]
    : kind === 1 ? [n(chain), n(3n), n(20_000_000n), n(21_000n), TO, n(10n ** 15n), new Uint8Array(), []]
    : [n(3n), n(20_000_000n), n(21_000n), TO, n(10n ** 15n), new Uint8Array()];
  const unsigned = kind === 0 ? rlp([...fields, n(chain), new Uint8Array(), new Uint8Array()]) : new Uint8Array([kind, ...rlp(fields)]);
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(keccak_256(unsigned), SECRET, { prehash: false, format: "recovered" }), "recovered");
  let s = sig.s, parity = BigInt(sig.recovery!);
  if (o.highS) (s = CURVE_N - s, parity ^= 1n);
  const v = o.v ?? (kind === 0 ? chain * 2n + 35n + parity : parity);
  const body = rlp([...fields, n(v), n(sig.r), n(s)]);
  return `0x${Buffer.from(kind === 0 ? body : new Uint8Array([kind, ...body])).toString("hex")}`;
}
const sendOf = (raw: string) => ({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [raw] });

/** A fixture standing in for the relay's Alchemy key (never a real one). */
const FIXTURE_KEY = "fixture-alchemy-key-0000";
const WALLET = "0x1111111111111111111111111111111111111111";
const APP = "zerofee-app://app";

function setup(o: { alchemy?: string | null; answer?: () => Response } = {}) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return o.answer ? o.answer() : new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x2a" }), { status: 200 });
  };
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, fetchFn, alchemy: o.alchemy === null ? undefined : o.alchemy ?? FIXTURE_KEY });
  const post = (body: unknown, extra: { path?: string; origin?: string; method?: string; ip?: string } = {}) => {
    const headers = new Headers({ "content-type": "application/json" });
    if (extra.origin) headers.set("origin", extra.origin);
    return relay(new Request(`https://quotes.example${extra.path ?? "/api/relay?route=rh-rpc"}`, { method: extra.method ?? "POST", body: extra.method === "GET" ? undefined : JSON.stringify(body), headers }), extra.ip ?? "203.0.113.9");
  };
  return { sent, post };
}
const balance = { jsonrpc: "2.0", id: 7, method: "eth_getBalance", params: [WALLET, "latest"] };

test("rh door: a balance read goes to Alchemy's Robinhood address with the key, rebuilt, and only its result comes back", async () => {
  const { sent, post } = setup();
  const r = await post({ ...balance, extra: "never-passed" }, { origin: APP, path: "/v0/rh/rpc" });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { jsonrpc: "2.0", id: 7, result: "0x2a" });
  assert.equal(sent.length, 1);
  assert.equal(ALCHEMY_RH_RPC, "https://robinhood-mainnet.g.alchemy.com/v2/");
  assert.equal(sent[0].url, `${ALCHEMY_RH_RPC}${FIXTURE_KEY}`);
  assert.equal(sent[0].init.redirect, "error", "a redirect never carries the key's address on");
  assert.deepEqual(JSON.parse(String(sent[0].init.body)), { jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [WALLET, "latest"] });
  assert.equal(r.headers.get("access-control-allow-origin"), APP);
});

test("rh door: a signed transaction passes as eth_sendRawTransaction, and the chain's refusal comes back as its error", async () => {
  const { sent, post } = setup({ answer: () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "nonce too low" } })) });
  const r = await post(sendOf(signed(2)), { origin: APP });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "nonce too low" } });
  assert.equal(JSON.parse(String(sent[0].init.body)).method, "eth_sendRawTransaction");
});

test("rh door: every method off the allowlist, a batch and odd params are refused (400) before Alchemy is asked", async () => {
  const { sent, post } = setup();
  const refused = [
    { jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{ address: WALLET }] },
    { jsonrpc: "2.0", id: 1, method: "debug_traceTransaction", params: [`0x${"ab".repeat(32)}`] },
    { jsonrpc: "2.0", id: 1, method: "txpool_content", params: [] },
    { jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newHeads"] },
    { jsonrpc: "2.0", id: 1, method: "eth_sendTransaction", params: [{ from: WALLET }] },
    { jsonrpc: "2.0", id: 1, method: "eth_sign", params: [WALLET, "0x00"] },
    { jsonrpc: "2.0", id: 1, method: "alchemy_getTokenBalances", params: [WALLET] },
    { jsonrpc: "2.0", id: 1, method: "constructor", params: [] },
    [balance, balance],
    { ...balance, params: ["not-an-address", "latest"] },
    { ...balance, params: [WALLET, "latest", "extra"] },
    { ...balance, jsonrpc: "1.0" },
    { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: ["0xzz"] },
    { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [`0x${"00".repeat(64 * 1024 + 1)}`] },
    { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [] },
  ];
  for (const body of refused) {
    const r = await post(body, { origin: APP });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal((await r.json()).code, "quotes.rh.refused");
  }
  assert.equal(sent.length, 0, "Alchemy is never asked for a refused call");
  // control: the allowlist is the app's own methods, and a call the app makes passes
  assert.ok(RH_RPC_METHODS.includes("eth_sendRawTransaction") && !RH_RPC_METHODS.includes("eth_getLogs"));
  assert.notEqual(rhRpcOf({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: WALLET, data: "0x70a08231" }, "latest"] }), null);
  assert.notEqual(rhRpcOf({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }), null);
});

test("rh door: no ALCHEMY_API_KEY answers 503 in the relay's problem shape, and Alchemy is never asked", async () => {
  const { sent, post } = setup({ alchemy: null });
  const r = await post(balance, { origin: APP });
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.equal(body.code, "quotes.not-configured");
  assert.equal(typeof body.whatHappened, "string");
  assert.deepEqual(body.money, { state: "not-involved" });
  assert.equal(sent.length, 0);
});

test("rh door: the key never comes back, not in a result, an error, a 429 or a failure", async () => {
  const answers = [
    () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: `echo ${FIXTURE_KEY}` })),
    () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: `bad key ${FIXTURE_KEY}` } })),
    () => new Response(`limit for ${FIXTURE_KEY}`, { status: 429 }),
    () => new Response(`no such key ${FIXTURE_KEY}`, { status: 401 }),
    () => new Response(`not enabled for this app ${FIXTURE_KEY}`, { status: 403 }),
    () => new Response(`oops ${FIXTURE_KEY}`, { status: 500 }),
    () => { throw new TypeError(`fetch failed ${FIXTURE_KEY}`); },
  ];
  for (const answer of answers) {
    const { post } = setup({ answer });
    const r = await post(balance, { origin: APP });
    const text = await r.text();
    assert.ok(!text.includes(FIXTURE_KEY), `key leaked at ${r.status}`);
    for (const [, v] of r.headers) assert.ok(!v.includes(FIXTURE_KEY));
  }
  // control: the same check sees a plain answer, so it would see the key if it were there
  const { post } = setup();
  assert.ok((await (await post(balance, { origin: APP })).text()).includes("0x2a"));
});

test("rh door: an Alchemy 429 is a 429, and the caller's minute is the reads' minute (the same caps as the other doors)", async () => {
  const busy = setup({ answer: () => new Response("", { status: 429 }) });
  assert.equal((await busy.post(balance, { origin: APP })).status, 429);
  const { sent, post } = setup();
  const ip = "198.51.100.4";
  for (let i = 0; i < READS_PER_IP_MINUTE.other; i++) assert.equal((await post(balance, { ip })).status, 200);
  const r = await post(balance, { ip });
  assert.equal(r.status, 429);
  assert.equal((await r.json()).code, "quotes.rate.limited");
  assert.equal(sent.length, READS_PER_IP_MINUTE.other, "the limited call never reaches Alchemy");
  // the app's own origin gets the app's room from another address
  for (let i = 0; i < READS_PER_IP_MINUTE.other + 1; i++) assert.equal((await post(balance, { origin: APP, ip: "198.51.100.5" })).status, 200);
});

test("rh door: Alchemy's 403 (Robinhood Chain not enabled for the key's app) is the relay's 503, never Alchemy's own words", async () => {
  for (const status of [403, 401]) {
    const { sent, post } = setup({ answer: () => new Response(JSON.stringify({ error: { message: `ROBINHOOD_MAINNET is not enabled for this app ${FIXTURE_KEY}` } }), { status }) });
    const r = await post(balance, { origin: APP });
    assert.equal(r.status, 503, "the app rests the door a minute and asks the public node (hood-proxy.test.ts)");
    const text = await r.text();
    assert.equal(JSON.parse(text).code, "quotes.not-configured");
    assert.ok(!/not enabled|ROBINHOOD_MAINNET/i.test(text) && !text.includes(FIXTURE_KEY), "Alchemy's raw text never passes");
    assert.equal(sent.length, 1, "control: Alchemy was asked");
  }
});

test("rh door: GET is nothing here", async () => {
  const { post } = setup();
  assert.equal((await post(null, { method: "GET", origin: APP })).status, 404);
});

test("rh door: each kind of signed Robinhood Chain transaction recovers its sender; the EIP-155 example recovers the spec's", () => {
  for (const kind of [2, 1, 0] as const) assert.equal(rhTxSender(signed(kind)), SENDER, `kind ${kind}`);
  // EIP-155's own example (chain 1), an answer this file didn't make: its sender is 0x9d8a…5a4f
  const spec = "0xf86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83";
  assert.equal(rhTxSender(spec, 1n), "0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f");
  assert.equal(rhTxSender(spec), null, "and it is refused for Robinhood Chain: it names chain 1");
});

test("rh door: a send that doesn't parse or recover is refused (400) before Alchemy is asked, and never counts as a send", async () => {
  const good = signed(2);
  const bad = [
    "0x02f8aa0182",
    `${good}00`,
    `0x03${good.slice(4)}`,
    signed(2, { chain: 1n }),
    signed(1, { chain: 56n }),
    signed(0, { chain: 1n }),
    signed(0, { v: 27n }),
    signed(2, { highS: true }),
    signed(2, { v: 5n }),
    `0x02${"c0"}`,
  ];
  for (const raw of bad) assert.equal(rhTxSender(raw), null, raw.slice(0, 24));
  const now = () => Date.UTC(2026, 10, 5, 12);
  const counter = memoryCounter(now);
  const sent: unknown[] = [];
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, counter, now, alchemy: FIXTURE_KEY, fetchFn: async (_u: string, init: RequestInit) => (sent.push(init), new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${"ab".repeat(32)}` }))) });
  const post = (body: unknown) => relay(new Request("https://quotes.example/v0/rh/rpc", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: APP } }), "203.0.113.70");
  for (const raw of bad) {
    const r = await post(sendOf(raw));
    assert.equal(r.status, 400, raw.slice(0, 24));
    assert.match((await r.json()).code, /^quotes\.rh\.(unsigned|refused)$/);
  }
  assert.equal(sent.length, 0, "Alchemy is never asked for one");
  assert.equal(await counter.add(`rate:rh-send-day:203.0.113.70:${Math.floor(now() / 86_400_000)}`, 0, 86_400_000), 0, "a refused send isn't one of the day's");
  // control: the same relay sends a good one, and only then counts it
  assert.equal((await post(sendOf(good))).status, 200);
  assert.equal(sent.length, 1);
  assert.equal(await counter.add(`rate:rh-send-day:203.0.113.70:${Math.floor(now() / 86_400_000)}`, 0, 86_400_000), 1);
});

test("rh door: sends count apart from reads: their own minute, day and relay-wide budget with a reserve for light senders", async () => {
  const now = () => Date.UTC(2026, 10, 5, 12);
  const day = Math.floor(now() / 86_400_000);
  const counter = memoryCounter(now);
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, counter, now, alchemy: FIXTURE_KEY, fetchFn: async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" })) });
  const post = (body: unknown, ip: string) => relay(new Request("https://quotes.example/v0/rh/rpc", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), ip);
  const tx = signed(2);
  // reads spent: a send still goes; sends spent: a read still goes
  const a = "198.51.100.20";
  for (let i = 0; i < READS_PER_IP_MINUTE.other; i++) await post(balance, a);
  assert.equal((await post(balance, a)).status, 429, "control: the reads' minute is spent");
  assert.equal((await post(sendOf(tx), a)).status, 200, "a send isn't a read");
  const b = "198.51.100.21";
  for (let i = 0; i < RH_SEND_PER_IP_MINUTE; i++) assert.equal((await post(sendOf(tx), b)).status, 200);
  assert.equal((await post(sendOf(tx), b)).status, 429, "the sends' own minute");
  assert.equal((await post(balance, b)).status, 200, "a read isn't a send");
  // the address's day
  const c = "198.51.100.22";
  await counter.add(`rate:rh-send-day:${c}:${day}`, RH_SEND_PER_ADDRESS_DAY, 86_400_000);
  const r = await post(sendOf(tx), c);
  assert.equal(r.status, 429);
  assert.match((await r.json()).whatHappened, /today/);
  // the relay-wide minute's general part spent: a heavy sender rests, a light one sends from the reserve
  await counter.add("budget:rh-send:minute", RH_SEND_BUDGET.minute, 60_000);
  const heavy = "198.51.100.23";
  await counter.add(`rate:rh-send-day:${heavy}:${day}`, RH_SEND_LIGHT_DAY + 1, 86_400_000);
  const h = await post(sendOf(tx), heavy);
  assert.equal(h.status, 503);
  assert.equal((await h.json()).code, "quotes.rh.resting");
  assert.equal((await post(sendOf(tx), "198.51.100.24")).status, 200, "a light sender sends on");
  assert.equal((await post(balance, heavy)).status, 200, "and reads have their own budget");
});
