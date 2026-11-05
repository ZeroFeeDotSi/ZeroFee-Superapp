// B28 R6 + B30: the relay's status table (GET /v0/health). Each service ZeroFee leans on is pinged at most once a minute
// per instance and said as up, down (5xx, 521, no answer), busy (429) or slow (no answer in time), with since when; a
// service's own public status (Statuspage JSON) adds its words as plain text only. Never a key, a body, HTML or a link.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain JS, deployed as is (no build step)
import { APP_ORIGINS, HEALTH_PINGS, HEALTH_SECOND, NEAR_STALE_MS, STATUS_PAGES, cleanNote, createRelay, nearHealthy, nearSays, paidSays } from "./relay.mjs";
// @ts-ignore: plain JS
import { HEALTH_CLIENT_MS, HEALTH_PING_MS } from "./read-limits.mjs";

/** Every pending answer settled (event order, never the clock). */
const settled = () => new Promise((r) => setImmediate(r));

// every service once, and NEAR a second time on another node (bug 8: down only when two sources say so)
const PINGS = Object.keys(HEALTH_PINGS).length + Object.keys(HEALTH_SECOND).length;
const PAGES = Object.keys(STATUS_PAGES).length;
/** One of NEAR's two nodes (FastNEAR, or the second operator's). */
const isNear = (url: string) => url.includes("fastnear") || url.includes("near.drpc");
/** A NEAR node's healthy `status` answer: a JSON-RPC result whose latest block is `ageMs` old by the relay's clock. */
const nearOk = (nowMs: number, ageMs = 1_000) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { chain_id: "mainnet", sync_info: { latest_block_height: 1, latest_block_time: new Date(nowMs - ageMs).toISOString(), syncing: false } } }), { status: 200 });

function setup(answer: (url: string) => Response | Promise<Response>, now = () => 1_000_000, helius?: string) {
  const sent: string[] = [];
  const relay = createRelay({ key: "partner-key-SECRET-1234567890", secret: "s", origins: APP_ORIGINS, now, helius, fetchFn: async (url: string) => (sent.push(url), answer(url)) });
  const health = async (path = "/v0/health") => {
    const r = await relay(new Request(`https://quotes.example${path}`), "203.0.113.7");
    const text = await r.text();
    return { status: r.status, body: JSON.parse(text), text, cache: r.headers.get("cache-control") };
  };
  return { sent, health };
}

test("every service up: each named up with since when, the relay too; cacheable for a minute; no key anywhere", async () => {
  const { sent, health } = setup((url) => (isNear(url) ? nearOk(1_000_000) : new Response("{}", { status: 200 })), undefined, "helius-KEY-123456");
  const h = await health();
  assert.equal(h.status, 200);
  assert.deepEqual(h.body.services, { relay: "up", oneclick: "up", bridge: "up", near: "up", solana: "up", nearai: "up", gecko: "up", helius: "up" });
  assert.equal(h.body.details.bridge.since, new Date(1_000_000).toISOString());
  assert.match(h.cache!, /s-maxage=60/);
  assert.equal(sent.length, PINGS + 1 + PAGES, "one ping each (Helius with the relay's key), and each status page");
  assert.ok(!h.text.includes("helius-KEY") && !h.text.includes("partner-key"), "no key in the answer");
});

test("a 521 bridge is down, a 429 is busy, a timeout is slow, a refused connection is down (the 19:45 outage, and its kin)", async () => {
  const { health } = setup((url) => {
    if (url.includes("bridge.chaindefuser")) return new Response("<html>Web server is down</html>", { status: 521 });
    if (url.includes("1click")) return new Response("{}", { status: 429 });
    if (url.includes("fastnear") || url.includes("near.drpc")) throw new DOMException("timed out", "TimeoutError");
    if (url.includes("api.mainnet-beta.solana")) throw new TypeError("fetch failed");
    return new Response("{}", { status: 200 });
  });
  const s = (await health()).body.services;
  assert.deepEqual([s.oneclick, s.bridge, s.near, s.solana, s.nearai, s.gecko], ["busy", "down", "slow", "down", "up", "up"]);
  assert.equal(s.helius, undefined, "no Helius key on this relay: not checked");
});

