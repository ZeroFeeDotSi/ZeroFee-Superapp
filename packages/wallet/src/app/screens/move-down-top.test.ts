// Audit 16 re-grade of b19's g3-solana-move (8 Nov): with Solana down the line "Solana is down, so this can't go now..." sat at
// Move's floor, squeezed into a narrow column beside "See their status". The product rule (builder 10's A4, builder 14's D4):
// a sheet's problem goes ON TOP, full width, with "See their status" as a link under it, and the floor never says it again.
// Swap's top uses the same block. Fails on main: no SheetTop, Move's down line was the floor's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { statusLinkOf } from "@zerofee/core/services";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const move = read("./MoveSheet.tsx");
const swap = read("../money/SwapSheet.tsx");
const design = read("../../../../design/src/MoneySheet.tsx");

test("the problem block: full width on top, its text then its status link under it (a grid, never side by side)", () => {
  const top = design.slice(design.indexOf("export function SheetTop"), design.indexOf("export function SheetLine"));
  assert.match(top, /style=\{\{ display: "grid", gap: 8, margin: "4px 0 16px" \}\}>\n\s+<p className="zf-body">\{text\}<\/p>\n\s+\{link && <a className="zf-link" href=\{link\}[^>]*>See their status<\/a>\}/);
  assert.equal(statusLinkOf("Solana is down, so this can't go now."), "https://status.solana.com");
  assert.equal(statusLinkOf("ZeroFee's server is down, so this can't go now."), undefined, "none for ours");
});

test("Move: a down service is said on top, once; the floor doesn't say it", () => {
  assert.match(move, /const downTop = !offline && !running && services\.down \? services\.line : null;/);
  assert.match(move, /said: \(offline \|\| downTop \? null : services\.line\)/);
  assert.ok(move.indexOf('<SheetTop text={downTop} testid="move-down" />') > 0 && move.indexOf('<SheetTop text={downTop} testid="move-down" />') < move.indexOf('<div className="wl-mv-hero">'), "above the total");
});

test("Swap: its top line is the same block", () => {
  assert.match(swap, /<SheetTop text=\{top\} testid=\{offline \? "swap-offline" : "swap-down"\} offline=\{offline\} \/>/);
});
