// the copy review's From card while the fill is shut (5 Nov): a Private-only row says public sends go through Private and what Private
// holds (format.ts privateFigure), or that it is empty, with a quiet "Top up Private" link under it that opens the fill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOP_UP_PRIVATE, fillShutLine } from "./send-cap.ts";
import { privateFigure } from "../format.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const usdc = (amount: string, usd: string) => ({ tokenId: "nep141:usdc", symbol: "USDC", name: "USD Coin", icon: "usdc", chain: "near", amount, usd, held: "private" as const });

test("the fill shut: From's sub-line names Private's one figure, or that it is empty; \"Top up Private\" under it opens the fill (controls: the fill open, no card; a row that isn't Private-only, no card)", () => {
  const figure = privateFigure({ available: true, ready: true, rows: [usdc("20", "20")] as never });
  assert.equal(fillShutLine(figure), "Public sends go through Private. Private holds $20.00 right now.");
  assert.equal(fillShutLine(privateFigure({ available: true, ready: true, rows: [] })), "Public sends go through Private. Private is empty.");
  assert.equal(fillShutLine(null), "Public sends go through Private. Private is empty.", "not read: never a made-up figure");
  assert.equal(TOP_UP_PRIVATE, "Top up Private");
  const form = src("./SendForm.tsx");
  assert.match(form, /\{fillShut && source\.privateOnly && \(\n\s+<div className="wl-send2__part" data-testid="send-fill-shut">\n\s+<p className="zf-small">\{fillShutLine\(fillShut\.usd\)\}<\/p>\n\s+<button type="button" className="zf-link" onClick=\{fillShut\.onTopUp\} data-testid="send-top-up">\{TOP_UP_PRIVATE\}<\/button>/, "a quiet text link under the sub-line, only on a Private-only row");
  const sheet = src("./SendSheet.tsx");
  assert.match(sheet, /\{\.\.\.\(SAFE_SEND_OPEN \? \{\} : \{ fillShut: \{ usd: privateFigure\(/, "control: the fill open, no card");
  assert.match(sheet, /onTopUp: \(\) => \{ onClose\(false\); shell\.openApp\("wallet", "private\/add"\); \}/);
  const wallet = src("../WalletApp.tsx");
  assert.match(wallet, /if \(t === "private\/add"\) return web \? \{ kind: "phone", reason: "private" \} : privateOpen\(\) \? \{ kind: "toPrivate" \} : null;/, "it opens the fill: Safe → Private (control: the web wallet, its On your phone page)");
  assert.match(wallet, /if \(asked === "private\/add" && !web && privateOpen\(\)\) setView\(\{ kind: "toPrivate" \}\);/);
});
