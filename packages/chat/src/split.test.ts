// C-1 Split the bill (typed total): the shares, the two messages it posts, and what the asker sees come in, from their
// own Activity only. Each rule with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Movement } from "@zerofee/wallet/types.ts";
import { readRequest, requestText, shown } from "./messages.ts";
import { SPLIT_COUNT_MS, cameIn, cameInWords, readSplit, shareAmount, splitBill, splitLive, splitRequest, splitText } from "./split.ts";

const ok = (r: ReturnType<typeof splitBill>) => ("ok" in r ? r.ok : assert.fail(`expected shares, got ${JSON.stringify(r)}`));
const line = (r: ReturnType<typeof splitBill>) => ("line" in r ? r.line : assert.fail(`expected a line, got ${JSON.stringify(r)}`));

test("shares: the total divided, cut to the cent; the cent left over stays with the asker", () => {
  assert.deepEqual(ok(splitBill("50", 4)), { totalCents: 5000, people: 4, eachCents: 1250, askerCents: 1250 });
  assert.deepEqual(ok(splitBill("10", 3)), { totalCents: 1000, people: 3, eachCents: 333, askerCents: 334 });
  assert.deepEqual(ok(splitBill("$1,234.56", 20)), { totalCents: 123456, people: 20, eachCents: 6172, askerCents: 6188 });
  assert.equal(ok(splitBill("0.02", 2)).eachCents, 1);
  // controls: what is never split
  assert.match(line(splitBill("0.01", 2)), /less than a cent/);
  assert.match(line(splitBill("abc", 2)), /in dollars/);
  assert.match(line(splitBill("0", 2)), /in dollars/);
  assert.match(line(splitBill("5.001", 2)), /in dollars/);
  assert.match(line(splitBill("50", 1)), /2 to 20/);
  assert.match(line(splitBill("50", 21)), /2 to 20/);
  assert.match(line(splitBill("50", 2.5)), /2 to 20/);
});

test("the split line is plain text, reads back, and is never a chip", () => {
  const s = ok(splitBill("50", 4));
  const text = splitText(s);
  assert.equal(text, "Splitting a $50.00 bill 4 ways. Each pays $12.50.");
  assert.deepEqual(readSplit(text), { totalCents: 5000, people: 4, eachCents: 1250 });
  assert.equal(readRequest(text), null, "a split line is never a request");
  assert.equal(readSplit("Splitting a $1,234.56 bill 20 ways. Each pays $61.72.")?.totalCents, 123456);
  // controls: shares that don't add up, or a broken line, read as nothing
  assert.equal(readSplit("Splitting a $10.00 bill 4 ways. Each pays $9.00."), null);
  assert.equal(readSplit("Splitting a $50.00 bill 1 ways. Each pays $50.00."), null);
  assert.equal(readSplit("splitting a $50.00 bill 4 ways. Each pays $12.50."), null);
  assert.ok(new TextEncoder().encode(splitText(ok(splitBill("999999.99", 20)))).length <= 255, "fits a BitChat private message");
});

