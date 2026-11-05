import { test } from "node:test";
import assert from "node:assert/strict";
import type { BridgeResult } from "@zerofee/core/bridge";
import { RECIPES } from "@zerofee/pay/partners/recipes";
import { iosDevice, type IosHost } from "./ios.ts";
import { HOST_RECIPES, hostRecipe, partnerService, SITE_PILL, withRecipe } from "./partner.ts";

const apps = new Set(["pay", "browser", "wallet"]);

function phone() {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const host: IosHost = {
    async call<T>(method: string, params?: Record<string, unknown>) {
      calls.push({ method, params });
      return { ok: { ok: true } } as BridgeResult<T>;
    },
    on: () => () => {},
  };
  return { host, calls };
}

test("Pay's recipes compile into the host's shape: exact hosts, modes, the wallet and chains, slots, login, commit words", () => {
  const mt = HOST_RECIPES.get("mt-pelerin")!;
  assert.deepEqual(mt.hosts, ["app.mtpelerin.com"]);
  assert.deepEqual(mt.modes, ["wallet", "robot"]);
  assert.equal(mt.walletKind, "browser");
  assert.deepEqual(mt.login, { host: "app.mtpelerin.com", create: true });
  assert.ok(mt.slots.includes("{{login.password}}") && mt.slots.includes("{{login.new}}") && mt.slots.includes("{{profile.email}}"));
  const gp = HOST_RECIPES.get("gnosis-pay")!;
  // §F: the card's window uses the card's own "pay" wallet, never Browser's.
  assert.equal(gp.walletKind, "pay");
  assert.deepEqual(gp.chains, ["gnosis"]);
  assert.equal(gp.login, undefined);
  assert.ok(!gp.slots.some((s) => s.startsWith("{{login.")));
  for (const r of RECIPES) for (const h of hostRecipe(r).hosts) assert.match(h, /^[a-z0-9.-]+$/, "no wildcards, ports or paths");
});

test("device.openUrl: a recipe id becomes the compiled recipe; an object an app made up is dropped", async () => {
  const { host, calls } = phone();
  const device = iosDevice(host, apps, () => false);
  await device.call("device.openUrl", { app: "pay", url: "https://app.mtpelerin.com/", mode: "sheet", recipe: "mt-pelerin" });
  await device.call("device.openUrl", { app: "pay", url: "https://app.mtpelerin.com/", mode: "sheet", recipe: { partner: "x", hosts: ["evil.example"], modes: ["robot"] } });
  assert.deepEqual(calls[0]!.params!.recipe, HOST_RECIPES.get("mt-pelerin"));
  assert.equal(calls[0]!.params!.kid, false);
  assert.equal("recipe" in calls[1]!.params!, false);
});

test("a recipe that doesn't cover the page it opens, or an unknown id, means the plain window", () => {
  assert.equal("recipe" in withRecipe("device.openUrl", { url: "https://evil.example/", recipe: "mt-pelerin" }, false), false);
  assert.equal("recipe" in withRecipe("device.openUrl", { url: "https://app.mtpelerin.com/", recipe: "nobody" }, false), false);
  assert.equal("recipe" in withRecipe("device.openUrl", { url: "http://app.mtpelerin.com/", recipe: "mt-pelerin" }, false), false);
});

test("never on a child's phone: no recipe, and the host is told it's a child's", async () => {
  const { host, calls } = phone();
  await iosDevice(host, apps, () => true).call("device.openUrl", { app: "pay", url: "https://app.gnosispay.com/", mode: "sheet", recipe: "gnosis-pay" });
  assert.equal("recipe" in calls[0]!.params!, false);
  assert.equal(calls[0]!.params!.kid, true);
});

