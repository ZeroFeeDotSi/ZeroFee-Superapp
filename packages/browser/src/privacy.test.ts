// D131: the Privacy screen's reads and changes, through a fake phone: the web has no private browsing; a build without
// Tor says so; a malformed answer is never read as "on"; only an exact host is sent; Clear site data's three answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { clearSiteData, PRIVACY, readPrivacy, setBlockTrackers, setNormalSite, setPrivate, viewOf } from "./privacy.ts";

const problem = (code: string, whatHappened = "No.") => ({ problem: { code, whatHappened, money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } }) as BridgeResult<never>;
function phone(answer: (method: string, p: Record<string, unknown>) => BridgeResult<unknown>) {
  const calls: { method: string; p: Record<string, unknown> }[] = [];
  const bridge = { call: async (method: string, p: Record<string, unknown> = {}) => (calls.push({ method, p }), answer(method, p)), on: () => () => {} } as unknown as Bridge;
  return { bridge, calls };
}

test("the phone's setting is read as it is; the web has none; a build without Tor says so", async () => {
  const on = phone(() => ({ ok: { private: true, normalSites: ["pump.fun", "gmgn.ai"], built: true } }));
  assert.deepEqual(await readPrivacy(on.bridge, true), { kind: "phone", private: true, normalSites: ["gmgn.ai", "pump.fun"], built: true });
  assert.deepEqual(on.calls, [{ method: "partner.privacy", p: {} }]);
  assert.deepEqual(await readPrivacy(phone(() => problem("partner.unavailable")).bridge, true), { kind: "web" });
  assert.deepEqual(await readPrivacy(phone(() => ({ ok: { private: true, normalSites: [], built: false } })).bridge, true), { kind: "phone", private: true, normalSites: [], built: false });
  // off the iPhone: the web, whatever a bridge answers (the web demo's own bridge answers partner.* with its own Problem)
  const web = phone(() => ({ ok: { private: true, normalSites: [], built: true } }));
  assert.deepEqual(await readPrivacy(web.bridge, false), { kind: "web" });
  assert.equal(web.calls.length, 0, "nothing asked off the iPhone");
  assert.equal(PRIVACY.rowLine({ kind: "phone", private: true, normalSites: [], built: false }), "Trackers, history and site data");
  assert.equal(PRIVACY.rowLine({ kind: "phone", private: false, normalSites: [], built: true }), "Private browsing is off");
  assert.equal(PRIVACY.rowLine({ kind: "web" }), "History");
});

test("a malformed answer, or one from an older phone, is never read as private browsing on", () => {
  for (const bad of [{ ok: null }, { ok: { private: "yes", built: true } }, { ok: { private: true } }, problem("partner.act.unknown")] as const) {
    const v = viewOf(bad as never);
    assert.ok(v.kind === "phone" && v.built === false, JSON.stringify(bad));
  }
  // a site name that isn't an exact host is dropped from the list
  const v = viewOf({ ok: { private: true, built: true, normalSites: ["pump.fun", "evil.com/x", "", 7, "Bad Host", "pump.fun"] } });
  assert.deepEqual(v, { kind: "phone", private: true, normalSites: ["pump.fun"], built: true });
});

test("changes: on/off as asked; a site back to private by its exact host only (control: a bad host sends nothing)", async () => {
  const p = phone((m, q) => ({ ok: { private: m === "partner.setPrivate" ? q.on : true, normalSites: [], built: true } }));
  assert.equal(((await setPrivate(p.bridge, false)) as { private: boolean }).private, false);
  assert.deepEqual(p.calls.at(-1), { method: "partner.setPrivate", p: { on: false } });
  await setNormalSite(p.bridge, "pump.fun", false);
  assert.deepEqual(p.calls.at(-1), { method: "partner.setNormalSite", p: { host: "pump.fun", normal: false } });
  const before = p.calls.length;
  assert.equal(await setNormalSite(p.bridge, "pump.fun/../x", false), null);
  assert.equal(p.calls.length, before, "nothing sent for a host that isn't one");
});

test("Clear site data: cleared, kept (the phone's own alert said Keep), or the phone's reason", async () => {
  assert.equal(await clearSiteData(phone(() => ({ ok: { cleared: true } })).bridge), PRIVACY.dataCleared);
  assert.equal(await clearSiteData(phone(() => ({ ok: { cleared: false } })).bridge), null);
  assert.equal(await clearSiteData(phone(() => problem("partner.forget.open", "Close the open site first, then clear.")).bridge), "Close the open site first, then clear.");
});

test("the words: the off sheet says what changes, plainly", () => {
  assert.equal(PRIVACY.offTitle, "Turn off private browsing?");
  assert.equal(PRIVACY.offLine, "Sites will see your phone's address.");
  assert.deepEqual([PRIVACY.offYes, PRIVACY.offNo], ["Turn off", "Keep it on"]);
});

test("Block trackers (D131): read from the phone, changed by its own call; an older phone that doesn't say shows no switch (control)", async () => {
  const p = phone((method, q) => ({ ok: { private: true, normalSites: [], built: false, blockTrackers: method === "partner.setBlockTrackers" ? q.on : true } }));
  const v = await readPrivacy(p.bridge, true);
  assert.ok(v.kind === "phone" && v.blockTrackers === true);
  const off = await setBlockTrackers(p.bridge, false);
  assert.ok(off.kind === "phone" && off.blockTrackers === false);
  assert.deepEqual(p.calls.at(-1), { method: "partner.setBlockTrackers", p: { on: false } });
  const old = viewOf({ ok: { private: true, normalSites: [], built: true } });
  assert.ok(old.kind === "phone" && !("blockTrackers" in old), "no field: no switch");
  assert.ok(old.kind === "phone" && !("blockTrackers" in viewOf({ ok: { private: true, normalSites: [], built: true, blockTrackers: "yes" } })), "not a yes/no: no switch");
  assert.equal(PRIVACY.trackersCredit, "Tracker list by the EasyList authors (CC BY-SA 4.0).");
});
