// The UX audit of 4 Nov: Trade's rows were a skeleton for 0.56 s after the tap and reached full ink at ~900 ms; five row
// logos took 1.76 s (98 KB "large" images for a 40 pt disc). The rules that change it, with controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listReadsNow, liveReadsNow } from "./reads.ts";
import { risesIn } from "./screens/discover-rules.ts";
import { rowLogo } from "../market/logo.ts";

test("a list's first read goes while Trade is drawn beside another app; a search, a refresh, a list already painted wait for it to be on screen (controls)", () => {
  assert.equal(listReadsNow({ active: false, kind: "trending", hasRows: false }), true, "the first Hot list, beside Home");
  assert.equal(listReadsNow({ active: false, kind: "new", hasRows: false }), true);
  assert.equal(listReadsNow({ active: false, kind: "trending", hasRows: true }), false, "control: already painted, no read beside Home");
  assert.equal(listReadsNow({ active: false, kind: "search", hasRows: false }), false, "control: a search waits for Trade on screen");
  assert.equal(listReadsNow({ active: true, kind: "search", hasRows: true }), true, "on screen: every read as before");
  assert.equal(liveReadsNow(false, true), true, "the wallet chips' first read beside Home");
  assert.equal(liveReadsNow(false, false), false, "control: no re-read beside Home");
  assert.equal(liveReadsNow(true, false), true);
});

test("the first screen of rows doesn't rise in; a row that joins later does (control)", () => {
  const seen = new Set<string>();
  assert.equal(risesIn(seen, "sol:A"), false, "the first rows: full ink at once");
  seen.add("sol:A");
  assert.equal(risesIn(seen, "sol:A"), false, "a row already shown stays");
  assert.equal(risesIn(seen, "sol:B"), true, "control: a row that joins later rises");
});

test("a row's logo is coingecko's small image (13 KB), not its large one (98 KB); anything else is as it is (controls)", () => {
  assert.equal(rowLogo("https://coin-images.coingecko.com/coins/images/12345/large/dope.png?1700000000"), "https://coin-images.coingecko.com/coins/images/12345/small/dope.png?1700000000");
  assert.equal(rowLogo("https://coin-images.coingecko.com/coins/images/12345/small/dope.png"), "https://coin-images.coingecko.com/coins/images/12345/small/dope.png");
  assert.equal(rowLogo("https://assets.geckoterminal.com/abc/large/x.png"), "https://assets.geckoterminal.com/abc/large/x.png", "control: another host as it is");
  assert.equal(rowLogo("https://quotes.example/v0/market/logo?c=sol&a=X"), "https://quotes.example/v0/market/logo?c=sol&a=X", "control: the relay's logo (already small)");
  assert.equal(rowLogo("data:image/svg+xml;utf8,%3Csvg%3E"), "data:image/svg+xml;utf8,%3Csvg%3E");
  assert.equal(rowLogo(undefined), undefined);
});
