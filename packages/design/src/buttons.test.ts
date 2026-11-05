// The button system (the design review §2.1): seven kinds. The rules that make it one system are held here:
// the filled button is 50 pt on a 14 radius, a disabled one is the same shape at 30 % (never an outline), the second
// kind is the soft fill (never an outline), a chip is 32 pt on a 16 radius, a text button is ink, and a busy one stays ink.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync(new URL("./ui.css", import.meta.url), "utf8");
/** The last declaration block for an exact selector list (later rules win in the cascade). */
const last = (css: string, sel: string): string => {
  const all = [...css.matchAll(new RegExp(`(?:^|\\n|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g"))];
  return all.at(-1)?.[1] ?? "";
};

test("rebrand B1: the primary is mint with an ink label, 56 pt on the 18 command radius (THEME: sheet 34 − 16 = 18), 17/600, its glow token (the last rule wins)", () => {
  const b = last(ui, ".zf-btn");
  assert.match(b, /height: 56px; border-radius: 18px/);
  assert.match(b, /background: var\(--lit, var\(--mint\)\)/);   // v3.1: the same mint, lit from above
  assert.match(b, /color: var\(--on-mint\)/);
  assert.match(b, /box-shadow: var\(--lit-shadow, var\(--glow-go\)\)/);
  assert.match(b, /font: 600 /);
  assert.ok(ui.lastIndexOf("height: 50px") < ui.lastIndexOf("background: var(--lit, var(--mint))"), "the rebrand comes after B1");
});

test("look 4: off is ONE shared style: the soft fill, a mute label, a hairline; never dark on black, never mint at 30 %; busy stays mint", () => {
  const d = last(ui, '.zf-btn:disabled, .zf-btn[aria-disabled="true"]');
  assert.match(d, /background: var\(--fill\)/);
  assert.match(d, /background-image: none/);
  assert.match(d, /color: var\(--mute\)/);
  assert.match(d, /box-shadow: inset 0 0 0 1px var\(--line\)/);
  assert.match(d, /opacity: 1/);
  assert.match(last(ui, ".zf-btn.is-busy, .zf-btn.is-busy:disabled"), /background: var\(--lit, var\(--mint\)\)/);
});

test("B2 is the soft fill, never an outline; B3 is ink; B4 is a 32 pt chip on a 16 radius", () => {
  const q = last(ui, ".zf-btn.zf-btn--quiet, .zf-btn.zf-btn--quiet:disabled");
  assert.match(q, /background: var\(--fill\)/);
  assert.match(q, /box-shadow: none/);
  assert.match(last(ui, ".zf-link"), /color: var\(--ink\)/);
  const c = last(ui, ".zf-chip");
  assert.match(c, /height: 32px/);
  assert.match(c, /border-radius: 16px/);
  assert.match(last(ui, ".zf-chip::before"), /inset: -6px 0/, "a 44 pt target around it");
});

const wallet = (f: string) => readFileSync(new URL(`../../wallet/src/app/${f}`, import.meta.url), "utf8");

test("look 4: every pinned off command (Hold to send, the sheet's Go, an idle Swap) wears the shared off look, never ink-30 % with the ground's colour as its label", () => {
  for (const f of ["wallet.css", "money/send.css", "money/move-swap.css"]) {
    const css = wallet(f);
    assert.ok(!/ink\) 30%, var\(--bg\)\); color: var\(--bg\)/.test(css), `${f}: no dark label on a 30 % ink fill`);
  }
  const hold = last(wallet("money/send.css"), ".wl-send2__floor > .wl-hold:disabled");
  assert.match(hold, /background: var\(--fill\)/);
  assert.match(hold, /color: var\(--mute\)/);
  assert.match(hold, /inset 0 0 0 1px var\(--line\)/);
  assert.match(last(wallet("money/move-swap.css"), ".zf-sheet__content > .wl-sheet-go.is-idle"), /color: var\(--mute\)/);
});

test("look 4: the Hold's sweep is a layer ON TOP of the lit mint, never instead of it (a lone background-image dropped the fill once the guard passed)", () => {
  const css = wallet("money/send.css");
  for (const re of [/\.wl-send2__floor > \.wl-hold:not\(:disabled\) \{[^}]*background-image: linear-gradient\([^}]*\), var\(--lit\);/, /data-theme="dark"\] \.wl-send2__floor > \.wl-hold:not\(:disabled\) \{[^}]*, var\(--lit\);/]) assert.match(css, re);
});

test("look 4: the request's QR is on one card in both themes (surface, e-card, 22), Share is a 44 pt capsule in the flow, not under the pinned Copy", () => {
  const css = wallet("wallet.css");
  const qr = last(css, ".wl-qr-big");
  assert.match(qr, /background: var\(--surface\)/);
  assert.match(qr, /box-shadow: var\(--e-card\)/);
  assert.match(qr, /border-radius: 22px/);
  const share = last(css, ".zf-btn.wl-req-share");
  assert.match(share, /height: 44px/);
  assert.match(share, /border-radius: 999px/);
  assert.match(share, /background: var\(--fill\)/);
  const tsx = readFileSync(new URL("../../wallet/src/app/money/RequestSheet.tsx", import.meta.url), "utf8");
  assert.match(tsx, /wl-req-copy/);
  assert.match(tsx, /wl-req-share/);
  assert.ok(!/zf-btn wl-sheet-go" onClick=\{did\}/.test(tsx), "Copy is not the pinned floor");
});

test("look 4: no browser tap-highlight box anywhere; a tapped field draws the 1 px --ink inset ring on its own radius, never white", () => {
  const m = /html, body, button, a, input, textarea, select, summary, label, \[role="button"\], \[tabindex\] \{ -webkit-tap-highlight-color: transparent; \}/.exec(ui);
  assert.ok(m, "global tap-highlight reset");
  assert.match(ui, /:where\(input, textarea, select\):focus-visible, :where\(input, textarea, select\):focus \{ box-shadow: inset 0 0 0 1px var\(--ink\); \}/);
  assert.ok(!/inset 0 0 0 1\.5px var\(--ink\)/.test(ui), "no 1.5 px field ring left");
  assert.ok(!/(?:focus|focus-visible)[^{]*\{[^}]*(?:#fff|white)[^}]*inset/.test(ui), "no white focus ring");
});

test("look 4: the bar never hides on scroll, and the coin page's live pill is one nowrap capsule", () => {
  const bar = readFileSync(new URL("./bar-scroll.ts", import.meta.url), "utf8");
  assert.ok(!/toggleAttribute\("data-hidden"/.test(bar), "no hide toggle");
  const trade = readFileSync(new URL("../../trade/src/app/trade.css", import.meta.url), "utf8");
  const pill = last(trade, ".tr-lbadge");
  assert.match(pill, /white-space: nowrap/);
  assert.match(pill, /border-radius: 999px/);
});
