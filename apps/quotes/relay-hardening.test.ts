// Security audit, 4 Nov (QA): the relay's own limits. Each test fails on the code before its fix.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain JS, deployed as is (no build step)
import { APP_ORIGINS, createRelay } from "./relay.mjs";

const APP = "zerofee-app://app";
const WALLET = "GBPDDnczHRaVUgKFXrPhkcRYjyhCb7JsTdaeuJqhpTJJ";  // generated sample
const FIXTURE_KEY = "fixture-helius-key-0000";

const solRead = (relay: (r: Request, ip: string) => Promise<Response>, ip = "203.0.113.9", origin = APP) =>
  relay(new Request("https://quotes.example/v0/sol/read", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [WALLET] }) }), ip);

test("audit S1: Helius's answer with no length is read only up to the cap, never whole", async () => {
  const CHUNK = 64 * 1024;
  const TOTAL = 48; // 3 MB, three times the cap
  let pulled = 0;
  const fetchFn = async () =>
    new Response(
      new ReadableStream({
        pull(c) {
          if (pulled >= TOTAL) return c.close();
          pulled++;
          c.enqueue(new Uint8Array(CHUNK).fill(0x20));
        },
      }),
      { status: 200 },
    );
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, fetchFn, helius: FIXTURE_KEY });
  const r = await solRead(relay);
  assert.equal(r.status, 502);
  assert.equal((await r.json()).code, "quotes.sol.too-big");
  assert.ok(pulled <= 1024 * 1024 / CHUNK + 2, `stopped at the cap: pulled ${pulled} of ${TOTAL} chunks`);
});

test("audit #7: the trace can't fill the shared store: its bytes have a day per caller and relay-wide, and other routes keep answering", async () => {
  // @ts-ignore: plain JS
  const { memoryCounter } = await import("./guards.mjs");
  // @ts-ignore: plain JS
  const { memoryTraces, TRACE_BYTES_PER_BUCKET_DAY, TRACE_BYTES_DAY } = await import("./trace.mjs");
  let t = Date.UTC(2026, 10, 4, 1);
  const now = () => t;
  const inner = memoryTraces(now);
  let stored = 0;
  const traceStore = { ...inner, push: async (k: string, box: string, keep: number, ttl: number) => ((stored += box.length), inner.push(k, box, keep, ttl)) };
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, counter: memoryCounter(now), traceStore, traceReadToken: "a-reader-token-of-16+", helius: FIXTURE_KEY, now, fetchFn: async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: 1 }), { status: 200 }) });
  const box = "A".repeat(60 * 1024);
  const post = (ip: string) => relay(new Request(`https://quotes.example/v0/trace/${"ab".repeat(16)}`, { method: "POST", headers: { "content-type": "text/plain", origin: APP }, body: box }), ip);
  // one caller, 100 a minute (under the per-minute 120): refused once its day's bytes are spent
  let refused = 0;
  for (let i = 0; i < 200; i++) {
    if (i % 100 === 0) t += 61_000;
    if ((await post("198.51.100.7")).status === 429) refused++;
  }
  assert.ok(refused > 0, "a caller's trace bytes stop at its day");
  assert.ok(stored <= TRACE_BYTES_PER_BUCKET_DAY, `one caller stored ${stored} bytes`);
  // many callers: the relay-wide day stops them all, and the store never holds more than it
  for (let ip = 0; ip < 8; ip++) for (let i = 0; i < 150; i++) {
    if (i % 100 === 0) t += 61_000;
    await post(`198.51.101.${ip}`);
  }
  assert.ok(stored <= TRACE_BYTES_DAY, `relay-wide stored ${stored} bytes`);
  assert.equal((await solRead(relay)).status, 200, "a read still answers");
});

