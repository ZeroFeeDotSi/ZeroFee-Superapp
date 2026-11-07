// the audit's Trade audit T1 (8 Nov): the receipt, the list row and Activity said the quote's coins as the coins that landed. A
// Solana buy done on one node's word carries the quote's figure as an estimated fill until the two-node check reads the
// chain; a sale's receipt said the quote's dollars under "Sold". Now each says "about" the quote's figure until the read
// books, then the read figure, and the open receipt and row redraw when it books. Controls beside each. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { receiptWords } from "@zerofee/design/receipt.ts";
import type { TradeRecord } from "../service.ts";
import { tradeCard } from "./job-cards.ts";
import { rowBuyLine } from "./screens/row-buy.ts";
import * as fw from "./fill-words.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const Q = { side: "buy", chain: "sol", coin: "Dope111", symbol: "DOPE", decimals: 6, getRaw: "7505000000", getMinRaw: "7400000000", payRaw: "33000000", payUsd: 5, getUsd: 4.95, feeUsd: 0.002 };
const SQ = { ...Q, side: "sell", getRaw: "32000000", payRaw: "7505000000", getUsd: 4.88, payUsd: 4.95 };
const rec = (o: Partial<TradeRecord>): TradeRecord => ({ id: "t1", kind: "buy", chain: "sol", symbol: "DOPE", status: "done", amountUsd: 5, hashes: ["h1"], startedAt: 0, endedAt: 1, quote: Q as never, ...o });
const est = { txHash: "h1", estimated: true as const, got: "7505000000", spent: "33000000", fee: "0" };
const read = { txHash: "h1", got: "7488000000", spent: "33000000", fee: "5000" };
const costs = { coinUsd: 5, feeUsd: 0.002 };

test("T1: the receipt's landed line says \"About 7,505 DOPE\" while the fill is the quote's; the chain's read figure plain (control: no about)", () => {
  assert.equal(receiptWords({ state: "landed", side: "buy", coin: "DOPE", coinAmount: "7,505", where: "your SOL wallet", about: true }).line, "About 7,505 DOPE · in your SOL wallet");
  assert.equal(receiptWords({ state: "landed", side: "buy", coin: "DOPE", coinAmount: "7,488", where: "your SOL wallet" }).line, "7,488 DOPE · in your SOL wallet", "control");
  assert.equal(receiptWords({ state: "landed", side: "buy", coin: "DOPE", coinAmount: "7,505", where: "your SOL wallet", about: true }).head, "Bought", "the head stays");
});

test("T1: landedSaid: a buy on one node's word is about the quote's coins; booked, the chain's coins and its dollars in all", () => {
  const o = { hero: "$5.00", sold: "7,505" };
  assert.deepEqual(fw.landedSaid(rec({ fill: est, verifying: true }), o), { got: "7,505", about: true, usd: "$5.00" });
  assert.deepEqual(fw.landedSaid(rec({}), o), { got: "7,505", about: true, usd: "$5.00" }, "no fill yet: the quote's, about");
  assert.deepEqual(fw.landedSaid(rec({ fill: read, costs, amountUsd: 5.01 }), o), { got: "7,488", about: false, usd: "$5.01" }, "control: booked");
});

test("T1: landedSaid: a sale says \"About $4.86\" until the chain's figure books, then the booked figure plain; its coins sent are known", () => {
  const o = { hero: "$4.86", sold: "7,505" };
  const s = (x: Partial<TradeRecord>) => rec({ kind: "sell", quote: SQ as never, amountUsd: 4.86, ...x });
  assert.deepEqual(fw.landedSaid(s({ fill: { ...est, got: "32000000", spent: "7505000000" }, verifying: true }), o), { got: "7,505", about: false, usd: "About $4.86" });
  assert.deepEqual(fw.landedSaid(s({ fill: { ...read, got: "31900000", spent: "7505000000" }, costs: { coinUsd: 4.85, feeUsd: 0.002 } }), o), { got: "7,505", about: false, usd: "$4.85" }, "control: booked");
});

test("T1: the list row says \"Bought · about 7,505 DOPE\" on the quote's figure; the chain's read plain (control)", () => {
  const a = fw.rowSaid(rec({ fill: est, verifying: true }));
  assert.deepEqual(a, { got: "7,505 DOPE", about: true });
  assert.equal(rowBuyLine({ phase: "landed", at: 0, ...a }, "DOPE"), "Bought · about 7,505 DOPE");
  const b = fw.rowSaid(rec({ fill: read, costs }));
  assert.equal(rowBuyLine({ phase: "landed", at: 0, ...b }, "DOPE"), "Bought · 7,488 DOPE", "control");
  assert.equal(rowBuyLine({ phase: "away", at: 0, got: "7,505 DOPE" }, "DOPE"), "On its way · about 7,505 DOPE", "control: one about while away");
});

