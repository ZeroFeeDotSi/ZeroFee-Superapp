// Speed (Home's first-load budget, 4 Nov): a network's logo Home's first paint never shows is its own small file, never
// base64 inside Home's first JS (it was ~34 KB of it); Home's own coins' logos stay inline, so its first paint is the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const rule = new RegExp(/const LOGO_AS_FILE = \/(.*)\/;/.exec(config)![1]!);

test("off-Home logos ship as files; Home's own coins' stay inline (controls: NEAR, SOL, ETH, Robinhood, BNB, USDC, USDT, Base, Arbitrum; another folder's svg)", () => {
  assert.match(config, /assetsInlineLimit: \(file: string\) => \(LOGO_AS_FILE\.test\(file\) \? false : undefined\)/);
  for (const f of ["ada", "starknet", "xlayer", "gnosis", "scroll", "monad", "sui", "ton", "btc", "doge"]) assert.ok(rule.test(`/x/packages/design/src/logos/${f}.svg`), f);
  for (const f of ["near", "sol", "eth", "hood", "bnb", "usdc", "usdt", "base", "arb"]) assert.ok(!rule.test(`/x/packages/design/src/logos/${f}.svg`), `control: ${f} stays inline`);
  assert.ok(!rule.test("/x/packages/design/src/icons/ada.svg"), "control: only the network logos");
});
