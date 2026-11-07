// Tap targets (A fifteen, 5 Nov; QA test "many 32–38 px chips"): Apple's minimum is 44 × 44 pt. The shared controls
// keep their drawn size (a 32 pt chip, a 38 pt track option, a 42 pt squeezed key) and take the 44 from an inert hit box:
// a min-height/min-width of 44, or an absolute ::before/::after whose inset reaches far enough past the drawn edge.
// Pinned here on the CSS text so a restyle that drops the hit box fails before a walk does; `reach` is checked for power.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
const ui = css("ui.css"), seg = css("segmented.css"), me = css("moneyentry.css"), pad = css("keypad.css");
/** Every declaration block for an exact selector, joined in cascade order (later rules win; a pin reads the last value). */
const blocks = (src: string, sel: string): string =>
  [...src.matchAll(new RegExp(`(?:^|\\n|\\}|,)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1]).join(";");
const lastPx = (decls: string, prop: string): number | null => { const m = [...decls.matchAll(new RegExp(`${prop}:\\s*(-?[\\d.]+)px`, "g"))].at(-1); return m ? Number(m[1]) : null; };
/** The inset of a hit pseudo: "inset: -6px 0" → { y: 6, x: 0 }; null when the block has no content or is not absolute. */
const hitInset = (decls: string): { y: number; x: number } | null => {
  if (!/content:\s*""/.test(decls) || !/position:\s*absolute/.test(decls)) return null;
  const m = [...decls.matchAll(/inset:\s*(-?[\d.]+)px\s+(-?[\d.]+)(?:px)?(?:\s+(-?[\d.]+)px\s+(-?[\d.]+)(?:px)?)?/g)].at(-1);
  if (!m) return null;
  const y = Math.min(-Number(m[1]), m[3] === undefined ? -Number(m[1]) : -Number(m[3]));
  const x = Math.min(-Number(m[2]), m[4] === undefined ? -Number(m[2]) : -Number(m[4]));
  return { y: y + 0, x: x + 0 }; // + 0: "-0" from "inset: -6px 0" compares as 0
};
/** How tall the tap is: the drawn height plus the pseudo's reach over and under. */
const reach = (height: number, inset: { y: number; x: number } | null): number => height + 2 * (inset?.y ?? 0);

test("the 32 pt chip (.zf-chip) is drawn at 32 and tapped at 44: its ::before reaches 6 over and under", () => {
  assert.equal(lastPx(blocks(ui, ".zf-chip"), "height"), 32, "the chip stays 32 to the eye");
  assert.ok((lastPx(blocks(ui, ".zf-chip"), "min-width") ?? 0) >= 44, "never narrower than 44");
  assert.ok(reach(32, hitInset(blocks(ui, ".zf-chip::before"))) >= 44, "32 + 2 × 6 = 44");
});

test("the track option (.zf-me__chips button, 38 pt in a 44 track) takes a 44 pt tap through its ::before", () => {
  const inset = hitInset(blocks(me, ".zf-me__chips button::before"));
  assert.ok(inset, "the option has a hit pseudo");
  assert.ok(reach(38, inset) >= 44, `38 + 2 × ${inset?.y} ≥ 44`);
  assert.equal(inset?.x, 0, "never sideways: the options touch in the track");
  assert.match(blocks(me, ".zf-me__chips button"), /position: relative/);
});

test("the segmented item (.zf-seg__item) and the text link (.zf-link) carry min-height 44", () => {
  assert.equal(lastPx(blocks(seg, ".zf-seg__item"), "min-height"), 44);
  assert.equal(lastPx(blocks(ui, ".zf-link"), "min-height"), 44);
  assert.equal(lastPx(blocks(ui, ".zf-link"), "min-width"), 44);
});

test("a keypad key squeezed to 42 (Send with networks) still taps 44: an ::after 1 beyond its top and bottom", () => {
  const inset = hitInset(blocks(pad, ".zf-keypad button::after"));
  assert.ok(inset, "the key has an inert hit pseudo beside its press disc");
  assert.ok(reach(42, inset) >= 44);
  assert.match(blocks(pad, ".zf-keypad button"), /position: relative/);
});

test("the icon button (.zf-icon-btn) grows its tap with padding and gives the space back with a negative margin", () => {
  const b = blocks(ui, ".zf-icon-btn");
  const p = lastPx(b, "padding"), m = lastPx(b, "margin");
  assert.ok(p !== null && m !== null && p > 0 && m === -p, `padding ${p} / margin ${m}`);
});

test("control: a decorative pseudo is not a hit box, and a 5 pt reach is not enough (the check can fail)", () => {
  assert.equal(hitInset(blocks(ui, ".zf-small")), null, "no pseudo, no hit box");
  assert.equal(hitInset("content: \"\"; position: absolute; inset: -6px 0;".replace("absolute", "relative")), null, "a relative pseudo grows nothing");
  assert.ok(reach(32, { y: 5, x: 0 }) < 44, "32 + 2 × 5 = 42 fails");
  assert.ok(reach(38, { y: 3, x: 0 }) == 44 && reach(38, { y: 2, x: 0 }) < 44);
});

// the copy review's item 12 (6 Nov; fix/trade-list-coin, 7 Nov): every tap target on Home's rows, Trade's list and the coin page is at
// least 44 pt, measured from the CSS each screen ships: the drawn height (the last min-height or height), plus the reach of
// an inert ::before/::after hit box over and under it; a width pinned where the target is a word ("Copy").
const pkg = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const wallet = pkg("wallet/src/app/wallet.css"), trade = pkg("trade/src/app/trade.css"), discover = pkg("trade/src/app/discover.css"), coinpage = pkg("trade/src/app/coinpage.css");
/** How tall and wide a target taps, from its CSS alone: null for a side the CSS doesn't size. */
export function tapBox(src: string, sel: string): { h: number | null; w: number | null } {
  const b = blocks(src, sel);
  const hs = [lastPx(b, "min-height"), lastPx(b, "height")].filter((n): n is number => n !== null);
  const ws = [lastPx(b, "min-width"), lastPx(b, "width")].filter((n): n is number => n !== null);
  const pseudo = hitInset(blocks(src, `${sel}::after`)) ?? hitInset(blocks(src, `${sel}::before`));
  return { h: hs.length ? Math.max(...hs) + 2 * (pseudo?.y ?? 0) : null, w: ws.length ? Math.max(...ws) + 2 * (pseudo?.x ?? 0) : null };
}
const NAMED: [screen: string, src: string, sel: string, side: "h" | "hw"][] = [
  ["Home, a coin row", wallet, ".wl-row.wl-coin", "h"],
  ["Home, Show all", wallet, ".wl-more", "h"],
  ["Home, the Safe row's Buy (32 to the eye)", wallet, ".wl-buy", "h"],
  ["Home, a Hot wallet's Add", wallet, ".wl-hw-add", "hw"],
  ["Coin page, a range (1H … ALL) and the candles switch", trade, ".tr-ranges button", "hw"],
  ["Coin page, Copy (its address)", coinpage, ".cp .cp-addr .tr-copy", "hw"],
  ["Trade list, a wallet chip", discover, ".dc-tabs button", "h"],
  ["Trade list, a list pill (Hot, New, 5m …)", discover, ".dc-wins button", "hw"],
  ["Trade list, Move", discover, ".dc-move", "h"],
  ["Trade list, Settings", discover, ".dc-gear", "hw"],
];
test("the copy review's item 12: every named target on Home, Trade's list and the coin page taps at 44 pt or more", () => {
  for (const [screen, src, sel, side] of NAMED) {
    const t = tapBox(src, sel);
    assert.ok(t.h !== null && t.h >= 44, `${screen} (${sel}): ${t.h} tall`);
    if (side === "hw") assert.ok(t.w !== null && t.w >= 44, `${screen} (${sel}): ${t.w} wide`);
  }
});
test("control: without the fixes, the Safe row's Buy taps at 32 and Copy unsized (the measure fails them)", () => {
  const oldWallet = wallet.slice(0, wallet.indexOf("/* 53, 6 Nov, item 12"));
  assert.ok(oldWallet.length < wallet.length, "the fix's block is there to cut");
  assert.equal(tapBox(oldWallet, ".wl-buy").h, 32);
  const oldCopy = coinpage.replace(".tr-copy { min-height: 44px; min-width: 44px;", ".tr-copy { min-height: 44px; min-width: 0;");
  assert.notEqual(oldCopy, coinpage, "the fix is there to undo");
  assert.ok((tapBox(oldCopy, ".cp .cp-addr .tr-copy").w ?? 0) < 44, "min-width 0: not sized to 44");
  assert.equal(tapBox(".x { height: 32px; } .x::after { content: \"\"; position: absolute; inset: -4px 0; }", ".x").h, 40, "a 4 pt reach is short");
});
