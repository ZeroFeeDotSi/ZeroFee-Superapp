// Product decision, 5 Nov. Every money sheet says who gets the fee, directly, and
// that ZeroFee takes nothing; real figures only; no screen says ZeroFee takes a cut.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FEES_KEPT, ZERO_FEE, feeFigure, feesFigure, intentsKept, intentsPaid, networkPaid, receivePaid, tradePaid } from "./zero-fee.ts";
import { bannedIn } from "../../../tools/copy/voice.ts";

const LINES = [
  intentsPaid(), FEES_KEPT,
  tradePaid("Jupiter", "Solana", 0.013), tradePaid("PumpSwap and Jupiter", "Solana", 0.004), tradePaid("KyberSwap", "Robinhood Chain", 0.25), tradePaid("Rhea", "NEAR", null), tradePaid("pump.fun", "Solana", 0.01), tradePaid(null, "Robinhood Chain", 0.25),
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
    assert.ok(/NEAR Intents|Jupiter|KyberSwap|Rhea|pump\.fun|network/.test(l), `names who is paid: ${l}`);
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
  // the copy review's fee line: the figure, then who keeps it, one zero-fee line; "this" only where a figure is on screen
  assert.equal(feesFigure(0.13), "Fees · about $0.13");
  assert.equal(feesFigure(0.004), "Fees · under a cent");
  assert.equal(feesFigure(null), null);
  assert.equal(feesFigure(Number.NaN), null);
  assert.equal(FEES_KEPT, "NEAR Intents and the network keep this. ZeroFee takes nothing.");
  assert.equal(intentsKept(true), FEES_KEPT);
  assert.equal(intentsKept(false), intentsPaid(), "control: no figure, no 'this'");
  assert.equal(intentsPaid(), "Any fee goes to NEAR Intents and the network. ZeroFee takes nothing.");
  // a router adds no fee on this path (sol/payout.ts pins Jupiter's platform fee to 0; kyber.ts never sets one): the pools' fee, never "Jupiter's fee"
  assert.equal(tradePaid("Jupiter", "Solana", 0.013), "The pools Jupiter picks keep a fee, in the price. Solana's network gets about $0.01. ZeroFee takes nothing.");
  assert.equal(tradePaid("KyberSwap", "Robinhood Chain", 0.25), "The pools KyberSwap picks keep a fee, in the price. Robinhood Chain's network gets about $0.25. ZeroFee takes nothing.");
  assert.equal(tradePaid("pump.fun", "Solana", 0.013), "pump.fun's fee is in the price. Solana's network gets about $0.01. ZeroFee takes nothing.", "control: a venue's own fee stays its own");
  assert.equal(tradePaid("PumpSwap and Jupiter", "Solana", 0.013), "PumpSwap and the pools Jupiter picks keep a fee, in the price. Solana's network gets about $0.01. ZeroFee takes nothing.");
  for (const l of LINES) assert.ok(!/(?:Jupiter|KyberSwap)'s fees? /.test(l), `no router has a fee of its own: ${l}`);
  assert.equal(tradePaid("Rhea", "NEAR", 0), "Rhea's fee is in the price. NEAR gets its own network fee. ZeroFee takes nothing.", "0 is no figure: none said");
  // control: with no figure in, no dollar sign out
  for (const l of [intentsPaid(), FEES_KEPT, tradePaid("Rhea", "NEAR"), networkPaid("Solana"), receivePaid("Solana")]) assert.ok(!l.includes("$"), l);
  assert.equal(feeFigure(undefined), null);
  assert.equal(feeFigure(1.234), "about $1.23");
});

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const SHEETS: [string, RegExp][] = [
  ["packages/wallet/src/app/money/SwapSheet.tsx", /data-testid="swap-paid">\{price\.paid\}/],
  ["packages/wallet/src/app/money/InplaceSwap.tsx", /data-testid="swap-paid">\{intentsKept\(!block && !!price\.q\)\}/],
  ["packages/wallet/src/app/money/SiteMoney.tsx", /data-testid="site-add-paid">\{intentsKept\(/],
  ["packages/wallet/src/app/money/SiteMoney.tsx", /data-testid="takeout-paid">\{intentsPaid\(\)\}/],
  ["packages/trade/src/native/NativeScreens.tsx", /data-testid="native-paid">\{intentsKept\(!!figure\)\}/],
  ["apps/web/src/agentzero/AgentWallet.tsx", /data-testid="az-fill-paid">\{intentsPaid\(\)\}/],
  ["packages/wallet/src/app/money/CoinSwap.tsx", /data-testid="swap-paid">\{paidLine\(price\.q\)\}/],
  ["packages/wallet/src/app/screens/MoveSheet.tsx", /data-testid="move-paid">\{intentsKept\(!block && !!cost && !!costed\)\}/],
  ["packages/wallet/src/app/money/SendForm.tsx", /data-testid="send-paid">\{intentsKept\(!!feeNow\)\}/],
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

test("one block, one place (the copy review, 6 Nov): the figure, then who keeps it, right above the button; nothing under it", () => {
  const sheets: [string, string, string][] = [
    ["packages/wallet/src/app/money/SendForm.tsx", 'data-testid="send-paid"', 'data-testid="send-go"'],
    ["packages/wallet/src/app/money/SwapSheet.tsx", 'data-testid="swap-paid"', 'data-testid="swap-go"'],
    ["packages/wallet/src/app/money/InplaceSwap.tsx", 'data-testid="swap-paid"', 'data-testid="swap-go"'],
    ["packages/wallet/src/app/money/CoinSwap.tsx", 'data-testid="swap-paid"', 'data-testid="swap-go"'],
    ["packages/wallet/src/app/screens/MoveSheet.tsx", 'data-testid="move-paid"', 'zf-btn wl-sheet-go${busy'],
    ["packages/wallet/src/app/money/SiteMoney.tsx", 'data-testid="site-add-paid"', 'data-testid="site-add-least-go"'],
    ["packages/wallet/src/app/money/SiteMoney.tsx", 'data-testid="takeout-paid"', '`Take out ${'],
    ["packages/trade/src/native/NativeScreens.tsx", 'data-testid="native-paid"', 'zf-btn tr-press tp-go'],
    ["packages/trade/src/app/screens/TradeSheet.tsx", 'data-testid="trade-paid"', "tp-go${checking"],
    ["apps/web/src/agentzero/AgentWallet.tsx", 'data-testid="az-fill-paid"', "data-agentzero-fill="],
  ];
  for (const [f, line, button] of sheets) {
    const src = read(f);
    const l = src.indexOf(line), b = src.indexOf(button, l);
    assert.ok(l > 0 && b > l, `${f}: ${line} comes before its button`);
    const block = src.lastIndexOf('className="zf-fee"', l);
    assert.ok(block > 0 && l - block < 300, `${f}: ${line} stands in the block`);
  }
  // the figure comes first in the block, on each sheet that has one
  for (const [f, fig, line] of [
    ["packages/wallet/src/app/money/SendForm.tsx", 'data-testid="send-fee"', 'data-testid="send-paid"'],
    ["packages/wallet/src/app/money/SwapSheet.tsx", 'data-testid="swap-fee"', 'data-testid="swap-paid"'],
    ["packages/wallet/src/app/money/InplaceSwap.tsx", 'data-testid="swap-fee"', 'data-testid="swap-paid"'],
    ["packages/wallet/src/app/money/SiteMoney.tsx", 'data-testid="site-add-fee"', 'data-testid="site-add-paid"'],
    ["packages/trade/src/native/NativeScreens.tsx", 'data-testid="native-fee"', 'data-testid="native-paid"'],
  ] as const) {
    const src = read(f);
    assert.ok(src.indexOf(fig) > 0 && src.indexOf(fig) < src.indexOf(line), `${f}: figure first`);
  }
  // control: Add is addresses only, no fee line at all
  assert.doesNotMatch(read("packages/wallet/src/app/money/AddSheet.tsx"), /add-paid|zero-fee|ZeroFee takes/);
});

test("the line's truth, by route: Home's Send has two calls, and both legs of each are NEAR Intents' (a new Send route must say its own words)", () => {
  const sheet = read("packages/wallet/src/app/money/SendSheet.tsx");
  const moves = [...sheet.matchAll(/bridge\.call<[^>]*>\("(ledger\.(?!private\b|activity\b|sendFee\b)[A-Za-z]+|subwallet\.[A-Za-z.]+)"/g)].map((m) => m[1]);
  assert.deepEqual(moves, ["ledger.hiddenFromRow", "ledger.sendFromSafe"]);
  // from a wallet: leg 1 the core's own quote into Private, leg 2 Private's payment on 1Click's quote
  const row = read("packages/wallet/src/hidden-row.ts");
  assert.match(row, /"subwallet\.private\.quoteIn"/);
  assert.match(row, /askPrivate\(req\)/);
  // from the Safe: the same two
  const safe = read("packages/wallet/src/safe-send.ts");
  assert.match(safe, /"subwallet\.private\.quoteIn"/);
  assert.match(safe, /x\.askPrivate\(req\)/);
  // control: the public transfer's door isn't one of them
  assert.doesNotMatch(sheet + row + safe, /"subwallet\.send"/);
});
