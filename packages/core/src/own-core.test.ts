// Builder 6's open edge (8 Nov): on the phone the core runs in Swift's own context, apart from the page, so the person's
// own server never reached the core's Solana checks (solPaidDoors) or Robinhood Chain reads and sends (hoodNodes) while
// the Status sheet said "Using your server". The page's Status service now hands it to that core (subwallet.own.set,
// ZeroFee's own screens only), and the core's doors ask it first. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkInCore, ownCoreState, ownIntoCore } from "./own-core.ts";
import { ownMissed, ownServer, ownStoreKey, setOwnServer } from "./own-servers.ts";
import { coreMissedIn, statusService, type StatusReport } from "./status-probe.ts";
import { hoodNodes, setHoodProxy } from "./hood-proxy.ts";
import { HOOD_DOOR } from "./hood-door.ts";
import { setSolProxy, solPaidDoors } from "./sol-proxy.ts";
import { movesNothing } from "./money-calls.ts";

const RELAY = "https://relay.example";
const OWN = "https://my-node.example/rpc?api-key=secret123";
const fail = async (f: () => unknown): Promise<string> => { try { await f(); } catch (e) { return (e as { problem?: { code?: string } }).problem?.code ?? "thrown"; } return "none"; };
/** The core's own fetch: answers (an RPC result), or refuses the host as Swift's core does for one off its list. */
const answers = (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: 5 }))) as unknown as typeof fetch;
const refused = (async (u: string) => { throw new Error(`the core may not reach ${new URL(u).host}`); }) as unknown as typeof fetch;

test("the core takes the address from ZeroFee's own Status: its Solana checks and Robinhood calls ask it first, then ZeroFee's", async () => {
  setSolProxy(`${RELAY}/v0/sol/read`);
  setHoodProxy(`${RELAY}/v0/rh/rpc`);
  assert.deepEqual(await ownIntoCore({ chain: "solana", address: OWN }, answers), { chain: "solana", host: "my-node.example" }, "its host only, never the address");
  assert.equal(solPaidDoors(0)[0], OWN);
  assert.deepEqual(solPaidDoors(0).slice(1), [`${RELAY}/v0/sol/read`, `${RELAY}/v0/sol/read?door=alchemy`], "ZeroFee's doors after it");
  assert.deepEqual(await ownIntoCore({ chain: "hood", address: OWN }, answers), { chain: "hood", host: "my-node.example" });
  assert.deepEqual(ownCoreState({}), { missed: [] }, "it answered: nothing missed");
  assert.deepEqual(hoodNodes(["https://free.example"], "eth_sendRawTransaction", 0), [OWN, `${RELAY}/v0/rh/rpc`, "https://free.example"], "a send's same bytes too");
  assert.ok(HOOD_DOOR.order, "Robinhood's hook is set");
  // back to ZeroFee's server
  assert.deepEqual(await ownIntoCore({ chain: "solana", address: null }, answers), { chain: "solana", host: null });
  assert.deepEqual(await ownIntoCore({ chain: "hood", address: null }, answers), { chain: "hood", host: null });
  assert.equal(solPaidDoors(0)[0], `${RELAY}/v0/sol/read`, "control: none set, ZeroFee's door first");
  assert.equal(hoodNodes([], "eth_call", 0)[0], `${RELAY}/v0/rh/rpc`);
  setSolProxy(null); setHoodProxy(null);
});

