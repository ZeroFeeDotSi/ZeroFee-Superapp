// S2 (QA, 4 Nov): $2 of SOL sent to an Add address whose least was $3. 1Click said INCOMPLETE_DEPOSIT and Home
// showed "Adding $2.00 to your SOL wallet · Making it private · 18:35" with a clock that kept growing. Under the least the
// money is not on its way: it waits for the rest or goes back to the NEAR wallet at 1Click's deadline. Each test has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addOnWayLine, type AddOnWay } from "./adds-on-way.ts";
import { addTrack } from "./live-steps.ts";
import { untilWords } from "./add-coins.ts";

const BACK = Date.parse("2026-11-08T18:35:00Z");
const short: AddOnWay = { key: "Qiwc12", tokenId: "nep141:sol.omft.near", chain: "sol", to: "wallet", stage: "short", amount: "21600000", usd: "2.00", needAmount: "32400000", needUsd: "2.97", backAtMs: BACK, at: { received: BACK - 4 * 86_400_000 } };

test("S2: Home's line for an Add under its least says what arrived, what it needed and when it goes back (control: arriving says it's on its way)", () => {
  const l = addOnWayLine(short, undefined);
  assert.equal(l.title, "$2.00 arrived. This Add needed at least $2.97.");
  assert.equal(l.detail, `It goes to your NEAR wallet after ${untilWords(new Date(BACK).toISOString())}.`);
  // no dollars at hand: the coin, both sides
  const coins = addOnWayLine({ ...short, usd: undefined, needUsd: undefined }, undefined);
  assert.equal(coins.title, "0.0216 SOL arrived. This Add needed at least 0.0324 SOL.");
  // no deadline known: where it goes, no made-up time
  assert.equal(addOnWayLine({ ...short, backAtMs: undefined }, undefined).detail, "It goes to your NEAR wallet.");
  assert.equal(addOnWayLine({ ...short, stage: "arriving" }, undefined).title, "SOL is on its way to your SOL wallet.", "control");
});

test("S2: its track has ended (no growing clock): Received, then stopped at Making it private, with the same words (control: arriving runs on)", () => {
  const t = addTrack(short)!;
  assert.deepEqual(t.steps.map((s) => s.state), ["done", "failed", "waiting"]);
  assert.equal(t.end?.ok, false, "an end: the clock stops");
  assert.equal(t.end?.line, `This Add needed at least $2.97. It goes to your NEAR wallet after ${untilWords(new Date(BACK).toISOString())}.`);
  assert.match(addTrack({ ...short, stage: "refunded" })!.end!.line, /in your NEAR wallet\.$/, "refunded: the NEAR wallet, by its name");
  assert.match(addTrack({ ...short, stage: "held" })!.end!.line, /in your NEAR wallet\.$/, "held: the NEAR wallet, by its name");
  const on = addTrack({ ...short, stage: "arriving" })!;
  assert.equal(on.end, undefined, "control: on its way, no end");
});
