// Home's Swap of any coin (bug report, 5 Nov): the shared picker's rows, every route kind with its controls, the hidden
// pairs with their one-line reasons, and the trade's job (made at the tap, its row naming the exchange, ended on the
// chain's answer with its proof).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NATIVE, PICK_CHAINS, foldLine, siteRows, heldRows, looksLikeAddress, matches, pickKey, pickRows, splitRows, type PickCoin } from "./coin-pick.ts";
import { COIN_WHY, coinRoute, placeCoin, tradeArrives } from "./swap-coins.ts";
import { SWAP_COIN } from "./swap-corridor.ts";
import { coinAsk, paidLine, priceLate, runTradeJob, trackOf, tradeSteps, type CoinQuote } from "./swap-trade.ts";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const RH = "0x" + "ab".repeat(20);
const place = (p: Parameters<typeof placeCoin>[0], usd?: number) => placeCoin(p, SWAP_COIN[p], usd)!;
const coin = (chain: PickCoin["chain"], address: string, symbol: string): PickCoin => ({ chain, address, symbol, name: symbol });
const open = (c: "bsc" | "pair") => c === "pair";

test("the tray is NEAR · SOL · Robinhood, in that order; BNB is no tab", () => {
  assert.deepEqual(PICK_CHAINS.map((c) => c.label), ["NEAR", "SOL", "Robinhood"]);
  assert.equal(placeCoin("bsc", SWAP_COIN.bsc), null);
  assert.deepEqual(["sol", "hood", "near", "safe-usdc", "safe-near"].map((p) => place(p as never).chain), ["sol", "hood", "near", "near", "near"]);
});

test("rows: Home's places first, then coins held, then what the market found, each once; filtered by the text", () => {
  const places = [place("sol", 40), place("hood", 12), place("near", 5), place("safe-usdc", 100)];
  const held = heldRows("sol", [{ address: BONK, symbol: "BONK", decimals: 5, raw: "1", usd: 12.5 }, { address: WIF, symbol: "WIF", decimals: 6, raw: "1" }]);
  const found = [{ chain: "sol", address: BONK, symbol: "BONK", name: "Bonk" }, { chain: "sol", address: "So11111111111111111111111111111111111111112", symbol: "PUMP", name: "Pump" }, { chain: "hood", address: RH, symbol: "HOOD", name: "Hood" }];
  const sol = pickRows("sol", "", { places, held, found });
  assert.deepEqual(sol.map((r) => r.symbol), ["SOL", "BONK", "WIF", "PUMP"], "BONK once, as held; Robinhood's coin not on SOL's tab");
  assert.equal(sol[1]!.heldUsd, 12.5);
  assert.equal(sol[1]!.name, "Bonk", "a held coin takes the market's name (and logo) when it found it");
  assert.equal(sol[2]!.heldUsd, undefined, "a coin with no price shows no figure, never $0");
  assert.deepEqual(pickRows("near", "", { places, held: [] }).map((r) => r.symbol), ["USDC", "USDC"]);
  // the market's answer to a search is its own match (a name, or a pasted address): taken as it is; held rows filter here
  assert.deepEqual(pickRows("sol", "wi", { places, held, found: [{ chain: "sol", address: "WiNd1111111111111111111111111111111111111", symbol: "WIND", name: "Wind" }] }).map((r) => r.symbol), ["WIF", "WIND"]);
  assert.deepEqual(pickRows("sol", BONK, { places, held, found: [found[0]!] }).map((r) => r.symbol), ["BONK"], "an address finds its coin, once");
  assert.deepEqual(pickRows("sol", "", { places, held }).map((r) => r.symbol), ["SOL", "BONK", "WIF"], "You pay: only what is held (control: no market rows)");
  assert.notEqual(pickKey(place("near")), pickKey(place("safe-usdc")), "two USDC places are two rows");
  assert.equal(pickKey(coin("hood", RH.toUpperCase().replace("0X", "0x"), "A")), pickKey(coin("hood", RH, "A")), "an EVM address in any case is one coin");
  assert.ok(matches({ symbol: "BONK", name: "Bonk Inu", address: BONK }, "inu") && !matches({ symbol: "BONK", name: "Bonk", address: BONK }, "x"));
  assert.ok(looksLikeAddress("sol", BONK) && looksLikeAddress("hood", RH) && !looksLikeAddress("hood", BONK) && !looksLikeAddress("sol", "bonk"));
});

