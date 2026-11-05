// The Browser's fomo on the phone (fomo is not in Apps, D47): the host opens fomo's own app (or its App Store page), never a window.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forApps, type Bridge, type BridgeResult } from "@zerofee/core/bridge";
import { FOMO_URL, openFomoApp } from "./fomo-app.ts";

function phone(answer: BridgeResult<unknown>) {
  const calls: [string, Record<string, unknown>][] = [];
  const bridge: Bridge = {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      calls.push([method, params]);
      return answer as BridgeResult<T>;
    },
    on: () => () => {},
  };
  return { bridge, calls };
}

test("asks the host for fomo's own app: fomo.family only, no desktop window, no Fund bar", async () => {
  const p = phone({ ok: { opened: "app" } });
  assert.deepEqual(await openFomoApp(p.bridge), { opened: "app" });
  assert.deepEqual(p.calls, [["device.openSite", { url: FOMO_URL, nativeApp: true }]]);
  assert.equal(new URL(FOMO_URL).host, "fomo.family");
});

test("not installed: the App Store page opened, and that is what the screen says", async () => {
  assert.deepEqual(await openFomoApp(phone({ ok: { opened: "store" } }).bridge), { opened: "store" });
});

test("neither opened, or the host refused: the plain Problem with Try again", async () => {
  for (const answer of [{ ok: { opened: "none" } }, { problem: { code: "shell.device.refused", whatHappened: "No.", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } }] as BridgeResult<unknown>[]) {
    const r = await openFomoApp(phone(answer).bridge);
    assert.ok("problem" in r);
    assert.equal(r.problem.code, "browser.social.app-didnt-open");
    assert.equal(r.problem.next.kind, "retry");
  }
});

test("an older phone app that opened its own window instead is not called a failure", async () => {
  assert.deepEqual(await openFomoApp(phone({ ok: { ok: true } }).bridge), { opened: "window" });
});

test("no app can pose as Social trading or Browser: forApps stamps the real app id last", async () => {
  for (const real of ["trade", "pay", "agent", "wallet"] as const) {
    const p = phone({ ok: { opened: "app" } });
    await forApps(p.bridge, real).call("device.openSite", { url: FOMO_URL, nativeApp: true, app: "social" });
    await forApps(p.bridge, real).call("device.openSite", { url: FOMO_URL, nativeApp: true, app: "browser" });
    assert.deepEqual(p.calls.map(([, params]) => params.app), [real, real], `${real} can't claim another app`);
  }
});

test("the Browser's fomo (preset, typed or history) opens fomo's own app on the phone, never a window", () => {
  const src = readFileSync(new URL("../app/BrowserApp.tsx", import.meta.url), "utf8");
  assert.match(src, /if \(preset\?\.ownApp && hasPhoneHost\(\)\) \{\n\s*const r = await openFomoApp\(shell\.bridge\);/);
});
