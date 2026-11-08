import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FUND_COINS, fundSteps, type FundFacts, type FundView } from "@zerofee/core/fund-start";
import { SWAP_OFF_LINE, addressGroups, asShown, fundCoinsShown, fundLine, fundNext, fundTiles, fundTitle, mayGoToApp, mayLeaveSetup, openingWords, stepText } from "./fund.ts";
import { threadOf } from "../shell/thread.ts";

/** The one thread's line for this funding (Job 1: the bar over the apps is the thread now). */
const bar = (w: FundView) => threadOf({ stage: w.stage, fund: asShown(w), wordsDone: false, moneyIn: null, protection: null, secondDevice: null });

const COINS = [
  { id: "near", symbol: "NEAR", name: "NEAR", network: "NEAR" },
  { id: "sol", symbol: "SOL", name: "Solana", network: "Solana" },
  { id: "base-eth", symbol: "ETH", name: "Base", network: "Base" },
  { id: "usdc-sol", symbol: "USDC", name: "USDC", network: "Solana" },
  { id: "usdc-base", symbol: "USDC", name: "USDC", network: "Base" },
];
const v = (over: Partial<FundView>): FundView => ({ coin: { id: "sol", symbol: "SOL", name: "Solana", network: "Solana" }, state: "waiting", steps: [], stage: "needs-funding", away: false, wordsDone: false, ...over });

test("the coins read as tiles: each coin by its name, every network's USDC behind one tile", () => {
  const tiles = fundTiles(COINS);
  assert.deepEqual(tiles.map((t) => [t.title, t.line, t.coins.length]), [["NEAR", "Goes straight in", 1], ["Solana", "SOL", 1], ["Base", "ETH on Base", 1], ["USDC", "2 networks", 2]]);
});

test("an address in groups of four, nothing else changed", () => {
  assert.equal(addressGroups("7xKXtg2CW87d97TX"), "7xKX tg2C W87d 97TX");
  assert.equal(addressGroups("zf-1.near"), "zf-1.near");
});

