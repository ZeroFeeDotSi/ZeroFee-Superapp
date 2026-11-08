// Builder QA's item 7, audit 16's S16-7: the Safe's Sell sheet showed four dollar figures and never how much NEAR leaves
// (79.51 NEAR at 25%). Now its quote line says the coin once, as Home reads it, beside what comes back. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { amountOf } from "@zerofee/wallet/app/format.ts";
import { NATIVE_COPY as W } from "./words.ts";

test("S16-7: the Sell sheet's quote line names the coin that leaves", () => {
  const page = readFileSync(new URL("./NativeScreens.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("W.aboutSell(amountOf(q.amountIn, row.symbol, row.decimals), row.symbol, usd(Number(q.amountOut)))"));
  assert.equal(W.aboutSell(amountOf("79.510123456", "NEAR", 24), "NEAR", "$351.88"), "79.5101 NEAR for about $351.88");
});
