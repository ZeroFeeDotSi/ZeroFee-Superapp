// wallet.css names each @keyframes once (3 Nov: wl-rise and wl-shimmer were defined twice, and the later silently won).
// Control: a planted second definition is caught.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const twice = (css: string): string[] => {
  const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]!);
  return [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
};

test("each @keyframes in wallet.css is defined once; wl-rise and wl-shimmer keep the look Home was walked with", () => {
  const css = readFileSync(new URL("./wallet.css", import.meta.url), "utf8");
  assert.deepEqual(twice(css), []);
  assert.match(css, /@keyframes wl-rise \{ from \{ opacity: 0; transform: translateY\(8px\); \} \}/);
  assert.match(css, /@keyframes wl-shimmer \{ to \{ transform: translateX\(100%\); \} \}/);
});

test("control: a second definition of one name is caught", () => {
  assert.deepEqual(twice("@keyframes a { to { opacity: 1; } }\n@keyframes b {}\n@keyframes a { to { opacity: 0; } }"), ["a"]);
});

test("Phantom's shape: a Home sheet's action (wl-sheet-go, a direct child of the Sheet's content) is pinned to the bottom", () => {
  const css = readFileSync(new URL("./wallet.css", import.meta.url), "utf8");
  assert.match(css, /\.zf-sheet__content:has\(> \.wl-sheet-go\) \{ display: flex; flex-direction: column; \}/);
  assert.match(css, /\.zf-sheet__content > \.wl-sheet-go:not\(\.wl-sheet-go ~ \.wl-sheet-go\) \{ margin-top: auto; position: sticky; bottom: 0;/);
  // each Home sheet's action carries the class the rule pins (control: a sheet whose button lost it would float mid-screen)
  // Add (D138) has no single action: each wallet row copies on tap and opens its QR, so nothing is pinned there.

  for (const f of ["money/SwapSheet.tsx", "screens/MoveSheet.tsx", "money/RequestSheet.tsx"]) {
    assert.match(readFileSync(new URL(`./${f}`, import.meta.url), "utf8"), /className=\{?[`"]zf-btn wl-sheet-go/, f);
  }
});

test("Phantom's shape on Send: the Send button (one tap, no hold) stands on the form's floor under the one scroll box, its form filling the sheet (a16: a floor, no sticky)", () => {
  const css = readFileSync(new URL("./money/send.css", import.meta.url), "utf8");
  assert.match(css, /\.zf-sheet__content:has\(> \.wl-send\) > \.wl-send \{ flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; \}/);
  // product decision, 5 Nov (we are zero fee): the line under the button is the floor's last child; the floor never scrolls, so nothing is sticky
  assert.match(css, /\.wl-send2__floor \{ position: relative; flex: none; display: flex; flex-direction: column;/);
  assert.match(css, /\.wl-send2__floor > \.wl-zerofee \{ box-sizing: border-box; min-height: 52px; margin: 0; padding: 8px 0; \}/);
  assert.doesNotMatch(css, /position: sticky/, "control: no sticky left in Send");
  // control: the hold, then only its line, end the form, and the form sits in Send's box (else the rules pin nothing)
  const form = readFileSync(new URL("./money/SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /<button type="button" className="zf-btn wl-hold" disabled=\{!ready\} onClick=\{go\} data-testid="send-go">\{label\}<\/button>\}\n\s*\{\/\*[^\n]*\*\/\}\n\s*<p className="zf-small wl-zerofee"[^\n]*<\/p>\n\s*<\/div>\n\s*<\/div>\n\s*\);\n\}/);
  assert.match(form, /<div className="wl-send2__floor">/, "the button and its line stand on the floor");
  assert.equal((form.match(/className="zf-btn wl-hold"/g) ?? []).length, 3, "control: Swap first and Move back take the pinned place too");
  assert.match(readFileSync(new URL("./money/SendSheet.tsx", import.meta.url), "utf8"), /<div className="wl-send">[\s\S]{0,200}<SendForm /);
});

test("Send's picker pill never styles a row: send.css's .wl-pick rules are scoped to :not(.wl-row) (REVAMP audit, 3 Nov: Home's rows drew as grey pills once the sheets preloaded)", () => {
  const css = readFileSync(new URL("./money/send.css", import.meta.url), "utf8");
  const unscoped = (text: string): string[] => [...text.matchAll(/(?:^|[,}\n])\s*(\.wl-pick(?![\w-]|:not\(\.wl-row\))[^{,]*)\{/g)].map((m) => m[1]!.trim()).filter((sel) => !/^\.wl-pick\[aria-expanded/.test(sel));
  assert.deepEqual(unscoped(css), []);
  // control: the old rule is caught
  assert.deepEqual(unscoped(".wl-pick { display: inline-flex; }\n.wl-pick b { font-weight: 500; }"), [".wl-pick", ".wl-pick b"]);
});

test("REVAMP P0 (phone test, 3 Nov: text under the pinned Moving…): a pinned action carries a solid band of the ground above, beside and below it, and a quiet, disabled or busy pinned action is never see-through (control: the old rule had none)", () => {
  const css = readFileSync(new URL("./wallet.css", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../../../design/src/ui.css", import.meta.url), "utf8");
  const pin = /\.zf-sheet__content > \.wl-sheet-go:not\(\.wl-sheet-go ~ \.wl-sheet-go\) \{ --pin-band: 0 -24px 0 0 var\(--bg\), 0 48px 0 var\(--gutter, 28px\) var\(--bg\); box-shadow: var\(--pin-band\); \}/;
  assert.match(css, pin);
  // R3: below the action the band reaches the screen's foot (48 + the gutter covers the safe area's 34 + 28 of padding):
  // a card scrolled under the floor never peeks out beneath the button (control: 24 left 10 pt of it showing)
  assert.doesNotMatch(css, /--pin-band: 0 -24px 0 0 var\(--bg\), 0 24px 0 var\(--gutter, 28px\) var\(--bg\);/);
  // the button system (the design review §2.1): B2's soft fill and a disabled B1's 30 % ink, each mixed into the ground (solid)
  assert.match(css, /\.wl-sheet-go\.zf-btn--quiet:not\(\.wl-sheet-go ~ \.wl-sheet-go\) \{ background: color-mix\(in srgb, var\(--ink\) 6%, var\(--bg\)\); box-shadow: var\(--pin-band\); \}/, "quiet: solid, never see-through");
  assert.match(css, /\.wl-sheet-go:disabled:not\(\.is-busy\):not\(\.zf-btn--quiet\):not\(\.wl-sheet-go ~ \.wl-sheet-go\) { background: var\(--fill\); color: var\(--mute\); opacity: 1; box-shadow: var\(--pin-band\), inset 0 0 0 1px var\(--line\); }/, "disabled: the one shared off style (look 4): --fill, --mute label, hairline ring, solid band");
  assert.match(css, /\.wl-sheet-go\.is-busy:not\(\.wl-sheet-go ~ \.wl-sheet-go\) \{ box-shadow: var\(--pin-band\); \}/, "busy: the band too");
  assert.match(ui, /\.zf-btn\.is-busy, \.zf-btn\.is-busy:disabled \{[^}]*background: var\(--ink\);/, "busy stays the ink pill, never the grey outline");
  assert.match(css, /\.zf-sheet__content > :has\(\+ \.wl-sheet-go:not\(\.wl-sheet-go ~ \.wl-sheet-go\)\) \{ margin-bottom: 32px; \}/, "the last line before it clears the band at the end of a scroll");
  // control: the rule as it was pinned nothing around the action
  assert.doesNotMatch(".zf-sheet__content > .wl-sheet-go:not(.wl-sheet-go ~ .wl-sheet-go) { margin-top: auto; position: sticky; bottom: 0; z-index: 1; }", pin);
});
