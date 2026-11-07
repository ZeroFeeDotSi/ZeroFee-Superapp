// T13 phase 2 (Settings → Status, spec lines 6-8): "Your own server" under the rows. Each chain says what it uses (its
// own server's host, never the address, or ZeroFee's server); a tap opens its field; Test runs the check against the
// typed address and says what it found in one line; Use it works only once a Test answered; "Use ZeroFee's server"
// clears it. The Sim answers all of it itself. Vite's loader loads the TSX.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { OwnHosts, OwnTest, StatusReport } from "@zerofee/core/status-probe";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";

const WEB = fileURLToPath(new URL("..", import.meta.url));
let ssr: ViteDevServer;
let fakeServer: ViteDevServer;
let OwnField: (p: Record<string, unknown>) => ReactElement;
let OwnServers: FunctionComponent<Record<string, unknown>>;
let FakeOwnServers: FunctionComponent<Record<string, unknown>>;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; unmount: () => void; text: () => string; settle: () => Promise<number>; press: (l: RegExp) => void };
let approvedOrigins: (t: string) => Set<string>;

before(async () => {
  const base = { configFile: false as const, logLevel: "silent" as const, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" as const, optimizeDeps: { noDiscovery: true, include: [] } };
  ssr = await createServer({ ...base, root: WEB });
  const m = await ssr.ssrLoadModule("./shell/StatusSheet.tsx");
  OwnField = m.OwnField; OwnServers = m.OwnServers;
  approvedOrigins = (await ssr.ssrLoadModule("./own-reach.ts")).approvedOrigins;
  const fake = fileURLToPath(new URL("../testing/fake-react.ts", import.meta.url));
  fakeServer = await createServer({ ...base, root: WEB, resolve: { alias: [{ find: /^react$/, replacement: fake }] } });
  runtime = (await fakeServer.ssrLoadModule(fake)) as typeof runtime;
  FakeOwnServers = (await fakeServer.ssrLoadModule("./shell/StatusSheet.tsx")).OwnServers;
});
after(async () => { await ssr?.close(); await fakeServer?.close(); });

const OWN = "https://my-node.example/rpc?api-key=secret123";
const none: Bridge = { call: () => new Promise(() => {}), on: () => () => {} };
const esc = (s: string) => s.replace(/'/g, "&#x27;");

test("at rest: the title, one line saying what it is, and each chain's row says ZeroFee's server", () => {
  const html = renderToString(createElement(OwnServers, { bridge: none }));
  assert.ok(html.includes(">Your own server</h2>"));
  assert.ok(html.includes(esc("You can use your own server for a chain. If it stops, ZeroFee's server takes over.")));
  for (const n of ["NEAR", "Solana", "Robinhood Chain"]) assert.ok(html.includes(`st__name">${n}</span><span class="st__state">ZeroFee&#x27;s server</span>`), n);
  assert.doesNotMatch(html, /<input/, "no field until a row is tapped");
});

test("a field: the typed address, the device-only line, Test; Use it is off until a Test answered (Test first)", () => {
  const html = renderToString(createElement(OwnField as unknown as FunctionComponent<Record<string, unknown>>, { chain: "solana", host: null, bridge: none, onDone: () => {}, initial: OWN }));
  assert.ok(html.includes(">Your Solana server</label>"));
  // QA 16's MUST 1: the address may carry a key: dots until Show, and its host said under it
  assert.match(html, /<input id="st-own-solana" class="st__own-input"[^>]*type="password"/);
  assert.match(html, /aria-pressed="false"[^>]*>Show<\/button>/);
  assert.match(html, /st__own-host"[^>]*>my-node\.example<\/p>/);
  assert.equal((html.match(/secret123/g) ?? []).length, 1, "the key only in the hidden field's value, nowhere shown");
  assert.ok(html.includes(esc("Only this device keeps it. It's locked.")));
  assert.match(html, /<button class="zf-btn" disabled=""[^>]*>Use it<\/button>/);
  assert.ok(html.includes("Test it first."));
  assert.doesNotMatch(html, /Use ZeroFee/, "no way back to show when none is set");
  const passed = renderToString(createElement(OwnField as unknown as FunctionComponent<Record<string, unknown>>, { chain: "solana", host: "my-node.example", bridge: none, onDone: () => {}, initial: OWN, initialTest: { result: "working", ms: 180 } }));
  assert.ok(passed.includes("Your server works. It answered in 0.2 s."));
  assert.match(passed, /<button class="zf-btn"[^>]*>Use it<\/button>/);
  assert.doesNotMatch(passed, /<button class="zf-btn" disabled=""[^>]*>Use it/);
  assert.ok(passed.includes(esc("Use ZeroFee's server")));
  const failed = renderToString(createElement(OwnField as unknown as FunctionComponent<Record<string, unknown>>, { chain: "near", host: null, bridge: none, onDone: () => {}, initial: "https://down.invalid", initialTest: { result: "down", ms: null } }));
  assert.match(failed, /data-result="down">Your server didn&#x27;t answer\./);
  const phone = renderToString(createElement(OwnField as unknown as FunctionComponent<Record<string, unknown>>, { chain: "hood", host: null, bridge: none, onDone: () => {}, initial: OWN, initialTest: { result: "blocked" } }));
  assert.ok(phone.includes(esc("ZeroFee on iPhone can't reach that address yet.")));
});

test("in the Sim: the section opens on its field reading the hosts only (no check); Test, Use it and the look answer as the real service does: host only, a dead host Down, the row on your server", async () => {
  const sim = createMockBridge({ latencyMs: 0 });
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const bridge: Bridge = { call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> { calls.push({ method, ...(params ? { params } : {}) }); return sim.call<T>(method, params); }, on: () => () => {} };
  await runtime.mount(createElement(FakeOwnServers, { bridge, initialOpen: "near" }));
  assert.match(runtime.text(), /Your NEAR server/);
  // the fake runtime can't type: the field's own Test is pressed with what the Sim was asked checked below
  const test0 = await sim.call<OwnTest>("status.own.test", { chain: "near", address: OWN });
  assert.ok("ok" in test0 && test0.ok.result === "working");
  const dead = await sim.call<OwnTest>("status.own.test", { chain: "near", address: "https://my-node.invalid" });
  assert.ok("ok" in dead && dead.ok.result === "down");
  const set = await sim.call<{ host: string }>("status.own.set", { chain: "near", address: OWN });
  assert.ok("ok" in set && set.ok.host === "my-node.example");
  const hosts = await sim.call<OwnHosts>("status.own.get");
  assert.ok("ok" in hosts);
  assert.deepEqual(hosts.ok, { near: "my-node.example", solana: null, hood: null });
  const look = await sim.call<StatusReport>("status.probe");
  assert.ok("ok" in look && look.ok.rows.find((r) => r.id === "near")!.via === "own");
  runtime.unmount();
  assert.equal(calls[0]?.method, "status.own.get", "the section reads the hosts as it opens, and no check");
  assert.ok(!calls.some((c) => c.method === "status.probe"));
});

test("the phone: a host outside apps/ios/connect-hosts.txt can't be fetched there, so Test says so (the list read from the file itself)", () => {
  const text = readFileSync(new URL("../../../ios/connect-hosts.txt", import.meta.url), "utf8");
  const set = approvedOrigins(text);
  assert.ok(set.has("https://rpc.mainnet.fastnear.com"));
  assert.ok(!set.has("https://my-node.example"));
  assert.ok([...set].every((o) => o.startsWith("https://")), "comments and the wss section left out");
  const core = readFileSync(new URL("../core.ts", import.meta.url), "utf8");
  assert.match(core, /host \? import\("\.\/own-reach\.ts"\) : null/, "only on the phone");
  assert.match(core, /\.\.\.\(r \? \{ reach: r\.phoneReaches \} : \{\}\)/);
  assert.match(core, /device\.call<\{ value: string \| null \}>\("device\.store\.get", \{ app: "trade", key \}\)/, "kept through device.store only (sealed / Keychain)");
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /void shellBridge\.call\("status\.own\.get"\)/, "read into the doors once Home is up");
});
