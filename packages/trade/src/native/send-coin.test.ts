// Sim re-check (5 Nov): BTC's "Send this coin" opened Send on USDC. Send pays a Safe coin from Private
// (the Safe's own part waits on route B, SAFE_SEND_OPEN off), so the coin page offers Send only for a coin with some in
// Private, and Send then opens on that coin. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateHas, safeFills } from "./swap.ts";
import { startSource } from "@zerofee/wallet/app/money/send-sources.ts";
import { SAFE_SEND_OPEN } from "@zerofee/wallet/send-open.ts";

const BTC = "nep141:btc.omft.near", USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

test("the coin page offers Send only for a coin Private holds (control: USDC in Private, yes; NEAR's Private row is wNEAR)", () => {
  const priv = [{ tokenId: USDC, amount: "25" }, { tokenId: "nep141:wrap.near", amount: "2" }, { tokenId: BTC, amount: "0" }];
  assert.equal(privateHas(priv, BTC), false, "BTC: none in Private, so no Send (never a USDC send)");
  assert.equal(privateHas(priv, USDC), true, "control");
  assert.equal(privateHas(priv, "nep141:wrap.near"), true);
  assert.equal(privateHas(priv, "near"), true);
  assert.equal(privateHas(null, USDC), false, "unread: no Send");
  assert.equal(SAFE_SEND_OPEN, true, "Send from the Safe fills Private first: the coin page offers the Safe's own part too (safeFills)");
  const page = readFileSync(new URL("./NativeScreens.tsx", import.meta.url), "utf8");
  assert.match(page, /\{shownHeld && \(canSend \|\| safeSends\) && <button type="button" className="tr-kv nc-send"/);
  assert.match(page, /setSafeSends\(safeFills\(rows, assetId, SAFE_FILL_OPEN\)\)/);
  assert.match(page, /privateHas\(r\.ok\.rows, assetId\)/);
});

test("with BTC in Private, Send opens on BTC (control: a coin with no source falls back to the best one)", () => {
  const src = (id: string, symbol: string, usd: string) => ({ id, row: null, tokenId: id.replace(/^safe:/, ""), label: symbol, place: "your Safe", symbol, chain: "near", amount: "1", usd, max: "1" });
  const sources = [src(`safe:${USDC}`, "USDC", "25"), src(`safe:${BTC}`, "BTC", "10")] as never;
  assert.equal(startSource(undefined, sources, "BTC"), `safe:${BTC}`);
  assert.equal(startSource(undefined, sources, "ETH"), `safe:${USDC}`, "control");
});

test("Send from the Safe fills Private first: a coin native to NEAR the Safe holds gets \"Send this coin\" with nothing in Private (controls: BTC, bridged, still needs Private; the fill shut, none; an empty Safe row, none)", () => {
  const safe = [{ tokenId: USDC, amount: "30", held: "ledger", bridged: false }, { tokenId: "near", amount: "4", held: "account", bridged: false }, { tokenId: BTC, amount: "0.01", held: "ledger", bridged: true }, { tokenId: "nep141:usdt.tether-token.near", amount: "0", held: "ledger", bridged: false }];
  assert.equal(safeFills(safe, USDC, true), true, "USDC in the Safe");
  assert.equal(safeFills(safe, "near", true), true, "NEAR on the account");
  assert.equal(safeFills(safe, "nep141:wrap.near", true), true, "NEAR as wNEAR");
  assert.equal(safeFills(safe, BTC, true), false, "control: BTC is bridged, its Safe part can't fill");
  assert.equal(safeFills(safe, USDC, false), false, "control: the fill shut");
  assert.equal(safeFills(safe, "nep141:usdt.tether-token.near", true), false, "control: none held");
  assert.equal(safeFills(null, USDC, true), false, "unread: no Send");
  // QA's re-check, item 3 (c): BTC and ETH show it whenever Send can send them: some in Private
  assert.equal(privateHas([{ tokenId: BTC, amount: "0.002" }], BTC) || safeFills(safe, BTC, true), true, "BTC with a Private share: Send this coin");
  assert.equal(privateHas([], BTC) || safeFills(safe, BTC, true), false, "control: Safe-only BTC has no way to send yet: no button");
});
