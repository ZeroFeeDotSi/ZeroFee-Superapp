// Gates grade, 5 Nov (MUST 6): NEAR_TRADES was a dead flag whose page said "NEAR coins open soon." (a promise with no
// date). It's gone: a coin page trades only on a chain in MARKET (one switch), and a NEAR coin's says what's true.
// Control: the old flag and its words, put back, fail these checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as runtime from "./runtime.ts";
import { agentNearLine, askRefusal } from "@zerofee/shell-api/trade-ask.ts";
import { NEAR_CLOSED } from "@zerofee/core/near-gate";
import { nearCoinNative } from "./app/requests.ts";

const page = readFileSync(new URL("./app/screens/CoinPage.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("./app/TradeApp.tsx", import.meta.url), "utf8");
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
  // AgentZero's ask has its own line (trade-ask.ts agentNearLine); the page's own refusal keeps Trade's
  assert.match(page, /else if \(!MARKET\.includes\(seed\.chain\)\) onAutoFail\?\.\(agentNearLine\(auto\)\);/);
  assert.match(page, /const canTrade = !no && MARKET\.includes\(seed\.chain\) &&/);
  assert.equal(page.match(/\{d && !no && MARKET\.includes\(seed\.chain\) && <Coin(Orders|ExitPlan|Standing) /g)?.length, 3);
});

test("control: the old gate fails", () => {
  const old = page.replace("!MARKET.includes(seed.chain)) onAutoFail?.(agentNearLine(auto))", 'seed.chain === "near" && !NEAR_TRADES) onAutoFail?.(NEAR_CLOSED_WORDS)');
  assert.notEqual(old, page);
  assert.ok(!gone(old));
  assert.ok(!gone('export const NEAR_CLOSED_WORDS = "NEAR coins open soon.";'));
});

test("one switch for a NEAR coin: NATIVE_COINS on, the Safe's own page by its 1Click id; off, Trade's page and its line (controls)", () => {
  const near = { chain: "near" as const, address: "token.rhealab.near", symbol: "RHEA" };
  assert.deepEqual(nearCoinNative(near, true), { assetId: "nep141:token.rhealab.near", symbol: "RHEA" });
  assert.deepEqual(nearCoinNative({ ...near, address: "nep141:wrap.near" }, true), { assetId: "nep141:wrap.near", symbol: "RHEA" }, "an id isn't prefixed twice");
  assert.equal(nearCoinNative(near, false), null, "control: the switch off");
  assert.equal(nearCoinNative({ chain: "sol", address: "So11111111111111111111111111111111111111112", symbol: "SOL" }, true), null, "control: only a NEAR coin");
  const app = readFileSync(new URL("./app/TradeApp.tsx", import.meta.url), "utf8");
  assert.match(app, /const openCoin = \(seed: CoinRow\) => setView\(coinView\(seed\)\);/);
  assert.match(app, /if \("coin" in r\) \{ const back = readBack\(shell\.requestedLink\); setView\(\{ kind: "coin", seed: r\.coin, \.\.\.\(back \? \{ back \} : \{\}\) \}\); \}/, "a link (Home's Hot row) opens that wallet's own page, with NATIVE_COINS on too, never the Safe's");
  assert.match(app, /nearCoinNative\(seed, NATIVE_COINS\)/);
});

test("Trade's own refusal and the core's say one plain line; AgentZero's ask says its own (control: another shut chain keeps its words)", () => {
  assert.ok(gone(NEAR_CLOSED));
  assert.equal(NEAR_CLOSED, runtime.NEAR_NOT_TRADED);
  const ask = { side: "buy", chain: "near", address: "token.rhealab.near", from: "agentzero", usd: 5 } as const;
  assert.equal(askRefusal(ask, runtime.MARKET), agentNearLine("buy", false), "the switch is off in tests");
  assert.notEqual(agentNearLine("buy", false), runtime.NEAR_NOT_TRADED);
  assert.match(app, /refused: a\.ask\.chain === "near" \? agentNearLine\(a\.ask\.side\) : "Trade doesn't trade on that chain yet\."/);
  assert.equal(askRefusal({ ...ask, chain: "bsc", address: "0x0000000000000000000000000000000000000001" }, ["sol"]), "Trade doesn't trade on that chain yet.", "control");
});
