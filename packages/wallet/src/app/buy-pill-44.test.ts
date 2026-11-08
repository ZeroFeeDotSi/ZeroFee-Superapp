// Audit 10's A3 (8 Nov): Home's Safe card "Buy" pill measured 52 × 32 pt (its 44 pt tap was an ::after the tap check
// can't see). Now the button itself is 44 pt tall, its 6 over and under taken back by negative margins (the row keeps its
// height), and the same 32 pt ink pill is drawn on its words. Each rule has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./wallet.css", import.meta.url), "utf8");
/** The last block for an exact selector. */
const last = (sel: string): string => [...css.matchAll(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&")} \\{([^}]*)\\}`, "g"))].at(-1)?.[1] ?? "";

test("A3: the Buy button is a 44 pt box itself; the pill keeps its look on its words (controls: the old pill drew 32 on the button; no hidden hit box left)", () => {
  const button = last(".wl-buy"), pill = last(".wl-buy > span");
  assert.match(button, /min-height: 44px/);
  assert.match(button, /margin-top: -6px; margin-bottom: -6px;/, "the row keeps its height");
  assert.match(button, /background: none/, "the button draws nothing itself");
  for (const look of ["min-height: 32px", "padding: 0 14px", "border-radius: 16px", "background: var(--ink)", "color: var(--bg)"]) assert.ok(pill.includes(look), `same look: ${look}`);
  assert.doesNotMatch(css, /\.wl-buy::after/, "no pseudo hit box any more");
  const first = [...css.matchAll(/(?:^|\n)\.wl-buy \{([^}]*)\}/g)][0]![1]!;
  assert.match(first, /min-height: 32px/, "control: the first rule (the old pill) drew 32");
  const home = readFileSync(new URL("./screens/Home.tsx", import.meta.url), "utf8");
  assert.match(home, /className="wl-buy" data-testid="safe-buy"[\s\S]{0,80}?\}\}><span>\{HOME_WORDS\.buy\}<\/span><\/button>/, "the words sit in the span the pill is drawn on");
});
