// 5 Nov walk: the panel's page opened as a tab sat on its mark, then said "the extension stopped partway". It now knows
// it is a tab, and says so (extension.panel.tab), since the worker answers the side panel only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { forgetPageIsTab, pageIsTab } from "./in-tab.ts";
import { extProblems } from "../problems.ts";

test("a tab of its own is a tab; the side panel (no current tab), no tabs API, or a refusal is not (controls)", async () => {
  forgetPageIsTab();
  assert.equal(await pageIsTab({ getCurrent: async () => ({ id: 7, windowId: 1 }) }), true);
  for (const tabs of [{ getCurrent: async () => undefined }, undefined, { getCurrent: () => Promise.reject(new Error("no")) }]) {
    forgetPageIsTab();
    assert.equal(await pageIsTab(tabs as never), false);
  }
  // asked once per page
  forgetPageIsTab();
  let n = 0;
  const tabs = { getCurrent: async () => (n++, { id: 1 }) };
  await pageIsTab(tabs);
  await pageIsTab(tabs);
  assert.equal(n, 1);
});

test("in a tab, ask() answers the plain Problem before any message; its one step closes the tab", () => {
  const p = extProblems.inTab();
  assert.equal(p.code, "extension.panel.tab");
  // the design lead's final words, pinned
  assert.equal(p.whatHappened, "This panel works beside a trading site, like pump.fun or GMGN.");
  assert.equal(p.more, "Open one of those and it appears there. Nothing moved.");
  assert.deepEqual(p.money, { state: "not-involved" });
  assert.equal(p.next.kind, "nothing");
  assert.equal(p.next.label, "Close this tab");
  const runtime = readFileSync(new URL("./runtime.tsx", import.meta.url), "utf8");
  const ask = runtime.slice(runtime.indexOf("export async function ask"));
  assert.ok(ask.indexOf("pageIsTab()") >= 0 && ask.indexOf("pageIsTab()") < ask.indexOf("sendMessage"), "checked before any message");
  assert.match(readFileSync(new URL("./Panel.tsx", import.meta.url), "utf8"), /extension\.panel\.tab"\) \{ window\.close\(\); return; \}/);
});