test("only ZeroFee's own screens set it, only a real https address, only the three chains", async () => {
  assert.equal(await fail(() => ownIntoCore({ app: "trade", chain: "solana", address: OWN }, answers)), "security.request.not-allowed", "an app can't point the core elsewhere");
  assert.equal(await fail(() => ownIntoCore({ caller: "x", chain: "solana", address: OWN }, answers)), "security.request.not-allowed");
  assert.equal(await fail(() => ownIntoCore({ chain: "bsc", address: OWN }, answers)), "security.request.not-allowed");
  assert.equal(await fail(() => ownIntoCore({ chain: "solana", address: "http://my-node.example" }, answers)), "status.own.bad");
  assert.equal(await fail(() => ownIntoCore({ chain: "solana", address: "https://u:p@my-node.example" }, answers)), "status.own.bad");
  assert.equal(ownServer("solana"), null, "nothing was set by a refusal");
  assert.equal(await fail(() => ownCoreState({ app: "trade" })), "security.request.not-allowed", "nor read by an app");
  // the core's dispatch answers it, and a throw in it says nothing moved
  const core = readFileSync(new URL("./demo-core.ts", import.meta.url), "utf8");
  assert.match(core, /case "subwallet\.own\.set":\n\s+return import\("\.\/own-core\.ts"\)\.then\(\(m\) => m\.ownIntoCore\(p\)\);/);
  assert.match(core, /case "subwallet\.own\.state":\n\s+return import\("\.\/own-core\.ts"\)\.then\(\(m\) => m\.ownCoreState\(p\)\);/);
  assert.equal(movesNothing("subwallet.own.state"), true);
  assert.equal(movesNothing("subwallet.own.set"), true, "a throw in it says nothing moved");
  // the phone lets the page ask this family of the core (IsolatedCore.swift coreFamilies), so the call reaches it
  const swift = readFileSync(new URL("../../../apps/ios/ZeroFee/IsolatedCore.swift", import.meta.url), "utf8");
  assert.match(swift.match(/coreFamilies: Set<String> = \[([^\]]*)\]/)?.[1] ?? "", /"subwallet"/);
});

test("the Status service hands each kept own server to a core apart from the page, on load and on Use it; a refusal is asked again", async () => {
  const kept = new Map<string, string | null>([[ownStoreKey("solana"), OWN], [ownStoreKey("hood"), OWN]]);
  const store = { get: async (k: string) => kept.get(k) ?? null, set: async (k: string, v: string | null) => { kept.set(k, v); } };
  const handed: [string, string | null][] = [];
  let refuse = true;
  const core = async (c: string, a: string | null) => { handed.push([c, a]); return refuse ? { problem: { code: "security.core.not-ready" } } : { ok: { host: null } }; };
  const s = statusService({ relay: RELAY, store, core, fetch: (async () => new Response("{}")) as never });
  await s.call("status.own.get");
  assert.deepEqual(handed, [["solana", OWN], ["hood", OWN]], "the set ones, with the address the core's doors need");
  refuse = false;
  await s.call("status.own.get");
  assert.deepEqual(handed.slice(2), [["solana", OWN], ["hood", OWN]], "a core that wasn't ready is handed them again");
  await s.call("status.own.get");
  assert.equal(handed.length, 4, "once taken, not again");
  await s.call("status.own.set", { chain: "solana", address: null });
  assert.deepEqual(handed[4], ["solana", null], "Use ZeroFee's server clears it in the core too");
  await s.call("status.own.set", { chain: "near", address: OWN });
  assert.deepEqual(handed[5], ["near", OWN]);
  const noCore = statusService({ relay: RELAY, store, fetch: (async () => new Response("{}")) as never });
  await noCore.call("status.own.set", { chain: "near", address: null });
  assert.equal(handed.length, 6, "control: a core in this page (the web) shares its doors, nothing is handed");
  for (const c of ["near", "solana", "hood"] as const) setOwnServer(c, null);
});

