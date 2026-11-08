// QA 16's grade of the move-44px shots (7 Nov), two MUSTs on the two-wallet Move sheet. (a) The Safe's row said
// "$5,200.55" (Home's Safe figure, Private in it) and under it "$5,154.15 stays in your Safe." (Private left out): two
// figures for one name. Now the row's figure is said once; its note says the reason only. (b) Private rose $33.86 →
// $46.40 with nothing saying why. Now one line under Private: "Private gets $12.54 so this move is harder to trace."
// Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MOVE_WORDS, privateGetsLine, safeKeeps } from "./move-split.ts";

const now = [{ place: "safe", usd: 5254.15, lo: 250 }] as never;

test("(a) the Safe's note under its figure says no second Safe figure: the reason only", () => {
  const cap = safeKeeps(now, { coinUsd: 5254.15, roomUsd: 500, capUsd: "500" }, 5154.15)!;
  assert.equal(cap, "The rest stays in your Safe. Your rule: wallets hold up to $500 in all.");
  const coin = safeKeeps(now, { coinUsd: 300, roomUsd: 500, capUsd: "500" }, 5154.15)!;
  assert.equal(coin, "The rest stays in your Safe. One coin per move.");
  for (const l of [cap, coin]) assert.doesNotMatch(l, /5,154|5,200/);
  // control: with no row figure to stand on (no caller today), the note keeps its figure
  assert.match(safeKeeps(now, { coinUsd: 5254.15, roomUsd: 500, capUsd: "500" })!, /^\$250 stays in your Safe\./);
});

test("(b) Private's rise is said once, under Private, with why; controls: no rise, a fall, under a cent: nothing", () => {
  assert.equal(privateGetsLine(33.86, 46.4), "Private gets $12.54 so this move is harder to trace.");
  assert.equal(MOVE_WORDS.privateGets("$12.54"), "Private gets $12.54 so this move is harder to trace.");
  assert.equal(privateGetsLine(33.86, 33.86), null);
  assert.equal(privateGetsLine(33.86, 20), null);
  assert.equal(privateGetsLine(33.86, 33.864), null);
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /x\.place === "private" && privGets && <p className="zf-small wl-mv-hint" data-testid="move-private-gets">\{privGets\}<\/p>/);
  assert.match(sheet, /const privGets = running \|\| cantGo \|\| legs\.length === 0 \|\| alsoSaysPrivate\(also\) \? null : privateGetsLine\(start\.private \?\? 0, privShown\);/);
});