test("every state says what happened, whether the money is safe, and one next step", () => {
  for (const state of ["waiting", "working", "opening", "opened", "done", "short", "expired", "refunded", "failed", "open-failed"] as const) {
    const x = v({ state, deposit: { address: "a", amount: "0.02", minimum: "0.0198", untilIso: new Date().toISOString() } });
    assert.ok(fundTitle(state).length > 0 && fundTitle(state).length < 50, state);
    assert.ok(fundLine(x, false).length > 10, state);
    assert.ok(!/1Click|intents|nep141|storage|transaction/i.test(fundTitle(state) + fundLine(x, false)), `${state}: VOICE words`);
    assert.ok(fundNext(x, "needs-funding").label || fundNext(x, "needs-funding").next === "wait", state);
  }
  // the private route: back to the person's own confidential balance, never a wallet's address
  assert.match(fundLine(v({ state: "refunded", refunded: "0.0199" }), false), /0\.0199 SOL went back to your NEAR wallet in ZeroFee\. Your backup words open it/);
  assert.match(fundLine(v({ state: "failed" }), false), /goes back to your NEAR wallet in ZeroFee/);
  // control: an order from before (the public route) still names the coin's own wallet it refunds to
  assert.match(fundLine(v({ state: "refunded", refunded: "0.0199", refundTo: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" }), false), /went back to your own Solana wallet in ZeroFee/);
  assert.equal(fundNext(v({ state: "refunded" }), "needs-funding").label, "Pick a coin again");
});

test("open but the words not written: never 'all set'; the words come next; the rest stays in the Safe, never a step (B10, B11)", () => {
  const open = asShown(v({ state: "done", stage: "needs-backup" }));
  assert.equal(fundTitle(open.state, open.stage), "Your money is in", "O7: the words' last screen is the one \"Your account is open\"");
  assert.equal(fundNext(open, "needs-backup").label, "Write down your backup words");
  assert.equal(bar(open).line, "Write down your backup words");
  assert.equal(bar(open).next, "words");
  const rest = v({ state: "opened", stage: "ready", rest: { near: "2", usd: "8.62" }, steps: [{ key: "seen", state: "done" }, { key: "open", state: "done" }, { key: "rest", state: "todo" }] as FundView["steps"] });
  assert.equal(fundNext(rest, "ready").label, "Open ZeroFee", "no Move to Private");
  assert.deepEqual(asShown(rest).steps.map((s) => s.key), ["seen", "open"], "the rest is never a step on screen");
  assert.match(fundLine(rest, true), /\$8\.62 is left over\. It's in your Safe now\./);
  for (const st of ["now", "done", "todo"] as const) assert.doesNotMatch(stepText({ key: "rest", state: st }, rest), /Private/);
});

// J1 (product decision, 2 Nov): a test picked SOL, sent nothing, and the bar said "Money seen on Solana · 1 of 3". Every state below is
// the core's own (fundSteps), so what is tested is what the bar is handed.
const SOL_COIN = FUND_COINS.find((c) => c.id === "sol")!;
const NEAR_COIN = FUND_COINS.find((c) => c.id === "near")!;
const at = (coin: typeof SOL_COIN, f: Partial<FundFacts>, stage: FundView["stage"] = "needs-funding"): FundView => {
  const { state, steps } = fundSteps({ order: null, coin, swap: null, haveYocto: 0n, needYocto: 100n, stage: "needs-funding", opening: false, openFailed: false, rest: null, nowMs: Date.now(), ...f });
  return { coin: { id: coin.id, symbol: coin.symbol, name: coin.name, network: coin.network }, state, steps, stage, away: false, wordsDone: false, deposit: { address: "a", amount: "0.02", minimum: "0.0198", untilIso: new Date().toISOString() } };
};

test("nothing sent: the bar waits for the coin, counts nothing, and no line says money was seen, arrived or is changing", () => {
  for (const coin of [SOL_COIN, NEAR_COIN, ...FUND_COINS.filter((c) => c.id !== "sol" && c.id !== "near")]) {
    const w = at(coin, {});
    assert.equal(w.state, "waiting", coin.id);
    const t = bar(w);
    assert.equal(t.line, `Waiting for your ${coin.symbol}`, coin.id);
    assert.equal(t.next, "money", coin.id);
    assert.deepEqual(t.steps.filter((s) => s.state === "done").map((s) => s.key), [], `${coin.id}: nothing ticked before anything happened`);
    assert.doesNotMatch(t.line, /\d of \d/, `${coin.id}: no "1 of 3"`);
    const said = [t.line, ...w.steps.map((s) => stepText(s, w))].join(" | ");
    assert.doesNotMatch(said, /seen|saw|come in|came in|arrived|changed|changing|moved|open$/i, `${coin.id}: ${said}`);
    assert.equal(mayGoToApp(w), false, `${coin.id}: the apps aren't offered before money is seen`);
    assert.equal(mayLeaveSetup(w), true, `${coin.id}: set-up can still be left`);
    assert.equal(fundNext(w, "needs-funding").label, "Show the address", `${coin.id}: never "Go to the app"`);
  }
  assert.equal(mayLeaveSetup(null), true, "no address asked yet");
});

test("each later state: the one thread says what is happening with the money, Money in under way, never a count", () => {
  const cases: [FundView, string, string][] = [
    [at(SOL_COIN, { swap: { status: "KNOWN_DEPOSIT_TX" } }), "Your SOL is here", "money"],
    [at(SOL_COIN, { swap: { status: "PROCESSING" } }), "Your SOL is here", "money"],
    [at(SOL_COIN, { swap: { status: "SUCCESS" }, haveYocto: 100n }), "Opening your account", "money"],
    [at(SOL_COIN, { swap: { status: "SUCCESS" }, haveYocto: 100n, openFailed: true }), "Your account isn't open yet", "money"],
    [at(SOL_COIN, { swap: { status: "INCOMPLETE_DEPOSIT" } }), "Not enough came in", "money"],
    [at(SOL_COIN, { swap: { status: "REFUNDED" } }), "Your money came back", "money"],
    [at(SOL_COIN, { stage: "needs-backup", haveYocto: null }, "needs-backup"), "Write down your backup words", "words"],
    [at(NEAR_COIN, { haveYocto: 40n }), "Some NEAR arrived, not all", "money"],
    [at(NEAR_COIN, { haveYocto: 100n }), "Opening your account", "money"],
  ];
  for (const [w, line, next] of cases) {
    const t = bar(w);
    assert.equal(t.line, line, `${w.coin.id} ${w.state}`);
    assert.equal(t.next, next, `${w.coin.id} ${w.state}`);
    assert.equal(mayGoToApp(w), true, `${w.coin.id} ${w.state}: money seen, the apps may show`);
    assert.equal(mayLeaveSetup(w), false, `${w.coin.id} ${w.state}: money seen, set-up can't be left from here`);
  }
});

test("a step's line follows where it stands: done says what happened, waiting or running says what is happening", () => {
  const w = at(SOL_COIN, {});
  const line = (key: FundView["steps"][number]["key"], state: FundView["steps"][number]["state"]) => stepText({ key, state }, w);
  assert.equal(line("seen", "now"), "Waiting for your SOL");
  assert.equal(line("seen", "done"), "Money seen on Solana");
  assert.equal(line("near", "todo"), "Change it to NEAR");
  assert.equal(line("open", "todo"), "Open your account");
  assert.equal(line("near", "now"), "Changing it to NEAR");
  assert.equal(line("near", "done"), "Changed to NEAR");
  assert.equal(line("open", "now"), "Opening your account");
  assert.equal(line("open", "done"), "Account opened");
  assert.equal(line("rest", "now"), "The rest is in your Safe");
});

test("the apps while the account opens: what is happening, one button back, never a spinner's 'opening' alone", () => {
  const working = openingWords(at(SOL_COIN, { swap: { status: "PROCESSING" } }), "Wallet");
  assert.deepEqual(working, { title: "Your SOL is here", line: "Getting your account ready. This takes about a minute.", note: "Wallet opens as soon as your account does.", button: "See the steps", words: false });
  const open = openingWords(at(SOL_COIN, { stage: "needs-backup", haveYocto: null }, "needs-backup"), "Wallet");
  assert.equal(open.button, "Write down your backup words");
  assert.equal(open.words, true);
  assert.equal(openingWords(at(SOL_COIN, { swap: { status: "REFUNDED" } }), "Trade").button, "See the steps");
});

test("O-2c: NEAR waiting for the words: the checklist, the thread and the apps say so (never 'Opening'), one step to the words", async () => {
  const { WAITS_LINE, WAITS_TITLE } = await import("./fund.ts");
  const w = { ...at(NEAR_COIN, { haveYocto: 100n }), waitsForWords: true as const };
  assert.deepEqual(fundNext(w, "needs-funding"), { next: "wordsFirst", label: "Write down my words" });
  assert.equal(WAITS_TITLE, "Your NEAR is here");
  assert.equal(WAITS_LINE, "Write down your 24 words, then your account opens.");
  const o = openingWords(w, "Wallet");
  assert.deepEqual([o.title, o.line], [WAITS_TITLE, WAITS_LINE]);
  assert.doesNotMatch(o.title + o.line, /Opening/);
  assert.equal(bar(w).line, "Your NEAR is here");
  // review L: the Details list doesn't say "Opening" either
  assert.equal(stepText({ key: "open", state: "now" }, w), "Opens once your words are checked");
  assert.equal(stepText({ key: "open", state: "now" }, at(NEAR_COIN, { haveYocto: 100n })), "Opening your account", "control");
  // Control: the same funding without the wait reads as opening.
  assert.notEqual(fundNext(at(NEAR_COIN, { haveYocto: 100n }), "needs-funding").next, "wordsFirst");
  assert.match(openingWords(at(NEAR_COIN, { haveYocto: 100n }), "Wallet").title, /Opening/);
});

test("D125: set-up's swap route (SOL, Robinhood) is on only in the test build; off, NEAR alone and one line, never the old public route (control: on, every coin)", () => {
  const coins = [{ id: "near" }, { id: "sol" }, { id: "hood-eth" }];
  assert.deepEqual(fundCoinsShown(coins, false).map((c) => c.id), ["near"], "off: NEAR only (it needs no swap)");
  assert.deepEqual(fundCoinsShown(coins, true).map((c) => c.id), ["near", "sol", "hood-eth"], "control: the test build");
  assert.equal(SWAP_OFF_LINE, "More coins open after their first real test.");
  const src = readFileSync(new URL("./FundStart.tsx", import.meta.url), "utf8");
  assert.match(src, /coinsFound\(fundCoinsShown\(coins, proof\), find\)/, "the tiles are the shown coins");
  assert.match(src, /\{!proof && <p[^>]*>\{SWAP_OFF_LINE\}<\/p>\}/, "off: the line says why");
  assert.match(src, /if \(coin\.id !== "near" && !homeProof\(\)\) return;/, "off: no swap coin is ever asked for");
});
