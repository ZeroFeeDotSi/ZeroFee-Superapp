import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BridgeResult } from "@zerofee/core/bridge";
import type { IosHost } from "./ios.ts";
import { lastUsedWords, loginsClient, siteName } from "./logins.ts";

function phone(answer: unknown) {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const host: IosHost = {
    async call<T>(method: string, params?: Record<string, unknown>) {
      calls.push({ method, params });
      return answer as BridgeResult<T>;
    },
    on: () => () => {},
  };
  return { host, calls };
}

test("in a browser there is no Keychain: no client (Settings says 'On the phone only.')", () => {
  assert.equal(loginsClient(null), null);
});

test("each Passwords action is one host call with the id only; no app id, and never a password", async () => {
  const { host, calls } = phone({ ok: {} });
  const c = loginsClient(host)!;
  await c.list();
  await c.reveal("A1");
  await c.copy("A1");
  await c.add("app.mtpelerin.com");
  await c.remove("A1");
  assert.deepEqual(calls, [
    { method: "logins.list", params: {} },
    { method: "logins.reveal", params: { id: "A1" } },
    { method: "logins.copy", params: { id: "A1" } },
    { method: "logins.add", params: { host: "app.mtpelerin.com" } },
    { method: "logins.remove", params: { id: "A1" } },
  ]);
  for (const call of calls) for (const k of Object.keys(call.params ?? {})) assert.ok(!["app", "caller", "password", "value"].includes(k));
});

test("Add takes a website's name only; anything else never reaches the phone", async () => {
  const { host, calls } = phone({ ok: { id: "X" } });
  const r = await loginsClient(host)!.add("not a site");
  assert.ok("problem" in r);
  assert.equal(calls.length, 0);
  assert.equal(siteName("https://App.MtPelerin.com/login?x=1"), "app.mtpelerin.com");
  assert.equal(siteName("app.example.com"), "app.example.com");
  assert.equal(siteName("localhost"), "");
  assert.equal(siteName("*.example.com"), "");
});

test("the phone's logins.unavailable Problem comes back as is (the Simulator has no secure chip)", async () => {
  const problem = { code: "logins.unavailable", whatHappened: "x", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } };
  const { host } = phone({ problem });
  assert.deepEqual(await loginsClient(host)!.list(), { problem });
});

test("last used, in words", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  assert.equal(lastUsedWords({ lastUsedIso: null }, now), "Never used");
  assert.equal(lastUsedWords({ lastUsedIso: "2026-10-26T09:00:00Z" }, now), "Used today");
  assert.equal(lastUsedWords({ lastUsedIso: "2026-10-25T09:00:00Z" }, now), "Used yesterday");
  assert.equal(lastUsedWords({ lastUsedIso: "2026-10-16T12:00:00Z" }, now), "Used 10 days ago");
});

test("Settings → Passwords: the row opens the screen on the phone, says 'On the phone only.' in a browser", () => {
  const src = readFileSync(new URL("../shell/SettingsPanel.tsx", import.meta.url), "utf8");
  assert.match(src, /logins = loginsClient\(iosHost\(\)\)/);
  assert.match(src, /setPasswordsOnIphone\(true\)/, "the copy review's #7 (7 Nov): a browser's row opens its On iPhone page");
  assert.match(src, /<PasswordsScreen client=\{logins\}/);
});

test("Settings → Sites: Browser's connected sites, read as Browser through the shell's bridge, and the app passes that bridge", () => {
  const src = readFileSync(new URL("../shell/SettingsPanel.tsx", import.meta.url), "utf8");
  assert.match(src, /const browser = useMemo\(\(\) => \(bridge \? forApps\(bridge, "browser"\)/);
  assert.match(src, /<ConnectedSiteRows bridge=\{browser\} \/>/);
  assert.match(readFileSync(new URL("../App.tsx", import.meta.url), "utf8"), /<SettingsPanel accountId=\{view\.account\.accountId\} bridge=\{shellBridge\}/);
});