test("review M1: a split asks in a dollar coin only, so the share is exact and never priced from an old list", () => {
  assert.equal(shareAmount(1250, "USDC"), "12.50");
  assert.equal(shareAmount(333, "USDT"), "3.33");
  // controls: every other coin is refused (the sheet says "A split asks in USDC or USDT")
  for (const c of ["SOL", "ETH", "BNB", "NEAR", "BTC", "USDX"]) assert.equal(shareAmount(1250, c), null, c);
  const app = readFileSync(new URL("./app/ChatApp.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app.slice(app.indexOf("export function RequestSheet")), /priceUsd\)|shareAmount\([^)]*price/, "no price sizes a share");
});

const SOL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const asked = "2026-11-03T08:00:00.000Z";
const dep = (o: Partial<Movement>): Movement => ({ id: crypto.randomUUID(), kind: "deposit", status: "done", from: "sol", to: USDC_SOL, amount: "12.5", startedAtIso: "2026-11-03T08:05:00.000Z", updatedAtIso: "2026-11-03T08:05:00.000Z", explorerUrls: [], ...o });

test("what came in: only the asker's own deposits of the share, in that coin, on that network, since the ask", () => {
  const r = { amount: "12.50", chain: "sol" };
  assert.equal(cameIn(r, USDC_SOL, asked, 4, [dep({}), dep({})]), 2);
  assert.equal(cameIn(r, USDC_SOL, asked, 4, [dep({ status: "moving" })]), 0, "review L2: still on its way can still fail");
  // controls: each of these is not a share that came in
  assert.equal(cameIn(r, USDC_SOL, asked, 4, [dep({ startedAtIso: "2026-11-03T07:00:00.000Z" })]), 0, "before the ask");
  assert.equal(cameIn(r, USDC_SOL, asked, 4, [dep({ amount: "12.49" })]), 0, "another amount");
  assert.equal(cameIn(r, USDC_SOL, asked, 4, [dep({ to: "nep141:sol.omft.near" })]), 0, "another coin");
  assert.equal(cameIn(r, USDC_SOL, asked, 4, [dep({ from: "base" })]), 0, "another network");
  assert.equal(cameIn(r, USDC_SOL, asked, 4, [dep({ kind: "transfer" })]), 0, "money going out");
  assert.equal(cameIn(r, USDC_SOL, asked, 4, [dep({ status: "problem" })]), 0, "a failed deposit");
  assert.equal(cameIn(r, USDC_SOL, asked, 2, [dep({}), dep({}), dep({})]), 1, "never more than the others");
});

test("the asker's words: what reached them, never who sent it (D98, review L2)", () => {
  const s = { eachCents: 1250 };
  assert.equal(cameInWords(0, s), "No payment of $12.50 has reached your Safe since you asked.");
  assert.equal(cameInWords(1, s), "1 payment of $12.50 has reached your Safe since you asked.");
  assert.equal(cameInWords(2, s), "2 payments of $12.50 have reached your Safe since you asked.");
  for (const n of [0, 1, 2]) assert.doesNotMatch(cameInWords(n, s), /paid|of 3|All /, "never says people paid");
});

test("review L5: a split is counted for 7 days, then left alone", () => {
  const now = Date.parse("2026-11-10T08:00:00.000Z");
  assert.ok(splitLive(new Date(now - SPLIT_COUNT_MS + 60_000).toISOString(), now));
  assert.ok(!splitLive(new Date(now - SPLIT_COUNT_MS - 60_000).toISOString(), now));
});

test("review M2: Activity is read before the split goes out, so older deposits are dated before the ask", () => {
  const app = readFileSync(new URL("./app/ChatApp.tsx", import.meta.url), "utf8");
  const make = app.slice(app.indexOf("export function RequestSheet"));
  const read = make.indexOf('if (split) await bridge.call("ledger.activity"');
  const posted = make.indexOf("await onSplit(splitText(split), request)");
  assert.ok(read > 0 && posted > read, "read first, then post");
});

test("the request a split posted is the asker's next own message; someone else's in between is skipped", () => {
  const req = requestText({ amount: "12.50", coin: "USDC", chain: "sol", address: SOL });
  const lines = [{ mine: true, text: "Splitting a $50.00 bill 4 ways. Each pays $12.50." }, { mine: false, text: req.replace(SOL, "x") }, { mine: true, text: req }];
  assert.deepEqual(splitRequest(lines, 0, readRequest), { amount: "12.50", coin: "USDC", chain: "sol", address: SOL });
  // control: a stranger's request right after my split line is never taken as mine
  const theirs = [{ mine: true, text: "Splitting a $50.00 bill 4 ways. Each pays $12.50." }, { mine: false, text: req }];
  assert.equal(splitRequest(theirs, 0, readRequest), null);
  // review L3: many strangers in between, and my request sorted just before in the same second, are both found
  const busy = [{ mine: true, text: "Splitting a $50.00 bill 4 ways. Each pays $12.50." }, ...Array.from({ length: 6 }, () => ({ mine: false, text: "hi" })), { mine: true, text: req }];
  assert.ok(splitRequest(busy, 0, readRequest));
  const at = "2026-11-03T08:00:01.000Z";
  const swapped = [{ mine: true, text: req, atIso: at }, { mine: false, text: "hi", atIso: at }, { mine: true, text: "Splitting a $50.00 bill 4 ways. Each pays $12.50.", atIso: at }];
  assert.ok(splitRequest(swapped, 2, readRequest));
  // control: my request from an earlier second is an older ask, not this split's
  const older = [{ mine: true, text: req, atIso: "2026-11-03T07:59:00.000Z" }, { mine: true, text: "Splitting a $50.00 bill 4 ways. Each pays $12.50.", atIso: at }];
  assert.equal(splitRequest(older, 1, readRequest), null);
});

test("proof row (in): a split asks its dollars on Solana, Robinhood Chain, BNB Chain or NEAR; the request reads on each", () => {
  const EVM = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
  for (const r of [
    { amount: "12.50", coin: "USDC", chain: "sol", address: SOL },
    { amount: "12.50", coin: "USDC", chain: "hood", address: EVM },
    { amount: "12.50", coin: "USDT", chain: "bsc", address: EVM },
    { amount: "12.50", coin: "USDC", chain: "near", address: "alice.near" },
  ]) assert.deepEqual(readRequest(requestText(r)), r, r.chain);
  assert.match(requestText({ amount: "12.50", coin: "USDC", chain: "hood", address: EVM }), / on Robinhood Chain to /, "never the raw id");
});

test("a payer's side: the split line is text; the request is the usual chip (D85: Send on Hidden, never auto-pay)", () => {
  const app = readFileSync(new URL("./app/ChatApp.tsx", import.meta.url), "utf8");
  // the split only ever posts its two messages; it opens nothing and pays nothing
  const onSplit = app.match(/onSplit=\{async \(line, r\) => \{.*?\}\} onProblem/g) ?? [];
  assert.equal(onSplit.length, 2, "in a place and in a private chat");
  for (const s of onSplit) assert.doesNotMatch(s, /openMoney|pay\(|subwallet|ledger\./);
  // the progress line reads Activity, never anyone else's wallet
  assert.match(app, /function SplitCameIn[\s\S]*?cameIn\(request, assetId, lines\[at\]!\.atIso, split\.people, activity\)/);
  // control: the pattern catches a split that pays
  assert.match("onSplit={async (line, r) => { void money.pay(r); }}", /pay\(/);
  // a stranger's split line shows as text: no chip, no Tip
  const m = shown({ id: "a".repeat(64), pubkey: "b".repeat(64), created_at: 1_762_000_000, kind: 20000, tags: [["g", "u0qj"]], content: "Splitting a $50.00 bill 4 ways. Each pays $12.50.", sig: "c".repeat(128) }, new Set());
  assert.equal(m.request, undefined);
});