test("audit S3: callers with a made-up app Origin can spend the shared minute, but a real phone's first reads still answer", async () => {
  // @ts-ignore: plain JS
  const { READS_PER_IP_MINUTE, READS_PER_ORIGIN_MINUTE, READS_APP_FLOOR_PER_IP_MINUTE } = await import("./read-limits.mjs");
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, helius: FIXTURE_KEY, fetchFn: async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: 1 }), { status: 200 }) });
  const spoofers = Math.ceil(READS_PER_ORIGIN_MINUTE.app / READS_PER_IP_MINUTE.app) + 1;
  for (let ip = 0; ip < spoofers; ip++) for (let i = 0; i < READS_PER_IP_MINUTE.app; i++) await solRead(relay, `192.0.2.${ip}`);
  assert.equal((await solRead(relay, `192.0.2.${spoofers + 1}`)).status, 200, "a fresh phone's read answers");
  let ok = 0;
  for (let i = 1; i < READS_APP_FLOOR_PER_IP_MINUTE + 5; i++) if ((await solRead(relay, "203.0.113.50")).status === 200) ok++;
  assert.equal(ok, READS_APP_FLOOR_PER_IP_MINUTE, "its floor a minute answers, and no more while the shared minute is spent");
});

test("audit S2: the relay's day spent by heavy addresses ends it for them, not for a phone that has read little today", async () => {
  // @ts-ignore: plain JS
  const { memoryCounter } = await import("./guards.mjs");
  // @ts-ignore: plain JS
  const { SOL_READ_BUDGET } = await import("./sol-read.mjs");
  // @ts-ignore: plain JS
  const { READS_LIGHT_BUCKET_DAY } = await import("./read-limits.mjs");
  const now = () => Date.UTC(2026, 10, 4, 12);
  const day = Math.floor(now() / 86_400_000);
  const counter = memoryCounter(now);
  // fifteen addresses read the relay's whole day
  await counter.add(`budget:helius-read:day:${day}`, SOL_READ_BUDGET.day, 86_400_000);
  const heavy = "198.51.100.77";
  await counter.add(`rate:sol-read-day:${heavy}:${day}`, READS_LIGHT_BUCKET_DAY + 1, 86_400_000);
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, counter, helius: FIXTURE_KEY, now, fetchFn: async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: 1 }), { status: 200 }) });
  assert.equal((await solRead(relay, "203.0.113.60")).status, 200, "a light phone reads on");
  assert.equal((await solRead(relay, heavy)).status, 503, "a heavy address rests till tomorrow");
});

test("audit S4: junk transactions can't rest every phone's sends: an address has a day, and a reserve needs a live blockhash", async () => {
  const { generateKeyPairSync, sign } = await import("node:crypto");
  // @ts-ignore: plain JS
  const { b58encode } = await import("./sol-tx.mjs");
  const LIVE = new Array(32).fill(3);
  /** A one-signer system transfer with this blockhash, signed by a fresh key (as a script would make one). */
  const tx = (blockhash: number[]) => {
    const k = generateKeyPairSync("ed25519");
    const payer = Buffer.from(k.publicKey.export({ format: "jwk" }).x!, "base64url");
    const message = Buffer.from([1, 0, 1, 3, ...payer, ...new Array(64).fill(9), ...blockhash, 1, 2, 2, 0, 1, 12, ...new Array(12).fill(1)]);
    return Buffer.from([1, ...sign(null, message, k.privateKey), ...message]).toString("base64");
  };
  let t = Date.UTC(2026, 10, 4, 12);
  const now = () => t;
  const fetchFn = async (_url: string, init: RequestInit) => {
    const call = JSON.parse(String(init.body));
    if (call.method === "isBlockhashValid") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: call.params[0] === b58encode(Uint8Array.from(LIVE)) } }));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "5".repeat(87) }));
  };
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, helius: FIXTURE_KEY, fetchFn, now, solSend: { minute: 10, day: 1_000 } });
  const send = (b64: string, ip: string) => relay(new Request("https://quotes.example/v0/sol/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx: b64 }) }), ip);
  // ten addresses spend the relay's minute with junk (a made-up blockhash)
  const junk = [];
  for (let i = 0; i < 10; i++) junk.push((await send(tx(new Array(32).fill(i + 100)), `192.0.2.${i}`)).status);
  assert.ok(junk.filter((s) => s === 503).length >= 2, `junk past the general part rests: ${junk}`);
  assert.equal((await send(tx(LIVE), "203.0.113.70")).status, 200, "a phone's real send still goes");
  // one address's day
  let last = 0;
  for (let i = 0; i < 520; i++) {
    if (i % 10 === 0) t += 61_000;
    last = (await send(tx(LIVE), "198.51.100.90")).status;
  }
  assert.equal(last, 429, "an address's day ends");
});