test("the page hands it in only where the core runs apart (the phone), through the shell-stamped core", () => {
  const web = readFileSync(new URL("../../../apps/web/src/core.ts", import.meta.url), "utf8");
  assert.match(web, /const ownIntoCore = \(chain: string, address: string \| null\) => core\.call\("subwallet\.own\.set", \{ chain, address \}\);/);
  assert.match(web, /\.\.\.\(coreIsIsolated\(host\) \? \{ core: ownIntoCore, coreMissed \} : \{\}\)/);
  assert.match(web, /const coreMissed = \(\) => core\.call<[^>]+>\("subwallet\.own\.state"\)/);
  assert.match(web, /const core: Bridge = asShell\(/, "the core bridge stamps ZeroFee's own screens");
});

test("QA 16's MUST: a core that can't reach the own server says so, and Status says who took over, never \"Using your server\"", async () => {
  setSolProxy(`${RELAY}/v0/sol/read`);
  // a host off the phone core's list: refused at once, the core's doors go on to ZeroFee's, and the miss is kept
  assert.deepEqual(await ownIntoCore({ chain: "solana", address: OWN }, refused), { chain: "solana", host: "my-node.example" });
  assert.equal(ownMissed("solana"), true);
  assert.deepEqual(ownCoreState({}), { missed: ["solana"] });
  // a server that never answers: no answer within the bar is a miss too
  const hangs = (() => new Promise(() => {})) as unknown as typeof fetch;
  assert.equal(await checkInCore("hood", OWN, hangs, 20), false);
  // the page's look (its own ask answered) with the core's word on top: the line says ZeroFee's server took over
  const page: StatusReport = { at: 1, relay: true, rows: [{ id: "solana", state: "working", via: "own", ms: 90 }, { id: "near", state: "working", via: "own", ms: 80 }] };
  const said = coreMissedIn(page, ["solana"], true);
  assert.deepEqual(said.rows[0], { id: "solana", state: "working", via: "relay", ms: 90, ownMissed: true });
  assert.deepEqual(said.rows[1], page.rows[1], "control: NEAR's own server is Trade's alone, its row as the page saw it");
  const { usingLine } = await import("./status-words.ts");
  assert.equal(usingLine(said.rows[0]!, true), "Your server didn't answer. Using ZeroFee's server.");
  assert.equal(usingLine(coreMissedIn(page, ["solana"], false).rows[0]!, false), "Your server didn't answer. Using Solana's public servers.");
  assert.equal(coreMissedIn(page, [], true), page, "control: nothing missed, the look as it was");
  // the service asks the core each look; the miss shows; once the core reaches it again, "Using your server"
  let missed: ("solana" | "hood" | "near")[] = ["solana"];
  const fetchOk = (async (u: string, init?: RequestInit) => { const m = init?.body ? JSON.parse(String(init.body)).method : ""; return new Response(JSON.stringify(m === "getSlot" ? { jsonrpc: "2.0", id: 1, result: 5 } : m === "eth_blockNumber" ? { jsonrpc: "2.0", id: 1, result: "0x1" } : m === "status" ? { jsonrpc: "2.0", id: 1, result: { sync_info: { latest_block_height: 1 } } } : u.endsWith("/v0/health") ? { services: {} } : { near: { usd: 2 } }), { status: 200 }); }) as never;
  const s = statusService({ relay: RELAY, fetch: fetchOk, coreMissed: async () => missed });
  const r1 = await s.call<StatusReport>("status.probe");
  assert.ok("ok" in r1 && r1.ok.rows.find((r) => r.id === "solana")?.ownMissed === true, JSON.stringify(r1));
  missed = [];
  const r2 = await s.call<StatusReport>("status.probe");
  assert.ok("ok" in r2 && r2.ok.rows.find((r) => r.id === "solana")?.via === "own", "the core reached it: Using your server");
  // the core's Solana reads say each answer of the own server, as Trade's doors and its Robinhood calls do
  const sol = readFileSync(new URL("./solana.ts", import.meta.url), "utf8");
  assert.match(sol, /const own = isOwnServer\("solana", url\);/);
  assert.match(sol, /\.then\(\(res\) => \{ if \(own\) ownSaid\("solana", res\.ok\); return res; \}, \(e\) => \{ if \(own\) ownSaid\("solana", false\); throw e; \}\);/);
  for (const c of ["near", "solana", "hood"] as const) setOwnServer(c, null);
  setSolProxy(null);
});
