// Settings → Status's checks (rule 9b, T13 phase 1; the spec's line 10): each service's Working / Slow / Down from its
// answer, the relay's door first and the public servers after (as the app's own reads), the 30 s cache, every look
// ending within PROBE_MS, and read-only calls only. No network: fetch, the clock and the wait are the test's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOOR_MS, PROBE_MS, PUBLIC, SPEED_BAR_MS, STATUS_CACHE_MS, STATUS_IDS, createStatusProbe, probeAll, stateOf, statusService, worse, type StatusReport, type StatusRow } from "./status-probe.ts";

const RELAY = "https://relay.example";
type Answer = { status?: number; body?: unknown; hang?: true; fail?: true; slowBy?: number };
const ok = {
  health: { status: 200, body: { at: "x", services: { relay: "up" } } },
  near: { status: 200, body: { jsonrpc: "2.0", id: 1, result: { sync_info: { latest_block_height: 1 } } } },
  sol: { status: 200, body: { jsonrpc: "2.0", id: 1, result: 466_000_000 } },
  hood: { status: 200, body: { jsonrpc: "2.0", id: 1, result: "0x10" } },
  price: { status: 200, body: { near: { usd: 2.5 }, solana: { usd: 90 } } },
  oneclick: { status: 200, body: [{ assetId: "nep141:wrap.near" }] },
  jupiter: { status: 200, body: { So11111111111111111111111111111111111111112: { usdPrice: 90 } } },
  anthropic: { status: 401, body: { type: "error" } },
} satisfies Record<string, Answer>;

/** Which answer a URL gets by default (every service up). */
function route(url: string): keyof typeof ok {
  if (url.endsWith("/v0/health")) return "health";
  if (url.endsWith("/v0/near") || url === PUBLIC.near) return "near";
  if (url.endsWith("/v0/sol/read") || url === PUBLIC.solana) return "sol";
  if (url.endsWith("/v0/rh/rpc") || url === PUBLIC.hood) return "hood";
  if (url.includes("simple/price")) return "price";
  if (url === PUBLIC.oneclick) return "oneclick";
  if (url === PUBLIC.jupiter) return "jupiter";
  if (url === PUBLIC.anthropic) return "anthropic";
  throw new Error(`asked a place the checks never ask: ${url}`);
}

/**
 * A world: `over` replaces a URL's answer. A `slowBy` answer moves the clock by that much and answers after every
 * other (one macrotask later), so only its own time is long. `hang` never answers; the wait ends it.
 */
