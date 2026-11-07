// T2-6 (the copy review's walk, 8 Nov) and QA QA's SHOULD: the Buy receipt's words and its Activity row's. "Landed in 0.43 s" says
// "Done in under a second."; the proof line says when its page is still to come; a buy's first step is paid from its
// wallet, by name; a row's time is "now" only in its first 60 s, then the clock time, by the service's own clock (never the
// wall's in a test); the receipt names what lies between "Paid $25.00" and the holding's "$24.85", once, from the trade's
// own quote and fee, never calling the price gap a fee. Controls beside each.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forApps } from "@zerofee/core/bridge";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import type { TradeRecord } from "../service.ts";
import { createTradeService } from "../service.ts";
import { tradeCard } from "./job-cards.ts";
import * as format from "./format.ts";
import * as words from "./receipt-words.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const f = format as unknown as { doneIn(ms: number): string; whenWords(at: number, now: number): string };
const w = words as unknown as { receiptProof(chain: string, hash: string): { line: string; url?: string }; buyCostLine(q: unknown, fee: number | undefined): string | null };
const SIG = "27UckxmYVcsFiu4vJ2QUTV8mGwT8iyWPGGm6aq9BnkdwEDBfgwNyJ7h4V3cQkuGkV8b6aSE6cN3U5pvWkn5U7zEHLR";

test("T2-6: the receipt's time is said done, \"Done in under a second.\" under 1 s, else \"Done in N seconds.\" (control: never \"Landed in\")", () => {
  assert.equal(f.doneIn(430), "Done in under a second.");
  assert.equal(f.doneIn(999), "Done in under a second.");
  assert.equal(f.doneIn(2_400), "Done in 2 seconds.");
  assert.equal(f.doneIn(11_600), "Done in 12 seconds.");
  assert.equal(f.doneIn(1_200), "Done in 1 second.", "one, not ones");
  const m = src("./screens/Moment.tsx");
  assert.match(m, /\{\.\.\.\(landed && landedMs !== undefined \? \{ say: \{ chain: doneIn\(landedMs\) \} \} : \{\}\)\}/, "the receipt's chain line, once landed");
  assert.doesNotMatch(m, /You hold \{symbol\}/, "control: the old label is gone");
});

test("T2-6: the proof line: \"On Solana\" with See proof once the transaction has its page; \"On Solana. Proof page in a moment.\" while not; a chain with no explorer says so (control: never the id)", () => {
  assert.deepEqual(w.receiptProof("sol", SIG), { line: "On Solana", url: `https://solscan.io/tx/${SIG}` });
  assert.deepEqual(w.receiptProof("sol", "sample-7"), { line: "On Solana. Proof page in a moment." });
  assert.deepEqual(w.receiptProof("hood", `0x${"a".repeat(64)}`), { line: "On Robinhood Chain · No public page yet." }, "control: no page will come");
  for (const p of [w.receiptProof("sol", SIG), w.receiptProof("sol", "sample-7")]) assert.ok(!p.line.includes(SIG) && !p.line.includes("sample"), "control: no id");
});

test("T2-6: a buy's first Activity step is \"Paid from your SOL wallet\" (its wallet's real name); control: a sale's is still \"Sent to Solana\"", () => {
  const rec = (o: Partial<TradeRecord>): TradeRecord => ({ id: "r1", kind: "buy", chain: "sol", symbol: "DOPE", status: "done", amountUsd: 25, hashes: ["h"], startedAt: 1_000, sentAt: 1_300, endedAt: 1_700, ...o });
  assert.equal(tradeCard(rec({})).steps[0]!.label, "Paid from your SOL wallet");
  assert.equal(tradeCard(rec({ chain: "bsc" })).steps[0]!.label, "Paid from your BNB wallet");
  assert.equal(tradeCard(rec({ kind: "sell" })).steps[0]!.label, "Sent to Solana", "control");
  // the copy review (8 Nov): the second step never repeats the title ("Bought DOPE"): where the coins landed, that wallet by name
  assert.equal(tradeCard(rec({})).steps[1]!.label, "Landed in your SOL wallet");
  assert.equal(tradeCard(rec({ chain: "hood" })).steps[1]!.label, "Landed in your ETH (RH) wallet");
  assert.equal(tradeCard(rec({ chain: "bsc" })).steps[1]!.label, "Landed in your BNB wallet");
  assert.ok(tradeCard(rec({})).steps.every((s) => s.label !== tradeCard(rec({})).title && s.label !== "Bought"), "never the title again");
  assert.equal(tradeCard(rec({ kind: "sell" })).steps[1]!.label, "Sold", "control: a sale's second step is unchanged");
});