test("since when: the time a state began, kept across checks until it changes", async () => {
  let t = 1_000_000;
  let bridge = 521;
  const { health } = setup((url) => new Response("{}", { status: url.includes("bridge.chaindefuser") ? bridge : 200 }), () => t);
  await health();
  t += 61_000;
  await health();
  await settled();
  const second = (await health()).body;
  assert.equal(second.details.bridge.since, new Date(1_000_000).toISOString(), "still down since the first check");
  bridge = 200;
  t += 61_000;
  const stale = (await health()).body;
  assert.equal(stale.services.bridge, "down", "the kept answer goes at once while the next check runs");
  await settled();
  const back = (await health()).body;
  assert.equal(back.services.bridge, "up");
  assert.equal(back.details.bridge.since, new Date(t).toISOString(), "up since it came back");
});

// Finding 3 (4 Nov): the app waited 5 s for /v0/health while the relay pinged each service for up to 6 s, so a check
// always looked like "ZeroFee's price server is slow". One file holds both now, and a kept answer never waits.
test("finding 3: the relay's ping budget sits inside the app's own wait, from the one shared file", () => {
  assert.ok(HEALTH_PING_MS + 1_000 <= HEALTH_CLIENT_MS, `${HEALTH_PING_MS} ms of pings inside the app's ${HEALTH_CLIENT_MS} ms`);
});

test("finding 3: with a kept answer, a caller after the minute gets it at once, even while a service hangs", async () => {
  let t = 1_000_000;
  let hang = false;
  const { health } = setup((url) => (hang && url.includes("bridge.chaindefuser") ? new Promise<Response>(() => undefined) : new Response("{}", { status: 200 })), () => t);
  await health();
  hang = true;
  t += 61_000;
  const marker = Symbol("still waiting");
  const first = await Promise.race([health(), settled().then(() => marker)]);
  assert.notEqual(first, marker, "answered before the hung ping ends");
  assert.equal((first as { status: number }).status, 200);
});

test("a status page's words are plain text: tags, links and control characters gone, at most 140 characters", async () => {
  const { health } = setup((url) =>
    url.includes("status.solana.com")
      ? new Response(JSON.stringify({ status: { indicator: "major", description: `<a href="https://evil.example">Partial outage</a>\u0007 of RPC https://evil.example/x ${"x".repeat(300)}` } }), { status: 200 })
      : new Response("{}", { status: 200 }),
  );
  const note: string = (await health()).body.details.solana.note;
  assert.ok(note.startsWith("Partial outage of RPC"), note);
  assert.ok(note.length <= 140);
  assert.doesNotMatch(note, /<|>|https?:|evil|\u0007/);
  assert.equal(cleanNote("All Systems Operational"), "All Systems Operational");
  assert.equal(cleanNote({ html: "<b>x</b>" }), undefined, "only text is ever kept");
});

test("a status page that says all is well adds nothing; one that can't be read adds nothing", async () => {
  const { health } = setup((url) => (url.includes("status.solana.com") ? new Response(JSON.stringify({ status: { indicator: "none", description: "All Systems Operational" } })) : url.includes("helius.statuspage") ? new Response("not json") : new Response("{}")));
  const d = (await health()).body.details;
  assert.equal(d.solana.note, undefined);
});

test("pinged at most once a minute per instance; after a minute, again (also through the rewritten ?route=health)", async () => {
  let t = 1_000_000;
  const { sent, health } = setup(() => new Response("{}", { status: 200 }), () => t);
  await health();
  await health("/api/relay?route=health");
  assert.equal(sent.length, PINGS + PAGES, "the second caller within the minute reads the kept answer");
  t += 61_000;
  await health();
  await settled();
  assert.equal(sent.length, 2 * (PINGS + PAGES), "after the minute, the next caller starts one new round");
});

