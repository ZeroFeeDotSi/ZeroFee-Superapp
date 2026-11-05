// Background alerts on the phone (the outside study's item 4): the refresh task Info.plist permits is the one Swift
// registers, registration is guarded so a build without the key never crashes, it's registered at launch, and what it
// tells comes only from the core's alerts.poll, under the host's own notification ids. Swift has no test target here,
// so these read the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
const alerts = read("apps/ios/ZeroFee/BackgroundAlerts.swift");
const app = read("apps/ios/ZeroFee/ZeroFeeApp.swift");
const plist = read("apps/ios/Info.plist");

test("Info.plist permits exactly the task Swift registers, with background fetch on", () => {
  const id = /static let taskId = "([^"]+)"/.exec(alerts)?.[1];
  assert.ok(id, "taskId");
  const permitted = /<key>BGTaskSchedulerPermittedIdentifiers<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist)?.[1] ?? "";
  assert.deepEqual([...permitted.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]), [id]);
  const modes = /<key>UIBackgroundModes<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist)?.[1] ?? "";
  assert.deepEqual([...modes.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]), ["fetch"]);
});

test("registered at launch, and only when Info.plist permits it (a build without the key runs as before)", () => {
  assert.match(app, /init\(\) \{[\s\S]*BackgroundAlerts\.register/);
  const register = alerts.slice(alerts.indexOf("static func register("));
  assert.ok(register.indexOf("guard permitted else") >= 0 && register.indexOf("guard permitted else") < register.indexOf("BGTaskScheduler.shared.register"));
});

test("it tells only what the core's alerts.poll returns, under the host's own ids, and asks to tell only once there's an account", () => {
  // audit pass 2, item 2: Swift's own core calls say they are the shell's ("app": "shell"); an unstamped call is refused
  assert.match(alerts, /core\.call\("alerts\.poll", \["app": "shell"\]\)/);
  assert.match(alerts, /identifier: idPrefix \+ id/);
  assert.match(alerts, /static let idPrefix = "zf\.security\.alert\."/);
  assert.match(alerts, /authorizationStatus == \.notDetermined[\s\S]*account\.state[\s\S]*"ready"[\s\S]*requestAuthorization/);
  const calls = [...alerts.matchAll(/core\.call\("([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(calls)].sort(), ["account.state", "alerts.poll"], "it reads; it signs and runs nothing");
});
