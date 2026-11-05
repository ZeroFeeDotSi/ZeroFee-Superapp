// The Home coin page (QA's Sim testda99e17e, 5 Nov, item 5): a coin the Safe holds had
// no Send on its page, and USD Coin opened a dead page ("Your Safe can't trade this coin." alone). Rule 1: never a dead end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeCoinRoute } from "./safe-hot.ts";
import { SAFE_CASH, nativeCoins } from "../../../../trade/src/native/assets.ts";
import type { Balance } from "../../types.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const part = (tokenId: string): Balance => ({ tokenId, symbol: "X", name: "X", icon: "", chain: "near", amount: "1", bridged: false, held: "ledger", listed: true });
const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

test("USD Coin opens Wallet's own coin screen, which has Send; a coin Trade lists opens its page (control: BTC still does)", () => {
  assert.equal(SAFE_CASH, USDC, "the Safe's cash is Trade's own");
  const tok = (assetId: string) => ({ assetId, symbol: "X", blockchain: "near", decimals: 6 }) as never;
  assert.deepEqual(nativeCoins([tok(USDC), tok("nep141:btc.omft.near")]).map((c) => c.assetId), ["nep141:btc.omft.near"], "Trade's list leaves it out: its page would be the dead one");
  assert.equal(safeCoinRoute({ symbol: "USDC", listed: true, parts: [part(USDC)] }), null);
  assert.equal(safeCoinRoute({ symbol: "BTC", listed: true, parts: [part("nep141:btc.omft.near")] }), "coin:intents:nep141:btc.omft.near:BTC", "control");
  // a null route is Wallet's Coin screen (WalletApp onCoin), and that screen's floor is Send, From this coin
  assert.match(src("../WalletApp.tsx"), /const to = NATIVE_COINS \? safeCoinRoute\(line\) : null; if \(to\) shell\.openApp\("trade", to, backLink\(\{ app: "wallet" \}\)\); else setView\(\{ kind: "coin", line \}\);/);
  assert.match(src("./Coin.tsx"), /<button className="zf-btn" onClick=\{onSend\}>Send<\/button>/);
  assert.match(src("../WalletApp.tsx"), /onSend=\{\(\) => shell\.openMoney\(\{ kind: "send", coin \}/);
});

test("Trade's coin page: \"Send this coin ›\", a quiet row under the figures, for a coin the Safe holds, From that coin; Buy and Sell stay the pair (control: no third button in the floor)", () => {
  const page = src("../../../../trade/src/native/NativeScreens.tsx");
  assert.match(page, /\{shownHeld && \(canSend \|\| safeSends\) && <button type="button" className="tr-kv nc-send" data-testid="native-send" onClick=\{\(\) => shell\.openMoney\(\{ kind: "send", coin: symbol \}\)\}><span>\{W\.sendCoin\}<\/span><span aria-hidden="true">›<\/span><\/button>\}/);
  const floor = page.slice(page.indexOf('<div className="tr-floor tr-coin-floor">'), page.indexOf("onTradeGround(<NativeTradeSheet"));
  assert.doesNotMatch(floor, /native-send|openMoney/, "control: the floor is Buy and Sell only");
  assert.ok(page.indexOf('data-testid="native-send"') < page.indexOf('<div className="tr-floor tr-coin-floor">'), "the row sits above the floor, under the figures");
  assert.match(src("../../../../trade/src/native/words.ts"), /sendCoin: "Send this coin",/);
  assert.match(src("../../../../trade/src/native/native.css"), /\.nc-send \{/);
});
