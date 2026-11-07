// k-trade crawl (4 Nov, real account): Trade's Buy sheet, short of money, offered "Move money to your ETH (RH) wallet",
// which opened "Move to your NEAR wallet" fixed at the whole Safe with no amount field, so a first $2 trade couldn't be
// funded (S2). Back from Your wallets landed on Home, not Trade's Settings (S3); the short line read "has $0.00 ." (S4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fundAsk } from "./fund-ask.ts";
import { backLink, readBack } from "@zerofee/shell-api/back-to.ts";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

test("the Buy sheet's Move opens Home's Move to the wallet it named, at the buy's dollars, never the NEAR wallet's Top up", () => {
  assert.deepEqual(fundAsk("hood", "2.5"), { kind: "move", wallet: "hood", from: "safe", to: "hood", usd: "2.5" });
  assert.deepEqual(fundAsk("sol", "5.255"), { kind: "move", wallet: "sol", from: "safe", to: "sol", usd: "5.26" }, "cents rounded up");
  assert.deepEqual(fundAsk("bsc", ""), { kind: "move", wallet: "bsc" }, "no amount: the wallet, nothing filled in");
  assert.deepEqual(fundAsk("hood", "0"), { kind: "move", wallet: "hood" });
  assert.deepEqual(fundAsk("eth", "2"), { kind: "move" }, "a chain with no Home wallet: Move as it is");
  const sheet = src("./screens/TradeSheet.tsx");
  // T2-5 (the copy review's walk): the way on is the floor's quiet button now, never a link in the page
  assert.match(sheet, /className="zf-btn zf-btn--quiet tp-add-quiet" onClick=\{\(\) => \{ onOpen\?\.\("move", value\); \}\}/, "the short state's button asks for the Move");
  const app = src("./TradeApp.tsx");
  assert.match(app, /if \(screen === "move"\) \{ void openMove\(from\); return true; \}/);
  assert.match(app, /shell\.openMoney\(back \? fundAsk\(back\.coin\.chain, back\.value\) : \{ kind: "move", quick: true \}/);
  assert.match(app, /if \(screen === "fund" \|\| screen === "add" \|\| screen === "spending-topup"\) \{ void openTopUp\(from\)/, "control: a Problem's own Top up step still opens Top up");
});

// QA's re-test of 95253474 (S3): a $1 buy pre-set Move to $1, under the least a move from the Safe to a wallet
// can be ($2.09), so Move opened with its button off. It opens at the least instead, and Home's Move says why.
test("a buy under Move's least opens Move at the least, marked raised, and Move says why (Home's own words)", () => {
  assert.deepEqual(fundAsk("hood", "1"), { kind: "move", wallet: "hood", from: "safe", to: "hood", usd: "2.09", raised: true });
  assert.deepEqual(fundAsk("sol", "2"), { kind: "move", wallet: "sol", from: "safe", to: "sol", usd: "2.09", raised: true });
  assert.deepEqual(fundAsk("near", "1"), { kind: "move", wallet: "near", from: "safe", to: "near", usd: "2", raised: true }, "the NEAR wallet's least is $2");
  assert.deepEqual(fundAsk("sol", "2.09"), { kind: "move", wallet: "sol", from: "safe", to: "sol", usd: "2.09" }, "control: at the least, not raised");
  const host = readFileSync(new URL("../../../wallet/src/app/money/MoneyHost.tsx", import.meta.url), "utf8");
  assert.match(host, /\.\.\.\(ask\.raised \? \{ raised: true as const \} : \{\}\)/);
  const move = readFileSync(new URL("../../../wallet/src/app/screens/MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(move, /p\.prefill\?\.raised && ops\.length === 0 \? \(p\.prefill\.to === "near" \? MOVE_WORDS\.least : MOVE_WORDS\.leastFromSafe\)/);
});

test("Your wallets (Home's Details) comes back to Trade's Settings on Back", async () => {
  const app = src("./TradeApp.tsx");
  assert.match(app, /const seeWallets = \(\) => shell\.openApp\("wallet", "details", backLink\(\{ app: "trade", tab: "settings" \}\)\);/);
  assert.match(app, /else if \(t === "settings"\) \{ setSheet\(null\); setView\(\{ kind: "settings" \}\); \}/, "Trade opens its Settings when asked");
  assert.deepEqual(readBack(backLink({ app: "trade", tab: "settings" })), { app: "trade", tab: "settings" });
  const wallet = readFileSync(new URL("../../../wallet/src/app/WalletApp.tsx", import.meta.url), "utf8");
  // k-security crawl: with no app to go back to, Back goes to Your account when Details was opened there (backFrom)
  assert.match(wallet, /<PushedFrame name="Details" onBack=\{back \? \(\) => \{ tabs\(\); shell\.openApp\(back\.app, back\.tab\); \} : backFrom\(view\)\}>/);
  assert.match(wallet, /if \(asked === "details" && !web\) setView\(detailsFor\(shell\.requestedLink\)\);/);
});

test("the short state's head is one string (T2-5, the copy review's walk: \"Your SOL wallet has $144.06, not $5,000.\", the figure the sheet's \"to spend\" says, never the wallet's balance; Copywriter batch 3: \"has only $X\" was false; control: no stray '$0.00 .')", () => {
  const short = src("./screens/ShortChain.tsx");
  assert.ok(short.includes('data-testid="over-wallet-head">{words.head}</p>'));
  assert.ok(short.includes("haveUsd={") === false && src("./screens/TradeSheet.tsx").includes("haveUsd={usd(ready)}"), "the figure is what it can spend");
  assert.ok(!short.includes("has only"), "the old line is gone");
  assert.ok(!short.includes("{Wallet} has {usd(c.readyUsd)}."), "not three text pieces");
});
