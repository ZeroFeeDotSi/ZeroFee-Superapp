// The relay hunt's B1 (5 Nov): email alerts answered 503 forever, after the person had typed an email and signed a proof.
// Now their store is its own database (ALERTS_STORE_URL / ALERTS_STORE_TOKEN, never the shared one), /v0/health says
// alerts "on" only when the door works end to end, and the app shows the email row only then.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-ignore: plain JS
import { APP_ORIGINS, createRelay } from "./relay.mjs";
// @ts-ignore: plain JS
import { createAlerts, memoryStore, redisDbOf, sharesRedis } from "./alerts.mjs";

test("the audit's SHOULD: the alerts' store is shared when it reaches the shared database (host, port, db index), whatever the credentials; a URL that can't be read counts as shared", () => {
  // the same host, port and db with different passwords: shared
  assert.equal(sharesRedis("redis://default:pw-one@db.example:6379/2", "redis://default:pw-two@db.example:6379/2"), true);
  assert.equal(sharesRedis("rediss://user:a@DB.example/0", "rediss://db.example:6379"), true, "default port and db, host case");
  assert.equal(sharesRedis("https://x:y@kv.upstash.test:443/", "https://kv.upstash.test"), true, "REST: the same database by another credential string");
  // a different db index, host or port: its own store
  assert.equal(sharesRedis("redis://default:pw@db.example:6379/3", "redis://default:pw@db.example:6379/2"), false);
  assert.equal(sharesRedis("https://alerts.upstash.test", "https://kv.upstash.test"), false);
  assert.equal(sharesRedis("redis://db.example:6380/0", "redis://db.example:6379/0"), false);
  // fail safe: a bad URL on either side is shared
  for (const bad of ["not a url", "", "redis://db.example:6379/zero", "mailto:x@db.example"]) {
    assert.equal(sharesRedis(bad, "https://kv.upstash.test"), true, `alerts URL ${JSON.stringify(bad)}`);
    assert.equal(sharesRedis("https://alerts.upstash.test", bad === "" ? "%%" : bad), true, `shared URL ${JSON.stringify(bad)}`);
  }
  // no shared store at all: nothing to share with (control: the same URL against itself is shared)
  assert.equal(sharesRedis("https://alerts.upstash.test", undefined), false);
  assert.equal(sharesRedis("https://alerts.upstash.test", "https://alerts.upstash.test"), true);
  assert.equal(redisDbOf("redis://u:secret@Db.Example:6379/02"), "db.example:6379/2", "credentials never kept");
});

const working = () => createAlerts({ store: memoryStore(), mail: { send: async () => undefined }, base: "https://relay.example", cronSecret: "c" });
async function healthOf(alerts: unknown, alertsStoreShared: boolean) {
  const relay = createRelay({ key: "k".repeat(24), secret: "s", origins: APP_ORIGINS, alerts, alertsStoreShared, fetchFn: async () => new Response("{}", { status: 200 }) });
  const r = await relay(new Request("https://relay.example/v0/health"), "203.0.113.7");
  return (await r.json()).alerts;
}

test("/v0/health: alerts on only with every part set and their own store; control: shared store, no sender, none", async () => {
  assert.equal(working().on, true);
  assert.equal(await healthOf(working(), false), "on");
  assert.equal(await healthOf(working(), true), "off", "their store would be the shared one");
  assert.equal(await healthOf(createAlerts({ store: memoryStore(), mail: null, base: "https://relay.example", cronSecret: "c" }), false), "off", "no sender");
  assert.equal(await healthOf(undefined, false), "off");
});

test("the deploy entry: the alerts store is ALERTS_STORE_*, never the shared one; the app's email row waits for the relay's yes", () => {
  const entry = readFileSync(new URL("./api/relay.mjs", import.meta.url), "utf8");
  assert.match(entry, /const alertsStore = env\.ALERTS_STORE_URL && env\.ALERTS_STORE_TOKEN \?/);
  assert.match(entry, /const alertsStoreShared = !alertsStore \|\| sharesRedis\(alertsStore\.url, redis\?\.url\);/);
  assert.match(entry, /store: alertsStore && !alertsStoreShared \? redisStore\(alertsStore\) : null/);
  const app = readFileSync(new URL("../web/src/apps/security/SecurityApp.tsx", import.meta.url), "utf8");
  assert.match(app, /\{!actions\.noEmail && emailOn && <More label="Email alerts"/);
  assert.match(app, /call<\{ on: boolean \}>\("account\.alertsEmail\.available"\)/);
  const core = readFileSync(new URL("../../packages/core/src/demo-core.ts", import.meta.url), "utf8");
  assert.match(core, /return \{ on: body\?\.alerts === "on" \};/);
});