test("audit #20 (logo.mjs gtImage): the keyed GeckoTerminal call never follows a redirect", async () => {
  // @ts-ignore: plain JS
  const { resolveLogo } = await import("./logo.mjs");
  const seen: RequestInit[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    if (url.startsWith("https://gt.example/")) seen.push(init);
    return new Response("", { status: 404 });
  };
  await resolveLogo("sol", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", f, { root: "https://gt.example/api/v2", headers: { "x-cg-pro-api-key": "fixture" } });
  assert.equal(seen.length, 1, "GeckoTerminal was asked once");
  assert.equal(seen[0].redirect, "error");
});

test("audit #20: /v0/health, cached by the CDN, varies by Origin for every caller", async () => {
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, fetchFn: async () => new Response("{}", { status: 200 }) });
  const r = await relay(new Request("https://quotes.example/v0/health"), "203.0.113.80");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("vary") ?? "", /Origin/);
});

test("audit L13 (4 Nov): a heavy address claiming the app's Origin can't spend every phone's CoinGecko day", async () => {
  // @ts-ignore: plain JS
  const { memoryCounter } = await import("./guards.mjs");
  const sent: string[] = [];
  let t = Date.UTC(2026, 10, 4, 1);
  const now = () => t;
  const counter = memoryCounter(now);
  const heavyIp = "203.0.113.90";
  // the address has already asked for 101 new coins today (past MARKET_LIGHT_DAY)
  await counter.add(`rate:market-miss-day:${heavyIp}:${Math.floor(t / 86_400_000)}`, 101, 86_400_000);
  const fetchFn = async (url: string) => (sent.push(url), new Response(JSON.stringify({ data: [] }), { status: 200 }));
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, counter, market: { gt: { key: "gt-key" }, cg: { key: "cg-key" }, dailyCalls: 30 }, fetchFn, now });
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  /** A new coin address each time, so every read misses the relay's keep. */
  const coin = (i: number) => `So1${B58[i % 58]}${B58[Math.floor(i / 58) % 58]}`.padEnd(43, "2");
  const get = (i: number, ip: string) => relay(new Request(`https://quotes.example/v0/market/gt/networks/solana/tokens/${coin(i)}/info`, { headers: { origin: APP } }), ip);
  let heavy = 0;
  for (let i = 0; i < 40; i++) { if ((await get(100 + i, heavyIp)).status === 200) heavy++; t += 2_000; }
  assert.equal(heavy, 24, `the heavy address gets the day's general part only (got ${heavy}, upstream ${sent.length})`);
  assert.equal((await get(500, "203.0.113.91")).status, 200, "a light phone still reaches the source");
});

