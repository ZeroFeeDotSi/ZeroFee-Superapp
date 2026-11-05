import { test } from "node:test";
import assert from "node:assert/strict";
import { FRESH, chooseMoney, choosePrivate, finish, later, loadSetup, nextStep, saveSetup, start } from "./setup.ts";
import { readFileSync } from "node:fs";

// a web test, 4 Nov (item 6): Welcome came back after a Retry and after each unlock. Shown once: the saved copy says so.
test("set-up: Welcome shown once stays off; started, it goes on; control: never shown, it shows", () => {
  assert.equal(nextStep(FRESH, false), "welcome", "control");
  assert.equal(nextStep({ ...FRESH, shown: true }, false), "off");
  assert.equal(nextStep({ ...start(FRESH), shown: true }, false), "money", "Set up now was tapped: the journey goes on");
  const app = readFileSync(new URL("./WalletApp.tsx", import.meta.url), "utf8");
  const fx = app.slice(app.indexOf("const setupChecked = useRef(false);"), app.indexOf("const setupTo ="));
  // asked for (a wallet just made): never waits on a balance read
  assert.ok(fx.indexOf("const forced =") < fx.indexOf("if (!forced && (balances === null || balanceProblem)) return;"));
  assert.match(fx, /if \(!state\.started\) void saveSetup\(bridge, \{ \.\.\.state, shown: true \}\);/);
  assert.doesNotMatch(fx, /if \(setupChecked\.current \|\| balances === null \|\| balanceProblem\) return;/, "control: the old wait on the read is gone");
});
import { fakeCore } from "../testing/replay.ts";

test("first open with an empty balance: Welcome, Add money, You're set, then never again", () => {
  assert.equal(nextStep(FRESH, false), "welcome");
  const going = start(FRESH);
  assert.equal(nextStep(going, false), "money");
  for (const way of ["receive", "pay-cash", "skipped"] as const) assert.equal(nextStep(chooseMoney(going, way), false), "set");
  const done = finish(chooseMoney(going, "receive"));
  assert.equal(nextStep(done, false), "off");
  assert.equal(nextStep(done, true), "off");
});

test("money already in the balance means no journey; once started, it finishes even if money lands meanwhile", () => {
  assert.equal(nextStep(FRESH, true), "off");
  assert.equal(nextStep(start(FRESH), true), "money", "money arriving mid-way doesn't drop the person out of a step");
  assert.equal(nextStep(chooseMoney(start(FRESH), "receive"), true), "set");
});

test("Later on Welcome opens Balance and the journey doesn't come back", () => {
  assert.equal(nextStep(later(FRESH), false), "off");
  assert.equal(nextStep(start(later(FRESH)), false), "money", "Set up now after all still works");
});

test("kept on the phone, only which step is done; anything unreadable is a fresh start", async () => {
  const core = fakeCore();
  assert.deepEqual(await loadSetup(core), FRESH);
  const s = chooseMoney(start(FRESH), "pay-cash");
  await saveSetup(core, s);
  assert.deepEqual(await loadSetup(core), s);
  assert.deepEqual(JSON.parse(core.store.get("setup.v1")!), { v: 1, started: true, later: false, money: "pay-cash" });
  core.store.set("setup.v1", "{not json");
  assert.deepEqual(await loadSetup(core), FRESH);
  core.store.set("setup.v1", JSON.stringify({ v: 2, started: true }));
  assert.deepEqual(await loadSetup(core), FRESH);
  assert.deepEqual(await loadSetup(fakeCore({ noStore: true })), FRESH, "no device storage: a fresh start, never a crash");
});

test("where this phone can use Private, it's step 2, after Add money, and either way You're set follows", () => {
  const money = chooseMoney(start(FRESH), "receive");
  assert.equal(nextStep(money, false, true), "private");
  assert.equal(nextStep(money, false, false), "set", "not offered where Private can't be used (D13)");
  assert.equal(nextStep(choosePrivate(money, "set"), false, true), "set");
  assert.equal(nextStep(choosePrivate(money, "skipped"), false, true), "set");
  assert.equal(nextStep(start(FRESH), false, true), "money", "Add money first");
});
