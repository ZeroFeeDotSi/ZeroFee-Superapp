// D118: "Social trading" is renamed the Browser tab (label only: app id "social", routes and storage keys stay), and the
// old Browser app's page never shows, so there are never two "Browser" pages; an old link to it lands on the Browser tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_STORE_NAME, SOCIAL_HUB_NAME } from "@zerofee/core/app-store";
import { foldedInto } from "./shown-apps.ts";
import { readFileSync } from "node:fs";

test("the tab is called Browser, its id stays social", () => {
  assert.equal(APP_STORE_NAME, "Browser");
  assert.equal(SOCIAL_HUB_NAME, "Browser");
  const app = readFileSync(new URL("../../../packages/browser/src/social/SocialApp.tsx", import.meta.url), "utf8");
  assert.match(app, /export const socialApp: AppModule = \{ id: "social", name: APP_STORE_NAME,/);
});

test("never two Browser pages: hostApps skips the old browser app's page; control: without the skip it would be there", () => {
  const src = readFileSync(new URL("./shell/home-apps.tsx", import.meta.url), "utf8");
  assert.match(src, /if \(m\.id === "browser"\) continue;/);
  const without = src.replace(/if \(m\.id === "browser"\) continue;/, "");
  assert.doesNotMatch(without, /if \(m\.id === "browser"\) continue;/, "control: the skip is the one line that hides it");
});

test("an old link to the Browser app lands on the Browser tab (the fold), as Pay folds into Wallet; control: another app doesn't fold", () => {
  assert.deepEqual(foldedInto("browser", "sites"), { id: "social", tab: "sites" });
  assert.deepEqual(foldedInto("pay", "send"), { id: "wallet", tab: "send" });
  assert.equal(foldedInto("trade", "x"), null);
});
