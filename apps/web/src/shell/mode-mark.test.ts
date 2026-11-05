// The mode mark (product decision, 3 Nov): Real shows "Beta · Use dust amounts only." on top, a tap hides the line for a day
// and Beta stays; Sim shows a quiet "Sim", always, and never the dust line. The dust line left the bottom notice slot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BETA_LABEL, COPY_LABEL, DUST_BACK_MS, DUST_HIDDEN_KEY, DUST_LINE, SIM_LABEL, dustHiddenAt, hideDust, modeMark } from "./mode-mark.ts";

const NOW = 1_800_000_000_000;

test("the dust line is in Real only; Sim's mark is Sim", () => {
  assert.deepEqual(modeMark("real", null, NOW), { label: BETA_LABEL, line: DUST_LINE });
  assert.deepEqual(modeMark("sim", null, NOW), { label: SIM_LABEL });
  // control: Sim never shows it, hidden or not
  assert.equal(modeMark("sim", NOW - 2 * DUST_BACK_MS, NOW).line, undefined);
  assert.equal(BETA_LABEL, "Beta");
  assert.equal(DUST_LINE, "Use tiny amounts only.", "the Copywriter (a web test, 4 Nov): never \"dust\", a crypto word");
  assert.equal(SIM_LABEL, "Sim");
});

test("a tap hides the dust line for 24 h; Beta always stays; it comes back after", () => {
  const kv = new Map<string, string>();
  const store = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v) };
  assert.equal(dustHiddenAt(store), null);
  hideDust(NOW, store);
  assert.equal(kv.get(DUST_HIDDEN_KEY), String(NOW));
  assert.deepEqual(modeMark("real", dustHiddenAt(store), NOW + 60_000), { label: BETA_LABEL }, "hidden: Beta alone");
  assert.deepEqual(modeMark("real", dustHiddenAt(store), NOW + DUST_BACK_MS - 1), { label: BETA_LABEL });
  assert.equal(modeMark("real", dustHiddenAt(store), NOW + DUST_BACK_MS).line, DUST_LINE, "a day later: back");
  // control: a time in the future or junk doesn't hide it
  assert.equal(modeMark("real", NOW + 1000, NOW).line, DUST_LINE);
  kv.set(DUST_HIDDEN_KEY, "soon");
  assert.equal(modeMark("real", dustHiddenAt(store), NOW).line, DUST_LINE);
});

test("the line moved from the bottom to the top: AppHost has no dust notice; every page draws the mark for its mode", () => {
  const host = readFileSync(new URL("./AppHost.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(host, /dustNotice|DUST_LINE/);
  const full = readFileSync(new URL("../full-app.tsx", import.meta.url), "utf8");
  assert.match(full, /const MARK: "real" \| "sim" \| "copy" \| null = "refused" in MODE \? null : FORK \? "copy" : MODE\.mainnet \? "real" : page === "demo" \? "sim" : null;/);
  assert.match(full, /\{MARK && <ModeMark mode=\{MARK\} strip=\{STRIP\} \/>\}/);
  // in a browser the app sits under the mark's own strip, never under the mark
  assert.match(full, /\{STRIP \? <div className="zf-under-mark">\{pageNow\}<\/div> : pageNow\}/);
  const mark = readFileSync(new URL("./ModeMark.tsx", import.meta.url), "utf8");
  assert.match(mark, /zf-mode-mark--sim/);
});

test("the mainnet copy (VITE_FORK=1) marks every page \"Copy\", dashed as Sim's; its words exist only in that build", () => {
  const src = readFileSync(new URL("./mode-mark.ts", import.meta.url), "utf8");
  assert.match(src, /export const COPY_LABEL = FORK \? "Copy" : "";/);
  assert.match(src, /export const COPY_NOTE = FORK \? "Copy: pretend money on a copy of the real chains" : "";/);
  // under node the build flag is off: no words, so a release bundle carries none
  assert.equal(COPY_LABEL, "");
  assert.deepEqual(modeMark("copy", null, NOW), { label: COPY_LABEL });
  // control: the copy's mark never shows Real's dust line
  assert.equal(modeMark("copy", null, NOW).line, undefined);
  const mark = readFileSync(new URL("./ModeMark.tsx", import.meta.url), "utf8");
  assert.match(mark, /if \(mode === "copy"\) return <div className=\{`zf-mode-mark zf-mode-mark--sim zf-mode-mark--copy\$\{at\}`\} role="note" aria-label=\{COPY_NOTE\}>/);
});

test("product decision, 4 Nov: the Sim pill carries no link to Real any more (the site's Sim | Real switch replaced it)", () => {
  const src = readFileSync(new URL("./ModeMark.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /toReal|otherMode|zf-mode-mark__go/);
  assert.match(src, /if \(mode === "sim"\) return <div className=\{`zf-mode-mark zf-mode-mark--sim\$\{at\}`\} role="note" aria-label=\{SIM_NOTE\}><b>\{mark\.label\}<\/b><\/div>;/);
  const css = readFileSync(new URL("./mode-mark.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /zf-mode-mark__go/);
  // control: Real's pill keeps its own × (the dust line's hide)
  assert.match(src, /className="zf-mode-mark__x" onClick=\{hide\}/);
});

test("a web test (4 Nov): in a browser the strip takes the status bar once: the pill under it, the app under the pill, --zf-top 0 inside (control: the phone's mark keeps its own --zf-top)", async () => {
  const css = (await import("node:fs")).readFileSync(new URL("./mode-mark.css", import.meta.url), "utf8");
  assert.match(css, /html:has\(\.zf-mode-mark--strip\) \{ --zf-top: 0px; \}/);
  assert.match(css, /\.zf-under-mark \{ position: absolute; inset: calc\(env\(safe-area-inset-top, 0px\) \+ 30px\) 0 0 0; \}/);
  assert.match(css, /\.zf-mode-mark--strip \{ top: calc\(env\(safe-area-inset-top, 0px\) \+ 4px\); \}/);
  assert.match(css, /html:has\(\.zf-mode-mark:not\(\.zf-mode-mark--strip\)\) \{ --zf-top: calc\(env\(safe-area-inset-top, 0px\) \+ 30px\); \}/, "control: the phone");
});

test("a web test (4 Nov): under the site's Sim | Real switch on a phone the status bar is taken once, by the switch; the mark and the app follow it (control: no switch, the strip takes it)", () => {
  const mark = readFileSync(new URL("./mode-mark.css", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app.css", import.meta.url), "utf8");
  const phone = mark.slice(mark.indexOf("@media (max-width: 599.98px)"));
  assert.match(phone, /html\[data-site-switch\] \.zf-under-mark \{ inset: 30px 0 0 0; \}/);
  assert.match(phone, /html\[data-site-switch\] \.zf-mode-mark--strip \{ top: 4px; \}/);
  assert.match(app, /\.zf-site-switch \{ margin: calc\(env\(safe-area-inset-top, 0px\) \+ 6px\) auto 6px; height: 36px; \}/);
  assert.match(app, /html\[data-site-switch\] #root \{ height: calc\(100dvh - 48px - env\(safe-area-inset-top, 0px\)\); \}/);
  assert.match(mark, /\.zf-under-mark \{ position: absolute; inset: calc\(env\(safe-area-inset-top, 0px\) \+ 30px\) 0 0 0; \}/, "control");
});
