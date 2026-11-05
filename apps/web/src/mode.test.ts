import { test } from "node:test";
import assert from "node:assert/strict";
import { MAINNET_REFUSAL, PAIR_SAME_BROWSER, SECOND_DEVICE_SITE, anyCoinOn, appRefusedHere, FIRST_WEB_MODE, WEB_MODES, WEB_MODE_KEY, keepWebMode, pinTabMode, savedWebMode, guardPairing, laptopRefusedHere, networkPrefix, parseMode, secretsVaultName, storeSlot } from "./mode.ts";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";

test("no query: the real app on testnet", () => {
  assert.deepEqual(parseMode(""), { page: "app", mainnet: false });
});

test("the old pages are unchanged, and laptop still wins over demo and screens", () => {
  assert.deepEqual(parseMode("?demo"), { page: "demo", mainnet: false });
  assert.deepEqual(parseMode("?demo&hold=20"), { page: "demo", mainnet: false });
  assert.deepEqual(parseMode("?screens"), { page: "screens", mainnet: false });
  assert.deepEqual(parseMode("?laptop"), { page: "laptop", mainnet: false });
  assert.deepEqual(parseMode("?laptop&demo"), { page: "laptop", mainnet: false });
  assert.deepEqual(parseMode("?demo&screens"), { page: "demo", mainnet: false });
});

test("?mainnet runs the real app, and ?laptop&mainnet the laptop, on mainnet", () => {
  assert.deepEqual(parseMode("?mainnet"), { page: "app", mainnet: true });
  assert.deepEqual(parseMode("?laptop&mainnet"), { page: "laptop", mainnet: true });
  assert.deepEqual(parseMode("?mainnet&laptop"), { page: "laptop", mainnet: true });
});

test("?mainnet with ?demo or ?screens is refused, in any order and with anything else", () => {
  for (const q of ["?mainnet&demo", "?demo&mainnet", "?mainnet&screens", "?screens&mainnet", "?mainnet&demo&hold=20", "?laptop&mainnet&demo", "?mainnet&demo&screens"]) {
    assert.deepEqual(parseMode(q), { refused: MAINNET_REFUSAL }, q);
  }
  assert.equal(MAINNET_REFUSAL, "Mainnet runs only the real app.");
});

test("a testnet key and a mainnet key never collide; testnet names are unchanged", () => {
  assert.equal(storeSlot("pay", "contacts", false), "zf.pay.contacts");
  assert.equal(storeSlot("pay", "contacts", true), "mainnet:zf.pay.contacts");
  assert.equal(secretsVaultName(false), "zerofee-device-secrets");
  assert.equal(secretsVaultName(true), "mainnet:zerofee-device-secrets");
  // Both pages in one browser write the same app and key into one localStorage: two entries, not one.
  const storage = new Map<string, string>();
  storage.set(storeSlot("pay", "contacts", false), "testnet contacts");
  storage.set(storeSlot("pay", "contacts", true), "mainnet contacts");
  assert.equal(storage.size, 2);
  assert.equal(storage.get(storeSlot("pay", "contacts", false)), "testnet contacts");
  // Security's local activity follows the same rule, and no testnet name can equal a mainnet one (keys start "zf.").
  assert.notEqual(storeSlot("security", "activity", false), storeSlot("security", "activity", true));
  assert.ok(!networkPrefix(false) && networkPrefix(true) === "mainnet:");
});

test("D157: the public build is the Sim only, whatever the address or a kept choice says; never mainnet", () => {
  for (const kept of ["sim", "real"] as const) {
    for (const q of ["", "?mainnet", "?testnet", "?laptop", "?screens", "?all", "?demo", "?mainnet&demo"]) {
      assert.deepEqual(parseMode(q, true, false, "/", kept), { page: "demo", mainnet: false }, `${kept} ${q}`);
    }
    assert.deepEqual(parseMode("", true, false, "/laptop", kept), { page: "demo", mainnet: false });
    assert.equal(anyCoinOn("", true, false, kept), true);
  }
  // control: not the public build, as before (the kept choice changes nothing there)
  assert.deepEqual(parseMode("", false, false, "/", "real"), { page: "app", mainnet: false });
  assert.deepEqual(parseMode("?mainnet", false, false, "/", "sim"), { page: "app", mainnet: true });
  assert.equal(WEB_MODES, false, "no Sim | Real switch anywhere");
});

test("the kept mode: a first visit is Sim; only \"sim\" or \"real\" counts; a broken store is Sim", () => {
  const kv = new Map<string, string>();
  const store = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v) };
  assert.equal(FIRST_WEB_MODE, "sim");
  assert.equal(savedWebMode(store), "sim");
  keepWebMode("real", store);
  assert.equal(kv.get(WEB_MODE_KEY), "real");
  assert.equal(savedWebMode(store), "real");
  keepWebMode("sim", store);
  assert.equal(savedWebMode(store), "sim");
  // control: anything else kept is a first visit, and a store that throws is too
  kv.set(WEB_MODE_KEY, "mainnet");
  assert.equal(savedWebMode(store), "sim");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(savedWebMode(broken), "sim");
  assert.doesNotThrow(() => keepWebMode("real", broken));
  assert.equal(savedWebMode(null), "sim");
});

test("a parameter that only contains the word is not the flag", () => {
  assert.deepEqual(parseMode("?x=mainnet"), { page: "app", mainnet: false });
  assert.deepEqual(parseMode("?mainnets"), { page: "app", mainnet: false });
});