test("security review M2: a 401/403/404 from a service's address is not an outage (only a 5xx, a 429 or no answer says anything); NEAR's nodes are read, so a 404 there is an unhealthy node (review M3)", async () => {
  const { health } = setup((url) => (url.includes("near.drpc") ? nearOk(1_000_000) : new Response("{}", { status: url.includes("api.mainnet-beta.solana") ? 403 : url.includes("near.ai") ? 401 : url.includes("fastnear") ? 404 : 200 })));
  const s = (await health()).body.services;
  assert.deepEqual([s.solana, s.nearai, s.near], ["up", "up", "slow"], "NEAR: one node 404, the other healthy: slow, never up");
});

test("security review M3: callers during a check share it: one round of pings, however many ask at once", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { sent, health } = setup(async () => (await gate, new Response("{}", { status: 200 })));
  const all = Promise.all([health(), health("/v0/health?x=1"), health("/api/relay?route=health&y=2")]);
  await new Promise((r) => setTimeout(r, 10));
  release();
  await all;
  assert.equal(sent.length, PINGS + PAGES);
});

test("control: a POST to health is nothing here", async () => {
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, fetchFn: async () => new Response("{}") });
  const r = await relay(new Request("https://quotes.example/v0/health", { method: "POST", body: "{}" }), "203.0.113.7");
  assert.equal(r.status, 404);
});

test("bug 8 + review M3: NEAR is up only when BOTH its nodes answer a fresh status; one unhealthy node is slow, never up; both failing is down", async () => {
  const near = (fast: () => Response | Promise<Response>, second: () => Response | Promise<Response>) =>
    setup((url) => (url.includes("fastnear") ? fast() : url.includes("near.drpc") ? second() : new Response("{}", { status: 200 })));
  const ok = () => nearOk(1_000_000);
  const both = near(ok, ok);
  assert.equal((await both.health()).body.services.near, "up", "both nodes healthy: up");
  assert.ok(both.sent.some((u) => u.includes("near.drpc.org")), "the second node, another operator's, is asked too");
  // the review's case: an aggregator answering 200 with a JSON-RPC error body when its own upstreams fail
  const errorBody = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "upstream" } }), { status: 200 });
  assert.equal((await near(ok, errorBody).health()).body.services.near, "slow", "one node answers 200 with an error body: slow, not up");
  assert.equal((await near(() => new Response("", { status: 521 }), ok).health()).body.services.near, "slow", "one node 521: slow");
  assert.equal((await near(ok, () => new Response("<html>", { status: 200 })).health()).body.services.near, "slow", "not JSON: unhealthy");
  assert.equal((await near(ok, () => nearOk(1_000_000, NEAR_STALE_MS + 5_000)).health()).body.services.near, "slow", "a stale block (a halted chain still answers): unhealthy");
  assert.equal((await near(ok, () => new Response("{}", { status: 403 })).health()).body.services.near, "slow", "a 4xx node never votes up");
  // both failing: down
  assert.equal((await near(() => new Response("", { status: 521 }), () => new Response("", { status: 503 })).health()).body.services.near, "down", "both 5xx: down");
  assert.equal((await near(errorBody, () => Promise.reject(new TypeError("fetch failed"))).health()).body.services.near, "down", "unhealthy and refused: down");
  assert.equal((await near(() => new Response("", { status: 503 }), () => Promise.reject(new DOMException("t", "TimeoutError"))).health()).body.services.near, "down", "one 5xx, one no answer in time: neither healthy, down");
  // the controls: the old rule (either node answering = up) would have said up for each of the slow cases above
  assert.deepEqual([nearSays("up", "up"), nearSays("up", "unhealthy"), nearSays("unhealthy", "up"), nearSays("slow", "slow"), nearSays("busy", "slow"), nearSays("unhealthy", "unhealthy"), nearSays("down", "slow")], ["up", "slow", "slow", "slow", "busy", "down", "down"]);
  assert.equal(nearHealthy({ result: { sync_info: { latest_block_time: new Date(5_000).toISOString() } } }, 6_000), true);
  assert.equal(nearHealthy({ result: {} }, 6_000), false, "no sync_info: unhealthy");
  assert.equal(nearHealthy(null, 6_000), false);
});

