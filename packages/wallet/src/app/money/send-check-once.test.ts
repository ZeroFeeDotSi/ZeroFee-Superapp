// Audit 10's A5 (8 Nov): the Send Check sheet said the figure twice, exact then "about": "Send $5.00 (1.1286 NEAR) through
// NEAR Confidential" over "Amount: about $5.00 (1.1286 NEAR)". Now said once, in the title, with "about" when it is an
// estimate (a priced coin). Each rule has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { amountLine, sheetTitle } from "@zerofee/core/sheet-amount";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";

const near = { title: "Send $5.00 (1.1286 NEAR) through NEAR Confidential", amount: "about $5.00 (1.1286 NEAR)", lines: ["To bob.near on NEAR. Public on NEAR."] };

test("A5: a title that carries the amount draws no Amount line, and an estimate says \"about\" in the title (controls: a dollar coin stays exact; a title without the figure keeps the line)", () => {
  assert.equal(amountLine(near), null);
  assert.equal(sheetTitle(near), "Send about $5.00 (1.1286 NEAR) through NEAR Confidential");
  const usdc = { title: "Send $5.00 (5 USDC) through NEAR Confidential", amount: "$5.00 (5 USDC)", lines: [] };
  assert.deepEqual([amountLine(usdc), sheetTitle(usdc)], [null, usdc.title], "a dollar coin: exact, no about");
  const plain = { title: "Send to bob.near", amount: "about $5.00 (1.1286 NEAR)", lines: [] };
  assert.deepEqual([amountLine(plain), sheetTitle(plain)], [plain.amount, plain.title], "control: the title doesn't say it, the line stays");
  assert.equal(sheetTitle({ ...near, title: "Send about $5.00 (1.1286 NEAR) through NEAR Confidential" }), "Send about $5.00 (1.1286 NEAR) through NEAR Confidential", "never two abouts");
  const view = readFileSync(new URL("../../../../../apps/web/src/shell/ApprovalSheetView.tsx", import.meta.url), "utf8");
  assert.match(view, /<h2 id="approval-title" className="approval__title">\{sheetTitle\(words\)\}<\/h2>/, "the web sheet draws the title through it");
});

test("A5 on the Sim's own sheet: a $5 Send from Private's NEAR says its figure once (control: the sheet's words carry it in the title)", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, hiddenStart: { usdc: "50", near: "20" } });
  let words: { title: string; amount?: string; amountSaid?: true; lines: string[] } | null = null;
  mock.on<{ id: string; words: NonNullable<typeof words> }>("approval.needed", (e) => { words = e.words; void mock.call("approval.answer", { id: e.id, approve: false }); });
  await mock.call("ledger.sendFromSafe", { app: "wallet", tokenId: "nep141:wrap.near", amount: "1.1286", to: { kind: "ledger", accountId: "bob.near" } });
  const w = words as unknown as { title: string; amount?: string; amountSaid?: true; lines: string[] };
  assert.ok(w, "a sheet was asked");
  assert.match(w.title, /^Send \$\d+\.\d\d \(1\.1286 NEAR\) through NEAR Confidential$/, w.title);
  assert.equal(amountLine(w), null, "no Amount line");
  assert.match(sheetTitle(w), /^Send about \$\d+\.\d\d \(1\.1286 NEAR\)/);
});
