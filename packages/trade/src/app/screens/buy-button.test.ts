// UX audit 4 Nov: Buy's first quote waited 250 ms for nothing, and the button's words flipped twice on every amount.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buttonWords, quoteDelayMs, withCommas } from "./buy-button.ts";

test("a new amount is quoted at once, unless a key was just typed (control: typing still waits a beat)", () => {
  assert.equal(quoteDelayMs(true), 0, "opening the page, a chip, money landing");
  assert.equal(quoteDelayMs(false), 250, "control: a typed key waits for the next");
});

test("the button keeps the trade's words while it is checked; only offline, sending and a kept press say otherwise (controls)", () => {
  const base = { online: true, busy: false, queued: false, side: "buy" as const, label: "Buy $25 of DOPE" };
  assert.equal(buttonWords(base), "Buy $25 of DOPE");
  assert.equal(buttonWords({ ...base, queued: true }), "Buying when it's checked…", "a press kept until the check ends");
  assert.equal(buttonWords({ ...base, side: "sell", queued: true, label: "Sell $9.94 of DOPE" }), "Selling when it's checked…");
  assert.equal(buttonWords({ ...base, busy: true }), "Sending…");
  assert.equal(buttonWords({ ...base, online: false }), "You're offline");
  // control: the old flip is gone from the sheet
  const sheet = readFileSync(new URL("./TradeSheet.tsx", import.meta.url), "utf8");
  assert.ok(!sheet.includes("Checking you can sell it back"), "no flip to a checking label");
  assert.ok(sheet.includes("const instant = useRef(true)"), "the page's first quote goes at once");
});

test("not enough money: the hero marks thousands; the short state says the wallet's name, never Spending or Top up (controls)", () => {
  assert.equal(withCommas("9999"), "9,999");
  assert.equal(withCommas("1234567.5"), "1,234,567.5");
  assert.equal(withCommas("999"), "999", "control: under a thousand as it is");
  assert.equal(withCommas("0."), "0.", "a decimal point being typed stays");
  const short = readFileSync(new URL("./ShortChain.tsx", import.meta.url), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/Spending|Top up|ready now/.test(short), "no Spending, Top up or 'ready now' in its words");
  assert.match(short, /`Move money to \$\{walletName\}`/);
  assert.match(short, /webWallet\(\) \? `Add \$\{COIN\[chain\]\}`/, "the web wallet has no Move: Add (a web test)");
  const sheet = readFileSync(new URL("./TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /Buy \$\{usd\(shortBuyNow\)\} instead/, "the smaller buy is the page's button, with cents (T2-5)");
});

test("the Buy page says what its wallet can spend as that, never as the wallet's balance (UI, 4 Nov: $148.22 beside AgentZero's $149.22; control: the figure is the wallet less its fee reserve)", async () => {
  const src = readFileSync(new URL("./TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(src, /From \{walletName\} · <b>\{walletUsd === undefined \? "…" : usd\(walletUsd\)\}<\/b> to spend<\/span>/);
  const { instantUsd, DEFAULT_POLICY } = await import("../../float.ts");
  assert.equal(instantUsd({ onChain: { sol: 149.22 }, floatUsd: 0 } as never, DEFAULT_POLICY as never, "sol"), 148.22, "control: $1 held back for network fees");
});
