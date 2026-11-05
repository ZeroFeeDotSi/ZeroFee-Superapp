// Sim's storage is its own (product decision, 3 Nov: a sim balance can never be shown in Real or the reverse): in Sim every key
// lives under "sim:" (but the theme, the mode choice, the layout and the sample's own zf.demo.* keys), Real's keys keep
// their names, and the old public demo's keys move under "sim:" once, never where a real account may live.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LAYOUT_KEY, SIM_PREFIX, adoptOldDemo, installSimStorage, simKey, simStorage } from "./sim-storage.ts";
import { WEB_MODE_KEY } from "./mode.ts";

/** A Storage as the browser's is. */
function memory(seed: Record<string, string> = {}): Storage & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    clear: () => map.clear(),
  };
}

test("Sim writes and reads only under sim:; Real's keys are never touched; the shared ones are one", () => {
  const base = memory({ "zf.tasks": "real tasks", "mainnet:zf.wallet.home": "real home", "zf.theme": "dark" });
  const sim = simStorage(base);
  // Sim can't see Real's
  assert.equal(sim.getItem("zf.tasks"), null);
  assert.equal(sim.getItem("mainnet:zf.wallet.home"), null);
  sim.setItem("zf.tasks", "sample tasks");
  sim.setItem("zf.wallet.home", "$1,234 sample");
  assert.equal(base.getItem("zf.tasks"), "real tasks", "Real's own key is unchanged");
  assert.equal(base.getItem(`${SIM_PREFIX}zf.tasks`), "sample tasks");
  assert.equal(base.getItem("zf.wallet.home"), null, "a sim figure never lands under a name Real reads");
  assert.equal(sim.getItem("zf.tasks"), "sample tasks");
  sim.removeItem("zf.tasks");
  assert.equal(base.getItem("zf.tasks"), "real tasks");
  // control: the shared keys are the same key in both (the theme, the mode, the sample's own)
  assert.equal(sim.getItem("zf.theme"), "dark");
  sim.setItem(WEB_MODE_KEY, "real");
  assert.equal(base.getItem(WEB_MODE_KEY), "real");
  sim.setItem("zf.demo.setup", "{}");
  assert.equal(base.getItem("zf.demo.setup"), "{}");
  assert.equal(simKey("zf.theme"), "zf.theme");
  assert.equal(simKey("zf.tasks"), "sim:zf.tasks");
  // key()/length list Sim's view; clear() drops Sim's own keys only
  assert.deepEqual(new Set(Array.from({ length: sim.length }, (_, i) => sim.key(i))), new Set(["zf.theme", WEB_MODE_KEY, "zf.demo.setup", "zf.wallet.home"]));
  sim.clear();
  assert.equal(base.getItem("sim:zf.wallet.home"), null);
  assert.equal(base.getItem("zf.tasks"), "real tasks");
  assert.equal(base.getItem("mainnet:zf.wallet.home"), "real home");
  assert.equal(base.getItem("zf.theme"), "dark");
});

test("installSimStorage swaps the page's localStorage and sessionStorage before any app code; Real (not installed) sees the old names", () => {
  const local = memory(), session = memory();
  const g = { localStorage: local, sessionStorage: session } as unknown as typeof globalThis;
  assert.equal(installSimStorage(g), true);
  g.localStorage.setItem("zf.tray", "[]");
  g.sessionStorage.setItem("zf.demo.keep", "x");
  g.sessionStorage.setItem("move", "1");
  assert.equal(local.getItem("sim:zf.tray"), "[]");
  assert.equal(local.getItem("zf.tray"), null);
  assert.equal(session.getItem("sim:move"), "1");
  // control: without the swap (Real) the same write is under its own name
  const realLocal = memory();
  realLocal.setItem("zf.tray", "[]");
  assert.equal(realLocal.getItem("zf.tray"), "[]");
  // a browser that won't let it swap: false, and the caller doesn't start Sim (fail closed)
  const frozen = Object.freeze({ localStorage: memory(), sessionStorage: memory() }) as unknown as typeof globalThis;
  assert.equal(installSimStorage(frozen), false);
});

test("the old public demo's keys move under sim: once; never where a real account may live", () => {
  const old = memory({ "zf.tasks": "sample", "zf.hub": "[]", "zf.theme": "dark", "zf.demo.setup": "{}" });
  assert.equal(adoptOldDemo(old, false), "moved");
  assert.equal(old.getItem("zf.tasks"), null);
  assert.equal(old.getItem("sim:zf.tasks"), "sample");
  assert.equal(old.getItem("sim:zf.hub"), "[]");
  assert.equal(old.getItem("zf.theme"), "dark", "shared keys stay");
  assert.equal(old.getItem("zf.demo.setup"), "{}", "the sample's own keys are Sim's by name");
  assert.equal(old.getItem(LAYOUT_KEY), "1");
  // once: a later Real key keeps its name
  old.setItem("zf.tasks", "real");
  assert.equal(adoptOldDemo(old, false), "done");
  assert.equal(old.getItem("zf.tasks"), "real");
  // control: a mainnet key here, or a real vault (or can't tell), and nothing moves
  const real = memory({ "zf.tasks": "real", "mainnet:zf.wallet.x": "1" });
  assert.equal(adoptOldDemo(real, false), "kept");
  assert.equal(real.getItem("zf.tasks"), "real");
  const vault = memory({ "zf.tasks": "real" });
  assert.equal(adoptOldDemo(vault, true), "kept");
  assert.equal(vault.getItem("zf.tasks"), "real");
  assert.equal(vault.getItem(LAYOUT_KEY), "1");
});
