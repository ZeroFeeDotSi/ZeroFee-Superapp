import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("a job receipt's Done never touches its last line, and a receipt with no protocol line leaves no gap (control: the through line is only drawn when given)", () => {
  assert.match(css("../../../../design/src/receipt.css"), /\.zf-receipt--job \+ \.zf-btn \{ margin-top: 32px; \}/);
  assert.match(css("./JobMade.tsx"), /\{through && <p className="zf-receipt__line" data-testid=\{`\$\{testid\}-through`\}>\{landed && through === THROUGH_CONFIDENTIAL \? WENT_CONFIDENTIAL : through\}<\/p>\}/);
});

test("ShortChain's job lines are the row's small lines: one size, never a bigger time than the headline", () => {
  const t = css("../../../../trade/src/app/trade.css");
  assert.match(t, /\.tr-inline \[data-testid="short-move-made"\] \{ display: grid; gap: 2px; justify-items: center; \}/);
  assert.match(t, /\.tr-inline \.zf-receipt__line \{ font: 400 13px\/18px var\(--font\); color: var\(--mute\); \}/);
});