test("T2-6: a row's time is \"now\" only in its first 60 s, then the clock time (\"8:15 am\"); a day before also says its day; by the injected clock", () => {
  const d = new Date(0); d.setHours(8, 15, 20, 0);                     // local, whatever the zone
  const at = d.getTime();
  assert.equal(f.whenWords(at, at), "now");
  assert.equal(f.whenWords(at, at + 59_999), "now");
  assert.equal(f.whenWords(at, at + 60_000), "8:15 am", "control: from 60 s, never \"now\" or \"1 min\"");
  assert.equal(f.whenWords(at, at + 3 * 3_600_000), "8:15 am");
  assert.match(f.whenWords(at, at + 24 * 3_600_000), /^\d{1,2} [A-Z][a-z]{2}, 8:15 am$/, "yesterday: its day too");
  const card = src("./screens/JobCard.tsx");
  assert.match(card, /const at = \(svc\.now \?\? Date\.now\)\(\);/, "the service's own clock");
  assert.match(card, /whenWords\(card\.at, at\)/);
  assert.doesNotMatch(card, /\bago\(card\.at\)/, "control: the old \"now\" for the first minute and \"2 min\" after");
});

test("T2-6: the service's clock is the injected one (TradeServiceDeps.now), never the wall's", () => {
  const svc = createTradeService({ bridge: forApps(createMockBridge({ latencyMs: 0 }), "trade"), engineFor: () => { throw new Error("no engine"); }, chains: ["sol"], now: () => 4_242 } as Parameters<typeof createTradeService>[0]);
  assert.equal((svc as unknown as { now(): number }).now(), 4_242);
});

test("QA QA's SHOULD: a buy's receipt names the gap once: its quote over the market price and its network fee, never calling the gap a fee; none under a cent (controls)", () => {
  // the Sim's walk: $25.00 paid; its coins worth $24.925 at the quote's own market price; a $0.002 network fee
  const q = { payUsd: 25, getUsd: 24.925, feeUsd: 0.002 };
  assert.equal(w.buyCostLine(q, 0.002), "About $0.08 over the market price. Fee $0.002.");
  assert.equal(w.buyCostLine({ ...q, getUsd: 24.996 }, 0.002), "Fee $0.002.", "control: a gap under a cent says none");
  assert.equal(w.buyCostLine(q, 0), "About $0.08 over the market price.", "control: no fee, none said");
  assert.equal(w.buyCostLine({ ...q, getUsd: 24.996 }, undefined), null, "control: nothing to name, no line");
  assert.equal(w.buyCostLine(undefined, 0.002), null, "control: no quote recorded, nothing said");
  assert.doesNotMatch(w.buyCostLine(q, 0.002)!.split("Fee")[0]!, /fee/i, "the gap is never called a fee");
  // the sheet reads it from the trade's own record: its quote, the chain's booked fee, else its quote's
  const sheet = src("./screens/TradeSheet.tsx");
  assert.match(sheet, /const costOf = \(r: TradeRecord\): string \| null => \(r\.kind === "buy" \? buyCostLine\(r\.quote, r\.costs\?\.feeUsd \?\? r\.quote\?\.feeUsd\) : null\);/);
  assert.equal((sheet.match(/cost: costOf\(re?c?\)/g) ?? []).length, 2, "both landed receipts (at once, and after a late confirm)");
  // the receipt's one gap line (copy review, 8 Nov): none under the holding, so the coin has one price on the page
  assert.doesNotMatch(src("./screens/Moment.tsx"), /receipt-held-gap|held\.gap/);
  assert.doesNotMatch(src("./held-net.ts"), /heldNetSale/, "control: the receipt-only helper is gone");
});
