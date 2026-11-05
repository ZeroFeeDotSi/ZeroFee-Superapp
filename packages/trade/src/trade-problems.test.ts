import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TradeError } from "./errors.ts";
import type { Problem } from "@zerofee/core/problem";
import { problemOf, tradeProblems } from "./trade-problems.ts";
import { nearProblems } from "./near/problems.ts";

const catalogue = readFileSync(new URL("../errors.md", import.meta.url), "utf8");
const all = () => Object.entries({ ...tradeProblems, ...nearProblems }).map(([name, make]) => [name, (make as (s: string) => ReturnType<typeof tradeProblems.coinLow>)("BONK")] as const);

test("every Trade Problem has a unique code, the three parts, and a row in errors.md", () => {
  const codes = new Set<string>();
  for (const [name, p] of all()) {
    assert.match(p.code, /^trade(\.[a-z-]+)+$/, name);
    assert.ok(!codes.has(p.code), `${p.code} is used twice`);
    codes.add(p.code);
    assert.ok(p.whatHappened.length > 0 && p.whatHappened.length < 140, `${p.code}: what happened, in one or two short sentences`);
    assert.ok(p.money && p.next?.label, `${p.code}: where the money is and one next step`);
    assert.ok(catalogue.includes(`\`${p.code}\``), `${p.code} is missing from errors.md`);
  }
  for (const row of catalogue.matchAll(/^\| `(trade\.[a-z.-]+)`/gm)) assert.ok(codes.has(row[1]!), `errors.md lists ${row[1]}, which Trade never produces`);
});

test("Trade's words never promise what nobody can", () => {
  for (const [, p] of all()) {
    const words = `${p.whatHappened} ${p.more ?? ""} ${p.next.label} ${"where" in p.money ? p.money.where : ""}`;
    // "Safe" is the name of the main money (the house style); "safe" as a promise is not
    assert.doesNotMatch(words.replace(/\byour Safe\b/g, ""), /\b(safe|safely|guarantee[ds]?|unhackable|anonymous|risk-free)\b/i, p.code);
  }
});

test("every way the engine can say no has its own screen", () => {
  const o = { symbol: "BONK" };
  const code = (e: unknown) => problemOf(e, o).code;
  assert.equal(code(new TradeError("funds", "x", "wallet-empty")), "trade.wallet.empty");
  assert.equal(code(new TradeError("funds", "x", "sol-low")), "trade.sol.low");
  assert.equal(code(new TradeError("funds", "x", "coin-low")), "trade.coin.low");
  assert.equal(code(new TradeError("unavailable", "x", "thin")), "trade.pool.thin");
  assert.equal(code(new TradeError("unavailable", "x")), "trade.coin.unavailable");
  assert.equal(code(new TradeError("unsellable", "x")), "trade.coin.unsellable");
  assert.equal(code(new TradeError("unsellable", "x", "freezable")), "trade.coin.freezable");
  assert.equal(code(new TradeError("moved", "x")), "trade.price.moved");
  assert.equal(code(new TradeError("unavailable", "x", "not-this-swap")), "trade.swap.different");
  assert.equal(code(new TradeError("unavailable", "x", "prices")), "trade.market.busy", "no checked price: busy, try again (MKT-1)");
  assert.deepEqual(problemOf(new TradeError("unavailable", "x", "not-this-swap"), { symbol: "CAKE", chain: "BNB Chain" }).money, { state: "safe", where: "in your BNB wallet" }, "the place, by the chain's name");
  assert.equal(code(new TradeError("node", "x")), "trade.network.down");
  assert.equal(code(new Error("a bug")), "trade.coin.unavailable", "never a raw error on screen");
  assert.equal(problemOf(new TradeError("funds", "x", "sol-low"), { symbol: "CAKE", chain: "BNB Chain", coin: "BNB" }).whatHappened, "You need a little more BNB for this trade and its network fee.");
});

test("every Problem whose step opens a screen names one Trade opens (re-walk.3: Change my limit led to a page without the limit)", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL("./app/TradeApp.tsx", import.meta.url), "utf8");
  const { floatProblems } = await import("./app/boards.ts");
  const opened = new Set<string>();
  for (const make of [...Object.values(tradeProblems), ...Object.values(floatProblems)] as ((...a: unknown[]) => Problem)[]) {
    let p: Problem;
    try { p = make("X", 100, 50); } catch { continue; }
    if (p?.next?.kind === "open") opened.add((p.next as { screen: string }).screen);
  }
  assert.ok(opened.has("settings"), "Change my limit opens Settings");
  for (const screen of opened) assert.match(app, new RegExp(`screen === "${screen}"`), `TradeApp opens "${screen}"`);
});