function world(over: Record<string, Answer> = {}) {
  let clock = 1_000_000;
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const a: Answer = over[url] ?? ok[route(url)];
    if (a.hang) return new Promise<Response>(() => {});
    if (a.slowBy) { await new Promise((r) => setTimeout(r, 0)); clock += a.slowBy; }
    if (a.fail) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(a.body ?? null), { status: a.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  const waits: number[] = [];
  // the wait ends after every answer that came (two macrotasks): a hung call is cut, an answer never is
  const wait = (ms: number) => { waits.push(ms); return new Promise<void>((r) => setTimeout(() => setTimeout(r, 0), 0)); };
  return { fetch, wait, now: () => clock, calls, waits, tick: (ms: number) => { clock += ms; } };
}
const byId = (r: StatusReport) => Object.fromEntries(r.rows.map((x) => [x.id, x])) as Record<string, StatusRow>;

test("Working / Slow / Down per service: over twice its speed bar is Slow, no answer in 5 s or an error is Down", () => {
  for (const id of STATUS_IDS) {
    const bar = SPEED_BAR_MS[id];
    assert.equal(stateOf(id, true, 0), "working", id);
    assert.equal(stateOf(id, true, 2 * bar), "working", `${id} at twice its bar`);
    if (2 * bar + 1 < PROBE_MS) assert.equal(stateOf(id, true, 2 * bar + 1), "slow", `${id} just over twice its bar`);
    assert.equal(stateOf(id, true, PROBE_MS), "down", `${id} at 5 s`);
    assert.equal(stateOf(id, false, 10), "down", `${id} errored`);
    assert.equal(stateOf(id, true, null), "down", `${id} no answer`);
  }
  // the spec's bars: NEAR 2 s, Solana 200 ms, ETH (RH) 2 s, the relay 500 ms
  assert.deepEqual([SPEED_BAR_MS.near, SPEED_BAR_MS.solana, SPEED_BAR_MS.hood, SPEED_BAR_MS.relay], [2_000, 200, 2_000, 500]);
  assert.equal(stateOf("solana", true, 401), "slow");
  assert.equal(stateOf("near", true, 4_000), "working");
  assert.equal(worse("working", "slow"), "slow");
  assert.equal(worse("slow", "down"), "down");
});

test("every service up: one row each, the chains through the relay's doors, its two doors Working", async () => {
  const w = world();
  const r = await probeAll({ relay: RELAY, ...w });
  assert.equal(r.relay, true);
  assert.deepEqual(r.rows.map((x) => x.id), ["relay", "near", "solana", "hood", "price", "oneclick", "jupiter", "agentzero"]);
  assert.ok(r.rows.every((x) => x.state === "working"), JSON.stringify(r.rows));
  const rows = byId(r);
  for (const id of ["near", "solana", "hood", "price"]) assert.equal(rows[id]!.via, "relay", id);
  assert.deepEqual(rows.relay!.doors, { data: "working", chains: "working" });
  // a chain never asks its public servers while the relay's door answers
  assert.ok(!w.calls.some((c) => [PUBLIC.near, PUBLIC.solana, PUBLIC.hood, PUBLIC.price].includes(c.url as never)));
  assert.equal(r.at, w.now());
});

test("read-only: each check is one cheap read, with no key, no account and nothing signed", async () => {
  const w = world();
  await probeAll({ relay: RELAY, ...w });
  const methods = w.calls.filter((c) => c.init?.method === "POST").map((c) => JSON.parse(String(c.init!.body)) as { method: string; params: unknown });
  assert.deepEqual(methods.map((m) => m.method).sort(), ["eth_blockNumber", "getSlot", "status"]);
  assert.ok(methods.every((m) => Array.isArray(m.params) && m.params.length === 0), "no params: no account, no address");
  for (const c of w.calls) {
    assert.ok(c.init?.method === "GET" || c.init?.method === "POST");
    const h = new Headers(c.init?.headers);
    assert.equal(h.get("authorization"), null, c.url);
    assert.equal(h.get("x-api-key"), null, c.url);
    assert.equal(c.init?.credentials, "omit", c.url);
  }
  assert.equal(w.calls.length, 8, "one call per service, the relay's own check once");
});

test("a relay door that fails: the public servers answer, the row says so, and the relay's chain door is Down", async () => {
  const w = world({ [`${RELAY}/v0/sol/read`]: { status: 503, body: { code: "quotes.not-configured" } } });
  const rows = byId(await probeAll({ relay: RELAY, ...w }));
  assert.deepEqual([rows.solana!.state, rows.solana!.via], ["working", "public"]);
  assert.ok(w.calls.some((c) => c.url === PUBLIC.solana));
  assert.equal(rows.relay!.doors!.chains, "down");
  assert.equal(rows.relay!.doors!.data, "working");
  assert.equal(rows.relay!.state, "working", "the relay itself answered");
});

test("a door and its public servers both failing is Down; an error answer (a JSON-RPC error, a stale shape) counts as none", async () => {
  const bad = { status: 200, body: { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "x" } } };
  const w = world({ [`${RELAY}/v0/near`]: bad, [PUBLIC.near]: { fail: true }, [PUBLIC.oneclick]: { status: 200, body: [] }, [PUBLIC.jupiter]: { status: 500 } });
  const rows = byId(await probeAll({ relay: RELAY, ...w }));
  assert.equal(rows.near!.state, "down");
  assert.equal(rows.oneclick!.state, "down", "an empty token list is no answer");
  assert.equal(rows.jupiter!.state, "down");
  assert.equal(rows.solana!.state, "working");
});