test("ANY_COIN_START: off in the real app, on in the sample pages, and on by hand with ?anycoin", () => {
  assert.equal(anyCoinOn(""), false);
  assert.equal(anyCoinOn("?mainnet"), false);
  assert.equal(anyCoinOn("?laptop"), false);
  assert.equal(anyCoinOn("?demo"), true);
  assert.equal(anyCoinOn("?screens"), true);
  assert.equal(anyCoinOn("?mainnet&anycoin"), false, "never on mainnet (W-2)");
  assert.equal(anyCoinOn("?anycoin&mainnet"), false);
  assert.equal(anyCoinOn("?anycoins"), false);
  assert.equal(anyCoinOn("?x=anycoin"), false);
  assert.equal(anyCoinOn("?x=demo"), false);
});

test("the second-device build is the laptop page on mainnet, whatever the address asks for (H13)", () => {
  for (const q of ["", "?demo", "?screens", "?laptop", "?mainnet&demo", "?anycoin", "?all", "?testnet"]) {
    assert.deepEqual(parseMode(q, false, true), { page: "laptop", mainnet: true }, q);
    assert.equal(anyCoinOn(q, false, true), false, q);
  }
  // and the other builds are unchanged by it
  assert.deepEqual(parseMode("?laptop", true, false, "/", "real"), { page: "demo", mainnet: false });
});

test("D54: the real app serves the laptop page at /laptop; its public address is its own origin, laptop.zerofee.si", () => {
  assert.equal(SECOND_DEVICE_SITE, "laptop.zerofee.si", "QA's ruling, 5 Nov: its own origin; never zerofee.si (the website's) or superapp.zerofee.si (the Sim)");
  for (const path of ["/laptop", "/laptop/"]) {
    assert.deepEqual(parseMode("", false, false, path), { page: "laptop", mainnet: false }, path);
    assert.deepEqual(parseMode("?mainnet", false, false, path), { page: "laptop", mainnet: true }, path);
  }
  for (const path of ["/", "/laptops", "/x/laptop", "/index.html"]) assert.deepEqual(parseMode("", false, false, path), { page: "app", mainnet: false }, path);
  // the address's old form still works; the public build has no laptop page
  assert.deepEqual(parseMode("?laptop", false, false, "/"), { page: "laptop", mainnet: false });
});

test("D54: a browser is never its own account's second device: while it holds a laptop key, the app here pairs nothing", async () => {
  const asked: string[] = [];
  const core: Bridge = { call: async <T,>(method: string) => (asked.push(method), { ok: { status: "done" } } as BridgeResult<T>), on: () => () => {} };
  let names: string[] | null = ["zerofee-laptop-mainnet", "zerofee-mainnet-vault"];
  const guarded = guardPairing(core, async () => names, true);
  const refused = await guarded.call("account.secondDevice.pair", { qr: "ZFL1:ABC" });
  assert.ok("problem" in refused);
  assert.equal(refused.problem.code, "shell.pair.same-browser");
  assert.equal(refused.problem.whatHappened, PAIR_SAME_BROWSER);
  assert.equal(refused.problem.money.state, "safe");
  assert.ok("problem" in (await guarded.call("account.secondDevice.pair", { qr: "ZFL1:ABC", kind: "guardian" })), "any kind");
  assert.deepEqual(asked, [], "the core was never asked");
  assert.ok("ok" in (await guarded.call("account.state")), "everything else goes through");
  names = ["zerofee-mainnet-vault", "zerofee-laptop"]; // a testnet laptop isn't this network's
  assert.ok("ok" in (await guarded.call("account.secondDevice.pair", { qr: "ZFL1:ABC" })));
  names = null; // can't list: the laptop page made no key here (it refuses where it can't tell)
  assert.ok("ok" in (await guarded.call("account.secondDevice.pair", { qr: "ZFL1:ABC" })));
  assert.deepEqual(asked, ["account.state", "account.secondDevice.pair", "account.secondDevice.pair"]);
});

test("a Sim tab's reload stays in the Sim when another tab switched to Real (a web test, the lock on reload); control: a new tab follows the switch", () => {
  const kv = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  const browser = kv(), tabA = kv(), tabB = kv();
  // tab A opens on a first visit: Sim, kept as its own
  pinTabMode(savedWebMode(browser, tabA), tabA);
  assert.equal(savedWebMode(browser, tabA), "sim");
  // tab B opens, then taps Real (the web wallet)
  pinTabMode(savedWebMode(browser, tabB), tabB);
  keepWebMode("web", browser, tabB);
  assert.equal(savedWebMode(browser, tabB), "web");
  // tab A reloads: still the Sim, never the web wallet's lock
  assert.equal(savedWebMode(browser, tabA), "sim");
  assert.deepEqual(parseMode("", true, false, "/", savedWebMode(browser, tabA)), { page: "demo", mainnet: false });
  // control: a new tab follows the browser's choice, and so would tab A without its own (the bug)
  assert.equal(savedWebMode(browser, kv()), "web");
  assert.deepEqual(parseMode("", true, false, "/", savedWebMode(browser, null)), { page: "app", mainnet: true });
  // a tab switching back keeps its own choice too
  keepWebMode("sim", browser, tabB);
  assert.equal(savedWebMode(browser, tabB), "sim");
});
