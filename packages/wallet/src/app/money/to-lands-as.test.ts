// the audit's Send audit M2 (7 Nov): From "USDC · your Safe", To a .near name with a NEAR Intents balance (pay/send.ts makes it
// "ledger"): the sheet said "Lands as wNEAR, the NEAR Intents form of NEAR." while SendSheet pays toTokenId USDC
// (nearLandsAs). The To line now names the coin that lands: wNEAR only when NEAR is what goes. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INTENTS_LINE, routeLines } from "../../send-reach.ts";
import { nearLandsAs } from "../../send-to.ts";

const safe = (symbol: string, tokenId: string) => ({ row: null, chain: "near", tokenId, symbol });

test("M2: Safe USDC to a NEAR Intents balance says USDC lands there, the very coin SendSheet pays [before: wNEAR]", () => {
  const usdc = safe("USDC", "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1");
  assert.equal(nearLandsAs(usdc).tokenId, usdc.tokenId, "what SendSheet pays (toTokenId)");
  assert.deepEqual(routeLines("near", nearLandsAs(usdc).coin, true), ["Public on NEAR, as USDC."]);
  assert.deepEqual(routeLines("near", nearLandsAs(safe("ZEC", "nep141:zec.omft.near")).coin, true)[0], "Public on NEAR, as ZEC.");
});

test("M2 controls: NEAR (the Safe's, or a wallet's) into a NEAR Intents balance is wNEAR, said so; a plain NEAR account as before", () => {
  const near = safe("NEAR", "nep141:wrap.near");
  assert.equal(nearLandsAs(near).tokenId, "nep141:wrap.near");
  assert.deepEqual(routeLines("near", nearLandsAs(near).coin, true), ["Public on NEAR.", INTENTS_LINE]);
  assert.deepEqual(routeLines("near", nearLandsAs({ row: "sol", chain: "sol", tokenId: "sol", symbol: "SOL" }).coin, true), ["Public on NEAR.", INTENTS_LINE], "a wallet's coin lands as NEAR");
  assert.deepEqual(routeLines("near", undefined, true), ["Public on NEAR.", INTENTS_LINE]);
  assert.deepEqual(routeLines("near", "USDC"), ["Public on NEAR, as USDC."], "a plain NEAR account: one line, NEAR said once (QA 16)");
  // the form hands routeLines the same coin SendSheet pays
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /routeLines\(network, nearLandsAs\(source\)\.coin, who\.recipient\.kind === "ledger"\)/);
});
