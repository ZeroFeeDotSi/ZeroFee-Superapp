// The Safe's Swap sheet, the UI reviewer's ruling and QA's conditions (6 Nov): the first frame shows everything; a refusal
// takes line 1's slot, never the fee block, and the one button reads Try again; any edit, the amount or a coin, ends it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { jobTaken, claim, runJob } from "@zerofee/shell-api/job-run.ts";
import { ROW_USDC, SWAP_WORDS, floorOf, paysHere, routeOf, saidOnSheet, swapBlock, swapFloor, swapStays, swapSub, type SwapRoute } from "./swap-corridor.ts";
import { stoppedLine } from "./swap-refused.ts";

const sheet = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./move-swap.css", import.meta.url), "utf8");
const safeOut: SwapRoute = { kind: "topup", coin: "USDC", to: "sol" };
const BUSY = "Another job is using this money, so nothing moved. Try again once that job is signed.";
const idle = { again: null, block: null, tried: false, said: false, priceDown: false };

test("the busy refusal: a job on the same money is refused before its call, in the reviewer's words, said on the sheet (no shell screen behind it)", async () => {
  const release = claim(["safe"])!;
  let called = false;
  const end = await runJob({ tasks: undefined, title: "Swap", safe: true, money: ["safe"], call: async () => { called = true; return { ok: 1 }; }, declined: () => false, made: () => undefined });
  release();
  assert.ok("refused" in end, "refused");
  assert.equal(called, false, "before its call");
  assert.equal(stoppedLine(end.refused), BUSY);
  assert.equal(saidOnSheet(jobTaken()), true);
  assert.match(sheet, /saidOnSheet\(end\.refused\) \? setStopped\(end\.refused\)/);
});

