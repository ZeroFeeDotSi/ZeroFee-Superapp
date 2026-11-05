import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appsFor, foldedInto, HIDDEN_APP_PROBLEM, LIVE_IN_RELEASE, LIVE_ON_WEB, MVP_APPS, mvpOn, PHONE_ON_WEB, publicApps } from "./shown-apps.ts";

const registry = ["wallet", "trade", "social", "extension", "browser", "agent", "earn"].map((id) => ({ id }));

test("without the MVP every registered app shows, in the registry's order", () => {
  assert.deepEqual(appsFor(registry).map((m) => m.id), registry.map((m) => m.id));
});

test("D31: the MVP is on unless the address has `all`; ?demo&all and ?screens&all are not MVP", () => {
  for (const q of ["", "?", "?demo", "?screens", "?demo&hold=20", "?allx", "?demo&small=all"]) assert.equal(mvpOn(q), true, q);
  for (const q of ["?all", "?demo&all", "?screens&all", "?all&demo", "?all=1"]) assert.equal(mvpOn(q), false, q);
  assert.deepEqual([...MVP_APPS].sort(), ["agent", "chat", "social", "trade", "wallet"], "D55: ZeroFee Chat joined the MVP set; Agent with release 10");
});

test("H-2: on mainnet `?all` unhides nothing; the public build: the phone's apps, Real without Chat, never a Coming soon", () => {
  for (const q of ["?all", "?mainnet&all", "?all=1"]) assert.equal(mvpOn(q, true), true, q);
  const phone = ["wallet", "trade", "chat", "social", "extension", "browser", "agent", "earn"].map((id) => ({ id }));
  assert.deepEqual(publicApps(phone, true).map((m) => m.id), ["wallet", "trade", "chat", "social", "agent"], "Sim: every app the phone shows");
  assert.deepEqual(publicApps(phone, false).map((m) => m.id), ["wallet", "trade", "social", "agent"], "Real: Chat stays out (Private-only sends)");
  // control: the same list as the phone's MVP, so nothing else is dropped
  assert.deepEqual(publicApps(phone, true).map((m) => m.id), appsFor(phone, true).map((m) => m.id));
  assert.deepEqual([...LIVE_IN_RELEASE].sort(), ["agent", "social", "trade", "wallet"]);
  // no Coming soon screen is left for an app: the release's stand-ins and their screen are gone
  for (const f of ["./App.tsx", "./gallery/Screens.tsx"]) assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /comingSoon|releaseApps/, f);
});

test("D31 and D48: with the MVP on, wallet, trade and social show (Security is the shell's own); the others are hidden", () => {
  assert.deepEqual(appsFor(registry, true).map((m) => m.id), ["wallet", "trade", "social", "agent"]);
  const shown = appsFor(registry, mvpOn("?demo")).map((m) => m.id);
  for (const id of ["extension", "browser", "earn"]) assert.ok(!shown.includes(id), id);
});

test("D31: ?all shows every registered app", () => {
  assert.deepEqual(appsFor(registry, mvpOn("?demo&all")).map((m) => m.id), registry.map((m) => m.id));
  assert.deepEqual(appsFor(registry, mvpOn("?screens&all")).map((m) => m.id), registry.map((m) => m.id));
});

test("D31: openApp to an app that isn't shown lands on the Problem screen: the words, no money touched, one step 'Go back'", () => {
  assert.equal(HIDDEN_APP_PROBLEM.whatHappened, "That part of ZeroFee isn't in this build yet.");
  assert.deepEqual(HIDDEN_APP_PROBLEM.money, { state: "not-involved" });
  assert.deepEqual(HIDDEN_APP_PROBLEM.next, { kind: "nothing", label: "Go back" });
  const host = readFileSync(new URL("./shell/AppHost.tsx", import.meta.url), "utf8");
  assert.match(host, /if \(!to \|\| j < 0\) \{[\s\S]*?HIDDEN_APP_PROBLEM[\s\S]*?return;\s*\}/);
});

test("the shell picks its apps from the MVP flag and the network", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  assert.match(app, /appsFor\(APPS, mvpOn\(location\.search, account\.network === "mainnet"\), account\.network === "mainnet"\)/);
});

