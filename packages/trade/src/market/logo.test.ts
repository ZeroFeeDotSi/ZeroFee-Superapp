// Every coin has a logo: GeckoTerminal's image, or none (the shell draws the monogram). SOL, BNB and ETH are bundled.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BNB_LOGO_SVG, ETH_LOGO_SVG, SOL_LOGO_SVG, logoFor, nativeLogoUri } from "./logo.ts";
import { WSOL } from "./map.ts";

describe("logos", () => {
  it("the three native logos are small inline SVGs", () => {
    for (const s of [SOL_LOGO_SVG, BNB_LOGO_SVG, ETH_LOGO_SVG]) { assert.match(s, /^<svg [^>]*viewBox="0 0 64 64"/); assert.ok(s.length < 2000); assert.doesNotMatch(s, /<script|href=|onload/i); }
    assert.match(nativeLogoUri("sol"), /^data:image\/svg\+xml;utf8,%3Csvg/);
  });
  it("wrapped and native addresses use the bundled logo, with no request", () => {
    assert.equal(logoFor("sol", WSOL), nativeLogoUri("sol"));
    assert.equal(logoFor("bsc", "0xBB4CDB9CBD36B01BD1CBAEBF2DE08D9173BC095C"), nativeLogoUri("bsc"));
    assert.equal(logoFor("hood", "0x0000000000000000000000000000000000000000"), nativeLogoUri("hood"));
    assert.equal(logoFor("hood", "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeEEEeeE"), nativeLogoUri("hood"));
  });
  it("another coin takes the market data's https image; a missing placeholder, a non-https url or nothing gives undefined (the monogram)", () => {
    assert.equal(logoFor("sol", "Mint111111111111111111111111111111111111111", "https://coin-images.coingecko.com/x.png"), "https://coin-images.coingecko.com/x.png");
    assert.equal(logoFor("sol", "Mint111111111111111111111111111111111111111", "https://assets.geckoterminal.com/missing_large.png"), undefined);
    assert.equal(logoFor("sol", "Mint111111111111111111111111111111111111111", "http://evil.example/x.png"), undefined);
    assert.equal(logoFor("sol", "Mint111111111111111111111111111111111111111", "javascript:alert(1)"), undefined);
    assert.equal(logoFor("sol", "Mint111111111111111111111111111111111111111", null), undefined);
  });
});
