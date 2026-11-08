// Builder 24, item 1 (b23's open edge, seen in the i1-trenches shots): under a down chain the row's chip said
// "Robinhood down" over the row's price and change (the chip was 124 pt wide in a 76 pt slot). Now the words go to the
// row's second line ("Robinhood is down", mute, where the name was), no chip, and the price column stays whole in the
// slot every row keeps. Fails on main 5af9af16b (no downRowLine; the Row draws the chip on a down chain).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { downRowLine } from "./chain-down.ts";

const discover = readFileSync(new URL("./screens/Discover.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./discover.css", import.meta.url), "utf8");

test("the row's own line says who is down, by name", () => {
  assert.equal(downRowLine("sol"), "Solana is down");
  assert.equal(downRowLine("hood"), "Robinhood is down");
  assert.doesNotMatch(downRowLine("hood"), /…|BNB|Base/);
});

test("a row on a down chain has no chip: its second line says it, the price column keeps its slot", () => {
  assert.match(discover, /const down = chainDown\(downRows, r\.chain\) && !buy && !noSale;/, "the Row reads the notice's rule once (the list's one read)");
  assert.match(discover, /: down \? <span className="dc-sub dc-sub--down" data-testid="row-down">\{downRowLine\(r\.chain\)\}<\/span>/);
  assert.match(discover, /noSale \? <span className="dc-nfs"[^\n]*: !buy && !down && <RowBuy /, "no chip to cover the price");
  assert.match(css, /\.dc-sub--down \{[^}]*color: var\(--mute\)/);
  // the slot every row keeps for the chip stays (the price and change sit where the other rows' do)
  assert.match(css, /\.dc-rr \.dc-row \{ padding-right: 76px; \}/);
});
