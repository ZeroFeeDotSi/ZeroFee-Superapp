// T13 phase 2 (Settings → Status, spec lines 6-8 and 10): a person's own server per chain. Kept only through the store it
// is given (device.store: sealed on the web, the Keychain on the phone), never answered back (its host only), never sent
// anywhere but itself; each chain's door asks it first and ZeroFee's after; Test runs the chain's own check against a
// typed address, and on the phone a host outside its approved list is said plainly. No network: fetch is the test's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OWN_SWITCHED, ownAddressOf, ownHostOf, ownMissed, ownSaid, ownServer, ownStoreKey, setOwnServer } from "./own-servers.ts";
import { PUBLIC, checkOwn, probeAll, statusService, type OwnHosts, type OwnTest, type StatusReport } from "./status-probe.ts";
import { OWN_BACK, OWN_HIDE, OWN_INTRO, OWN_KEPT, OWN_NONE, OWN_SHOW, OWN_TITLE, OWN_USE, USING_OWN, ownTestWords, rowLines, usingLine } from "./status-words.ts";
import { hoodNodes, setHoodProxy, setOwnHood } from "./hood-proxy.ts";
import { HOOD_DOOR } from "./hood-door.ts";
import { setSolProxy, solPaidDoors } from "./sol-proxy.ts";
import { bannedIn, grade } from "../../../tools/copy/voice.ts";

const RELAY = "https://relay.example";
const OWN = "https://my-node.example/rpc?api-key=secret123";

const near = { jsonrpc: "2.0", id: 1, result: { sync_info: { latest_block_height: 1 } } };
const answers = (url: string, body?: { method?: string } | null): unknown => {
  if (body?.method === "getSlot") return { jsonrpc: "2.0", id: 1, result: 5 };
  if (body?.method === "eth_blockNumber") return { jsonrpc: "2.0", id: 1, result: "0x1" };
  if (url.endsWith("/v0/health")) return { services: {} };
  if (url.includes("simple/price")) return { near: { usd: 2 } };
  if (url === PUBLIC.oneclick) return [{ a: 1 }];
  if (url === PUBLIC.jupiter) return { a: 1 };
  if (url.includes("sol") || url.includes("solana")) return { jsonrpc: "2.0", id: 1, result: 5 };
  if (url.includes("rh") || url.includes("robinhood")) return { jsonrpc: "2.0", id: 1, result: "0x1" };
  return near;
};
function world(down: (url: string) => boolean = () => false) {
  let t = 0;
  const calls: { url: string; body: unknown }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    if (down(url)) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answers(url, body)), { status: url === PUBLIC.anthropic ? 401 : 200 });
  }) as typeof globalThis.fetch;
  const wait = (_ms: number) => new Promise<void>((r) => setTimeout(() => setTimeout(r, 0), 0));
  return { fetch, wait, now: () => (t += 10), calls };
}
function memStore() {
  const kept = new Map<string, string>();
  return { kept, get: async (k: string) => kept.get(k) ?? null, set: async (k: string, v: string | null) => { if (v === null) kept.delete(k); else kept.set(k, v); } };
}

test("an address the doors can use: plainly https, trimmed, no trailing slash; shown by its host only (controls: http, a password, junk)", () => {
  assert.equal(ownAddressOf("  https://My-Node.example/rpc/ "), "https://my-node.example/rpc");
  assert.equal(ownAddressOf(OWN), OWN);
  assert.equal(ownHostOf(OWN), "my-node.example", "the key in the address is never shown");
  for (const bad of ["http://my-node.example", "https://user:pw@my-node.example", "my-node.example", "", "https://", "javascript:alert(1)", null, 5]) assert.equal(ownAddressOf(bad), null, String(bad));
});

test("the check asks the own server first (Using your server); when it doesn't answer, ZeroFee's server, and the row says so", async () => {
  const w = world();
  const r = await probeAll({ relay: RELAY, ...w, own: (c) => (c === "near" ? OWN : null) });
  const n = r.rows.find((x) => x.id === "near")!;
  assert.equal(n.via, "own");
  assert.equal(usingLine(n, true), USING_OWN);
  assert.equal(w.calls.filter((c) => c.url === `${RELAY}/v0/near`).length, 0, "ZeroFee's NEAR door not asked when the own server answered");
  const w2 = world((u) => u === OWN);
  const r2 = await probeAll({ relay: RELAY, ...w2, own: (c) => (c === "near" ? OWN : null) });
  const n2 = r2.rows.find((x) => x.id === "near")!;
  assert.equal(n2.via, "relay");
  assert.equal(n2.ownMissed, true);
  assert.equal(n2.state, "working");
  assert.deepEqual(rowLines(n2, true), [OWN_SWITCHED]);
  assert.equal(OWN_SWITCHED, "Your server didn't answer. Using ZeroFee's server.");
  // no relay in the build: the public servers take over, named
  const w3 = world((u) => u === OWN);
  const r3 = await probeAll({ relay: null, ...w3, own: (c) => (c === "solana" ? OWN : null) });
  assert.equal(usingLine(r3.rows.find((x) => x.id === "solana")!, false), "Your server didn't answer. Using Solana's public servers.");
  // control: no own server, as phase 1
  const w4 = world();
  const r4 = await probeAll({ relay: RELAY, ...w4 });
  assert.ok(r4.rows.every((x) => x.via !== "own" && !x.ownMissed));
});

