// the audit's MUST (7 Nov, "no dead ends"): a NEAR coin's Rhea trade whose input was spent and whose coin out Ref kept, never
// proven where, said "Your NEAR wallet shows what you hold" (the coin isn't there). Now its card says Rhea may be holding
// it and shows the way back: Get it back while Ref's lost and found holds it (two nodes), else who to ask and what to give
// them. The claim runs once however often it is tapped and books the trade once at the measured figure. Controls pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps } from "@zerofee/core/bridge";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { createTradeService } from "../service.ts";
import * as cards from "../app/job-cards.ts";
import type { ChainEngine, Fill, Prepared } from "../types.ts";

const HOUR = 60 * 60_000;
const COIN = "blackdragon.tkn.near";
const HEAD = "Your BLACKDRAGON didn't reach your NEAR wallet.";
const WALLET_SAYS = "shows what you hold";

function world(o: { kept: boolean; held?: bigint | null; got?: bigint }) {
  const clock = { t: 1_700_000_000_000 };
  const claims: string[] = [];
  let release!: () => void, n = 0;
  const gate = new Promise<void>((r) => (release = r));
  const engine = {
    chain: "near", owner: "",
    async prepare(side: "buy" | "sell", coin: string) {
      return { key: "k1", at: 0, ready: async () => {}, steps: [], quote: { side, chain: "near", coin, symbol: "BLACKDRAGON", decimals: 18, payRaw: "250000000000000000000000", payUsd: 1, getRaw: "1000000000000000000000000", getUsd: 1, getMinRaw: "970000000000000000000000", feeRaw: "0", feeUsd: 0.01, route: "Rhea", slippageBps: 300, expiresAt: clock.t + 20_000 } } as Prepared;
    },
    async settle() {
      const h = `h${++n}`;
      const fill: Fill = { txHash: h, got: "1000000000000000000000000", spent: "250000000000000000000000", fee: "0", estimated: true };
      // what the engine's provenNear does on a FINAL whose coin transfer failed and no deposit rose: kept, can't tell
      const verify = Promise.resolve().then(() => { if (o.kept) fill.kept = true; return undefined; });
      return { fill, timing: { signedAt: clock.t, sentAt: clock.t, landedAt: clock.t + 900 }, verify, again: { hash: h, signerId: "w.near", ask: { side: "buy", coin: COIN, poolId: 1, amountIn: "1", minOut: "1" }, about: true } };
    },
    async finalAgain() { return undefined; },
    async keptHeld(token: string) { assert.equal(token, COIN); return o.held === undefined ? 5000n : o.held; },
    async claimKept(token: string) { claims.push(token); await gate; return o.got === undefined ? undefined : { got: o.got, hash: "h-claim" }; },
    async followMove() { return "pending" as const; },
    async holdings() { return { native: "0", coins: [] }; },
    txHash: (t: string) => t, async send() { return ""; }, async status() { return "unknown" as const; }, async fill() { return undefined; }, poolChanged() {},
  } as unknown as ChainEngine;
  const real = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  // a crash between the claim's booking and its records (the audit's MUST, 7 Nov): the records' write dropped while `drop` is on
  const crash = { drop: false };
  const bridge = { ...real, call: ((m: string, p?: Record<string, unknown>) => (crash.drop && m === "device.store.set" && p?.key === "activity" ? Promise.resolve({ ok: {} }) : real.call(m, p))) as typeof real.call } as typeof real;
  const make = () => createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => 1, meta: async () => ({ symbol: "BLACKDRAGON" }), chains: ["near"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  const svc = make();
  return { svc, clock, claims, release, make, crash, store: real };
}
/** A trade done on the node's word whose FINAL check ended with no answer, then the live window passed. */
async function unchecked(o: Parameters<typeof world>[0]) {
  const w = world(o);
  await w.svc.trade(await w.svc.quote("buy", "near", COIN, { usd: 1 }));
  await w.svc.checked();
  w.clock.t += HOUR + 1_000;
  const [rec] = await w.svc.activity();
  return { ...w, rec: rec! };
}
const svcOf = (s: unknown) => s as { keptHeld(id: string): Promise<string | null>; claimKept(id: string): Promise<{ got: string } | undefined> };
type View = { head: string; body?: string; claim?: { label: string; running: string }; details?: { open: string; head: string; rows: { label: string; value: string }[] } };
const keptWay = (cards as unknown as { keptWay: (k: unknown, held: string | null | undefined) => View }).keptWay;

test("the audit's MUST: a kept trade left unchecked says Rhea may be holding the coin, never \"your wallet shows what you hold\", and keeps the way back's facts (control: a plain unchecked trade's card is unchanged)", async () => {
  const { rec, clock } = await unchecked({ kept: true });
  assert.equal(rec.problem?.code, "trade.near.rhea-kept");
  assert.equal(rec.problem?.whatHappened, HEAD);
  const c = cards.tradeCard(rec, clock.t);
  assert.equal(c.result, HEAD);
  assert.ok(!c.result.includes(WALLET_SAYS) && !rec.problem!.whatHappened.includes(WALLET_SAYS));
  assert.deepEqual([c.badge, c.title], ["Check", "Bought BLACKDRAGON, amount unchecked"]);
  assert.deepEqual((c as { kept?: unknown }).kept, { id: rec.id, wallet: "w.near", hash: "h1", token: COIN, symbol: "BLACKDRAGON", decimals: 18 });
  assert.equal(cards.openByDefault(c), true, "the way back shows without a tap");
  // control: the same trade with nothing kept is the unchanged unchecked card
  const plain = await unchecked({ kept: false });
  const p = cards.tradeCard(plain.rec, plain.clock.t);
  assert.equal(plain.rec.problem?.code, "trade.trade.final-unchecked");
  assert.equal(p.result, "ZeroFee couldn't confirm how much BLACKDRAGON you got. Your NEAR wallet shows what you hold.");
  assert.equal((p as { kept?: unknown }).kept, undefined);
});

test("the audit's MUST (2) + (4): Get it back shows only while Ref's lost and found holds the coin (two nodes); none: who to ask and the wallet, the trade and the coin, no button; can't read: look again, no button", () => {
  const k = { id: "t", wallet: "w.near", hash: "h1", token: COIN, symbol: "BLACKDRAGON", decimals: 18 };
  assert.deepEqual(keptWay(k, "5000000000000000000"), { head: "Your BLACKDRAGON is still with Rhea.", body: "About 5 BLACKDRAGON. Nothing is lost.", claim: { label: "Get it back", running: "Getting it back…" } });
  const owner = keptWay(k, "0");
  assert.equal(owner.claim, undefined, "no button: only Rhea's team can send it back");
  assert.deepEqual([owner.head, owner.body], ["Your BLACKDRAGON didn't reach your NEAR wallet.", "It's most likely with Rhea's team. Ask them to send it back."]);
  assert.deepEqual(owner.details, { open: "Show details", head: "Give them these:", rows: [{ label: "Your wallet", value: "w.near" }, { label: "The trade", value: "h1" }, { label: "The coin", value: COIN }] });
  assert.ok(!JSON.stringify(owner).includes("Nothing is lost"));
  for (const h of [null, undefined]) assert.equal(keptWay(k, h).claim, undefined, String(h));
  assert.deepEqual([keptWay(k, null).head, keptWay(k, null).body], ["ZeroFee couldn't reach Rhea, so it stopped.", "Nothing moved. Open this again to check."]);
  assert.equal(keptWay(k, undefined).head, "Checking with Rhea…");
  // the copy review: "your NEAR wallet" everywhere, never a bare "your wallet"
  for (const h of ["5", "0", null, undefined]) assert.ok(!/your wallet/.test(JSON.stringify(keptWay(k, h)).replace(/Your wallet"/g, "")), String(h));
});

test("the audit's MUST (2): the service reads Ref's lost and found for the kept trade's coin (control: a trade with nothing kept reads nothing)", async () => {
  const { svc, rec } = await unchecked({ kept: true, held: 5000n });
  assert.equal(await svcOf(svc).keptHeld(rec.id), "5000");
  const none = await unchecked({ kept: true, held: null });
  assert.equal(await svcOf(none.svc).keptHeld(none.rec.id), null, "nodes apart: can't tell");
  const plain = await unchecked({ kept: false });
  assert.equal(await svcOf(plain.svc).keptHeld(plain.rec.id), null);
});

test("the audit's MUST (3): a double tap makes one claim; the measured rise is booked once and the card turns done (control: a claim that can't tell books nothing and keeps the card)", async () => {
  const { svc, rec, clock, claims, release } = await unchecked({ kept: true, got: 4000n });
  const one = svcOf(svc).claimKept(rec.id), two = svcOf(svc).claimKept(rec.id);
  release();
  assert.deepEqual(await Promise.all([one, two]), [{ got: "4000" }, { got: "4000" }]);
  assert.deepEqual(claims, [COIN], "one claim, one tx");
  const [after] = await svc.activity();
  assert.deepEqual([after!.problem, after!.fill?.got, after!.fill?.estimated, after!.fill?.kept, (after as { kept?: unknown }).kept], [undefined, "1000000000000000000000000", true, undefined, undefined], "its own figure: about its quote");
  assert.equal((await svc.positions())[0]?.raw, "4000", "booked once, the measured figure");
  const c = cards.tradeCard(after!, clock.t);
  assert.deepEqual([c.badge, c.title, (c as { kept?: unknown }).kept], ["Done", "Bought BLACKDRAGON", undefined]);
  // a tap after it is booked claims nothing more and books nothing twice
  assert.equal(await svcOf(svc).claimKept(rec.id), undefined);
  assert.deepEqual(claims, [COIN]);
  assert.equal((await svc.positions())[0]?.raw, "4000");
  // control: the claim can't tell: nothing booked, the card stays kept
  const no = await unchecked({ kept: true });
  no.release();
  assert.equal(await svcOf(no.svc).claimKept(no.rec.id), undefined);
  assert.equal((await no.svc.positions()).length, 0);
  assert.equal((await no.svc.activity())[0]!.problem?.code, "trade.near.rhea-kept");
});

test("the audit's MUST: one claim takes the coin's WHOLE lost and found: two kept trades of one coin are both done by it, the measured total booked once, no help step, nothing booked twice", async () => {
  const w = world({ kept: true, got: 9000n, held: 9000n });
  await w.svc.trade(await w.svc.quote("buy", "near", COIN, { usd: 1 }));
  await w.svc.trade(await w.svc.quote("buy", "near", COIN, { usd: 1 }));
  await w.svc.checked();
  w.clock.t += HOUR + 1_000;
  const both = await w.svc.activity();
  assert.deepEqual(both.map((r) => r.problem?.code), ["trade.near.rhea-kept", "trade.near.rhea-kept"]);
  // a tap on each card: one claim, one tx
  const taps = [svcOf(w.svc).claimKept(both[0]!.id), svcOf(w.svc).claimKept(both[1]!.id)];
  w.release();
  assert.deepEqual(await Promise.all(taps), [{ got: "9000" }, { got: "9000" }]);
  assert.deepEqual(w.claims, [COIN], "one claim");
  assert.equal((await w.svc.positions())[0]?.raw, "9000", "the measured total, booked once");
  const after = await w.svc.activity();
  for (const r of after) {
    const c = cards.tradeCard(r, w.clock.t);
    assert.deepEqual([r.problem, c.badge, (c as { kept?: unknown }).kept], [undefined, "Done", undefined], "done, no help step");
    assert.equal(await svcOf(w.svc).keptHeld(r.id), null, "nothing left to read for it");
  }
  // nothing books twice: another tap, or a reopen, adds nothing
  assert.equal(await svcOf(w.svc).claimKept(after[1]!.id), undefined);
  await w.svc.resume();
  await w.svc.checked();
  assert.equal((await w.svc.positions())[0]?.raw, "9000");
  assert.deepEqual(w.claims, [COIN]);
});

test("the audit's MUST: a crash after the claim is booked but before its records are saved: the reopen closes its trades as claimed, no help step, nothing booked twice", async () => {
  const w = world({ kept: true, got: 9000n, held: 0n });
  await w.svc.trade(await w.svc.quote("buy", "near", COIN, { usd: 1 }));
  await w.svc.trade(await w.svc.quote("buy", "near", COIN, { usd: 1 }));
  await w.svc.checked();
  w.clock.t += HOUR + 1_000;
  const both = await w.svc.activity();
  await w.svc.positions();                                            // the kept records' own save lands first
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual((await w.make().activity()).map((r) => r.problem?.code), ["trade.near.rhea-kept", "trade.near.rhea-kept"], "control: saved kept");
  w.crash.drop = true;
  const tap = svcOf(w.svc).claimKept(both[0]!.id);
  w.release();
  assert.deepEqual(await tap, { got: "9000" });
  w.crash.drop = false;
  // the reopen: the book has the claim, the records still say kept (and Rhea's lost and found is now empty: held 0)
  const y = w.make();
  const after = await y.activity();
  for (const r of after) {
    const c = cards.tradeCard(r, w.clock.t);
    assert.deepEqual([r.problem?.code, c.badge, (c as { kept?: unknown }).kept, r.fill?.estimated], [undefined, "Done", undefined, true], "closed as claimed, never the help step");
  }
  assert.equal((await y.positions())[0]?.raw, "9000", "booked once");
  await y.resume();
  await y.checked();
  const z = w.make();
  await z.activity();
  assert.equal((await z.positions())[0]?.raw, "9000", "nothing books twice, reopened again");
  assert.deepEqual(w.claims, [COIN], "one claim");
});

test("the audit's SHOULD (8 Nov): the book's claims are pruned as its applied ids are: a claim whose covered trades are all gone goes on save, with its booking key; one with a covered trade still kept stays (control: a trade's own applied id stays)", async () => {
  const w = world({ kept: false });
  const at = w.clock.t;
  // the book as a reopen finds it: one claim covering only trades long gone from the records, one covering a trade still there
  const old = { id: "tOld", kind: "buy", chain: "near", coin: COIN, symbol: "BLACKDRAGON", status: "done", amountUsd: 1, hashes: ["h0"], startedAt: at, endedAt: at };
  const set = (key: string, v: unknown) => w.store.call("device.store.set", { key, value: JSON.stringify(v) });
  await set("activity", [old]);
  await set("positions.v2", { positions: {}, applied: { tOld: at, gone1: at, "claim:hGone": at, "claim:hKept": at }, claims: { hGone: ["gone1", "gone2"], hKept: ["gone3", "tOld"] } });
  // any save: a new trade
  await w.svc.trade(await w.svc.quote("buy", "near", COIN, { usd: 1 }));
  await w.svc.checked();
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  const got = await w.store.call<{ value: string | null }>("device.store.get", { key: "positions.v2" });
  const book = JSON.parse(("ok" in got ? got.ok.value : null) ?? "{}") as { applied: Record<string, number>; claims: Record<string, string[]> };
  assert.deepEqual(Object.keys(book.claims), ["hKept"], "the claim with a trade still kept stays; the one with none goes");
  assert.equal(book.applied["claim:hGone"], undefined, "its booking key goes with it");
  assert.equal(book.applied["claim:hKept"], at, "the kept claim's booking key stays");
  assert.equal(book.applied.gone1, undefined, "control: a gone trade's own id goes, as before");
  assert.equal(book.applied.tOld, at, "control: a kept trade's own id stays");
});
