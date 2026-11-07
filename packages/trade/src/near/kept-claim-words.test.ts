// the audit's Trade audit T8 + T9 (8 Nov). T8: a lost-and-found claim that failed was silent (JobCard caught every failure and
// gave the button back); one that went out but read late returned nothing, the re-read found the lost and found empty, and
// the card sent the person to Rhea's team while the coin was most likely in the wallet; "Job created." was said and no
// Jobs row was made. Now every end has words (what failed, where the coin is, the next tap), a sent claim is remembered on
// its trades ("Your X claim was sent." / "Rhea sent it back or still holds it."), its Jobs row is made at the tap and ends
// with "Check Activity for where this is." when unsure. T9: a kept trade whose lost and found can't be read said
// "Nothing moved." while its NEAR had left; now "Your NEAR left. Ref kept the X." Controls beside each. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forApps } from "@zerofee/core/bridge";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { createTradeService } from "../service.ts";
import * as cards from "../app/job-cards.ts";
import { nearProblems } from "./problems.ts";
import type { ChainEngine, Fill, Prepared } from "../types.ts";

const HOUR = 60 * 60_000;
const COIN = "blackdragon.tkn.near";
const K = { id: "t", wallet: "w.near", hash: "h1", token: COIN, symbol: "BLACKDRAGON", decimals: 18, left: "NEAR" };
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

