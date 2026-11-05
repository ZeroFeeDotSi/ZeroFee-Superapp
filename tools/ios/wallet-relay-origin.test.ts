// B29 (phone test, 2 Nov): GMGN showed its wallet list, the sign-in steps chose ZeroFee, and nothing connected.
// The phone's host relayed each request to Browser's engine with `origin` = the bare host ("gmgn.ai"); the engine reads
// the origin with `new URL(origin)` and answers https origins only, so every site's Connect was answered "ZeroFee's
// wallet answers https sites only." (4100), and GMGN fell back to "You are not logged in". Headless Chrome never ran
// the Swift side, so no walk saw it. The two sides are held together here: the Swift source builds every relayed origin
// with WalletGate.relayOrigin, that is "https://<host>", and the engine accepts exactly that shape (and refuses the old).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createWalletEngine, hostOf } from "../../packages/browser/src/engine/engine.ts";
import { siteRules } from "../../packages/browser/src/sites.ts";
import { PRESETS } from "../../packages/browser/src/presets.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
const wallet = read("apps/ios/ZeroFee/PartnerWallet.swift");
const rules = read("apps/ios/ZeroFee/HostRules.swift");

test("the Swift host relays every request's origin through WalletGate.relayOrigin, and it is https://<host>", () => {
  const emits = [...wallet.matchAll(/host\.emit\("device\.wallet\.request", \[([^\n]*)\]\)/g)].map((m) => m[1]!);
  assert.ok(emits.length >= 2, `found ${emits.length} relays (the request and zerofee_left)`);
  // every relay in the host's Swift is one this test read (one written over several lines would slip past it)
  const dir = fileURLToPath(new URL("../../apps/ios/ZeroFee/", import.meta.url));
  const swift = readdirSync(dir).filter((f) => f.endsWith(".swift")).map((f) => readFileSync(dir + f, "utf8")).join("\n");
  assert.equal([...swift.matchAll(/emit\("device\.wallet\.request"/g)].length, emits.length, "a device.wallet.request relay this test can't read");
  for (const e of emits) assert.match(e, /"origin": WalletGate\.relayOrigin\(/, `a relay without relayOrigin: ${e}`);
  assert.match(rules, /static func relayOrigin\(_ host: String\) -> String \{ "https:\/\/\\\(host\)" \}/);
});

test("the engine reads the relayed shape as the site's host, and refuses the bare host (the bug's control)", () => {
  for (const host of ["gmgn.ai", "pump.fun", "jup.ag"]) {
    assert.equal(hostOf(`https://${host}`), host);
    assert.equal(hostOf(host), null, `a bare ${host} must stay refused: the fix is the host's, not a looser engine`);
  }
});

test("through the engine: GMGN's connect with the relayed origin gets its own wallet with no sheet; the bare host is refused", async () => {
  const store = new Map<string, string>();
  const address = "5fGUWQfj1crYzC1YCeLyD2ysu2iKn19XK87WSfRTKhjX";  // generated sample
  const asked: string[] = [];
  const bridge = {
    async call(method: string, p: Record<string, unknown> = {}) {
      if (method === "device.store.get") return { ok: { value: store.get(String(p.key)) ?? null } };
      if (method === "device.store.set") return store.set(String(p.key), String(p.value)), { ok: { ok: true } };
      if (method === "device.wallet.askConnect") return asked.push(String(p.host)), { ok: { allow: false } };
      if (method === "subwallet.list") return { ok: [{ id: "w1", kind: "site", site: "gmgn", chain: "sol", address }] };
      // audit C1: the engine asks the core for the site's own wallet on connect (subwallet.site.forHost)
      if (method === "subwallet.site.forHost") return { ok: { id: "w1", kind: "site", site: "gmgn", chain: "sol", address, label: "GMGN wallet" } };
      return { problem: { code: "test", whatHappened: method, money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } };
    },
    on: () => () => {},
  };
  const engine = createWalletEngine({ bridge: bridge as never, site: siteRules({}), emit: () => {}, askConnect: async () => false });
  const ok = await engine.handle({ id: 1, method: "solana:connect", params: { silent: false }, origin: "https://gmgn.ai", mainFrame: true });
  assert.ok("result" in ok, JSON.stringify(ok));
  assert.equal((ok.result as { address: string }).address, address);
  assert.deepEqual(asked, [], "no connect sheet on GMGN's own wallet (D65)");
  const bare = await engine.handle({ id: 2, method: "solana:connect", params: { silent: false }, origin: "gmgn.ai", mainFrame: true });
  assert.ok("error" in bare && bare.error.code === 4100, JSON.stringify(bare));
});

test("every site preset (and every host in the phone's pinned table) reaches the engine as an https origin it reads as that site", () => {
  const rule = siteRules({});
  const pinned = JSON.parse(/static let json = #"(.*)"#/.exec(read("apps/ios/ZeroFee/PinnedRecipes.swift"))![1]!) as { recipes: { hosts: string[] }[]; presets: { hosts: string[] }[] };
  const hosts = new Set([...PRESETS.flatMap((p) => p.hosts), ...pinned.presets.flatMap((p) => p.hosts), ...pinned.recipes.flatMap((r) => r.hosts)]);
  assert.ok(hosts.size >= PRESETS.length, `read ${hosts.size} hosts`);
  for (const host of hosts) {
    const origin = `https://${host}`; // WalletGate.relayOrigin(host), as the first test pins it
    assert.equal(hostOf(origin), host, `${origin} must read as ${host}`);
    assert.equal(hostOf(host), null, `the bare ${host} stays refused (the bug's control)`);
  }
  for (const p of PRESETS) for (const host of p.hosts) assert.equal(rule(hostOf(`https://${host}`)!)?.known, true, `${host} is a known site to the engine`);
});

test("D75 (review ST1 M1): the engine tells the host, beside the answer and never in it, when the core signed a sign-in with no sheet; Swift narrates only then", async () => {
  const address = "5fGUWQfj1crYzC1YCeLyD2ysu2iKn19XK87WSfRTKhjX";
  let quiet = true;
  const store = new Map<string, string>();
  const bridge = {
    async call(method: string, p: Record<string, unknown> = {}) {
      if (method === "device.store.get") return { ok: { value: store.get(String(p.key)) ?? null } };
      if (method === "device.store.set") return store.set(String(p.key), String(p.value)), { ok: { ok: true } };
      if (method === "subwallet.list") return { ok: [{ id: "w1", kind: "site", site: "gmgn", chain: "sol", address }] };
      if (method === "subwallet.site.forHost") return { ok: { id: "w1", kind: "site", site: "gmgn", chain: "sol", address, label: "GMGN wallet" } };
      if (method === "subwallet.signMessage") return { ok: { signature: "c2ln", ...(quiet ? { signedIn: true } : {}) } };
      return { problem: { code: "test", whatHappened: method, money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } };
    },
    on: () => () => {},
  };
  const engine = createWalletEngine({ bridge: bridge as never, site: siteRules({}), emit: () => {}, askConnect: async () => false });
  await engine.handle({ id: 1, method: "solana:connect", params: { silent: false }, origin: "https://gmgn.ai", mainFrame: true });
  const ask = (id: number) => engine.handle({ id, method: "solana:signMessage", params: { address, message: "aGk=" }, origin: "https://gmgn.ai", mainFrame: true });
  const a = await ask(2);
  assert.deepEqual(a, { id: 2, result: { signature: "c2ln" }, signedIn: true }, "beside the answer; the page's result is the signature alone");
  quiet = false;
  const b = await ask(3);
  assert.deepEqual(b, { id: 3, result: { signature: "c2ln" } }, "a sheet's signature: no flag (control)");
  // the service hands the engine's whole reply to the host; the host answers the page from `result` only
  assert.match(read("packages/browser/src/service.ts"), /bridge\.call\("device\.wallet\.reply", await engine\.handle\(req\)\)/);
  assert.match(wallet, /waiting\.reply\(\["id": waiting\.pageId, "result": p\["result"\] \?\? NSNull\(\)\], nil\)/);
  assert.match(wallet, /p\["signedIn"\] as\? Bool == true/);
});
