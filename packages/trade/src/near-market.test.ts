// Gates grade, 5 Nov (MUST 6): NEAR_TRADES was a dead flag whose page said "NEAR coins open soon." (a promise with no
// date). It's gone: a coin page trades only on a chain in MARKET (one switch), and a NEAR coin's says what's true.
// Control: the old flag and its words, put back, fail these checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as runtime from "./runtime.ts";

const page = readFileSync(new URL("./app/screens/CoinPage.tsx", import.meta.url), "utf8");
const gone = (src: string) => !/NEAR_TRADES|open soon/i.test(src);

test("the real build's market: Solana, Robinhood Chain and BNB as proven, never NEAR (no behaviour change)", () => {
  assert.ok(!runtime.MARKET.includes("near"));
  assert.ok(runtime.LISTED.includes("near"), "NEAR coins still list (their chart and facts)");
  assert.deepEqual(runtime.MARKET, runtime.LISTED.filter((c) => c !== "near"));
  assert.ok(!("NEAR_TRADES" in runtime) && !("NEAR_CLOSED_WORDS" in runtime), "the dead flag and its words are gone");
  assert.equal(runtime.NEAR_NOT_TRADED, "Trade doesn't buy or sell NEAR coins.");
  assert.doesNotMatch(runtime.NEAR_NOT_TRADED, /soon|yet/);
});

test("the coin page: Buy, orders and the exit plan only on a MARKET chain; elsewhere the plain line, for AgentZero too", () => {
  assert.ok(gone(page));
  assert.match(page, /: !MARKET\.includes\(seed\.chain\)\n\s+\? <p className="zf-small tr-why">\{NEAR_NOT_TRADED\}<\/p>/);
  assert.match(page, /else if \(!MARKET\.includes\(seed\.chain\)\) onAutoFail\?\.\(NEAR_NOT_TRADED\);/);
  assert.match(page, /const canTrade = !no && MARKET\.includes\(seed\.chain\) &&/);
  assert.equal(page.match(/\{d && !no && MARKET\.includes\(seed\.chain\) && <Coin(Orders|ExitPlan|Standing) /g)?.length, 3);
});

test("control: the old gate fails", () => {
  const old = page.replace("!MARKET.includes(seed.chain)) onAutoFail?.(NEAR_NOT_TRADED)", 'seed.chain === "near" && !NEAR_TRADES) onAutoFail?.(NEAR_CLOSED_WORDS)');
  assert.notEqual(old, page);
  assert.ok(!gone(old));
  assert.ok(!gone('export const NEAR_CLOSED_WORDS = "NEAR coins open soon.";'));
});
