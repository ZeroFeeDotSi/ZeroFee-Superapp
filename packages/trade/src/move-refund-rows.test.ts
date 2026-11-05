// S5 (the copy review's Sim walk, 5 Nov): after a Move or a Swap paid from Private came back, Trade's row still read
// "Moving $26.00 to your NEAR wallet · Didn't go · still in your Safe" beside Home's "Didn't move $26.00 to your SOL
// wallet · … Private". One job, one story: the row ends, names where it was going, and says the money is in Private.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIVATE_BACK, privateBack } from "@zerofee/core/private-route";
import type { MoveRow } from "./float-view.ts";
import { moveWords } from "./move-words.ts";
import { whereWords } from "./app/boards.ts";
import { moveCard } from "./app/job-cards.ts";

const row = (o: Partial<MoveRow>): MoveRow => ({ id: "mv-x", kind: "add", usd: 26, status: "moving", where: "in-flight", at: 0, ...o } as MoveRow);

test("a Move paid from Private that came back: its Trade row ends, names its wallet, and says Private (controls: going and done rows as before; a public-leg Add that failed is still in the Safe)", () => {
  const back = row({ status: "failed", where: "main", note: PRIVATE_BACK, priv: { parts: [{ wallet: "sw-sol", chain: "sol", usd: 26, ids: ["pocket-send:a"], ends: { "pocket-send:a": "refunded" } }] } });
  assert.equal(moveWords(back), "Didn't move $26.00 to your SOL wallet");
  assert.equal(whereWords(back), `Didn't go · ${PRIVATE_BACK}`);
  const card = moveCard(back);
  assert.equal(card.title, "Didn't move $26.00 to your SOL wallet");
  assert.doesNotMatch(`${card.title} ${card.result}`, /Moving|in your Safe/);
  // several wallets, and the plain Add to the NEAR wallet
  assert.equal(moveWords(row({ status: "failed", legs: [{ chain: "sol", usd: 13 }, { chain: "hood", usd: 13 }] })), "Didn't move $26.00 to your wallets");
  assert.equal(moveWords(row({ status: "failed", priv: { parts: [{ wallet: "near", chain: "near", usd: 26, ids: [] }] } })), "Didn't move $26.00 to your NEAR wallet");
  // controls
  assert.equal(moveWords(row({})), "Moving $26.00 to your NEAR wallet");
  assert.equal(moveWords(row({ status: "done" })), "Moved $26.00 to your NEAR wallet");
  assert.equal(whereWords(row({ status: "failed", where: "main" })), "Didn't go · still in your Safe", "a public-leg Add never left the Safe");
});

test("Private's line names why the money is there (where it was paid from), never the bare \"Your money is in Private.\"", () => {
  assert.equal(privateBack(26), "The $26.00 is back in Private.", "the copy review's words, the job's figure");
  assert.equal(PRIVATE_BACK, "It's back in Private.", "control: a figure truly unknown");
  assert.equal(privateBack(Number.NaN), PRIVATE_BACK, "control: no figure is no figure");
  assert.doesNotMatch(PRIVATE_BACK, /^NEAR Confidential sent it back\. Your money is in Private\.$/);
});
