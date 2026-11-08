// QA 16 on the S6 shot (8 Nov): the Sell page's amount box was an empty grey block while a sale short of its fee could not
// be quoted. It says the holding's worth the moment the page opens, never a blank block once the holding is read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { saleBox } from "./sale-box.ts";

test("the quote's figure once it answers; before it, About the holding's worth by the share; coins when unpriced", () => {
  const pos = { raw: "1501000000", decimals: 6, valueUsd: 4.98 };
  assert.deepEqual(saleBox({ quotedUsd: 4.97, pos, share: 1, symbol: "DOPE" }), { figure: "$4.97", about: false });
  assert.deepEqual(saleBox({ pos, share: 1, symbol: "DOPE" }), { figure: "$4.98", about: true });
  assert.deepEqual(saleBox({ pos, share: 0.5, symbol: "DOPE" }), { figure: "$2.49", about: true });
  assert.deepEqual(saleBox({ pos: { raw: "1501000000", decimals: 6 }, share: 1, symbol: "DOPE" }), { figure: "1,501 DOPE", about: false });
  assert.equal(saleBox({ pos: null, share: 1, symbol: "DOPE" }), null, "the shimmer only while the holding is unread");
  assert.equal(saleBox({ pos: { raw: "0", decimals: 6, valueUsd: 0 }, share: 1, symbol: "DOPE" }), null);
});

test("the sheet's sale box reads it, with a small About before the figure", () => {
  const src = readFileSync(new URL("./screens/TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(src, /const box = side === "sell" \? saleBox\(\{ \.\.\.\(q \? \{ quotedUsd: saleFigure \} : \{\}\), pos: pos\.value \?\? null, share, symbol \}\) : null;/);
  assert.match(src, /: box\?\.figure \?\? "";/);
  assert.doesNotMatch(src, /: q \? usd\(saleFigure\) : "";/, "the box is not blank until the quote");
  assert.match(src, /\{box\?\.about && <small className="tp-amt-about">About <\/small>\}\{big\}/);
});
