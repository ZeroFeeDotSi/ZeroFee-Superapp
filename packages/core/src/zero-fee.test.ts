// Product decision, 5 Nov. Every money sheet says who gets the fee, directly, and
// that ZeroFee takes nothing; real figures only; no screen says ZeroFee takes a cut.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ADD_PAID, ZERO_FEE, feeFigure, intentsPaid, networkPaid, receivePaid, tradePaid } from "./zero-fee.ts";
import { bannedIn } from "../../../tools/copy/voice.ts";

const LINES = [
  intentsPaid(), intentsPaid(0.13, 3), intentsPaid(0.001, 3), intentsPaid(0.55, 2), ADD_PAID,
  tradePaid("Jupiter", "Solana", 0.013), tradePaid("PumpSwap and Jupiter", "Solana", 0.004), tradePaid("Rhea", "NEAR", null), tradePaid(null, "Robinhood Chain", 0.25),
  networkPaid("Solana"), receivePaid("Robinhood Chain"),
];
/** A line that has ZeroFee take, keep or charge anything but nothing (or anything paid to ZeroFee). */
const zeroFeeTakes = (s: string): boolean => /\bZeroFee(?:'s)? (?:takes|took|keeps|charges|gets|fee)\b(?! nothing)|\b(?:paid|pays|to) ZeroFee\b/i.test(s);
/** The words that scare (the old Swap warning: "Fees are high. They take $0.55 of your $2 (28%)."). */
const scary = (s: string): boolean => /\b(?:high|careful|warning|expensive|they take|a day)\b/i.test(s);

test("each line names who is paid and ends with 'ZeroFee takes nothing.'", () => {
  for (const l of LINES) {
    assert.ok(l.endsWith(` ${ZERO_FEE}`), l);
    assert.ok(!zeroFeeTakes(l), l);
    assert.ok(!scary(l), l);
    assert.deepEqual(bannedIn("packages/wallet/src/app/money/SwapSheet.tsx", l), [], l);
    assert.ok(/NEAR Intents|Jupiter|Rhea|network/.test(l), `names who is paid: ${l}`);
  }
  // controls: a cut for ZeroFee, the old warning and the bare protocol word are each caught
  assert.ok(zeroFeeTakes("ZeroFee takes $0.10."));
  assert.ok(zeroFeeTakes("Pays ZeroFee after each reply."));
  assert.ok(zeroFeeTakes("AgentZero paid ZeroFee 1.2¢ for a reply"));
  assert.ok(scary("Fees are high. They take $0.55 of your $2 (28%)."));
  assert.ok(scary("Turn on AgentZero · $20.00 a day"));
  assert.notDeepEqual(bannedIn("packages/wallet/src/app/money/SwapSheet.tsx", "Your intents balance."), []);
});

test("figures are the quote's own, never made up", () => {
  assert.equal(intentsPaid(0.13, 3), "About $0.13 of your $3 goes to NEAR Intents and the network. ZeroFee takes nothing.");
  assert.equal(intentsPaid(0.004, 3), "Under a cent goes to NEAR Intents and the network. ZeroFee takes nothing.");
  assert.equal(intentsPaid(), "Any fee goes to NEAR Intents and the network. ZeroFee takes nothing.");
  assert.equal(tradePaid("Jupiter", "Solana", 0.013), "Jupiter's fee is in the price. Solana's network gets about $0.01. ZeroFee takes nothing.");
  assert.equal(tradePaid("Rhea", "NEAR", 0), "Rhea's fee is in the price. NEAR gets its own network fee. ZeroFee takes nothing.", "0 is no figure: none said");
  // control: with no figure in, no dollar sign out
  for (const l of [intentsPaid(), intentsPaid(Number.NaN), intentsPaid(-1), tradePaid("Rhea", "NEAR"), networkPaid("Solana"), receivePaid("Solana"), ADD_PAID]) assert.ok(!l.includes("$"), l);
  assert.equal(feeFigure(undefined), null);
  assert.equal(feeFigure(1.234), "about $1.23");
});

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const SHEETS: [string, RegExp][] = [
  ["packages/wallet/src/app/money/SwapSheet.tsx", /data-testid="swap-fees">\{price\.fees\}/],
  ["packages/wallet/src/app/money/CoinSwap.tsx", /data-testid="swap-paid">\{paidLine\(price\.q\)\}/],
  ["packages/wallet/src/app/screens/MoveSheet.tsx", /data-testid="move-paid">\{intentsPaid\(\)\}/],
  ["packages/wallet/src/app/money/SendForm.tsx", /data-testid="send-paid">\{intentsPaid\(\)\}/],
  ["packages/wallet/src/app/money/AddSheet.tsx", /data-testid="add-paid">\{ADD_PAID\}/],
  ["packages/wallet/src/app/money/WebSendSheet.tsx", /data-testid="web-send-paid">\{intentsPaid\(\)\}/],
  ["packages/wallet/src/app/money/WebAddSheet.tsx", /data-testid="web-add-paid">\{receivePaid\(qr\.row\.network\)\}/],
  ["packages/trade/src/app/screens/TradeSheet.tsx", /data-testid="trade-paid">\{paidLine\(q, CHAINS\[coin\.chain\]\.name\)\}/],
];

test("every money sheet shows the line, and none of their words has ZeroFee take anything", () => {
  for (const [f, line] of SHEETS) {
    const src = read(f);
    assert.match(src, line, f);
    const strings = [...src.matchAll(/"([^"\n]*)"|`([^`\n]*)`|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
    for (const s of strings) assert.ok(!zeroFeeTakes(s) && !/Fees are high/.test(s), `${f}: ${s}`);
  }
  for (const f of ["packages/wallet/src/app/money/swap-corridor.ts", "packages/wallet/src/app/money/swap-trade.ts", "apps/web/src/agentzero/wallet-words.ts"]) {
    const src = read(f);
    const strings = [...src.matchAll(/"([^"\n]*)"|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? "");
    for (const s of strings) assert.ok(!zeroFeeTakes(s) && !/Fees are high|They take/.test(s), `${f}: ${s}`);
  }
});
