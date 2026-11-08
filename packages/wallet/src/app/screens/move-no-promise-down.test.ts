// Audit 16 re-grade of b19's g3-solana-move (8 Nov): with Solana down, "Moves it to your SOL and Robinhood wallets.", "About 1 min." and
// the arrives / takes rows still showed under "Solana is down, so this can't go now." while nothing could move. While the sheet
// can't go, no promise line shows; the fee line ("Any fee goes to NEAR Intents...") stays. Fails on main: no cantGo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");

test("Move can't go: no summary, no arrives or takes rows; the fee line stays", () => {
  assert.match(sheet, /const cantGo = services\.down && !running;/, "offline is down too (servicesLine)");
  assert.match(sheet, /const summary = running \|\| cantGo \? null : moveSummary\(legs, !!block\);/);
  assert.match(sheet, /\{!running && !block && !cantGo && cost && costed && \(\n\s+<dl className="zf-group wl-mv-sum" data-testid="move-least"/);
  assert.match(sheet, /time: block && legs\.length > 0 && !cantGo \? aboutLegs\(legs, fillsFirst\) : null/, "no \"About 1 min.\" either");
  assert.match(sheet, /<p className="zf-small" data-testid="move-paid">\{fee\.kept\}<\/p>/, "control: the fee line has no such guard");
});
