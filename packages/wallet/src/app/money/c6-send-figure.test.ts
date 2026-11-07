// Sim test, MUST 1 (b): Send from Private's NEAR capped the keypad at "$6.85" while the button said
// "Send $6.86": the keypad floored the cap, the button rounded the coins' worth. One flow, one figure: the keypad's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateCap, sendFigure } from "./send-cap.ts";

test("c6 MUST 1 (b): Send's keypad and its button say one cent figure, the one it sends (control: Max with nothing typed rounds once, the same for both)", () => {
  // 1.5486 NEAR at $4.4297 is $6.8598...: the cap's keypad figure is $6.85 (never more than Private holds)
  const max = "1.5486", per = 4.4297;
  const cap = privateCap("11.29", max, per, false)!;
  assert.equal(cap.typed, "6.85");
  const usd = Number(cap.amount) * per;
  assert.equal(sendFigure({ typed: cap.typed, exact: false, usd }), cap.typed, "the button says the keypad's $6.85, never $6.86");
  // control: nothing typed (Max, the slider): the worth, down to the cent once (audit, 6 Nov: never a cent over the at-most
  // line), on the keypad and the button alike
  assert.equal(sendFigure({ typed: null, exact: false, usd }), "6.85");
  assert.equal(sendFigure({ typed: null, exact: false, usd: null }), null, "no price: the coins, no dollar figure");
});

test("c6, the audit's condition: the cent figure is display only; the typed amount reaches the quote unchanged (control: the rounded figure is never in the ask)", async () => {
  const { readFileSync } = await import("node:fs");
  const { safeAmount } = await import("./send-sources.ts");
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  // the ask (onSend) and the fee's quote carry the coin amount the keypad worked from the typed figure, and the raw dollars
  assert.match(form, /onSend\(\{\s*source, recipient: who\.recipient, network, [^\n]*amountIn: amount\.replace\(\/\\\.\$\/, ""\), usd,/);
  assert.match(form, /feeOf\(\{ source, recipient: who\.recipient, network, amountIn: amount\.replace\(\/\\\.\$\/, ""\), usd \}\)/);
  // `figure` (the rounded cents) is read only by the keypad's text and the button's words
  const uses = form.split("\n").filter((l) => /\bfigure\b/.test(l) && !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l));
  assert.ok(uses.every((l) => /const figure =|const shown =|const label =/.test(l)), uses.join("\n"));
  // the quote's amount is the ask's amountIn, as typed: 1.5486 NEAR stays 1.5486, never re-worked from "6.85"
  const source = { id: "safe:near", row: null, tokenId: "near", label: "", place: "your Safe", symbol: "NEAR", chain: "near", amount: "1.5486", usd: "6.86", max: "1.5486" };
  assert.equal(safeAmount({ source: source as never, amountIn: "1.5486", usd: 1.5486 * 4.4297 }), "1.5486");
  // control: the display figure and the amount sent are different texts, and only the first is rounded
  assert.notEqual(sendFigure({ typed: "6.85", exact: false, usd: 1.5486 * 4.4297 }), "1.5486");
});
