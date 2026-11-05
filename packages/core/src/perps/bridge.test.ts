// D119 landing 2: perps.* is a core family that only Trade (and ZeroFee's own screens) reach. Browser, Chat, the apps in
// Apps and AgentZero are refused by the bridge, and the core refuses them again if one got past it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PERPS_NETWORK } from "./service.ts";
import { CORE_NAMES, appMayCall, forApps } from "../bridge.ts";
import { DemoCore } from "../demo-core.ts";
import { FakeChain } from "../testing/fake-chain.ts";
import { MemoryVault } from "../vault.ts";
import { PERPS_CORE_ON, perpsCall } from "./service.ts";

test("only Trade may call perps.* (control: Trade may; every other app may not)", () => {
  assert.ok(CORE_NAMES.includes("perps"), "a core family: no service can answer it");
  assert.ok(appMayCall("trade", "perps.order"));
  for (const app of ["browser", "chat", "social", "agent", "wallet", "pay", "extension", "earn"] as const) assert.equal(appMayCall(app, "perps.order"), false, app);
});

test("the core routes perps.* for Trade and refuses another app's stamp, even past the bridge", async () => {
  const core = new DemoCore({ chain: new FakeChain(), vault: new MemoryVault(), policyWasm: async () => new Uint8Array(), createAccount: async () => undefined as never, prices: async () => ({ near: 4 }) });
  const viaBrowser = await forApps(core, "browser").call("perps.state");
  assert.equal("problem" in viaBrowser && viaBrowser.problem.code, "security.bridge.not-allowed");
  const forged = await core.call("perps.state", { app: "browser" });
  assert.equal("problem" in forged && forged.problem.code, "security.method.unknown");
  // review L4: until PERPS_CORE_ON is turned on with PERPS_ON, the core answers perps.* for no one, Trade included
  assert.equal(PERPS_CORE_ON, false);
  const trade = await forApps(core, "trade").call("perps.state");
  assert.equal("problem" in trade && trade.problem.code, "security.method.unknown");
  core.close();
  // control, with the core's switch on: Trade's call is routed (to the account check), another app's is not
  const vault = new MemoryVault();
  const seen: string[] = [];
  const at = { vault, approve: async () => false, ready: async () => { seen.push("ready"); throw new Error("no account"); } };
  await assert.rejects(perpsCall(at, "perps.state", { app: "trade" }, true), /no account/);
  await assert.rejects(perpsCall(at, "perps.state", {}, true), /no account/, "ZeroFee's own screens");
  await assert.rejects(perpsCall(at, "perps.state", { app: "browser" }, true), (e: any) => e.problem?.code === "security.method.unknown");
  assert.deepEqual(seen, ["ready", "ready"], "another app never reaches the account");
});

test("the phone's isolated core lets the page reach perps.* and Hyperliquid's TESTNET host, never its mainnet host", () => {
  const isolated = readFileSync(new URL("../../../../apps/ios/ZeroFee/IsolatedCore.swift", import.meta.url), "utf8");
  const context = readFileSync(new URL("../../../../apps/ios/ZeroFee/CoreContext.swift", import.meta.url), "utf8");
  assert.match(/coreFamilies: Set<String> = \[([^\]]*)\]/.exec(isolated)![1]!, /"perps"/);
  assert.match(context, /"api\.hyperliquid-testnet\.xyz"/);
  assert.match(context, /"api\.hyperliquid\.xyz"/, "landing 3: mainnet's API, for the build whose PERPS_NETWORK is mainnet");
});

test("landing 3: mainnet is data in one place (agent.ts HL_MAINNET); the build's network stays testnet until it's set; never Arbitrum's chain id", () => {
  assert.equal(PERPS_NETWORK, "testnet");
  for (const f of ["hl-sign.ts", "rules.ts", "service.ts"]) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /api\.hyperliquid\.xyz|hyperliquidChain: "Mainnet"/, f);
  }
  for (const f of ["agent.ts", "hl-sign.ts", "rules.ts", "service.ts"]) assert.doesNotMatch(readFileSync(new URL(`./${f}`, import.meta.url), "utf8"), /0xa4b1/, f);
  assert.match(readFileSync(new URL("./agent.ts", import.meta.url), "utf8"), /HL_MAINNET = \{ chain: "Mainnet", signatureChainId: "0x66eee", api: "https:\/\/api\.hyperliquid\.xyz"/);
});