test("routes: a wallet's coin ↔ a coin in it, and coin ↔ coin, are trades; between places, the private routes as before", () => {
  assert.deepEqual(coinRoute(place("sol"), coin("sol", BONK, "BONK"), open), { kind: "trade", chain: "sol", pay: NATIVE, get: BONK });
  assert.deepEqual(coinRoute(coin("sol", BONK, "BONK"), place("sol"), open), { kind: "trade", chain: "sol", pay: BONK, get: NATIVE });
  assert.deepEqual(coinRoute(coin("sol", BONK, "BONK"), coin("sol", WIF, "WIF"), open), { kind: "trade", chain: "sol", pay: BONK, get: WIF });
  assert.deepEqual(coinRoute(place("hood"), coin("hood", RH, "HOOD"), open), { kind: "trade", chain: "hood", pay: NATIVE, get: RH });
  // between wallets: only ever the private routes (spending.move through NEAR Confidential), unchanged
  assert.deepEqual(coinRoute(place("sol"), place("near"), open), { kind: "place", route: { kind: "move", from: "sol", to: "near" } });
  assert.deepEqual(coinRoute(place("safe-usdc"), place("sol"), open), { kind: "place", route: { kind: "topup", coin: "USDC", to: "sol" } });
});

test("hidden, each with its one line: NEAR coins, a coin to another chain, the same coin, a pair no core path finishes", () => {
  const why = (a: PickCoin, b: PickCoin, o = open) => { const r = coinRoute(a, b, o); return "why" in r ? r.why : "offered"; };
  assert.equal(why(place("safe-usdc"), coin("near", "token.near", "TKN")), COIN_WHY.nearCoins, "the Safe's NEAR coins: not in place yet");
  assert.equal(why(coin("sol", BONK, "BONK"), place("near")), COIN_WHY.crossChain);
  assert.equal(why(coin("sol", BONK, "BONK"), coin("hood", RH, "HOOD")), COIN_WHY.crossChain);
  assert.equal(why(place("hood"), coin("sol", BONK, "BONK")), COIN_WHY.crossChain);
  assert.equal(why(coin("sol", BONK, "BONK"), coin("sol", BONK, "BONK")), COIN_WHY.same);
  assert.equal(why(place("sol"), place("sol")), COIN_WHY.same);
  assert.equal(why(place("sol"), place("safe-near")), COIN_WHY.noSafeNear, "nothing lands as NEAR in the Safe yet");
  const bsc = { ...place("sol"), place: "bsc" as const };
  assert.equal(why(bsc, place("safe-usdc")), COIN_WHY.bscClosed, "BNB Chain closed");
  assert.equal(why(bsc, place("safe-usdc"), () => true), "offered", "control: BNB open, it goes");
  assert.equal(why(place("safe-usdc"), place("safe-near")), COIN_WHY.noSafeNear);
  assert.equal(why(place("safe-near"), place("safe-usdc")), "offered", "control: E7 with the pair open");
  assert.equal(why(place("safe-near"), place("safe-usdc"), () => false), COIN_WHY.notHere, "a direction not open: the fallback");
  assert.equal(why(place("sol"), coin("sol", BONK, "BONK")), "offered", "control");
  for (const w of Object.values(COIN_WHY)) assert.ok(w.length <= 90 && !/\bwe\b/i.test(w) && !/doesn't have this coin/.test(w), w);
});

const ONE: CoinQuote = { id: "q1", chain: "sol", legs: [{ side: "buy", route: "Jupiter", symbol: "BONK" }], payUsd: 10, getRaw: "45000000000", getMinRaw: "44550000000", getDecimals: 5, getSymbol: "BONK", getUsd: 9.9, about: false, feeUsd: 0.001 };
const TWO: CoinQuote = { ...ONE, id: "q2", legs: [{ side: "sell", route: "PumpSwap", symbol: "WIF" }, { side: "buy", route: "Jupiter", symbol: "BONK" }], about: true };

test("what arrives: 'About' the exchange's own quote, no four decimals (design review, 5 Nov)", () => {
  assert.equal(tradeArrives(ONE, "SOL"), "About 450,000 BONK");
  assert.equal(tradeArrives({ getRaw: "2911915900", getDecimals: 6, getSymbol: "DOPE" }, "SOL"), "About 2,912 DOPE");
  assert.equal(tradeArrives({ getRaw: "41254000", getDecimals: 6, getSymbol: "X" }, "SOL"), "About 41.25 X");
  assert.equal(tradeArrives({ getRaw: "51480000", getDecimals: -1, getSymbol: "" }, "SOL"), "About 0.0515 SOL", "a sale gets the chain's coin");
  assert.deepEqual(coinAsk("sol", NATIVE, BONK, 10.004, false), { chain: "sol", pay: NATIVE, get: BONK, usd: 10 });
  assert.deepEqual(coinAsk("sol", BONK, NATIVE, 12.5, true), { chain: "sol", pay: BONK, get: NATIVE, all: true });
});

test("the lines name who gets the fee (the exchange, the network's own figure; product decision, 5 Nov: ZeroFee takes nothing), and who didn't answer", () => {
  assert.equal(paidLine({ ...ONE, feeUsd: 0 }), "Jupiter's fee is in the price. Solana gets its own network fee. ZeroFee takes nothing.", "no figure: none made up");
  assert.equal(paidLine(ONE), "Jupiter's fee is in the price. Solana's network gets under a cent. ZeroFee takes nothing.", "a fee under a cent is still a fee");
  assert.equal(paidLine({ ...TWO, feeUsd: 0.013 }), "PumpSwap and Jupiter's fees are in the price. Solana's network gets about $0.01. ZeroFee takes nothing.");
  assert.equal(paidLine({ ...TWO, chain: "hood", legs: [TWO.legs[1]!, TWO.legs[1]!], feeUsd: 0.25 }), "Jupiter's fee is in the price. Robinhood Chain's network gets about $0.25. ZeroFee takes nothing.", "one exchange named once");
  const sheet = readFileSync(new URL("./CoinSwap.tsx", import.meta.url), "utf8");
  assert.match(sheet, /data-testid="swap-go"[\s\S]{0,400}<\/button>\n\s*\{[^\n]*\n?\s*\{!block && price\.q && <p className="zf-small wl-zerofee" data-testid="swap-paid">\{paidLine\(price\.q\)\}<\/p>\}/, "under the button");
  assert.equal(priceLate(null), "The exchange didn't answer.");
  assert.equal(priceLate(ONE), "Jupiter didn't answer.");
});

test("the job's steps name the exchange that does the work, never 'we'", () => {
  assert.deepEqual(tradeSteps(ONE, "SOL", "BONK", 5).map((s) => [s.label, s.state]), [["Jupiter is swapping it", "doing"]]);
  assert.deepEqual(tradeSteps(TWO, "WIF", "BONK", 5).map((s) => [s.label, s.state]), [["PumpSwap is swapping WIF for SOL", "doing"], ["Jupiter is swapping SOL for BONK", "waiting"]]);
});

function fakeTasks() {
  const log: unknown[][] = [];
  return { log, tasks: { publish: (t: unknown) => (log.push(["publish", t]), true), update: (id: string, p: unknown) => (log.push(["update", id, p]), true), end: (id: string, s: string, d?: string) => (log.push(["end", id, s, d]), true), open: () => undefined } };
}
const bridgeOf = (answer: unknown) => ({ calls: [] as unknown[], call(method: string, params: unknown) { this.calls.push([method, params]); return Promise.resolve(answer); }, on: () => () => undefined });

test("the trade's job ends on the chain's answer: done with its proof, or failed in the exchange's own words", async () => {
  const ok = fakeTasks(), b = bridgeOf({ ok: { legs: [{ id: "r1", side: "sell", status: "done", hashes: ["h1"] }, { id: "r2", side: "buy", status: "done", hashes: ["h2"] }] } });
  assert.equal(await runTradeJob(b as never, ok.tasks as never, "swap:q2", TWO, "WIF", "BONK", () => 7), "done");
  assert.deepEqual(b.calls, [["spending.swap.go", { id: "q2" }]]);
  const up = ok.log.find((x) => x[0] === "update")![2] as { steps: { label: string; state: string }[]; proof: unknown[] };
  assert.deepEqual(up.steps.map((s) => [s.label, s.state]), [["PumpSwap swapped WIF for SOL", "done"], ["Jupiter swapped SOL for BONK", "done"]]);
  assert.deepEqual(up.proof, [{ chain: "sol", hash: "h1" }, { chain: "sol", hash: "h2" }]);
  assert.deepEqual(ok.log.at(-1), ["end", "swap:q2", "done", undefined]);

  const half = fakeTasks();
  assert.equal(await runTradeJob(bridgeOf({ ok: { legs: [{ id: "r1", side: "sell", status: "failed", hashes: ["h1"] }] } }) as never, half.tasks as never, "swap:q2", TWO, "WIF", "BONK"), "failed", "control: a sale that didn't land");
  assert.deepEqual(half.log.at(-1), ["end", "swap:q2", "failed", "PumpSwap didn't swap. Your coins are in your wallet."]);
  const sold = fakeTasks();
  await runTradeJob(bridgeOf({ ok: { legs: [{ id: "r1", side: "sell", status: "done", hashes: ["h1"] }, { id: "r2", side: "buy", status: "failed", hashes: ["h2"] }] } }) as never, sold.tasks as never, "swap:q2", TWO, "WIF", "BONK");
  assert.deepEqual(sold.log.at(-1), ["end", "swap:q2", "failed", "Jupiter didn't swap. You have SOL now."], "the sale landed, the buy didn't: what is held now");

  const no = fakeTasks();
  assert.equal(await runTradeJob(bridgeOf({ problem: { code: "trade.thin", whatHappened: "Too little BONK trades right now.", money: { state: "safe" }, next: { kind: "nothing", label: "Go back" } } }) as never, no.tasks as never, "swap:q1", ONE, "SOL", "BONK"), "failed");
  assert.deepEqual(no.log.at(-1), ["end", "swap:q1", "failed", "Too little BONK trades right now."]);
});

test("the sheet: the tap IS the swap (no hold, no confirm): in its frame the job's row, the bell and the tracker, then the trade", () => {
  const src = readFileSync(new URL("./CoinSwap.tsx", import.meta.url), "utf8");
  const go = src.slice(src.indexOf("const go = (el: HTMLElement) =>"), src.indexOf("const side = "));
  const at = (x: string) => go.indexOf(x);
  assert.ok(at("tapBurst(") > 0 && at("tapBurst(") < at("tasks?.publish(") && at("tasks?.publish(") < at("onTrack(() =>") && at("onTrack(() =>") < at("void runTradeJob("), "ring, row, tracker, then the trade (never awaited)");
  assert.doesNotMatch(go, /await /, "nothing waits between the tap and the tracker");
  assert.doesNotMatch(src, /HoldGo|Hold to swap|onPointerDown/, "no hold on a coin swap");
  const sheet = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /if \(track\) return <LiveTracker track=\{track\}/, "the sheet becomes the tracker");
  assert.match(sheet, /<CoinPicker bridge=\{bridge\}/, "Swap's two sides open the shared picker");
  assert.match(sheet, /search=\{which === "get"\}/, "the market's coins only on You get");
});

test("the tracker follows the trade: away at the tap, each step's time from the tap, landed on the chain's answer", () => {
  const start = { id: "swap:q1", kind: "swap" as const, title: "Swap $10", wallets: ["sol"], startMs: 1_000, steps: [] };
  const away = trackOf(start, { steps: tradeSteps(ONE, "SOL", "BONK", 1_000) }, 1_000);
  assert.deepEqual([away.steps.map((s) => [s.label, s.state]), away.end], [[["Jupiter is swapping it", "doing"]], undefined]);
  const landed = trackOf(away, { steps: [{ label: "Jupiter swapped it", state: "done", at: 1_800 }], end: { ok: true, line: "In your SOL wallet as BONK." } }, 1_800);
  assert.deepEqual([landed.steps[0]!.atMs, landed.end, landed.endMs], [800, { ok: true, line: "In your SOL wallet as BONK." }, 1_800]);
  const checking = trackOf(away, { steps: [{ label: "Jupiter is swapping it", state: "doing" }], checking: "Sent. Still checking it landed." }, 2_000);
  assert.deepEqual([checking.steps[0]!.label, checking.end], ["Sent. Still checking it landed.", undefined], "sent, not seen: never failed");
});

test("picker: what can be picked first, in full; the rest folded into one quiet line; a chain with nothing says one line", () => {
  const rows = [place("sol"), coin("sol", BONK, "BONK"), coin("sol", WIF, "WIF"), coin("near", "a.near", "A")];
  const why = (c: PickCoin) => (c.chain === "near" ? COIN_WHY.nearCoins : c.address === WIF ? COIN_WHY.crossChain : null);
  const s = splitRows(rows, why);
  assert.deepEqual([s.open.map((c) => c.symbol), s.shut.map((x) => x.c.symbol), s.none], [["SOL", "BONK"], ["WIF", "A"], null]);
  assert.equal(foldLine(s.shut.length), "2 more coins can't swap yet");
  assert.equal(foldLine(1), "1 more coin can't swap yet");
  const near = splitRows([coin("near", "a.near", "A"), coin("near", "b.near", "B"), place("safe-near")], (c) => (c.place ? COIN_WHY.notHere : COIN_WHY.nearCoins));
  assert.deepEqual([near.open, near.none], [[], COIN_WHY.nearCoins], "nothing to pick: the reason most share, no rows");
  assert.equal(splitRows([], () => null).none, null, "control: an empty list says nothing here");
});

test("a sale that landed with its buy stopped says where the money is; a leg sent and unseen stays checking, never failed", async () => {
  const moved = fakeTasks(), seen: unknown[] = [];
  const r = await runTradeJob(bridgeOf({ ok: { legs: [{ id: "r1", side: "sell", status: "done", hashes: ["h1"] }], stopped: { code: "spending.swap.priceMoved", whatHappened: "The price moved. Your SOL is in your wallet." } } }) as never, moved.tasks as never, "swap:q2", TWO, "WIF", "BONK", () => 9, (v) => seen.push(v));
  assert.equal(r, "failed");
  assert.deepEqual(moved.log.at(-1), ["end", "swap:q2", "failed", "The price moved. Your SOL is in your wallet."]);
  const up = moved.log.find((x) => x[0] === "update")![2] as { steps: { state: string }[] };
  assert.deepEqual(up.steps.map((s) => s.state), ["done", "failed"], "the sale is done, the buy is the step that stopped");
  assert.deepEqual((seen[0] as { end: unknown }).end, { ok: false, line: "The price moved. Your SOL is in your wallet." }, "the tracker says the same");
  const unseen = fakeTasks();
  assert.equal(await runTradeJob(bridgeOf({ ok: { legs: [{ id: "r1", side: "sell", status: "unconfirmed", hashes: ["h1"] }] } }) as never, unseen.tasks as never, "swap:q2", TWO, "WIF", "BONK"), "checking");
  assert.ok(!unseen.log.some((x) => x[0] === "end"), "no end: it keeps going");
  assert.equal((unseen.log.at(-1)![2] as { detail: string }).detail, "Solana hasn't confirmed the sale yet. Nothing was bought.");
  const one = fakeTasks();
  assert.equal(await runTradeJob(bridgeOf({ ok: { legs: [{ id: "r1", side: "buy", status: "done", hashes: ["h1"] }] } }) as never, one.tasks as never, "swap:q1", ONE, "SOL", "BONK"), "done");
  assert.equal((one.log.find((x) => x[0] === "update")![2] as { steps: { label: string }[] }).steps[0]!.label, "Jupiter swapped it");
});

test("a buy sent and unseen after its sale landed: checking with the chain's words, the sale's step done, never failed", async () => {
  const t = fakeTasks();
  assert.equal(await runTradeJob(bridgeOf({ ok: { legs: [{ id: "r1", side: "sell", status: "done", hashes: ["h1"] }, { id: "k2", side: "buy", status: "unconfirmed", hashes: [] }] } }) as never, t.tasks as never, "swap:q2", TWO, "WIF", "BONK"), "checking");
  const up = t.log.at(-1)![2] as { steps: { state: string }[]; detail: string };
  assert.deepEqual([up.steps.map((s) => s.state), up.detail], [["done", "doing"], "Solana hasn't confirmed it yet."]);
  assert.ok(!t.log.some((x) => x[0] === "end"));
});

test("QA (5 Nov): a site's own wallet with money (pump.fun, GMGN) is a row on You pay, on its network's tab; never AgentZero's pocket", () => {
  const w = (o: Record<string, unknown>) => ({ id: "x", role: "site", network: "sol", current: true, cashUsd: "0", ...o });
  const rows = siteRows([
    w({ id: "s-pump", site: "pump", cashUsd: "4.2", coinsUsd: "1.3" }),
    w({ id: "s-gmgn", site: "gmgn", cashUsd: "3" }),
    w({ id: "s-gmgn-base", site: "gmgn", network: "base", cashUsd: "9" }),
    w({ id: "s-agent", site: "agentzero", cashUsd: "20" }),
    w({ id: "s-empty", site: "raydium" }),
    w({ id: "s-old", site: "orca", cashUsd: "5", current: false }),
    w({ id: "c-sol", role: "chain", cashUsd: "50" }),
  ]);
  assert.deepEqual(rows.map((r) => [r.symbol, r.name, r.chain, r.heldUsd, r.site?.id]), [["pump.fun", "Your wallet. Moves to your Safe.", "sol", 5.5, "s-pump"], ["GMGN", "Your wallet. Moves to your Safe.", "sol", 3, "s-gmgn"]]);
  assert.equal(pickKey(rows[0]!), "site:s-pump");
  assert.deepEqual(pickRows("sol", "", { places: rows, held: [] }).map((r) => r.symbol), ["pump.fun", "GMGN"], "on the SOL tab");
  const sheet = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /if \(c\.site\) return setSitePay\(c\.site\);/, "picked: its own Move to your Safe");
  assert.match(sheet, /if \(sitePay\) return <SiteBackSheet wallet=\{sitePay\.id\}/);
});