test("on mainnet Agent shows (release 10, D57: on an older account it says so in place)", () => {
  const registry = ["wallet", "trade", "agent", "earn"].map((id) => ({ id }));
  assert.deepEqual(appsFor(registry, false, true).map((m) => m.id), ["wallet", "trade", "agent", "earn"]);
  assert.deepEqual(appsFor(registry, true, true).map((m) => m.id), ["wallet", "trade", "agent"]);
  assert.deepEqual(appsFor(registry, false, false).map((m) => m.id), ["wallet", "trade", "agent", "earn"], "testnet keeps it");
});


test("D48: Pay folds into Wallet: its Send opens Wallet's Send, any other Pay screen Wallet's Receive; other apps unchanged", () => {
  assert.deepEqual(foldedInto("pay", "send"), { id: "wallet", tab: "send" });
  for (const tab of ["cash", "receive", "request", undefined]) assert.deepEqual(foldedInto("pay", tab), { id: "wallet", tab: "receive" }, String(tab));
  for (const id of ["wallet", "trade", "security"]) assert.equal(foldedInto(id, "send"), null, id);
});

test("the web wallet (product decision, 4 Nov, no Safe): Wallet, Trade while WEB_TRADE is on, and the Browser (its page: On your phone); and AgentZero (W7, product decision, 5 Nov); never Chat", () => {
  const phone = ["wallet", "trade", "chat", "social", "extension", "browser", "agent", "earn"].map((id) => ({ id }));
  assert.deepEqual(publicApps(phone, false, true, true).map((m) => m.id), ["wallet", "trade", "social", "agent"]);
  assert.deepEqual(publicApps(phone, false, true, false).map((m) => m.id), ["wallet", "social", "agent"], "WEB_TRADE off: no Trade");
  assert.deepEqual(publicApps(phone, false, true).map((m) => m.id), ["wallet", "social", "agent"], "WEB_TRADE is off unless the build sets VITE_WEB_TRADE=1");
  assert.deepEqual([...LIVE_ON_WEB].sort(), ["agent", "social", "trade", "wallet"]);
  // owner: the Browser tab stays, one calm page (On your phone), never the site
  const apps = readFileSync(new URL("./shell/home-apps.tsx", import.meta.url), "utf8");
  assert.match(apps, /render: web \? \(\) => <PhoneTab reason="browser" \/> : /);
  // S17: Social trading is one tab; on the web its list, a site's tap the On your phone page (its code only when shown)
  assert.match(apps, /render: \(\) => <SocialTradingRoot page=\{SOCIAL_TRADING\} web=\{web\}/);
  assert.match(apps, /\.\.\.\(web \? \{\} : \{ preload: \(\) => void socialTrading\.preload\(\) \}\)/);
  assert.match(readFileSync(new URL("../../../packages/browser/src/social/SocialTradingApp.tsx", import.meta.url), "utf8"), /\{web && shownSite && active && <OnYourPhone reason="site" name=\{shownSite\.preset\.name\}/);
  // a way in to an app the web doesn't show (Chat): the same page, never "isn't in this build"
  const host = readFileSync(new URL("./shell/AppHost.tsx", import.meta.url), "utf8");
  assert.match(host, /if \(webWallet\(\) && PHONE_ON_WEB\[id\]\) \{ setPhone\(PHONE_ON_WEB\[id\]!\); return; \}/);
  assert.match(host, /\{phone && <OnYourPhone reason=\{phone\} onClose=\{\(\) => setPhone\(null\)\} \/>\}/);
  assert.deepEqual(PHONE_ON_WEB, { chat: "chat", social: "browser", browser: "browser" }, "Chat gets its own line; AgentZero is on the web (W7)");
  assert.deepEqual(publicApps(phone, false, false, false).map((m) => m.id), ["wallet", "trade", "social", "agent"], "control: the flag is the web's only");
  assert.deepEqual(publicApps(phone, false, false).map((m) => m.id), ["wallet", "trade", "social", "agent"], "control: Real keeps AgentZero");
  assert.deepEqual(publicApps(phone, true, true).map((m) => m.id), ["wallet", "trade", "chat", "social", "agent"], "control: the Sim is whole");
});
