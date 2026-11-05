// R3 (the design review §4.9, §2.3 G1): every row of the account menu leads with its own line icon, one family, drawn
// in CSS so Home's first load carries no SVG for it. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const here = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const ROWS: Record<string, string> = { Protection: "shield", Devices: "phone", Recovery: "words", Activity: "clock", Details: "code", Settings: "dials" };

test("each of the menu's six rows names its icon, a different one per row (control: the Statement row in Activity has none)", () => {
  const src = here("../WalletApp.tsx") + here("../../../../../apps/web/src/apps/security/SecurityApp.tsx");
  for (const [title, icon] of Object.entries(ROWS)) assert.match(src, new RegExp(`<NavRow title="${title}"[^>]*\\bicon="${icon}"`), title);
  assert.equal(new Set(Object.values(ROWS)).size, 6, "one icon per row");
  assert.doesNotMatch(here("./Activity.tsx"), /<NavRow title="Statement"[^>]*\bicon=/, "control: a row outside the menu keeps no tile");
});

test("the tile and its icon are CSS (one 1.5 line, 18 pt, a 30 pt tile, radius 8); NavRow draws an empty span (control: no tile without an icon)", () => {
  const css = here("../wallet.css");
  const nav = here("./NavRow.tsx");
  for (const icon of Object.values(ROWS)) {
    const rule = css.match(new RegExp(`\\.wl-nav\\[data-ic="${icon}"\\] \\{ --ic: url\\("data:image/svg\\+xml,([^"]+)"\\); \\}`));
    assert.ok(rule, icon);
    assert.match(decodeURIComponent(rule[1]!), /stroke-width='1\.5'/, `${icon}: the 1.5 line`);
  }
  assert.match(css, /\.wl-nav-ic \{[^}]*width: 30px; height: 30px;[^}]*border-radius: 8px;/);
  assert.match(css, /mask: var\(--ic\) center \/ 18px 18px no-repeat;/);
  assert.match(nav, /\{icon && <span className="wl-nav-ic" aria-hidden="true" \/>\}/, "control: no icon, no tile");
  assert.doesNotMatch(nav, /<svg|<path/, "no SVG in Home's first load");
});
