// Back from Home's coin page (QA's QA re-check, item 10: it landed on Trade): Home opens Trade's coin page
// with a back link naming Wallet, and Trade's Back goes there; a page opened inside Trade (its Intents list) stays in Trade.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { backLink, readBack } from "@zerofee/shell-api/back-to.ts";

test("Home's coin page carries Wallet as its Back, and Trade's Back opens it (control: Trade's own list keeps Back in Trade)", () => {
  assert.deepEqual(readBack(backLink({ app: "wallet" })), { app: "wallet" });
  assert.equal(readBack(undefined), null, "control: no link, no Back elsewhere");
  const wallet = readFileSync(new URL("../WalletApp.tsx", import.meta.url), "utf8");
  assert.match(wallet, /if \(to\) shell\.openApp\("trade", to, backLink\(\{ app: "wallet" \}\)\)/);
  const trade = readFileSync(new URL("../../../../trade/src/app/TradeApp.tsx", import.meta.url), "utf8");
  assert.match(trade, /const back = readBack\(shell\.requestedLink\); if \(NATIVE_COINS\) setView\(\{ kind: "native", assetId: r\.native\.assetId, symbol: r\.native\.symbol, \.\.\.\(back \? \{ back \} : \{\}\) \}\)/);
  assert.match(trade, /<PushedFrame name=\{view\.symbol\} onBack=\{\(\) => \{ const back = view\.back; setView\(\{ kind: "tabs" \}\); if \(back\) shell\.openApp\(back\.app, back\.tab\); \}\}>/);
  assert.match(trade, /<NativeList onCoin=\{\(r, buy\) => setView\(\{ kind: "native", assetId: r\.assetId, symbol: r\.symbol, \.\.\.\(buy \? \{ buy: true \} : \{\}\) \}\)\} \/>/, "control: Trade's own list sets no back");
});

test("test: a coin page opened from Home's Hot side (a wallet's coin row) carries Wallet as its Back, and Trade's coin page goes there (control: a coin opened inside Trade sets no back)", () => {
  const wallet = readFileSync(new URL("../WalletApp.tsx", import.meta.url), "utf8");
  assert.match(wallet, /onRowCoin=\{\(chain, address, symbol\) => shell\.openApp\("trade", `coin:[^\n]*`, backLink\(\{ app: "wallet" \}\)\)\}/);
  const trade = readFileSync(new URL("../../../../trade/src/app/TradeApp.tsx", import.meta.url), "utf8");
  assert.match(trade, /if \("coin" in r\) \{ const back = readBack\(shell\.requestedLink\); setView\(\{ kind: "coin", seed: r\.coin, \.\.\.\(back \? \{ back \} : \{\}\) \}\); \}/);
  assert.match(trade, /<PushedFrame name=\{view\.seed\.symbol\} onBack=\{\(\) => \{ const back = view\.back; [^\n]*setView\(\{ kind: "tabs" \}\); if \(back\) shell\.openApp\(back\.app, back\.tab\); \}\}>/);
  assert.match(trade, /const openCoin = \(seed: CoinRow\) => setView\(\{ kind: "coin", seed \}\);/, "control: Trade's own lists open a coin with no back");
});
