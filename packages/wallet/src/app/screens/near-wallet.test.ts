// Finding 43 (the crawl, 4 Nov): the NEAR wallet's tab offered Add, which opened an Add with no NEAR address in it, and
// "NEAR" read as both a wallet and the Safe's coin. Add shows only where Add takes that wallet's coin (ADD_OPEN); the NEAR
// tab says what the wallet is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ADD_OPEN } from "@zerofee/core/add-outside";

const home = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");

test("finding 43: no Add where Add can't fill; the NEAR wallet's row says what it holds; each Trade wallet's Add opens Move, set to it (product decision, 5 Nov)", () => {
  assert.equal(ADD_OPEN.near, false, "the NEAR wallet has no Add of its own yet (D155)");
  const acts = home.slice(home.indexOf("function Actions("), home.indexOf("return (", home.indexOf("function Actions(")));
  assert.match(acts, /!wallet \|\| wallet === "safe" \|\| ADD_OPEN\[wallet\] \? \[\{ word: "Add"/, "Add only on the Safe and an open wallet");
  assert.doesNotMatch(acts, /^\s*\{ word: "Add"/m, "control: never an unconditional Add");
  assert.match(home, /nearLine: "Cash",/);
  assert.match(home, /r\.chain === "near" \? \(cashOf \? `\$\{HOME_WORDS\.nearLine\} \$\{\$\(cashOf\.usd\)\}` : HOME_WORDS\.nearLine\)/, "the NEAR row's line");
  // swap-in-place re-crawl (5 Nov): with a coin bought in it, the line is its cash's own figure, never the row's total;
  // hidden amounts hide it (control: no bought coin, no "Cash" sub-row, the line is "Cash" alone)
  assert.match(home, /const cashOf = r\.chain === "near" && !hide \? r\.coins\.find\(\(c\) => c\.symbol === "Cash"\) \?\? \(r\.coins\.length \? \{ usd: "0\.00" \} : undefined\) : undefined;/, "all its cash spent, a coin held: \"Cash $0.00\", never \"Cash\" beside the coins' total");
  assert.match(home, /const subs = mine\.length \|\| inNear\.length \? \[\.\.\.\(Number\(cash\) >= 0\.01 \? \[\{ key: "near:cash", symbol: "Cash"/, "the Cash sub-row exists only beside bought coins");
  assert.match(home, /if \(web\) a\.onAdd\(c\); else a\.onMove\("safe", c\);/, "the phone's Add beside a wallet is Move, set to it");
});

test("finding 51, superseded by product decision (5 Nov): Robinhood's row is named by its chain and says its ETH; the number is the tab's own (the Safe's on Safe)", () => {
  assert.match(home, /hood: "Robinhood wallet"/, "one wallet-name set app-wide (look 4): the chain in the name");
  assert.match(home, /const tabUsd = tab === "safe" \?/);
});