test("a refusal shown: it takes line 1's slot and the one button reads its Try again, which asks again", () => {
  assert.deepEqual(swapFloor({ ...idle, again: "Try again" }), { line: "stopped", tap: "again", label: "Try again" });
  assert.match(sheet, /\{on\.line === "stopped" && <p className="zf-small" role="alert" data-testid="swap-stopped">\{refused\}<\/p>\}/);
  assert.match(sheet, /const on = swapFloor\(\{ again: refused \? stopped!\.next\.label : null,/);
  assert.equal(sheet.match(/data-testid="swap-go"/g)?.length, 1, "one button");
  assert.match(sheet, />\{on\.label\}<\/button>/, "its words are the floor's");
  assert.match(sheet, /if \(on\.tap === "swap" && block === SWAP_WORDS\.amount\) return setTried\(true\);[^\n]*void go\(\);/, "Try again runs the swap again");
  assert.doesNotMatch(sheet, /zf-btn--quiet" data-testid="swap-/, "never a second grey one");
  assert.match(sheet.slice(sheet.indexOf('className="wl-swap2__floor"')), /^[\s\S]*?data-testid="swap-go"[\s\S]*?<\/button>\n\s*<\/div>\n\s*<\/div>/, "nothing under the button");
});

test("QA's condition 1: any edit, the amount or a coin, clears the refusal and the button reads Swap again", () => {
  assert.match(sheet, /const edited = \(\) => \{ setLine\(null\); setStopped\(null\); setTried\(false\); \};/);
  assert.match(sheet, /const onUsd = \(v: string\) => \{ edited\(\); setUsd\(v\); \};/, "the keypad, the chips, Max and a pasted amount all come through onUsd");
  assert.match(sheet, /const picked = \(which: "pay" \| "get", c: PickCoin\) => \{\n\s*setPicking\(null\); edited\(\);/, "You pay and You get both");
  assert.deepEqual(swapFloor(idle), { line: "stays", tap: "swap", label: SWAP_WORDS.title }, "no refusal: Swap");
  assert.match(sheet, /const refused = stopped && !busy && !block \? stoppedLine\(stopped\) : null;/, "the slot follows the state: no stopped, no refusal");
});

test("QA's condition 2: the fee line is never what a refusal replaces: the fee block is its own line, under every state, and back with the figure once cleared", () => {
  const fee = sheet.indexOf('<div className="zf-fee">'), line = sheet.indexOf('data-testid="swap-line"'), go = sheet.indexOf('data-testid="swap-go"');
  assert.ok(line < fee && fee < go, "line 1, the fee block, the button");
  assert.match(sheet, /\{route && \(\n\s*<div className="zf-fee">/, "gated on the route alone: no refusal hides it");
  assert.match(sheet, /price\.waiting \? <p className="zf-small" role="status" data-testid="swap-price-wait">[^\n]*: price\.figure && <p className="zf-small" data-testid="swap-fee">\{price\.figure\}<\/p>\}/);
  assert.match(sheet, /<p className="zf-small" data-testid="swap-paid">\{price\.paid\}<\/p>/);
  assert.doesNotMatch(sheet, /const price = useSwapPrice\([^\n]*stopped/, "a refusal never stops the price: the figure stays and comes back with the amount");
  assert.match(sheet, /const price = useSwapPrice\(bridge, pay\?\.place \?\? null, get, amount, !route \|\| !!block\);/);
});

test("button words, each state: Swap, Try again for a refusal or a price, Swap off under the least", () => {
  const under = swapBlock({ route: safeOut, usd: 1, most: 100 });
  assert.deepEqual(swapFloor({ ...idle, block: under }), { line: "why", tap: "swap", label: "Swap" }, "under the least: nothing to try again; the button stays Swap, off");
  assert.match(sheet, /disabled=\{busy \|\| \(on\.tap === "swap" && \(nothing \|\| !!short \|\| services\.down \|\| \(!!block && block !== SWAP_WORDS\.amount\)\)\)\}/);
  assert.deepEqual(swapFloor({ ...idle, block: SWAP_WORDS.amount }), { line: "stays", tap: "swap", label: "Swap" }, "nothing typed: the privacy line stays");
  assert.deepEqual(swapFloor({ ...idle, block: SWAP_WORDS.amount, tried: true }), { line: "why", tap: "swap", label: "Swap" }, "a press at $0 says Pick an amount");
  assert.deepEqual(swapFloor({ ...idle, again: "Try again", block: null, said: true, priceDown: true }).line, "stopped", "a refusal comes first");
});

test("the price's Try again (no Sim switch, so proved here): its line in the slot; the one button re-asks the price, never the swap", () => {
  assert.deepEqual(swapFloor({ ...idle, priceDown: true }), { line: "price", tap: "price", label: "Try again" });
  assert.deepEqual(swapFloor({ ...idle, priceDown: true, said: true }), { line: "said", tap: "price", label: "Try again" }, "the service's own line, with the same retry");
  assert.deepEqual(swapFloor({ ...idle, priceDown: true, block: SWAP_WORDS.most("$5.00") }), { line: "why", tap: "swap", label: "Swap" }, "an amount that can't go: its why first");
  assert.match(sheet, /priceDown: price\.late \|\| !!price\.said/);
  assert.match(sheet, /\{on\.line === "price" && <p className="zf-small" role="status" data-testid="swap-price-late">\{price\.late \? SWAP_PRICE_LATE : price\.said\}<\/p>\}/);
  assert.match(sheet, /if \(on\.tap === "price"\) return price\.again\(\);/);
  assert.match(sheet, /again: \(\) => setTries\(\(n\) => n \+ 1\)/);
  assert.match(sheet, /\[bridge, from, to, usd, off, tries\]/, "tries re-runs the quote");
});

test("under the least: the reviewer's words; the standing line above the keypad is gone; no chip or Max under it", () => {
  assert.equal(swapBlock({ route: safeOut, usd: 2, most: 100 }), "Swaps start at $2.09.");
  assert.equal(swapBlock({ route: routeOf("safe-near", "safe-usdc", () => true), usd: 2, most: 100 }), "Swaps start at $2.09.");
  assert.equal(floorOf(safeOut).usd, 2.09);
  assert.doesNotMatch(sheet, /swap-floor|floorSay/);
  assert.match(sheet, /\{on\.line === "why" && <p className="zf-small" role="status" data-testid="swap-why">\{block\}<\/p>\}/);
  assert.match(sheet, /Number\(d\) < floor\.usd/);
});

test("the one sub-line slot: what one swap can take until an amount can go, then what arrives; a swap with no way back says so", () => {
  const part = "Up to $317.46 can go in one swap.";
  assert.deepEqual(swapSub({ back: null, arrives: null, part }), { id: "swap-part", text: part });
  assert.deepEqual(swapSub({ back: null, arrives: "About 0.09 SOL arrives. About 1 min.", part }), { id: "swap-arrives", text: "About 0.09 SOL arrives. About 1 min." });
  assert.equal(swapSub({ back: "x", arrives: "y", part }).id, "swap-back");
  assert.equal(swapSub({ back: null, arrives: null, part: null }), null, "empty: its height stays");
  assert.doesNotMatch(sheet.slice(sheet.indexOf('className="wl-swap2__scroll"'), sheet.indexOf('className="wl-swap2__floor"')), /wl-sheet-lead|swap-why|swap-stays|Who/, "nothing else above the keypad");
});

test("line 1 is the privacy line: its figure, with Who can see this? a link at its end, opening the same words on their own sheet", () => {
  // T-F (6 Nov): the cover clause only when the Safe really covers (swap-cover.ts); else Private's line alone
  assert.equal(swapStays(safeOut, 10, undefined, true, { kind: "cover" }), "$10.00 leaves Private. If Private is short, your Safe covers the rest.");
  assert.equal(swapStays(safeOut, 10), "$10.00 leaves Private.");
  assert.match(sheet, /\{stays && <span data-testid="swap-stays">\{stays\} <\/span>\}\{privateLine\(route\) && <button type="button" className="zf-link wl-swap2__who" onClick=\{\(\) => setWho\(true\)\} data-testid="swap-who">\{MOVE_WORDS\.who\}<\/button>\}/);
  assert.match(sheet, /<MoneySheet title=\{MOVE_WORDS\.who\} onClose=\{\(\) => setWho\(false\)\}>/);
});

test("the shape, Send's: the keypad gives inside the box, 30 pt rows at least; the floor is its own box and keeps its room", () => {
  assert.match(css, /\.wl-swap2__scroll > \.zf-keypad \{ flex: 0 1 224px; min-height: 120px;[^}]*grid-auto-rows: minmax\(0, 1fr\);/, "4 rows x 30");
  assert.match(css, /\.wl-swap2__scroll \{ flex: 1 1 auto; min-height: 0;[^}]*overflow-y: auto;/);
  assert.match(css, /\.wl-swap2__floor \{ position: relative; flex: none;/);
  assert.match(css, /\.wl-swap2__line \{ min-height: 36px;/, "two lines' room, so a refusal moves nothing");
  assert.match(css, /\.wl-swap2__floor > \.zf-fee \{ min-height: 54px; \}/);
});

test("Move's refusal is in the floor's line 1, over its fee block, never down at the long plan's end (the floor's own table: move-floor.test.ts)", () => {
  assert.doesNotMatch(css, /:has\(> \.wl-mv-hero\)/);
  const move = readFileSync(new URL("../screens/MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(move, /<div className="wl-swap2__line" data-testid="move-line">/);
});

test("nothing can go in one swap: the slot says so once, never \"Up to $0.00\", and the sheet's button stays off", () => {
  const route = safeOut;
  assert.equal(swapBlock({ route, usd: 10, most: 0 }), SWAP_WORDS.none);
  assert.equal(swapBlock({ route, usd: 1, most: 0 }), SWAP_WORDS.none, "not the minimum's words: no amount would do");
  assert.equal(swapBlock({ route, usd: 0, most: 0 }), SWAP_WORDS.amount);
  assert.equal(swapFloor({ again: null, block: SWAP_WORDS.none, tried: true, said: false, priceDown: false }).line, "stays", "not said a second time on line 1");
  assert.deepEqual(swapSub({ back: null, arrives: null, part: SWAP_WORDS.none }), { id: "swap-part", text: "Nothing more can go in one swap right now." });
  const [safe] = paysHere({ networks: [], roomUsd: "0", safe: [{ tokenId: ROW_USDC, symbol: "USDC", usd: "50" }] } as never);
  assert.equal(safe.most, 0);
  assert.equal(safe.part, undefined, "no \"Up to $0.00\"");
  assert.match(sheet, /const nothing = !!route && most < 0\.01;/);
  assert.match(sheet, /disabled=\{busy \|\| \(on\.tap === "swap" && \(nothing \|\|/);
});

test("a refusal that stands when the amount can no longer go ends: never a lit Try again whose tap does nothing (audit, 6 Nov)", () => {
  assert.match(sheet, /const refused = stopped && !busy && !block \? stoppedLine\(stopped\) : null;/);
  assert.match(sheet, /if \(!pay \|\| !get \|\| !route \|\| busy \|\| block \|\| short\) return;/, "what it guards: go() stops at block (and at Private short with no cover, T-F)");
  assert.equal(swapFloor({ again: null, block: SWAP_WORDS.none, tried: false, said: false, priceDown: false }).tap, "swap");
  assert.equal(swapFloor({ again: null, block: "You can swap up to $5.00.", tried: false, said: false, priceDown: false }).line, "why", "the reason is said instead");
});
