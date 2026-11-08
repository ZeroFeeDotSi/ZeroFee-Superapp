// Audit 14 E9 (8 Nov): "light mode renders dark on every AgentZero screen". Found: the auditor's light run set the
// browser's own light/dark setting, which the website and the Sim ignore by the product choice (theme.ts defaultTheme:
// they open black, 4-5 Nov). With the person's pick (Settings → Appearance, zf.theme.picked) AgentZero draws light, and
// every colour on its screens comes from the design tokens (the orb's own colours in az-mark.css are the one exception,
// with a light and a dark set). Shots: sim-crawls/2026-11-08-b16 e9-* (-black and -white). Each check with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const read = (u: URL) => strip(readFileSync(u, "utf8"));
/** A colour written out (hex, rgb/hsl, a named black or white) rather than read from a token. */
const RAW = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|:\s*(?:black|white)\b/;
const AZ_CSS = ["./chat.css", "./jobs.css", "./wallet.css"].map((f) => new URL(f, import.meta.url));
const AGENT_CSS = new URL("../../../../packages/agent/src/app/agent.css", import.meta.url);

test("AgentZero's screens draw every colour from the tokens, so the person's light pick is light there too (control: a raw colour is caught)", () => {
  for (const u of [...AZ_CSS, AGENT_CSS]) {
    const css = read(u);
    for (const rule of css.split("}")) assert.doesNotMatch(rule.replace(/mask-image:[^;]*;/g, ""), RAW, `${u.pathname.split("/").pop()}: ${rule.trim().slice(0, 80)}`);
    assert.doesNotMatch(css, /data-theme|prefers-color-scheme/, "no screen forces its own theme");
  }
  assert.match(".x { color: #000; }", RAW);
  assert.match(".x { background: rgb(0 0 0); }", RAW);
  assert.doesNotMatch(".x { color: var(--ink); background: var(--bg); }", RAW);
});

test("the orb is the one coloured thing, with its own light and dark sets (control: both are written)", () => {
  const mark = read(new URL("./az-mark.css", import.meta.url));
  assert.match(mark, /\.az-mark \{ --az-c1: #[0-9a-f]{6}/, "light set");
  assert.match(mark, /:root\[data-theme="dark"\] \.az-mark \{ --az-c1:/, "dark set");
});

test("the theme follows the person's pick, and only the website's first load is black (control: the browser's own setting isn't read)", () => {
  const theme = readFileSync(new URL("../shell/theme.ts", import.meta.url), "utf8");
  assert.match(theme, /export const THEME_KEY = "zf\.theme\.picked";/);
  assert.match(theme, /const v = localStorage\.getItem\(THEME_KEY\);\n\s*return v === "dark" \|\| v === "light" \? v : defaultTheme\(web\);/);
  assert.doesNotMatch(theme.replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, ""), /prefers-color-scheme|matchMedia/);
});
