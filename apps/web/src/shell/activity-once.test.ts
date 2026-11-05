// The proof run's Sim walk of the pump.fun wallet (5 Nov, rule 11): a $10 Add to the person's own pump.fun wallet,
// paid from Private (NEAR Confidential), showed TWO Activity rows: its job's, and "Paid … with the address you gave" for
// the payment to the site's wallet. On the Sim's own ledger (MockBridge), the real engine and Spending: the row says which
// payments are it (`paid`, fix/jobs-4r f9f3ab6d4 + ba41a7710), so Activity lists the Add once. Control: a payment that is
// no part of it stays its own row.
// QA's Jobs re-crawl (5 Nov, B4/F3): a Swap from the Safe, paid from Private (NEAR Confidential), showed in
// Activity as two Moves ("Moved to your SOL wallet · 10 USDC from your private balance" and "Moved $11.00 to your SOL
// wallet · On its way") and no Swap. The row says which payments are it (`paid`), so Activity lists the move once, named
// as its Swap. Controls: a payment that is no part of it stays its own row; a row nothing named keeps its own words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity, type SpendingStatus, type SpendingWallet } from "@zerofee/core/spending";
import { tradingUsd } from "@zerofee/wallet/app/trading.ts";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "@zerofee/trade/float-core.ts";
import { nameSwap } from "@zerofee/shell-api/job-carry.ts";
import { activityRows, legsLine, nameOf } from "@zerofee/wallet/app/activity-rows.ts";
import { foldInto, moveTrack } from "@zerofee/wallet/app/money/live-steps.ts";
import type { Movement } from "@zerofee/wallet/types.ts";

const KEY = "activity-once-0123456789abcdef01";
const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const nativeUsd = async (c: keyof typeof PX) => PX[c];
const tick = () => new Promise((r) => setTimeout(r, 5));

async function phone(settleMs = 20) {
  const mock = createMockBridge({ latencyMs: 0, settleMs, float: { moveMs: 10 }, hiddenStart: { usdc: "50", near: "0" } });
  for (const chain of ["sol", "hood", "bsc"]) await mock.call("subwallet.create", { kind: "trade", chain });
  const kept = new Map<string, unknown>();
  const call: CoreFloatDeps["call"] = async (method, params) => {
    const r = await mock.call<any>(method, params);
    if ("problem" in r) throw new ProblemError(r.problem);
    return r.ok as never;
  };
  const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async (k) => structuredClone(kept.get(k)), set: async (k, v) => { kept.set(k, structuredClone(v)); }, now: () => 1_000_000, every: () => () => undefined, rng: () => 0.5, fromPrivate: true });
  const host = async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T;
  const svc = createSpendingService({ engine: () => f as never, call: host });
  const rows = async () => { const r = await svc.call<SpendingActivity[]>("spending.activity", {}); assert.ok("ok" in r); return r.ok; };
  const movements = async () => ((await mock.call<any>("ledger.activity", {})) as any).ok as Movement[];
  // rule 11: a payment the ledger says is done lands on its wallet's chain read, which the engine's follow asks (each
  // second in the app; here, `refresh`)
  return { svc, rows, movements, call, refresh: () => f.refresh() };
}

test("the proof run's Sim walk (5 Nov, rule 11): a $10 Add to pump.fun on its way is NOT spendable: Trading's figure leaves it out while its row says On its way, and counts it once the wallet's chain read shows it landed (control: then it is in, once)", async () => {
  const s = await phone(400);
  const made = await s.call<{ id: string }>("subwallet.create", { kind: "site", siteId: "pump", chain: "sol" });
  const status = async () => { const r = await s.svc.call<SpendingStatus>("spending.status", {}); assert.ok("ok" in r); return r.ok; };
  const wallets = async () => { const r = await s.svc.call<SpendingWallet[]>("spending.wallets", {}); assert.ok("ok" in r); return r.ok; };
  const hot = async () => Number(tradingUsd(await status(), [], await wallets()).usd);
  const before = await hot();
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 10, ready: made.id, key: `${KEY}-spend` });
  assert.ok("ok" in r, JSON.stringify(r));
  const row = async () => (await s.rows()).find((x) => x.id === r.ok.id)!;
  assert.equal((await row()).status, "on-its-way");
  const site = async () => Number((await wallets()).find((w) => w.id === made.id)!.cashUsd);
  assert.equal(await site(), 0, "the site's wallet doesn't hold it yet (its chain read)");
  assert.equal(await hot(), before, "in flight: never counted as spendable");
  assert.ok((await status()).onItsWay.some((a) => a.id === r.ok.id && a.usd === "10.00"), "it is said as on its way, apart from the figure");
  for (let i = 0; i < 400 && (await row()).status !== "done"; i++) { await tick(); await s.refresh(); }
  assert.equal((await row()).status, "done");
  assert.equal(await site(), 10, "landed: the chain read has it");
  assert.equal(await hot(), before + 10, "control: once landed it counts, once");
});

const isPay = (m: Movement) => m.id.startsWith("pocket-send:") || m.id.startsWith("safe-send:");