test("audit #8 (quotes): one address's quotes end at its own day, and the relay's day spent by a heavy address leaves a phone that has asked little its reserve", async () => {
  // @ts-ignore: plain JS
  const { memoryCounter } = await import("./guards.mjs");
  // @ts-ignore: plain JS
  const { QUOTES_DAY_SPENT } = await import("./relay.mjs");
  const DEPOSIT = "818473a0072ed5084b4ec9f665b47d7c244546ca9a0ebc76d71fe1e6274ef8ba";
  const body = { dry: true, swapType: "EXACT_OUTPUT", originAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", depositType: "CONFIDENTIAL_INTENTS", refundType: "CONFIDENTIAL_INTENTS", refundTo: "a1".repeat(32), recipient: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", recipientType: "DESTINATION_CHAIN", amount: "1000000", confidentiality: "basic" };
  let t = Date.UTC(2026, 10, 4, 1);
  const now = () => t;
  let asked = 0;
  const fetchFn = async () => (asked++, new Response(JSON.stringify({ quote: { depositAddress: DEPOSIT, amountIn: "1000000", amountInUsd: "0.999631" }, quoteRequest: {} }), { status: 201 }));
  const at = (quotesDaily: number) => {
    const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, counter: memoryCounter(now), fetchFn, quotesDaily, quotesPerMinute: 1_000, now });
    return async (ip: string) => (await relay(new Request("https://quotes.example/v0/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ip)).status;
  };
  // a heavy address spends the day's general part, then is refused; a phone that asked little still gets its quote
  const small = at(100);
  const heavy: number[] = [];
  for (let i = 0; i < 120; i++) heavy.push(await small("198.51.100.7"));
  assert.equal(heavy.filter((s) => s === 201).length, 80, "the general part: 80 of 100");
  assert.equal(heavy.at(-1), 503);
  assert.equal(await small("203.0.113.9"), 201, "a light phone has the reserve");
  // its own day: the 1,001st quote of one address is refused by its own limit, and 1Click isn't asked
  const big = at(10_000);
  const statuses: number[] = [];
  for (let i = 0; i < 1_001; i++) statuses.push(await big("198.51.100.8"));
  const before = asked;
  assert.equal(statuses.at(-1), 429);
  assert.equal(statuses.filter((s) => s === 201).length, 1_000);
  assert.equal(await big("198.51.100.8"), 429);
  assert.equal(asked, before, "1Click isn't asked past the address's day");
  assert.equal(await big("203.0.113.10"), 201, "control: another address");
  assert.notEqual(QUOTES_DAY_SPENT, "quotes.rate.limited");
});

test("audit #8 (rail): real payouts from a Confidential Intents balance have a day per address; dry quotes and other addresses go on", async () => {
  // @ts-ignore: plain JS
  const { memoryCounter } = await import("./guards.mjs");
  const DEPOSIT = "818473a0072ed5084b4ec9f665b47d7c244546ca9a0ebc76d71fe1e6274ef8ba";
  const pay = { dry: false, swapType: "EXACT_OUTPUT", originAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", depositType: "CONFIDENTIAL_INTENTS", refundType: "CONFIDENTIAL_INTENTS", refundTo: "a1".repeat(32), recipient: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", recipientType: "DESTINATION_CHAIN", amount: "1000000", confidentiality: "basic" };
  const t = Date.UTC(2026, 10, 4, 1);
  let asked = 0;
  const fetchFn = async () => (asked++, new Response(JSON.stringify({ quote: { depositAddress: DEPOSIT, amountIn: "1000000", amountInUsd: "0.999631" }, quoteRequest: {} }), { status: 201 }));
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, counter: memoryCounter(() => t), fetchFn, quotesPerMinute: 1_000, now: () => t });
  const quote = async (ip: string, body: object) => (await relay(new Request("https://quotes.example/v0/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ip)).status;
  const statuses: number[] = [];
  for (let i = 0; i < 101; i++) statuses.push(await quote("198.51.100.7", pay));
  assert.equal(statuses.filter((s) => s === 201).length, 100);
  const before = asked;
  assert.equal(statuses.at(-1), 429, "the 101st payout from one address");
  assert.equal(asked, before);
  assert.equal(await quote("198.51.100.7", { ...pay, dry: true }), 201, "control: a dry quote (a price) still answers");
  assert.equal(await quote("203.0.113.9", pay), 201, "control: another address");
});

test("audit L14: AgentZero's way home delivers only into an account that runs the Safe's contract; any other NEAR account is refused before 1Click is asked", async () => {
  const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
  const DEPOSIT = "818473a0072ed5084b4ec9f665b47d7c244546ca9a0ebc76d71fe1e6274ef8ba";
  const code: Record<string, { code_hash: string; global_contract_hash?: string }> = {
    "kim.near": { code_hash: "8vPUrwYWp5cPDJGEuMg73d5tCJM29YkhytTsJR33AAyu" },
    "global-safe.near": { code_hash: "11111111111111111111111111111111", global_contract_hash: "5dvbBjU2boghQtkkoCUJeBofaheUwLjLUwnvMydC6Tf9" },
    "pre-audit.near": { code_hash: "11111111111111111111111111111111", global_contract_hash: "CzhCDZAN4GhtxTtoHpKUXvNDmKus5r1aLtAK85KW37sE" },
    "exchange.near": { code_hash: "11111111111111111111111111111111" },
    "dex.near": { code_hash: "J1arLz48fgXcGyCPVckFwLnewNH6j1uw79thsvwqGYTY" },
  };
  let quotes = 0;
  const fetchFn = async (url: string, init: RequestInit) => {
    if (url.includes("fastnear")) {
      const id = JSON.parse(String(init.body)).params.account_id;
      return new Response(JSON.stringify(code[id] ? { jsonrpc: "2.0", id: 1, result: code[id] } : { jsonrpc: "2.0", id: 1, error: { cause: { name: "UNKNOWN_ACCOUNT" } } }), { status: 200 });
    }
    quotes++;
    return new Response(JSON.stringify({ quote: { depositAddress: DEPOSIT, amountIn: "1000000", amountInUsd: "7.5" }, quoteRequest: {} }), { status: 201 });
  };
  const at = (fastnear?: string) => {
    const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, fetchFn, ...(fastnear ? { fastnear } : {}) });
    return async (recipient: string) => (await relay(new Request("https://quotes.example/v0/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dry: false, swapType: "EXACT_INPUT", originAsset: USDC, destinationAsset: USDC, depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN", refundTo: "a9".repeat(32), recipient, recipientType: "INTENTS", amount: "7500000", confidentiality: "basic" }) }), "203.0.113.9")).status;
  };
  const home = at("fixture-fastnear-key");
  assert.equal(await home("kim.near"), 201, "a Safe");
  assert.equal(await home("global-safe.near"), 201, "a Safe on the global release");
  assert.equal(quotes, 2);
  for (const other of ["exchange.near", "dex.near", "nobody.near", "pre-audit.near"]) assert.equal(await home(other), 400, other);
  assert.equal(quotes, 2, "1Click isn't asked for another account");
  assert.equal(await at()("kim.near"), 201, "no FastNEAR key: still read on chain (FastNEAR's free tier)");
  assert.equal(await at()("exchange.near"), 400);
});

