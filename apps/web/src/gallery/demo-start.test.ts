import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_ACCOUNT_KEY, DEMO_SETUP_KEY, DEMO_STATE_KEY, DEMO_WALLETS_KEY, demoAccountId, demoKeep, demoStart, forgetDemoSetup, keepDemoSetup, type Kept } from "./demo-start.ts";

const memory = (): Kept & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};
const blocked: Kept = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("SecurityError"); },
  removeItem: () => { throw new Error("SecurityError"); },
};

test("a first-time visitor starts at Welcome, the first set-up screen (never a recovery screen)", () => {
  assert.deepEqual(demoStart(memory()), { at: "welcome" });
  assert.deepEqual(demoStart(null), { at: "welcome" });
});

test("a visitor who finished set-up here opens on Home, with the wait they chose", () => {
  const s = memory();
  keepDemoSetup(259_200, s);
  assert.deepEqual(demoStart(s), { at: "home", delaySeconds: 259_200 });
});

test("start over: the next screen is Welcome again", () => {
  const s = memory();
  keepDemoSetup(172_800, s);
  forgetDemoSetup(s);
  assert.deepEqual(demoStart(s), { at: "welcome" });
});

test("blocked storage never breaks the demo: it starts at Welcome and keeping or forgetting does nothing", () => {
  assert.doesNotThrow(() => keepDemoSetup(172_800, blocked));
  assert.doesNotThrow(() => forgetDemoSetup(blocked));
  assert.deepEqual(demoStart(blocked), { at: "welcome" });
});

test("anything kept that isn't a finished set-up with an offered wait is a first visit", () => {
  for (const raw of ["", "garbage", "{}", JSON.stringify({ delaySeconds: 60 }), JSON.stringify({ delaySeconds: "172800x" }), "null"]) {
    const s = memory();
    s.data.set(DEMO_SETUP_KEY, raw);
    assert.deepEqual(demoStart(s), { at: "welcome" }, raw);
  }
});

test("grade 30 Oct item 7: the session is kept for a returning visitor, dropped on a first visit, and Start over stops every later save", () => {
  const s = memory();
  keepDemoSetup(172_800, s);
  const k = demoKeep(s);
  k.storage.setItem(DEMO_STATE_KEY, "{\"v\":1}");
  assert.equal(demoKeep(s).storage.getItem(DEMO_STATE_KEY), "{\"v\":1}", "a reload reads it back");
  k.forget();
  assert.equal(s.data.get(DEMO_STATE_KEY), undefined);
  k.storage.setItem(DEMO_STATE_KEY, "{\"v\":1}");
  assert.equal(s.data.get(DEMO_STATE_KEY), undefined, "the page's last save on its way out can't put it back");
  // a first visit (no set-up kept) never opens on an older session's sends
  const t = memory();
  t.data.set(DEMO_STATE_KEY, "old");
  t.data.set(DEMO_WALLETS_KEY, "old");
  demoKeep(t);
  assert.equal(t.data.size, 0);
});

test("grade 30 Oct item 7: blocked storage never throws from the kept session", () => {
  const k = demoKeep(blocked);
  assert.doesNotThrow(() => k.storage.setItem(DEMO_STATE_KEY, "x"));
  assert.equal(k.storage.getItem(DEMO_STATE_KEY), null);
  assert.doesNotThrow(() => k.forget());
  assert.doesNotThrow(() => demoKeep(null).storage.setItem("a", "b"));
});

test("J3 C1: each browser's demo is its own sample account, kept, so two demo windows are two people (one pays the other)", () => {
  const ava = memory();
  const ben = memory();
  const a = demoAccountId(ava, () => 0.123456);
  const b = demoAccountId(ben, () => 0.654321);
  assert.equal(a, "zf-sample123456.testnet");
  assert.equal(b, "zf-sample654321.testnet");
  assert.equal(demoAccountId(ava, () => 0.9), a, "kept: the same name after a reload");
  assert.equal(ava.data.get(DEMO_ACCOUNT_KEY), a);
  ava.data.set(DEMO_ACCOUNT_KEY, "zf-sample000001.testnet; alert(1)");
  assert.equal(demoAccountId(ava, () => 0.5), "zf-sample500000.testnet", "a damaged one is replaced");
  assert.match(demoAccountId(blocked, () => 0.25), /^zf-sample250000\.testnet$/, "blocked storage still gives a name");
});