test("B4: a Swap from the Safe paid from Private is ONE Activity row, named as its Swap; its payment is in it (controls: another payment stays its own row; an unnamed row keeps its words)", async () => {
  const s = await phone();
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 10, swap: "USDC", legs: [{ network: "sol", usd: 10 }], key: KEY });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.equal(r.ok.via, "private", "paid from Private (NEAR Confidential)");
  for (let i = 0; i < 200 && !(await s.movements()).some(isPay); i++) await tick();
  const pays = (await s.movements()).filter(isPay);
  assert.ok(pays.length >= 1, "the ledger has its payment");
  const row = (await s.rows()).find((x) => x.id === r.ok.id)!;
  assert.deepEqual([...(row.paid ?? [])].sort(), pays.map((m) => m.id).sort(), "the row names its payments");

  const other: Movement = { ...pays[0]!, id: "pocket-send:someone-else" };
  const list = activityRows([...(await s.movements()), other], await s.rows());
  assert.ok(!list.ledger.some((m) => pays.some((p) => p.id === m.id)), "its payment is no row of its own");
  assert.equal(list.spending.filter((x) => x.id === r.ok.id).length, 1, "the Swap is one row");
  assert.ok(list.ledger.some((m) => m.id === other.id), "control: a payment that is no part of it stays its own row");

  // rule 11: once its payment landed, Activity's row and Home's job say the same: done
  for (let i = 0; i < 400 && (await s.rows()).find((x) => x.id === r.ok.id)?.status !== "done"; i++) { await tick(); await s.refresh(); }
  const done = (await s.rows()).find((x) => x.id === r.ok.id)!;
  assert.equal(done.status, "done");
  assert.doesNotMatch(legsLine(done), /on its way/i, "Activity never says On its way once Jobs says Done");
  assert.equal(moveTrack(foldInto([done]).find((x) => x.id === done.id)!, "Swap $10 of USDC for SOL")!.end?.ok, true, "Home's job: Done, from the same row");
  // control: a public Move from the Safe (D137) is done only once its leg landed in the wallet
  assert.match(legsLine({ ...done, via: undefined, goesTo: ["sol"], legs: [] }), /on its way/i, "control: D137 still holds for a Move with legs");

  // move-title-kept (5 Nov): the Move's title is the same on every surface, so the unnamed row says "Move", not the core's "Moving"
  assert.equal(nameOf(row), "Move $10.00 to your SOL wallet", "control: nothing named, the Move's own title");
  nameSwap(r.ok.id, "Swap $10 of USDC for SOL");
  assert.equal(nameOf({ ...done, status: "on-its-way" }), "Swap $10 of USDC for SOL", "named as its Swap, never the Move underneath, the asked form as Home says it");
  assert.equal(nameOf(done), "Swap $10 of USDC for SOL", "done too: the line carries the state");
});

test("F1: the Sim never shows the fill's Approve while the fill is closed: the Move is refused before any sheet, naming why (control: open, the Safe's sheet asks first)", async () => {
  for (const open of [false, true]) {
    const mock = createMockBridge({ latencyMs: 0, settleMs: 20, hiddenStart: { usdc: "25", near: "0" }, safeFillOpen: open });
    await mock.call("subwallet.create", { kind: "trade", chain: "sol" });
    const sol = ((await mock.call<any>("subwallet.list", {})) as any).ok.find((w: { chain: string; kind: string }) => w.chain === "sol" && w.kind === "trade");
    const asked: string[] = [];
    mock.on<{ id: string; title?: string }>("approval.needed", (p) => { asked.push(String(p.title ?? "asked")); void mock.call("approval.answer", { id: p.id, approve: true }); });
    const r = await mock.call<any>("ledger.moveFromPrivate", { parts: [{ wallet: sol.id, usd: 120 }] });
    if (!open) {
      assert.equal(asked.length, 0, "no Approve that can only end in Nothing moved");
      assert.ok("problem" in r && /^Nothing moved\. Private has \$25\.00, and this needs \$120\.00\.$/.test(r.problem.whatHappened), JSON.stringify(r));
    } else {
      assert.equal(asked.length, 1, "control: the fill open, the Safe's sheet asks first");
      assert.ok("ok" in r, JSON.stringify(r));
    }
  }
});

test("a $10 Add to the person's own pump.fun wallet is ONE Activity row: its payment from Private is in it, never \"Paid … with the address you gave\" (control: a payment no move names stays its own row)", async () => {
  const s = await phone();
  const made = await s.call<{ id: string }>("subwallet.create", { kind: "site", siteId: "pump", chain: "sol" });
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 10, ready: made.id, key: `${KEY}-site` });
  assert.ok("ok" in r, JSON.stringify(r));
  for (let i = 0; i < 200 && !(await s.movements()).some(isPay); i++) await tick();
  const pays = (await s.movements()).filter(isPay);
  assert.ok(pays.length >= 1, "Private paid the site's wallet");
  const spending = await s.rows();
  assert.ok(spending.some((x) => x.id === r.ok.id && pays.every((p) => x.paid?.includes(p.id))), "the Add's row names its payment");
  const list = activityRows(await s.movements(), spending);
  assert.ok(!list.ledger.some((m) => pays.some((p) => p.id === m.id)), "no \"Paid … with the address you gave\" row for its own payment");
  assert.equal(list.spending.filter((x) => x.id === r.ok.id).length, 1, "one row per Add");
  // control: a payment no move names (a Send to someone) keeps its own row
  const other = { ...pays[0]!, id: "pocket-send:someone-else" } as Movement;
  assert.ok(activityRows([other, ...(await s.movements())], spending).ledger.some((m) => m.id === other.id), "another payment stays its own row");
});