test("a slow answer is Slow by its own time; a hung one is Down, cut within PROBE_MS (the door's wait, then the rest)", async () => {
  const w = world({ [`${RELAY}/v0/sol/read`]: { ...ok.sol, slowBy: 450 }, [`${RELAY}/v0/rh/rpc`]: { hang: true }, [PUBLIC.hood]: { hang: true } });
  const rows = byId(await probeAll({ relay: RELAY, ...w }));
  assert.deepEqual([rows.solana!.state, rows.solana!.ms], ["slow", 450]);
  assert.deepEqual([rows.hood!.state, rows.hood!.via], ["down", "public"]);
  assert.equal(rows.near!.state, "working", "one slow service doesn't slow the others' times");
  // the door gets DOOR_MS, the public servers the rest, so the look ends within PROBE_MS
  assert.ok(w.waits.includes(DOOR_MS) && w.waits.includes(PROBE_MS - DOOR_MS));
  assert.ok(w.waits.every((ms) => ms <= PROBE_MS));
});

test("AgentZero: down when the relay is (its chat goes through it) or when Claude's API doesn't answer; 401 without a key is up", async () => {
  let rows = byId(await probeAll({ relay: RELAY, ...world({ [PUBLIC.anthropic]: { status: 529 } }) }));
  assert.equal(rows.agentzero!.state, "down");
  rows = byId(await probeAll({ relay: RELAY, ...world({ [`${RELAY}/v0/health`]: { status: 502 } }) }));
  assert.equal(rows.agentzero!.state, "down");
  assert.equal(rows.relay!.state, "down");
  rows = byId(await probeAll({ relay: RELAY, ...world() }));
  assert.equal(rows.agentzero!.state, "working");
});

test("NEAR's trades on NEAR's public servers (doors.ts onSwitch): its check goes there, and the relay's chain door says Down", async () => {
  const w = world();
  const rows = byId(await probeAll({ relay: RELAY, ...w, nearSwitched: () => true }));
  assert.deepEqual([rows.near!.state, rows.near!.via], ["working", "public"]);
  assert.ok(!w.calls.some((c) => c.url === `${RELAY}/v0/near`));
  assert.equal(rows.relay!.doors!.chains, "down");
});

test("no relay (the free build): no relay or AgentZero row, every chain on its public servers", async () => {
  const w = world();
  const r = await probeAll({ relay: null, ...w });
  assert.equal(r.relay, false);
  assert.deepEqual(r.rows.map((x) => x.id), ["near", "solana", "hood", "price", "oneclick", "jupiter"]);
  assert.ok(r.rows.filter((x) => ["near", "solana", "hood", "price"].includes(x.id)).every((x) => x.via === "public" && x.state === "working"));
  assert.ok(!w.calls.some((c) => c.url.startsWith(RELAY) || c.url === PUBLIC.anthropic));
});

test("the 30 s cache: the Settings row, the sheet and a re-open share one look; a new one only after 30 s", async () => {
  const w = world();
  const p = createStatusProbe({ relay: RELAY, ...w });
  const [a, b] = await Promise.all([p.probe(), p.probe()]);
  assert.equal(a, b, "one look in flight at a time");
  const once = w.calls.length;
  w.tick(STATUS_CACHE_MS - 1);
  assert.equal(await p.probe(), a);
  assert.equal(w.calls.length, once, "kept: not asked again inside 30 s");
  w.tick(1);
  const c = await p.probe();
  assert.notEqual(c, a);
  assert.equal(w.calls.length, 2 * once, "asked again at 30 s");
});

test("the bridge's answerer: status.probe gives the look; any other method is refused, nothing asked", async () => {
  const w = world();
  const s = statusService({ relay: RELAY, ...w });
  const r = await s.call<StatusReport>("status.probe");
  assert.ok("ok" in r && r.ok.rows.length === 8);
  const n = w.calls.length;
  const bad = await s.call("status.anything");
  assert.ok("problem" in bad);
  assert.equal(bad.problem.whatHappened, "Status couldn't check this one.", "QA 16's SHOULD: said what it couldn't do");
  assert.equal(w.calls.length, n);
});