test("Test: the chain's own check against the typed address; Working, Down, not an address, and the phone's list said plainly", async () => {
  const w = world();
  const ok = await checkOwn("near", OWN, w);
  assert.equal(ok.result, "working");
  assert.deepEqual(w.calls.map((c) => c.url), [OWN], "only the typed address is asked");
  assert.equal((w.calls[0]!.body as { method: string }).method, "status", "the same read-only call as its row");
  assert.equal((await checkOwn("solana", OWN, world((u) => u === OWN))).result, "down");
  assert.equal((await checkOwn("hood", "http://x.example", w)).result, "bad");
  const asked: string[] = [];
  const blocked = await checkOwn("near", OWN, { ...world(), fetch: (async (u: string) => { asked.push(u); return new Response("{}"); }) as unknown as typeof fetch, reach: (o) => o === "https://rpc.mainnet.fastnear.com" });
  assert.equal(blocked.result, "blocked");
  assert.deepEqual(asked, [], "a host the phone can't fetch is never asked");
  assert.equal(ownTestWords({ result: "blocked" }), "ZeroFee on iPhone can't reach that address yet.");
  assert.equal(ownTestWords({ result: "working", ms: 320 }), "Your server works. It answered in 0.3 s.");
  assert.equal(ownTestWords({ result: "slow", ms: 4_100 }), "Your server works, but it's slow. It answered in 4.1 s.");
  assert.equal(ownTestWords({ result: "down", ms: null }), "Your server didn't answer.");
  assert.equal(ownTestWords({ result: "bad" }), "That isn't a server address. It starts with https://");
});

test("the service: keeps it only in the store it's given, answers its host only, puts it in the doors, and clears it (back to ZeroFee's)", async () => {
  const w = world();
  const store = memStore();
  const applied: string[] = [];
  const s = statusService({ relay: RELAY, ...w, store, apply: (c) => applied.push(c) });
  const set = await s.call<{ host: string }>("status.own.set", { chain: "solana", address: ` ${OWN} ` });
  assert.ok("ok" in set);
  assert.deepEqual(set.ok, { host: "my-node.example" });
  assert.equal(store.kept.get(ownStoreKey("solana")), OWN, "kept through the store (device.store: sealed / Keychain)");
  assert.equal(ownServer("solana"), OWN, "in the doors");
  assert.deepEqual(applied, ["solana"]);
  const got = await s.call<OwnHosts>("status.own.get");
  assert.ok("ok" in got);
  assert.deepEqual(got.ok, { near: null, solana: "my-node.example", hood: null });
  assert.ok(!JSON.stringify(got).includes("secret123"), "the key is never answered back");
  const probe = await s.call<StatusReport>("status.probe");
  assert.ok("ok" in probe && probe.ok.rows.find((x) => x.id === "solana")!.via === "own", "a new look after it was set (not the kept one)");
  assert.ok(!w.calls.some((c) => c.url.startsWith(RELAY) && JSON.stringify(c.body ?? "").includes("secret123")), "never sent to ZeroFee");
  const bad = await s.call("status.own.set", { chain: "near", address: "http://nope" });
  assert.ok("problem" in bad && bad.problem.whatHappened === "That isn't a server address. It starts with https://");
  assert.equal(store.kept.has(ownStoreKey("near")), false, "control: nothing kept for a bad address");
  const back = await s.call("status.own.set", { chain: "solana", address: null });
  assert.ok("ok" in back);
  assert.equal(store.kept.has(ownStoreKey("solana")), false);
  assert.equal(ownServer("solana"), null, "back to ZeroFee's server");
  const noStore = statusService({ relay: RELAY, ...w });
  const unkept = await noStore.call("status.own.set", { chain: "near", address: OWN });
  assert.ok("problem" in unkept, "with no sealed store, nothing is kept anywhere else");
  assert.equal(ownServer("near"), null);
  const t = await s.call<OwnTest>("status.own.test", { chain: "near", address: OWN });
  assert.ok("ok" in t && t.ok.result === "working");
  assert.equal(ownServer("near"), null, "a Test keeps nothing");
});