test("device.openSite (Browser): wallet mode only, the Browser wallet only, never the robot; other apps can't use it", async () => {
  const { host, calls } = phone();
  const device = iosDevice(host, apps, () => false);
  await device.call("device.openSite", { app: "browser", url: "https://app.gnosispay.com/" });
  const gp = calls[0]!.params!.recipe as { modes: string[]; walletKind: string; chains: string[]; slots: string[]; login?: unknown };
  assert.deepEqual([gp.modes, gp.walletKind, gp.chains, gp.slots, gp.login], [["wallet"], "browser", ["gnosis"], [], undefined], "never the card's pay wallet through openSite");
  // A site the person typed: one host, the Browser wallet's own chains, nothing else.
  await device.call("device.openSite", { app: "browser", url: "https://example.com/", desktop: true });
  assert.deepEqual(calls[1]!.params!.recipe, { partner: "site", hosts: ["example.com"], chains: ["eth", "base", "arb", "gnosis", "sol"], modes: ["wallet"], walletKind: "browser", slots: [], commitButtons: [] });
  assert.equal(calls[1]!.params!.desktop, true);
  // A preset: its own hosts and chains.
  assert.deepEqual(withRecipe("device.openSite", { app: "browser", url: "https://fomo.family/" }, false).recipe, { partner: "fomo", hosts: ["fomo.family"], chains: ["sol", "base"], modes: ["wallet"], walletKind: "browser", slots: [], commitButtons: [] });
  // Pay's openUrl never gets a typed site's recipe.
  assert.equal("recipe" in withRecipe("device.openUrl", { app: "pay", url: "https://example.com/", recipe: "site" }, false), false);
  const refused = await device.call("device.openSite", { app: "pay", url: "https://app.gnosispay.com/" });
  assert.ok("problem" in refused);
  // The refusal names who can open sites (Apps and Browser), not Browser alone.
  assert.equal(refused.problem.whatHappened.startsWith("Only Apps and Browser can open sites."), true, refused.problem.whatHappened);
  for (const m of ["device.wallet.reply", "device.wallet.emit", "device.wallet.askConnect", "device.wallet.forget"]) {
    const r = await device.call(m, { app: "wallet", id: "w1", host: "example.com" });
    assert.ok("problem" in r && r.problem.whatHappened.startsWith("Only Browser can do that."), m);
  }
  assert.equal(calls.length, 2);
  // fomo's own app (nativeApp) from the Browser goes to the host, which accepts fomo.family alone (PartnerApp).
  await device.call("device.openSite", { app: "browser", url: "https://fomo.family/", nativeApp: true });
  assert.equal(calls[2]!.params!.nativeApp, true);
  assert.equal(calls[2]!.params!.app, "browser");
});

test("partner.* goes to the phone as asked; in a browser it's a plain Problem", async () => {
  const { host, calls } = phone();
  await partnerService(host).call("partner.act", { kind: "click", id: "e3", caller: "pay" });
  assert.deepEqual(calls, [{ method: "partner.act", params: { kind: "click", id: "e3", caller: "pay" } }]);
  const r = await partnerService(null).call("partner.snapshot", {});
  assert.ok("problem" in r && r.problem.code === "partner.unavailable");
  const odd = await partnerService(host).call("partner.navigate", { url: "https://evil.example" });
  assert.ok("problem" in odd);
  assert.equal(calls.length, 1);
});

test("ST2: a site window's wallet pill passes only from Social trading, only for a preset, only as dollars and cents", () => {
  const pill = (app: string, url: string, value: unknown) => withRecipe("device.openSite", { app, url, pill: value }, false).pill;
  assert.equal(pill("social", "https://pump.fun/", "$2.91"), "$2.91");
  assert.equal(pill("social", "https://gmgn.ai/", "$1,204.50"), "$1,204.50");
  for (const bad of ["$2.9", "2.91", "$2.91 ", "Free money", "$-1.00", "$1,20.00", "$9999.00", "<b>$1.00</b>", "$1,000,000,000.00", 2.91]) assert.equal(pill("social", "https://pump.fun/", bad), undefined, String(bad));
  assert.equal(pill("browser", "https://pump.fun/", "$2.91"), undefined, "the Browser's windows have no pill");
  assert.equal(pill("social", "https://example.com/", "$2.91"), undefined, "a typed site has no pill");
  assert.equal(SITE_PILL.test("$12.00"), true);
});
