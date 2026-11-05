// The bug report (5 Nov, pump.fun top-up "completely broken"): one top-up is ONE Activity row, named by where it goes,
// and it never says "in your pump.fun wallet" before the move on to that wallet landed (real money, 5 Nov: said 2 min
// 43 s early). Spending's real engine and service on the shell's MockBridge, as st-break-rows.test.ts. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity } from "@zerofee/core/spending";
import { foldLegs } from "@zerofee/core/spending-fold";
import { bridgeWallets, createCoreFloat, readyGapMs, type CoreFloatDeps } from "./float-core.ts";
import { shownMove, siteMove } from "./app/boards.ts";
import type { MoveRow } from "./float-view.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const settle = () => new Promise((r) => setTimeout(r, 40));
const nativeUsd = async (c: keyof typeof PX) => PX[c];

async function setup(moveMs: number) {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs } });
  const call: CoreFloatDeps["call"] = async (method, params) => {
    const r = await mock.call<any>(method, params);
    if ("problem" in r) throw new ProblemError(r.problem);
    return r.ok;
  };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  const site = (await call("subwallet.create", { kind: "site", chain: "sol", siteId: "pump" })) as { id: string };
  let t = 1_000_000;
  const f = createCoreFloat({ call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async () => undefined, set: async () => {}, now: () => t, every: () => () => undefined, rng: () => 0.5 });
  const svc = createSpendingService({ now: () => t, engine: () => f as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T });
  const leg2 = async (id: string) => { await settle(); await f.refresh(); t += readyGapMs(id) + 1; await f.refresh(); await settle(); await f.refresh(); };
  const rows = async () => { const r = await svc.call<SpendingActivity[]>("spending.activity", {}); assert.ok("ok" in r); return r.ok; };
  return { f, svc, site, leg2, rows, mock };
}

test("a site's top-up is one Activity row with its leg folded in, named by where it goes; control: its leg is there, and a plain Move keeps its own row", async () => {
  const s = await setup(10);
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: "10", ready: s.site.id });
  assert.ok("ok" in r, JSON.stringify(r));
  await s.leg2(r.ok.id);
  await new Promise((ok) => setTimeout(ok, 80));
  await s.f.refresh();
  const all = await s.rows();
  // control: the move on to the site's wallet is its own record, and says whose leg it is
  const leg = all.find((a) => a.kind === "ready");
  assert.ok(leg, "control: leg 2 is in Spending's record");
  assert.equal(leg!.of, r.ok.id, "leg 2 is the top-up's own leg (one move)");
  const shown = foldLegs(all.filter((a) => a.shown));
  const mine = shown.filter((a) => a.site === "pump");
  assert.equal(mine.length, 1, `one row for one top-up: ${JSON.stringify(mine.map((a) => a.words))}`);
  assert.equal(mine[0]!.words, "Add $10.00 to your pump.fun wallet");
  assert.equal(mine[0]!.siteName, "pump.fun");
  assert.equal(mine[0]!.legs?.length, 1, "its leg on is inside it");
  // Trade's Activity never repeats it ("Moved $10.00 to your NEAR wallet"); control: shownMove alone would have shown it
  const moves = s.f.snapshot().moves;
  const ours = moves.filter((m) => m.id === r.ok.id || m.of === r.ok.id);
  assert.ok(ours.length >= 2 && ours.every(shownMove), "control: both were Trade rows before");
  assert.ok(ours.every((m) => siteMove(m, moves)), "now Home's only");
  assert.equal(siteMove({ id: "x", kind: "add", usd: 5, status: "done", where: "main", at: 0 }, moves), false, "control: a plain Move from the Safe is still Trade's");
});

test("the proof's Sim walk (fix/browser-sites-4, 5 Nov, rule 11): a $5.20 Move from the Safe to the SOL wallet is ONE row, Money's job; Trade's Activity never adds \"Moved $5.20 to your NEAR wallet\" (controls: a Move that ends in the NEAR wallet stays Trade's; a leg's own row follows its Move)", () => {
  const base = { usd: 5.2, status: "moving", where: "in-flight", at: 0 } as const;
  const viaPrivate = { ...base, id: "m-priv", kind: "add", why: "asked", priv: { parts: [{ wallet: "trade-sol-0", chain: "sol", usd: 5.2, ids: ["pocket-send:1"] }] } } as MoveRow;
  const viaLegs = { ...base, id: "m-legs", kind: "add", why: "asked", legs: [{ chain: "sol", usd: 5.2 }] } as MoveRow;
  const leg = { ...base, id: "j-out", kind: "out", why: "asked", chain: "sol", of: "m-legs" } as MoveRow;
  const toNear = { ...base, id: "m-near", kind: "add", why: "asked", priv: { parts: [{ wallet: "near", chain: "near", usd: 5.2, ids: ["pocket-send:2"] }] } } as MoveRow;
  const all = [viaPrivate, viaLegs, leg, toNear];
  assert.ok([viaPrivate, viaLegs, leg].every(shownMove), "control: each was a Trade row before");
  assert.deepEqual(all.filter((m) => shownMove(m) && !siteMove(m, all)).map((m) => m.id), ["m-near"], "Trade lists only the Move that ends in the NEAR wallet");
});

test("a site's top-up never says it's in the wallet before its move on landed; control: it does once that move landed", async () => {
  const s = await setup(1500);
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: "10", ready: s.site.id });
  assert.ok("ok" in r, JSON.stringify(r));
  // the Add reached the NEAR wallet; its move on to the site's wallet is asked and still on its way
  await s.leg2(r.ok.id);
  const going = (await s.rows()).find((a) => a.id === r.ok.id)!;
  const raw = s.f.snapshot().moves.find((m) => m.id === r.ok.id)!;
  assert.equal(raw.status, "done", "control: the engine's Add itself landed in the NEAR wallet");
  assert.equal(going.status, "on-its-way", "never done while its move on is on its way");
  assert.equal(going.words, "Add $10.00 to your pump.fun wallet");
  // once the move on lands, it is done, in the past tense (asked again until it lands, 6 s at most)
  let done = going;
  for (let i = 0; i < 60 && done.status !== "done"; i++) { await new Promise((ok) => setTimeout(ok, 100)); await s.f.refresh(); done = (await s.rows()).find((a) => a.id === r.ok.id)!; }
  assert.equal(done.status, "done");
  assert.equal(done.words, "Add $10.00 to your pump.fun wallet");
});