test("after the unlock the store is read into the doors once; a locked store sets nothing and is read again next time", async () => {
  const store = memStore();
  store.kept.set(ownStoreKey("hood"), OWN);
  let locked = true;
  const s = statusService({ relay: RELAY, ...world(), store: { get: (k) => (locked ? Promise.reject(new Error("locked")) : store.get(k)), set: store.set } });
  await s.call("status.own.get");
  assert.equal(ownServer("hood"), null);
  locked = false;
  const got = await s.call<OwnHosts>("status.own.get");
  assert.ok("ok" in got && got.ok.hood === "my-node.example");
  assert.equal(ownServer("hood"), OWN);
  setOwnServer("hood", null);
});

test("Robinhood Chain: the own server first, ZeroFee's door next, the free nodes after; the hook is set with no relay too", () => {
  setHoodProxy(null);
  assert.equal(HOOD_DOOR.order, null, "control: nothing to put first");
  setOwnServer("hood", OWN); setOwnHood();
  assert.ok(HOOD_DOOR.order, "an own server alone sets the hook");
  assert.deepEqual(hoodNodes(["https://free.example"], "eth_sendRawTransaction"), [OWN, "https://free.example"]);
  setHoodProxy(`${RELAY}/v0/rh/rpc`);
  assert.deepEqual(hoodNodes(["https://free.example"], "eth_sendRawTransaction"), [OWN, `${RELAY}/v0/rh/rpc`, "https://free.example"], "the same signed bytes go on down the list");
  HOOD_DOOR.said!(OWN, 500);
  assert.equal(ownMissed("hood"), true);
  HOOD_DOOR.said!(OWN, 200);
  assert.equal(ownMissed("hood"), false);
  setOwnServer("hood", null); setOwnHood(); setHoodProxy(null);
  assert.equal(HOOD_DOOR.order, null);
});

test("Solana: a trade's checks ask the own server first, ZeroFee's doors after (control: none, as before)", () => {
  setSolProxy(`${RELAY}/v0/sol/read`);
  assert.deepEqual(solPaidDoors(0), [`${RELAY}/v0/sol/read`, `${RELAY}/v0/sol/read?door=alchemy`]);
  setOwnServer("solana", OWN);
  assert.deepEqual(solPaidDoors(0), [OWN, `${RELAY}/v0/sol/read`, `${RELAY}/v0/sol/read?door=alchemy`]);
  setSolProxy(null);
  assert.deepEqual(solPaidDoors(0), [OWN], "no relay: the own server alone ahead of the free nodes");
  ownSaid("solana", false);
  assert.equal(ownMissed("solana"), true);
  setOwnServer("solana", null);
  assert.equal(ownMissed("solana"), false, "cleared with it");
  assert.deepEqual(solPaidDoors(0), []);
});

test("Trade's Solana reads and sends put the own server first; the NEAR doors are handed it in route.ts", () => {
  const rpc = readFileSync(new URL("../../trade/src/sol/rpc.ts", import.meta.url), "utf8");
  assert.match(rpc, /const own = o\.nodes === undefined \? ownServer\("solana"\) : null;/);
  const route = readFileSync(new URL("../../trade/src/near/route.ts", import.meta.url), "utf8");
  assert.match(route, /createNearDoors\(\{ relay: relay!, own,/);
});

test("the words: short, one idea a line, no banned word (never relay, nodes or RPC); the address kept only on the device", () => {
  const lines = [OWN_TITLE, OWN_INTRO, OWN_NONE, OWN_KEPT, OWN_USE, OWN_BACK, OWN_SHOW, OWN_HIDE, USING_OWN, OWN_SWITCHED, ownTestWords({ result: "blocked" }), ownTestWords({ result: "working", ms: 300 }), ownTestWords({ result: "down", ms: null }), ownTestWords({ result: "bad" }), "Status couldn't check this one."];
  for (const l of lines) {
    assert.deepEqual(bannedIn("packages/core/src/status-words.ts", l).map((b) => b.word), [], l);
    assert.ok(l.split(/(?<=\.)\s/).every((x) => x.split(/\s+/).length <= 12), `short: ${l}`);
  }
  for (const l of [OWN_INTRO, OWN_SWITCHED, OWN_KEPT]) assert.equal(grade("packages/core/src/status-words.ts", l).grade, "A", l);
  // the store, never a log: own-servers.ts and the service never print it
  for (const f of ["./own-servers.ts", "./status-probe.ts"]) assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /console\.|localStorage/);
});