test("product decision, 4 Nov: with the relay's paid keys, the PAID doors decide: FastNEAR's paid door healthy is NEAR up, Helius answering is Solana up, whatever the free nodes say (control: paid failing, the old rule)", async () => {
  const sent: { url: string; auth: string | null }[] = [];
  const at = () => 1_000_000;
  const relayWith = (answer: (url: string, auth: string | null) => Response | Promise<Response>) =>
    createRelay({ key: "partner-key-SECRET-1234567890", secret: "s", origins: APP_ORIGINS, now: at, helius: "helius-KEY-123456", fastnear: "fastnear-KEY-123456", fetchFn: async (url: string, init?: { headers?: Record<string, string> }) => {
      const auth = init?.headers?.authorization ?? null;
      sent.push({ url, auth });
      return answer(url, auth);
    } });
  const read = async (relay: (r: Request, ip: string) => Promise<Response>) => {
    const text = await (await relay(new Request("https://quotes.example/v0/health"), "203.0.113.7")).text();
    return { body: JSON.parse(text), text };
  };
  // the 4 Nov evening: the free public Solana node times out from Vercel and dRPC errors; the paid doors answer
  const evening = relayWith((url, auth) => {
    if (url.includes("api.mainnet-beta.solana")) throw new DOMException("t", "TimeoutError");
    if (url.includes("near.drpc")) return new Response(JSON.stringify({ error: { code: -32000 } }), { status: 200 });
    if (url.includes("fastnear")) return auth ? nearOk(at()) : new Response("{}", { status: 429 });
    return new Response("{}", { status: 200 });
  });
  const h = await read(evening);
  assert.equal(h.body.services.near, "up", "FastNEAR's paid door healthy: no 'NEAR is slow/busy'");
  assert.equal(h.body.services.solana, "up", "Helius answering: no 'Solana is slow'");
  const nearPing = sent.find((x) => x.url.includes("rpc.mainnet.fastnear.com"));
  assert.equal(nearPing?.auth, "Bearer fastnear-KEY-123456", "NEAR is pinged at the paid door, its key in a header");
  assert.ok(!nearPing!.url.includes("KEY"), "never in the URL");
  assert.ok(!h.text.includes("KEY"), "no key in the answer");
  // control: the paid doors failing, the free nodes decide as before (both bad: busy or down)
  const down = relayWith((url) => {
    if (url.includes("helius-rpc")) return new Response("{}", { status: 429 });
    if (url.includes("api.mainnet-beta.solana")) return new Response("{}", { status: 429 });
    if (url.includes("fastnear")) return new Response("{}", { status: 503 });
    if (url.includes("near.drpc")) return new Response("{}", { status: 503 });
    return new Response("{}", { status: 200 });
  });
  const d = (await read(down)).body.services;
  assert.deepEqual([d.near, d.solana, d.helius], ["down", "busy", "busy"]);
  assert.deepEqual([paidSays("up", "down"), paidSays("unhealthy", "up"), paidSays("busy", "slow")], ["up", "slow", "busy"]);
});

test("product decision, 4 Nov: a check where every service is 'slow' at once (a cold instance's own network, 16:20 UTC) says nothing about them (control: one slow service is said)", async () => {
  const all = setup(() => Promise.reject(new DOMException("t", "TimeoutError")));
  assert.deepEqual((await all.health()).body.services, { relay: "up" }, "no eight outages from the relay's own slow start");
  const one = setup((url) => (url.includes("1click") ? Promise.reject(new DOMException("t", "TimeoutError")) : isNear(url) ? nearOk(1_000_000) : new Response("{}", { status: 200 })));
  assert.equal((await one.health()).body.services.oneclick, "slow");
});
