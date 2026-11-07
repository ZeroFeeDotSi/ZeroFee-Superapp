// J3-5 (the copy review's walk, 8 Nov): the Add list's Safe row and SOL wallet row both read "Only SOL on Solana, at least 0.03 SOL."
// The Safe's row says first what it lands as, "Lands in your Safe as USDC.", true of the core's E2 forward. Fails on main:
// addRule gave the Safe's row no such line. Control: a wallet's row has none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ADD_ROWS, ADD_WORDS, addRule, qrLines } from "./add-coins.ts";

/** An hour past the sim clock's own start (sim-clock.ts: now = 0): never the wall clock, never a fixed date. */
const at = new Date(0 + 3_600_000).toISOString();
const a = { minAmountIn: "29300000", decimals: 9, untilIso: at };
const sol = ADD_ROWS.find((r) => r.chain === "sol")!;

test("J3-5: the Safe's Add row's first fact line is \"Lands in your Safe as USDC.\", then the coin line; control: the SOL wallet's row has no such line", () => {
  const safe = addRule(a, sol, "safe"), wallet = addRule(a, sol, "wallet");
  assert.equal(safe.lands, "Lands in your Safe as USDC.", "fails on main: the two rows read the same");
  assert.equal(safe.only, "Only SOL on Solana, at least 0.03 SOL.");
  assert.equal(wallet.lands, undefined, "control: a wallet's row");
  assert.equal(wallet.only, safe.only, "control: the coin line as it was");
  assert.ok(qrLines(a, sol, "safe").until.startsWith(ADD_WORDS.rowLands), "the QR sheet's own words");
  const sheet = readFileSync(new URL("./AddSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const rule = a \? addRule\(a, row, to\) : null;/);
  assert.match(sheet, /\{to === "safe" && !why && <span className="wl-addline__addr" data-testid="add-lands">\{W\.rowLands\}<\/span>\}\s*<span className=\{`wl-addline__addr\$\{lit \? " is-copied" : ""\}`\} data-testid="add-rule">/, "first, before the coin line");
});

test("J3-5: it is true of the money path: the core's Safe Add forward is homeOne, which swaps the chain's coin to USDC", () => {
  const add = readFileSync(new URL("../../../../core/src/float-add.ts", import.meta.url), "utf8");
  const moves = readFileSync(new URL("../../../../core/src/float-moves.ts", import.meta.url), "utf8");
  assert.match(add, /if \(o\.to === "safe"\) return h\.homeOne\(coin\.tokenId, units, fwdKey, fields, true\);/);
  assert.match(moves, /const chain = \(Object\.keys\(CHAIN_COIN\) as TradeChain\[\]\)\.find\(\(c\) => CHAIN_COIN\[c\]\.tokenId === tokenId\);\n\s*const ask = \{ swapType: "EXACT_INPUT", destinationAsset: chain \? FLOAT_USDC : tokenId,/);
});
