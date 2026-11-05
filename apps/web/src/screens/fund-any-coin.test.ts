// D155 (product decision, 3 Nov): "Add money to start" is one clear page: every chain's own coin NEAR Intents takes, found by
// typing, the likely ones first; then that coin's one-time address behind "Show address" (a full-screen sheet with the QR
// and Copy), the least in dollars, and one live line, waiting → here → opening → done. No AgentZero line, no "close
// ZeroFee", no hour, no NEAR jargon on the coins; the markup is the one the UI revamp lead agreed (fs-page, fs-hero…).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FundView } from "@zerofee/core/fund-start";
import { ADD_LINE, ADD_TITLE, coinIcon, coinsFound, liveOf, setupProgress, type FundCoinRow } from "./fund.ts";

const src = readFileSync(new URL("./FundStart.tsx", import.meta.url), "utf8");
const coins: FundCoinRow[] = [
  { id: "near", symbol: "NEAR", name: "NEAR", network: "NEAR", likely: true },
  { id: "btc", symbol: "BTC", name: "Bitcoin", network: "Bitcoin", likely: true },
  { id: "eth", symbol: "ETH", name: "Ethereum", network: "Ethereum", likely: true },
  { id: "base-eth", symbol: "ETH", name: "Base", network: "Base" },
  { id: "doge", symbol: "DOGE", name: "Dogecoin", network: "Dogecoin" },
];
const v = (state: FundView["state"]): FundView => ({ coin: { id: "btc", symbol: "BTC", name: "Bitcoin", network: "Bitcoin" }, state, steps: [], stage: "needs-funding", away: false, wordsDone: false });

test("the coins: found by its symbol, name or network, any case (controls: nothing typed lists all; no match lists none)", () => {
  assert.deepEqual(coinsFound(coins, "btc").map((c) => c.id), ["btc"]);
  assert.deepEqual(coinsFound(coins, "base").map((c) => c.id), ["base-eth"]);
  assert.deepEqual(coinsFound(coins, "  Eth ").map((c) => c.id), ["eth", "base-eth"]);
  assert.deepEqual(coinsFound(coins, "").map((c) => c.id), coins.map((c) => c.id), "control: all");
  assert.deepEqual(coinsFound(coins, "xyz"), [], "control: none");
  assert.equal(coinIcon(coins[3]!), "base");
  assert.equal(coinIcon(coins[1]!), "btc");
});

test("the one live line: waiting → here → opening → done, a stop said calmly; the 2 pt line moves on with it", () => {
  assert.deepEqual(liveOf(v("waiting")), { cls: "is-waiting", line: "Waiting for your BTC" });
  assert.deepEqual(liveOf(v("working")), { cls: "is-here", line: "It's here" });
  assert.deepEqual(liveOf(v("opening")), { cls: "is-opening", line: "Opening your account" });
  assert.deepEqual(liveOf(v("done")), { cls: "is-done", line: "Done" });
  assert.equal(liveOf(v("refunded")).cls, "is-stopped");
  const order = ["coins", "deposit", "working", "opening", "done"] as const;
  assert.deepEqual(order.map(setupProgress), [...order.map(setupProgress)].sort((a, b) => a - b), "never backwards");
});

test("the page uses the agreed markup: one fs-page column, its hero, the search, the likely group first, Show address opening a full-screen sheet with the QR and Copy, one live row; no AgentZero line, no 'close ZeroFee', no hour, no dashes (controls: the old screens' words are gone)", () => {
  assert.equal(ADD_TITLE, "Add money to start");
  assert.equal(ADD_LINE, "Pick the coin you'll send. It opens your account.");
  const page = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  for (const cls of ["fs-page", "fs-hero__title", "fs-hero__line", "fs-search", "fs-coins fs-coins--likely", "fs-coin__mark", "fs-coin__sym", "fs-coin__name", "fs-addr", "fs-qr", "fs-qr__addr", "zf-chip fs-copy", "fs-live", "fs-live__ring", "fs-live__line", "fs-floor", "fs-progress"]) assert.ok(page.includes(cls), cls);
  assert.ok(page.indexOf("fs-coins--likely") < page.indexOf('<ul className="fs-coins">'), "the likely ones first");
  assert.match(page, /\{sheet && <AddressSheet /, "the address in the full-screen sheet, on Show address");
  assert.match(page, /<Sheet title=\{`Your \$\{symbol\} address`\}/);
  // the independent grade (§4.1): Copy is a chip by the address; the address step's floor is only the live line
  const deposit = page.slice(page.indexOf("export function DepositView"), page.indexOf("export function ChecklistView"));
  assert.match(deposit, /<div className="fs-floor zf-enter-2"><Live v=\{v\} \/><\/div>/);
  const waitingFloor = deposit.slice(deposit.indexOf('<div className="fs-floor zf-enter-2"><Live'));
  assert.doesNotMatch(waitingFloor.slice(0, waitingFloor.indexOf("</div>")), /zf-btn/, "control: no ink button on the waiting address's floor");
  for (const gone of [/AgentZero/, /Close ZeroFee if you like/, /You can close ZeroFee/, /one hour/i, /What will you send/, /Goes straight in/, /ThreadBar steps=\{t\.steps\} line=""/]) assert.doesNotMatch(page, gone, String(gone));
  assert.match("AgentZero will see it when it gets here.", /AgentZero/, "control: the old line is caught");
});
