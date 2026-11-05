// Apps (app id "social", once the ZeroFee App Store) opens its apps the way the Browser does (device.openSite, wallet mode with the Browser wallet),
// and nothing more: the engine's own device calls stay the Browser's.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BridgeResult } from "@zerofee/core/bridge";
import { PRESETS } from "@zerofee/browser/presets";
import { CATALOG } from "@zerofee/browser/social/catalog.ts";
import { iosDevice, type IosHost } from "./ios.ts";
import { siteRecipe, withRecipe } from "./partner.ts";

for (const { id } of CATALOG) {
  const preset = PRESETS.find((p) => p.id === id)!;
  const host = preset.hosts[0]!;
  test(`${preset.name}: opened from Apps, it gets wallet mode with the Browser wallet on its own hosts and chains`, () => {
    const r = siteRecipe(host);
    assert.deepEqual([r.modes, r.walletKind, r.hosts, r.chains], [["wallet"], "browser", [...preset.hosts], [...preset.chains]]);
    const p = withRecipe("device.openSite", { app: "social", url: preset.url, desktop: !!preset.desktop }, false);
    assert.deepEqual(p.recipe, r);
    assert.equal(withRecipe("device.openSite", { app: "trade", url: preset.url }, false).recipe, undefined, "another app's open is plain");
    assert.equal(withRecipe("device.openSite", { app: "social", url: preset.url }, true).recipe, undefined, "never on a child's phone");
  });
}

test("on the phone, Social trading may open a site, and may not answer for the wallet engine", async () => {
  const sent: string[] = [];
  const host: IosHost = { call: async <T,>(m: string) => (sent.push(m), { ok: { ok: true } } as BridgeResult<T>), on: () => () => {} };
  const device = iosDevice(host, new Set(["social", "browser", "trade"]), () => false);
  assert.ok("ok" in (await device.call("device.openSite", { app: "social", url: "https://pump.fun/" })));
  for (const m of ["device.wallet.reply", "device.wallet.emit", "device.wallet.askConnect", "device.wallet.forget"]) {
    const r = await device.call(m, { app: "social" });
    assert.ok("problem" in r, m);
  }
  assert.ok("problem" in (await device.call("device.openSite", { app: "trade", url: "https://pump.fun/" })), "other apps still can't");
  assert.deepEqual(sent, ["device.openSite"]);
});