test("audit #8 (sign-ups): one IPv6 /48 can't make each /64 a new caller, and networks that signed up a lot leave a new phone the day's reserve", async () => {
  // @ts-ignore: plain JS
  const { memoryCounter } = await import("./guards.mjs");
  let t = Date.UTC(2026, 10, 4, 1);
  const now = () => t;
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, anthropicKey: "sk-ant-zerofee-test-key-0000000000", agentZeroSecret: "token-secret", counter: { ...memoryCounter(now), shared: true }, fetchFn: async () => new Response("{}"), now });
  let n = 0;
  const signup = async (ip: string) => {
    if (++n % 40 === 0) t += 61_000; // under the relay's 50 a minute
    return (await relay(new Request("https://quotes.example/v0/agentzero/signup", { method: "POST", headers: { origin: APP, "content-type": "application/json" }, body: "{}" }), ip)).status;
  };
  // one /48, a new /64 for each sign-up: the 21st is refused
  const one: number[] = [];
  for (let i = 0; i < 21; i++) one.push(await signup(`2001:db8:1:${i.toString(16)}::1`));
  assert.deepEqual([one.filter((s) => s === 200).length, one.at(-1)], [20, 429]);
  // 24 more /48s, 20 sign-ups each: the day's general part (400 of 500) goes to them, the rest is held for light networks
  let got = 20;
  for (let net = 2; net <= 25; net++) for (let i = 0; i < 20; i++) if ((await signup(`2001:db8:${net.toString(16)}:${i.toString(16)}::1`)) === 200) got++;
  // the general part (400), and from the reserve only each network's first three, while it was still light (5 × 3)
  assert.equal(got, 415, "heavy networks share the general part only");
  assert.equal(await signup("203.0.113.9"), 200, "a new phone still signs up from the reserve");
});
