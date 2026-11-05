// Sim re-crawl (5 Nov, the pump.fun bug report): Settings > Sites said "You haven't connected any sites" over a funded
// pump.fun wallet, because the Sim's Settings had the bare mock (no Spending). It gets the routed shell, as the real app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const demo = readFileSync(new URL("./Demo.tsx", import.meta.url), "utf8");
const screens = readFileSync(new URL("./Screens.tsx", import.meta.url), "utf8");

test("the Sim's Settings reads Spending's site wallets through the routed shell (control: the bare mock stays for the shell's own calls)", () => {
  assert.match(screens, /routeBridge\(demoBridge, \{[^}]*spending: demoSpending/);
  assert.match(screens, /export const demoShell: Bridge = injected \? faultedBridge\(routedShell, injected\) : routedShell;/);
  assert.match(demo, /const demoSettingsBridge = requireActivation\(demoShell\);/);
  assert.match(demo, /<SettingsPanel accountId="" bridge=\{demoSettingsBridge\}/);
  assert.match(demo, /export const demoShellBridge = requireActivation\(demoBridge\);/, "control: the shell's own sheets keep the mock");
});
