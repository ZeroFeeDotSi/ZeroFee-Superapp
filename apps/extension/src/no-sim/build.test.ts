// Row 35 (product decision, 3 Nov): the extension is the real app, never a Sim. The build's gate (build.ts) and its stand-ins.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MUST, NEVER, STANDINS, simProblems, standinFor } from "./build.ts";
import { isSampleAddress, createDemoEngine } from "./demo-engine.ts";
import { simSitesOn } from "./sites-data.ts";
import { installSimStorage, adoptOldDemo } from "./sim-storage.ts";
import { isSampleAccount } from "./earn-demo.ts";
import { simReal, simWords } from "./agent-sim.ts";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const R = (p: string) => join(repo, p);
const CORE = [R("packages/core/src/demo-core.ts"), R("packages/core/src/chain.ts"), R("packages/core/src/vault.ts")];
const SIM = [
  "apps/web/src/sim-storage.ts", "apps/web/src/demo-line.ts", "apps/web/src/gallery/screens.css", "apps/web/src/gallery/Demo.tsx",
  "apps/web/src/agentzero/SimChat.tsx", "apps/web/src/agentzero/sim-chat.ts", "packages/agent/src/chat/sim.ts",
  "packages/trade/src/demo-engine.ts", "packages/trade/src/perps/sample.ts", "packages/trade/src/market/demo-samples.ts",
  "packages/trade/src/market/recorded-data.ts", "packages/browser/src/sim/sites-data.ts", "packages/browser/src/sim/SimSitePage.tsx",
  "packages/earn/src/app/demo.ts", "packages/earn/src/testing/fake-near.ts", "packages/shell-api/src/MockBridge.ts",
  "packages/shell-api/src/mock-float.ts",
].map(R);

test("every Sim module the web app imports has a stand-in, and each stand-in file exists", () => {
  for (const id of SIM.filter((p) => STANDINS.some((s) => s.module.test(p)))) {
    const s = standinFor(id);
    assert.ok(s && existsSync(s), id);
  }
  for (const s of STANDINS) assert.ok(SIM.some((p) => s.module.test(p)), `${s.module} names a module this test lists`);
  // control: the real core, Trade's real engines and the real chat are never swapped
  for (const id of [...CORE, R("packages/trade/src/sol/chain.ts"), R("packages/agent/src/chat/turn.ts"), R("packages/agent/src/chat/standins.ts"), R("apps/web/src/core.ts")]) assert.equal(standinFor(id), null, id);
});

test("the gate: a build with the real core and no Sim passes (control); any Sim module, or no core, fails", () => {
  const clean = [...CORE, R("apps/web/src/main.tsx"), R("apps/extension/src/no-sim/sim-storage.ts"), R("packages/trade/src/runtime.ts")];
  assert.deepEqual(simProblems(clean), []);
  for (const id of SIM) assert.ok(simProblems([...clean, id]).some((p) => p.includes(id)), id);
  for (const i of MUST.keys()) assert.ok(simProblems(clean.filter((id) => !MUST[i]!.test(id))).some((p) => p.includes("real core")), String(MUST[i]));
  assert.ok(NEVER.length >= 8);
});

test("the stand-ins never take a sample path: the Sim's own inputs read as real", () => {
  assert.equal(isSampleAddress("T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM"), false);
  assert.equal(isSampleAddress("0xAb5e688E42cE07Fc83e0AD8ca0486b96a5D53e39"), false);
  assert.throws(() => createDemoEngine({}));
  assert.equal(simSitesOn({ sim: true, demo: true, phone: false }), false);
  assert.equal(installSimStorage(), false);
  assert.equal(adoptOldDemo({} as Storage, false), "done");
  assert.equal(isSampleAccount("zf-sample000001.testnet"), false);
  assert.equal(simReal("sign me up on pump.fun"), false);
  assert.equal(simWords("Approve on your iPhone"), "Approve on your iPhone");
});

test("the built extension (build/), when there is one: no Sim module's words, and the real core's chunk is there", { skip: !existsSync(join(repo, "apps/extension/build/app/build.json")) && !process.env.ZF_REQUIRE_BUILD ? "no build here" : false }, () => {
  const dir = join(repo, "apps/extension/build/app/chunks");
  const names = readdirSync(dir);
  assert.ok(names.some((n) => /^demo-core-[\w-]+\.js$/.test(n) && readFileSync(join(dir, n), "utf8").length > 100_000), "the real core's chunk");
  const css = join(repo, "apps/extension/build/app/assets");
  const all = [...names.filter((n) => n.endsWith(".js")).map((n) => join(dir, n)), ...readdirSync(css).filter((n) => n.endsWith(".css")).map((n) => join(css, n))].map((f) => readFileSync(f, "utf8")).join("\n");
  for (const words of ["This is the Sim. On the iPhone app", "In the Sim, AgentZero answers only", "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM", "Simulation · sample coins", "Sim can't start in this browser", "sample-marker", "zf.demo.setup"]) {
    assert.ok(!all.includes(words), words);
  }
  // control: the real app's own words are there
  assert.ok(all.includes("Create my account"));
});
