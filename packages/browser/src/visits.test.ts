import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { addVisit, clearHistory, loadHistory, openSite, recentOf } from "./visits.ts";

function device(has: { openSite?: boolean; openUrl?: boolean } = {}) {
  const store = new Map<string, string>();
  const calls: [string, Record<string, unknown>][] = [];
  const no = { problem: { code: "device.refused", whatHappened: "No.", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } };
  const bridge: Bridge = {
    async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      calls.push([method, p]);
      if (method === "device.store.get") return { ok: { value: store.get(String(p.key)) ?? null } as T };
      if (method === "device.store.set") {
        if (p.value === null) store.delete(String(p.key));
        else store.set(String(p.key), String(p.value));
        return { ok: { ok: true } as T };
      }
      if (method === "device.openSite") return (has.openSite ? { ok: { ok: true } } : no) as BridgeResult<T>;
      if (method === "device.openUrl") return (has.openUrl ? { ok: { ok: true } } : no) as BridgeResult<T>;
      return no as BridgeResult<T>;
    },
    on: () => () => {},
  };
  return { bridge, calls, store };
}

test("history: one row per host, newest first, kept on the device, and cleared in one tap", async () => {
  const d = device();
  await addVisit(d.bridge, "https://pump.fun/", new Date("2026-10-26T01:00:00Z"));
  await addVisit(d.bridge, "https://fomo.family/", new Date("2026-10-26T02:00:00Z"));
  await addVisit(d.bridge, "https://pump.fun/coin/x", new Date("2026-10-26T03:00:00Z"));
  assert.deepEqual((await loadHistory(d.bridge)).map((v) => [v.host, v.atIso]), [
    ["pump.fun", "2026-10-26T03:00:00.000Z"],
    ["fomo.family", "2026-10-26T02:00:00.000Z"],
  ]);
  await clearHistory(d.bridge);
  assert.deepEqual(await loadHistory(d.bridge), []);
  d.store.set("history", "{broken");
  assert.deepEqual(await loadHistory(d.bridge), []);
});

test("a site opens in ZeroFee's own window where there is one, and in the plain browser sheet where there isn't", async () => {
  const phone = device({ openSite: true });
  assert.deepEqual(await openSite(phone.bridge, "https://fomo.family/", true), { opened: "wallet" });
  assert.deepEqual(phone.calls[0], ["device.openSite", { url: "https://fomo.family/", desktop: true }]);
  const web = device({ openUrl: true });
  assert.deepEqual(await openSite(web.bridge, "https://pump.fun/"), { opened: "plain" });
  assert.deepEqual(web.calls.at(-1), ["device.openUrl", { url: "https://pump.fun/", mode: "sheet" }]);
  const blocked = device();
  assert.equal("problem" in (await openSite(blocked.bridge, "https://pump.fun/")), true);
});

test("D131: eight pages open and none may close: the phone's 'Close a page first.' is the answer, never a plain window instead (control: another refusal still falls back)", async () => {
  const calls: string[] = [];
  const full = { call: async (m: string) => (calls.push(m), m === "device.openSite" ? { problem: { code: "partner.tabs.full", whatHappened: "Close a page first.", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } } : { ok: { ok: true } }), on: () => () => {} } as never;
  const r = await openSite(full, "https://example.com/");
  assert.ok("problem" in r && r.problem.whatHappened === "Close a page first.");
  assert.deepEqual(calls, ["device.openSite"]);
  const other = await openSite(device({ openUrl: true }).bridge, "https://example.com/");
  assert.deepEqual(other, { opened: "plain" });
});

test("product decision, 3 Nov: recent pages beside pump.fun and GMGN: the newest sites opened, never a listed site's or a favourite's host (each has its own tile), at most 4", () => {
  const v = (host: string, i: number) => ({ host, url: `https://${host}/`, atIso: new Date(Date.UTC(2026, 10, 3, 12, 60 - i)).toISOString() });
  const history = ["pump.fun", "dexscreener.com", "gmgn.ai", "x.com", "kim.example", "news.example", "old.example"].map(v);
  assert.deepEqual(recentOf(history, ["pump.fun", "gmgn.ai", "x.com"]).map((r) => r.host), ["dexscreener.com", "kim.example", "news.example", "old.example"]);
  assert.deepEqual(recentOf(history, []).map((r) => r.host).length, 4, "at most 4 (control: nothing skipped)");
  assert.deepEqual(recentOf([], ["pump.fun"]), [], "nothing opened yet: no row");
});
