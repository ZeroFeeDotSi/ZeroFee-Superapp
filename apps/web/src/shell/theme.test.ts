// Product decision, 4 Nov: the public website (Sim and the real-money web wallet) opens black; the phone app keeps light; a pick wins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const m = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
const { THEME_KEY, defaultTheme, savedTheme } = await import("./theme.ts");

test("the public website opens dark and the phone app light, until the person picks (the pick wins either way)", () => {
  m.clear();
  assert.equal(defaultTheme(true), "dark");
  assert.equal(defaultTheme(false), "light");
  assert.equal(savedTheme(true), "dark");
  assert.equal(savedTheme(false), "light");
  // the old key, written by every first load before 4 Nov, is no pick: the website still opens dark
  m.set("zf.theme", "light");
  assert.equal(savedTheme(true), "dark");
  m.set(THEME_KEY, "light");
  assert.equal(savedTheme(true), "light", "a pick of light stays light");
  m.set(THEME_KEY, "dark");
  assert.equal(savedTheme(false), "dark", "a pick of dark on the phone stays dark");
});

test("a load draws the theme but keeps nothing; only Settings keeps a pick", () => {
  const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
  assert.match(main, /applyTheme\(savedTheme\(\), false\);/);
  const settings = readFileSync(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
  assert.match(settings, /applyTheme\(t\);/);
});

test("no pick: Black on the website and in the Sim whatever the browser prefers; the code never reads prefers-color-scheme (product decision, 5 Nov)", () => {
  m.clear();
  const src = readFileSync(new URL("./theme.ts", import.meta.url), "utf8");
  assert.match(src, /web: boolean = WEB_MODES \|\| SIM\): Theme => \(web \? "dark" : "light"\)/, "the Sim counts as the website");
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""), /prefers-color-scheme|matchMedia/);
  (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false });
  assert.equal(savedTheme(true), "dark", "a browser set to light still opens Black");
  m.set(THEME_KEY, "light");
  assert.equal(savedTheme(true), "light", "control: a pick of White is kept");
});
