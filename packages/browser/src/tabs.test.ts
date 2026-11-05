// D131 open pages: the phone's answer read strictly, show and close through the bridge, nothing on the web.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { OPEN_PAGES, closePage, pagesOf, readPages, showPage } from "./tabs.ts";

const ID = "6F9619FF-8B86-D011-B42D-00C04FC964FF", ID2 = "7F9619FF-8B86-D011-B42D-00C04FC964FF";
const page = (o: Record<string, unknown> = {}) => ({ id: ID, host: "pump.fun", title: "pump.fun", private: true, ...o });

test("the phone's open pages are read strictly: a bad id or host is left out; a blank title shows the host (controls pass)", () => {
  assert.deepEqual(pagesOf({ tabs: [page()] }), [{ id: ID, host: "pump.fun", title: "pump.fun", private: true }]);
  assert.deepEqual(pagesOf({ tabs: [page({ title: "  " })] })[0]!.title, "pump.fun");
  assert.equal(pagesOf({ tabs: [page({ title: "x".repeat(200) })] })[0]!.title.length, 60);
  assert.deepEqual(pagesOf({ tabs: [page({ id: "1; drop" }), page({ host: "evil.com/path?q=1" }), page({ host: "<b>x</b>" }), null, 7] }), []);
  assert.deepEqual(pagesOf({ tabs: [page({ private: "yes" })] })[0]!.private, false, "only true is private");
  assert.deepEqual(pagesOf(null), []);
  assert.deepEqual(pagesOf({ tabs: "no" }), []);
});

test("show and close go through partner.showTab / partner.closeTab; on the web (no phone) there are no pages", async () => {
  const calls: [string, unknown][] = [];
  const phone = { call: async (m: string, p: unknown) => (calls.push([m, p]), m === "partner.tabs" || m === "partner.closeTab" ? { ok: { tabs: [page({ id: ID2 })] } } : { ok: { tabs: [] } }), on: () => () => {} } as unknown as Bridge;
  assert.equal((await readPages(phone)).length, 1);
  assert.equal(await showPage(phone, ID), true);
  assert.deepEqual(await closePage(phone, ID, [{ id: ID, host: "a.b", title: "a", private: true }]), [{ id: ID2, host: "pump.fun", title: "pump.fun", private: true }]);
  assert.deepEqual(calls.map((c) => c[0]), ["partner.tabs", "partner.showTab", "partner.closeTab"]);
  const web = { call: async () => ({ problem: { code: "partner.unavailable" } }), on: () => () => {} } as unknown as Bridge;
  assert.deepEqual(await readPages(web), []);
  assert.equal(await showPage(web, ID), false);
  assert.deepEqual(await closePage(web, ID, [{ id: ID, host: "a.b", title: "a", private: true }]), [], "the page leaves the strip even if the phone didn't say");
  assert.equal(OPEN_PAGES.close("pump.fun"), "Close pump.fun");
});
