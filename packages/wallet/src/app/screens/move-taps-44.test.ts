// the audit's way-home audit P7 (7 Nov): two Move taps under 44 px: the typed figure on each wallet row (.wl-mv-type, 17/22 px
// text and 1 px padding: about 24 px) and the "Leave SOL as it is" chip (.zf-chip, 32 px). Fails on main for the field.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../money/move-swap.css", import.meta.url), "utf8");
const ui = readFileSync(new URL("../../../../design/src/ui.css", import.meta.url), "utf8");
const px = (rule: string, prop: string) => Number(new RegExp(`${prop}: (-?\\d+)px`).exec(rule)?.[1] ?? NaN);

test("P7: the typed figure's tap is 44 px, grown upward only: the text and its hairline stay where they were", () => {
  const rule = /\.wl-mv-row \.wl-mv-type \{[^}]*\}/.exec(css)![0];
  assert.match(rule, /box-sizing: border-box; min-height: 44px;/);
  const pad = /padding: (\d+)px 0 (\d+)px/.exec(rule)!;
  const line = 22, border = 1;
  assert.equal(Number(pad[1]) + line + Number(pad[2]) + border, 44, "20 + 22 + 1 + 1");
  assert.equal(px(rule, "margin-top"), -Number(pad[1]), "the padding over the text is given back: the row's layout is the same");
  assert.match(css, /\.wl-mv-row__h:has\(\.wl-mv-type\) \{ min-height: 44px; \}/, "the room is the row's own");
  // control: the focus line is still the hairline (home-root's a-nav-5)
  assert.match(css, /\.wl-mv-row \.wl-mv-type:focus \{ outline: none; box-shadow: none; border-bottom: 1px solid var\(--ink\); \}/);
});

test("P7: the Leave chip's tap is 44 px: a 32 px chip with 6 px of target above and below (.zf-chip::before), positioned", () => {
  const chip = /\.zf-chip \{[^}]*\}/.exec(ui)![0];
  assert.equal(px(chip, "height"), 32);
  assert.match(chip, /position: relative;/);
  assert.match(ui, /\.zf-chip::before \{ content: ""; position: absolute; inset: -6px 0; \}/, "32 + 6 + 6 = 44");
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /<button type="button" className="zf-chip" data-testid="move-leave"/);
});