test("T1: Activity's buy row says \"About 7,505 DOPE\" while the fill is estimated; the chain's read plain once booked", () => {
  assert.equal(tradeCard(rec({ fill: est, verifying: true })).units, "About 7,505 DOPE");
  assert.equal(tradeCard(rec({ fill: read, costs })).units, "7,488 DOPE", "control: booked");
  assert.equal(tradeCard(rec({ fill: est, verifying: true })).usdAbout, undefined, "a buy's dollars are what it paid: never about");
});

test("T1: Activity's sale row says its dollars \"about\" until booked; its coins sent plain (one about per row)", () => {
  const s = (x: Partial<TradeRecord>) => rec({ kind: "sell", quote: SQ as never, amountUsd: 4.86, ...x });
  const a = tradeCard(s({ fill: { ...est, got: "32000000", spent: "7505000000" }, verifying: true }));
  assert.equal(a.usdAbout, true);
  assert.equal(a.units, "7,505 DOPE", "the coins it sent: no about");
  assert.equal(tradeCard(s({ fill: { ...read, got: "31900000", spent: "7505000000" }, costs: { coinUsd: 4.85, feeUsd: 0.002 } })).usdAbout, undefined, "control: booked");
  assert.equal(tradeCard(s({ status: "failed", hashes: ["h1"] })).usdAbout, undefined, "control: a sale that didn't go has no about");
  assert.match(src("./screens/JobCard.tsx"), /card\.usdAbout \? `About \$\{usd\(card\.usd\)\}` : usd\(card\.usd\)/, "JobCard draws it");
});

function fakeSvc(first: TradeRecord) {
  let now = first;
  const fns = new Set<() => void>();
  return {
    activity: async () => [now],
    on: (f: () => void) => { fns.add(f); return () => fns.delete(f); },
    set(r: TradeRecord) { now = r; for (const f of [...fns]) f(); },
    get listening() { return fns.size; },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("T1: whenBooked tells once the record books (by id, a new object), then stops listening", async () => {
  const svc = fakeSvc(rec({ fill: est, verifying: true }));
  const got: TradeRecord[] = [];
  fw.whenBooked(svc, "t1", (r) => got.push(r));
  await tick();
  assert.equal(got.length, 0, "still the quote's");
  svc.set(rec({ fill: read, costs }));
  await tick();
  assert.equal(got.length, 1);
  assert.equal(got[0]!.fill!.got, "7488000000");
  assert.equal(svc.listening, 0, "stopped");
  svc.set(rec({ fill: read, costs, amountUsd: 6 }));
  await tick();
  assert.equal(got.length, 1, "once");
});

test("T1: whenBooked stops with no redraw on a turn (expired) or an amount never proven (done, no check left, no figure)", async () => {
  for (const turned of [rec({ status: "expired" }), rec({ fill: est })]) {
    const svc = fakeSvc(rec({ fill: est, verifying: true }));
    let told = 0;
    fw.whenBooked(svc, "t1", () => told++);
    svc.set(turned);
    await tick();
    assert.equal(told, 0);
    assert.equal(svc.listening, 0);
  }
});

test("T1: the sheet and the row draw the said figures and redraw when the trade books (wiring)", () => {
  const sheet = src("./screens/TradeSheet.tsx");
  assert.match(sheet, /landedSaid\(rec, said\)/, "the sheet's receipt from landedSaid");
  assert.match(sheet, /whenBooked\(svc, rec\.id,/, "redrawn when it books");
  assert.doesNotMatch(sheet, /got: coinsOf\(rec\.fill\)/, "control: the old figure, the quote's as fact, is gone");
  const moment = src("./screens/Moment.tsx");
  assert.match(moment, /\{\.\.\.\(about \? \{ about \} : \{\}\)\}/, "the Moment hands about to the Receipt");
  const row = src("./screens/Discover.tsx");
  assert.match(row, /rowSaid\(rec\)/, "the row's figure from rowSaid");
  assert.match(row, /whenBooked\(svc, rec\.id,/, "the row redrawn when it books");
});