function world(claim: () => Promise<unknown>) {
  const clock = { t: 1_700_000_000_000 };
  let n = 0;
  const engine = {
    chain: "near", owner: "",
    async prepare(side: "buy" | "sell", coin: string) {
      return { key: "k1", at: 0, ready: async () => {}, steps: [], quote: { side, chain: "near", coin, symbol: "BLACKDRAGON", decimals: 18, payRaw: "250000000000000000000000", payUsd: 1, getRaw: "1000000000000000000000000", getUsd: 1, getMinRaw: "970000000000000000000000", feeRaw: "0", feeUsd: 0.01, route: "Rhea", slippageBps: 300, expiresAt: clock.t + 20_000 } } as Prepared;
    },
    async settle() {
      const h = `h${++n}`;
      const fill: Fill = { txHash: h, got: "1000000000000000000000000", spent: "250000000000000000000000", fee: "0", estimated: true };
      const verify = Promise.resolve().then(() => { fill.kept = true; return undefined; });
      return { fill, timing: { signedAt: clock.t, sentAt: clock.t, landedAt: clock.t + 900 }, verify, again: { hash: h, signerId: "w.near", ask: { side: "buy", coin: COIN, poolId: 1, amountIn: "1", minOut: "1" }, about: true } };
    },
    async finalAgain() { return undefined; },
    async keptHeld() { return 0n; },
    claimKept: claim,
    async followMove() { return "pending" as const; },
    async holdings() { return { native: "0", coins: [] }; },
    txHash: (t: string) => t, async send() { return ""; }, async status() { return "unknown" as const; }, async fill() { return undefined; }, poolChanged() {},
  } as unknown as ChainEngine;
  const bridge = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  const svc = createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => 1, meta: async () => ({ symbol: "BLACKDRAGON" }), chains: ["near"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  return { svc, clock };
}
async function kept(claim: () => Promise<unknown>) {
  const w = world(claim);
  await w.svc.trade(await w.svc.quote("buy", "near", COIN, { usd: 1 }));
  await w.svc.checked();
  w.clock.t += HOUR + 1_000;
  const [rec] = await w.svc.activity();
  return { ...w, rec: rec! };
}

test("T9: a kept trade whose lost and found can't be read names what left and who kept it, never \"Nothing moved.\" (a sale: its coin left, Ref kept the NEAR)", () => {
  const v = cards.keptWay(K, null);
  assert.deepEqual([v.head, v.body], ["Rhea's servers didn't answer.", "Your NEAR left. Ref kept the BLACKDRAGON. Open this again to check."]);
  assert.ok(!JSON.stringify(v).includes("Nothing moved"));
  assert.equal(v.claim, undefined, "no button while it can't be read");
  const sale = cards.keptWay({ ...K, symbol: "NEAR", decimals: 24, left: "BLACKDRAGON" }, null);
  assert.equal(sale.body, "Your BLACKDRAGON left. Ref kept the NEAR. Open this again to check.");
});

test("T8: a claim that went out with no read: the engine says sent, the trade remembers it, and an empty lost and found then says so, never Rhea's team", async () => {
  const { svc, rec, clock } = await kept(async () => ({ sent: "h-claim" }));
  assert.deepEqual(await svc.claimKept(rec.id), { sent: true });
  const [after] = await svc.activity();
  assert.equal(after!.problem?.code, "trade.near.rhea-kept", "nothing booked on no read");
  const c = cards.tradeCard(after!, clock.t);
  assert.equal(c.kept?.sent, true);
  const v = cards.keptWay(c.kept!, "0");
  assert.deepEqual([v.head, v.body], ["Your BLACKDRAGON claim was sent.", "Rhea sent it back or still holds it. Check your NEAR wallet."]);
  assert.ok(!/Rhea's team/.test(JSON.stringify(v)) && v.details === undefined, "never sent to Rhea's team");
  // control: no claim sent, an empty lost and found is still the copy review's way to Rhea's team
  const plain = cards.keptWay({ ...K }, "0");
  assert.match(plain.body!, /Rhea's team/);
  // control: the lost and found still holds it after a sent claim: Get it back again
  assert.equal(cards.keptWay(c.kept!, "5").claim?.label, "Get it back");
});

test("T8: the person said no: declined, nothing booked; the claim's words say so", async () => {
  const { svc, rec } = await kept(async () => ({ declined: true }));
  assert.deepEqual(await svc.claimKept(rec.id), { declined: true });
  assert.equal((await svc.activity())[0]!.kept?.claimSent, undefined);
  assert.deepEqual(cards.claimEnd(K, { declined: true }), { line: "You said no. Your BLACKDRAGON is still with Rhea.", task: "stopped", detail: "You said no. Nothing moved." });
});

test("T8: every claim end has words: what failed, where the coin is, the next tap; the Jobs row's end", () => {
  const still = "Your BLACKDRAGON is still with Rhea.";
  assert.deepEqual(cards.claimEnd(K, undefined, nearProblems.claimRefused()), { line: `Rhea said no to getting it back. ${still} Tap Get it back to try again.`, task: "failed", detail: `Rhea said no to getting it back. ${still}` });
  assert.equal(cards.claimEnd(K, undefined, { code: "security.near.whatever", whatHappened: "x" }).line, `ZeroFee didn't approve getting it back. ${still} Tap Get it back to try again.`, "the core's no, by name");
  assert.equal(cards.claimEnd(K, undefined).line, `Rhea's servers didn't answer, so nothing was sent. ${still} Tap Get it back to try again.`);
  assert.deepEqual(cards.claimEnd(K, { sent: true }), { task: "stopped", detail: "Rhea sent it back or still holds it. Check Activity for where this is." });
  assert.deepEqual(cards.claimEnd(K, { got: "4000000000000000000" }), { task: "done", detail: "4 BLACKDRAGON · in your NEAR wallet" });
  for (const e of [cards.claimEnd(K, undefined), cards.claimEnd(K, { sent: true }), cards.claimEnd(K, undefined, nearProblems.claimRefused())]) assert.ok(!/Rhea's team|Nothing moved/.test(`${e.line ?? ""} ${e.detail}`), e.detail);
  assert.equal(cards.keptTaskTitle("BLACKDRAGON"), "Get your BLACKDRAGON back");
});

test("T8: the engine says sent once the claim may have gone out, refused only on Rhea's own no (source); the card makes its Jobs row at the tap and shows its words", () => {
  const r = src("./rhea.ts");
  assert.match(r, /if \("declined" in r\) return \{ declined: true as const \};/);
  assert.match(r, /if \(!out\?\.status\) return \{ sent: r\.hash \};/, "an answer lost after the send: unsure");
  assert.match(r, /if \("Failure" in out\.status\) throw new ProblemError\(nearProblems\.claimRefused\(\)\);/);
  assert.match(r, /return b && "got" in b \? \{ got: b\.got, hash: r\.hash \} : \{ sent: r\.hash \};/, "no read after it: unsure, never nothing");
  assert.doesNotMatch(r, /nearNothingMoved\(token\)/, "control: a coin's contract id never said as its name");
  const j = src("../app/screens/JobCard.tsx");
  assert.match(j, /tasks\?\.publish\(\{ id: task, title: keptTaskTitle\(k\.symbol\)/, "the Jobs row at the tap");
  assert.match(j, /tasks\?\.end\(task, end\.task, end\.detail\);/);
  assert.match(j, /setSaid\(end\.line\)/, "the card's words");
  assert.doesNotMatch(j, /svc\.claimKept\(k\.id\)\.catch\(\(\) => undefined\)/, "control: the silent catch is gone");
});
