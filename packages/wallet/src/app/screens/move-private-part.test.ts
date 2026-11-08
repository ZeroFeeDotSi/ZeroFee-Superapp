import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeRowFigure } from "../one-total.ts";
import { placesNow } from "./move-split.ts";

// the audit's S1 (7 Nov): Safe $85 + Private $15 + SOL $30 + ETH $4 read as $134 under a $119 headline, because the Safe's row
// already holds Private. Private's row is now set in under the Safe's, so only the rows at the edge are summed by the eye.
test("the audit's S1: the Move sheet's Private row is set in under the Safe's (is-part), and the rows at the edge add up to the headline", () => {
  const src = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(src, /wl-mv-row wl-mv-\$\{x\.place\}\$\{x\.place === "private" \? " is-part" : ""\}/, "Private's row carries is-part");
  const css = readFileSync(new URL("../money/move-swap.css", import.meta.url), "utf8");
  assert.match(css, /\.wl-mv-row\.is-part \{ margin-left: 36px;/, "set in under the Safe's name (24 px mark + 12 px gap)");
  assert.match(css, /\.wl-mv-row:has\(\+ \.wl-mv-row\.is-part\) \{ border-bottom: 0; \}/, "no line between the Safe and its part");
  // the audit's case: the Safe $100 with Private $15 in it, SOL $30, ETH (RH) $4; the headline $134
  const places = placesNow({ safeUsd: 100, safeMostUsd: 100, privateUsd: 15, privateMostUsd: 15, networks: [
    { network: "sol", cashUsd: "30", coinsUsd: "0", readyUsd: "30" }, { network: "hood", cashUsd: "4", coinsUsd: "0", readyUsd: "4" }] });
  const usd = (p: string) => places.find((x) => x.place === p)?.usd ?? 0;
  assert.deepEqual(places.map((p) => p.place).slice(0, 2), ["safe", "private"], "Private comes right under the Safe");
  const edge = safeRowFigure(usd("safe"), usd("private")) + usd("sol") + usd("hood") + usd("near");
  assert.equal(edge, 134, "Safe (with Private) + SOL + Robinhood = the headline");
});
