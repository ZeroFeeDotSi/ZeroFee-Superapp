// Audit 18's I8 (builder 22's item 14, 8 Nov; product decision, 8 Nov: SOL, NEAR and Robinhood only): BNB was still in AgentZero's
// world: Claude was told "Call the coins SOL, ETH, NEAR, USDC and BNB ... BNB isn't open yet." and "bsc (BNB, not open
// yet)", sheets named "your BNB wallet", the tool schemas offered "BNB" and "bsc". Now the wallets are core app-chains.ts's
// (home-ask HomePlace = "safe" | AppChain), no BNB coin, and no BNB or bsc word reaches Claude or a sheet. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_CHAINS } from "@zerofee/core/app-chains";
import { chatSystem, chatTools, TODAY_PLACES } from "./tools.ts";
import { HOME_COINS, HOME_PLACES, PLACE_WORD, TRADE_CHAIN_WORD, appFound, sendSheet, swapSheet } from "./home-ask.ts";
import { JOB_SCHEMA } from "../zero/rulebox.ts";

const root = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
/** Every source file (not a test) under `dir`. */
const sources = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (statSync(p).isDirectory()) return sources(p);
  return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
});
/** The code without its comments: what can reach Claude or a screen. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

test("no-bnb-b22: Claude's prompt and tools name no BNB and no bsc", () => {
  for (const wallet of [false, true]) {
    const said = chatSystem(wallet) + JSON.stringify(chatTools(JOB_SCHEMA, wallet, true, true));
    assert.doesNotMatch(said, /BNB|\bbsc\b/i, `wallet=${wallet}`);
  }
  assert.ok(!TODAY_PLACES.includes("bsc"));
});

test("no-bnb-b22: the sheets' coins and places are the app's chains only", () => {
  assert.deepEqual(HOME_PLACES, ["safe", ...APP_CHAINS]);
  assert.deepEqual([...HOME_COINS], ["SOL", "ETH", "NEAR", "USDC"]);
  assert.deepEqual(Object.keys(PLACE_WORD).sort(), ["hood", "near", "safe", "sol"]);
  assert.deepEqual(Object.keys(TRADE_CHAIN_WORD).sort(), ["hood", "near", "sol"]);
  assert.equal(typeof swapSheet({ from: "BNB", to: "USDC", usd: 5 }, "swap $5 of bnb to usdc"), "string", "BNB is no coin here");
  assert.doesNotMatch(String(swapSheet({ from: "BNB", to: "USDC", usd: 5 }, "swap $5 of bnb to usdc")), /BNB/);
  assert.doesNotMatch(JSON.stringify(sendSheet({ to: "0x0000000000000000000000000000000000000001", usd: 5, from: "bsc" }, "send $5 to 0x0000000000000000000000000000000000000001")), /BNB/);
  const found = appFound([{ chain: "bsc", address: "0x1", symbol: "X", name: "X", liquidityUsd: 9 }, { chain: "sol", address: "So1", symbol: "X", name: "X", liquidityUsd: 1, copycatOf: { chain: "bsc", address: "0x1" } }]);
  assert.deepEqual(found, [{ chain: "sol", address: "So1", symbol: "X", name: "X", liquidityUsd: 1 }], "a coin elsewhere is never offered, nor named as the real one");
});

test("no-bnb-b22: no BNB or bsc word in AgentZero's code (packages/agent, apps/web/src/agentzero)", () => {
  const hits: string[] = [];
  // one file kept: the block list's check of a scanned address names the chain it is on, so a BNB Chain address scanned
  // from a QR is refused by its own name (zero/counterparty.ts OTHER_CHAIN; wallet scan.test.ts)
  const KEPT = /zero\/counterparty\.ts$/;
  for (const f of [...sources(root("..")), ...sources(root("../../../../apps/web/src/agentzero"))].filter((f) => !KEPT.test(f))) {
    code(readFileSync(f, "utf8")).split("\n").forEach((l, i) => { if (/BNB|["'`]bsc["'`]|\bbsc:/.test(l)) hits.push(`${f.split("/src/").pop()}:${i + 1}`); });
  }
  assert.deepEqual(hits, []);
});
