// Bug report (5 Nov): "after a Safe → SOL Move, if I close the window and come back, the Move job is GONE". The Add was
// saved only once the Safe's transaction was final (6–9 s after the Approve); a page closed in between lost the row and
// its legs while the money still left the Safe. Now the job is saved before the Safe signs, under the id it keeps to its
// end (mv-<key>), and a page opened again finds out what became of it: 1Click's record of the quote kept for that job,
// then the chain (QA's MUST: "nothing moved" only when the chain shows no payment).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "./float-core.ts";
import { SIGNING_WORDS } from "./float-signing.ts";

const DEP = "4cb9371d628e1ad751552fce130b05d2c3804c95d464bc885a60f678b4a38f73";
const KEY = "home-move-0123456789abcdef01234567";
const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const nativeUsd = async (c: keyof typeof PX) => PX[c];
const tick = () => new Promise((r) => setTimeout(r, 5));

/** One phone: its store outlives each page; `page()` is the app opened (again). `held`: the ledger's timed steps (its
 *  movement settling) never run on their own, so a read sees it still moving however slow the machine is. */
async function phone(o: { held?: boolean } = {}) {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10 }, ...(o.held ? { timers: { set: () => undefined, clear: () => {} } } : {}) });
  const kept = new Map<string, unknown>();
  const core = { status: "pending" as string | null, sent: "none" as "none" | "found" | "unknown" | "throws", asked: [] as string[], hang: false, decline: false, refuse: "" };
  let t = 1_000_000;
  for (const chain of ["sol", "hood", "bsc"]) await mock.call("subwallet.create", { kind: "trade", chain });
  function page() {
    const call: CoreFloatDeps["call"] = async (method, params) => {
      if (method === "subwallet.float.addStatus" && params.job !== undefined) {
        core.asked.push(`addStatus:${params.job}`);
        return (core.status ? { status: core.status, depositAddress: DEP, tokenId: "nep141:usdc", deadlineMs: 1_000_000 + 10 * 60_000 } : null) as never;
      }
      if (method === "ledger.addSent") {
        core.asked.push(`addSent:${params.depositAddress}:${params.sinceIso}`);
        if (core.sent === "throws") throw new ProblemError({ code: "security.nodes.unreachable", whatHappened: "x", money: { state: "safe", where: "x" }, next: { kind: "nothing", label: "OK" } } as never);
        return core.sent as never;
      }
      if (method === "ledger.toTrading") {
        core.asked.push(`toTrading:${params.job}`);
        if (core.hang) return new Promise(() => {}) as never;   // the page closes while the Safe's tx goes final
        if (core.decline) return { status: "declined" } as never;
        if (core.refuse) throw new ProblemError({ code: core.refuse, whatHappened: "No.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "OK" } } as never);
      }
      const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem);
      return (method === "ledger.toTrading" ? { ...r.ok, status: "moving", depositAddress: DEP } : r.ok) as never;
    };
    const f = createCoreFloat({ offered: (c) => c !== "bsc", call, nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async (k) => structuredClone(kept.get(k)), set: async (k, v) => { kept.set(k, structuredClone(v)); }, now: () => t, every: () => () => undefined, rng: () => 0.5 });
    const host = async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T;
    const svc = createSpendingService({ engine: () => f as never, call: host });
    const rows = async () => { const r = await svc.call<SpendingActivity[]>("spending.activity", {}); assert.ok("ok" in r); return r.ok; };
    return { f, svc, rows, row: async (id: string) => (await rows()).find((a) => a.id === id) };
  }
  const savedRow = () => ((kept.get("float.adds.v1")) as { r: { id: string; signing?: unknown; legs?: unknown[]; status: string } }[] | undefined)?.map((x) => x.r).find((r) => r.id === `mv-${KEY}`);
  return { core, page, savedRow, mock, later: (ms: number) => { t += ms; } };
}

/** Page 1 taps Move; its Safe's tx is on its way when the page closes (the call never answers). */
async function closedWhileSigning() {
  const p = await phone();
  p.core.hang = true;
  const one = p.page();
  void one.svc.call("spending.topUp", { usd: 6, legs: [{ network: "sol", usd: 6 }], key: KEY });
  for (let i = 0; i < 100 && !p.core.asked.includes(`toTrading:${KEY}`); i++) await tick();
  assert.ok(p.core.asked.includes(`toTrading:${KEY}`), "the Safe was asked, with the job's key");
  return p;
}

test("the job is saved, with its legs, before the Safe signs: under the id it keeps to its end", async () => {
  const p = await closedWhileSigning();
  const r = p.savedRow();
  assert.ok(r, "the job is on the phone before the Safe's answer");
  assert.ok(r!.signing, "saved as asked of the Safe");
  assert.equal(r!.legs?.length, 1, "its SOL leg with it");
});

test("closed while signing, the tx landed: opened again, the same row goes on and its SOL leg goes", async () => {
  const p = await closedWhileSigning();
  p.core.status = "done";
  // the Safe's tx went final after the page closed: the money reached the NEAR wallet
  assert.ok("ok" in (await p.mock.call("ledger.toTrading", { amount: "6.00" })));
  await new Promise((r) => setTimeout(r, 50));
  const two = p.page();
  await two.f.refresh();
  const r = await two.row(`mv-${KEY}`);
  assert.ok(r, "the same row (mv-<key>), never gone");
  assert.notEqual(r!.status, "refused");
  assert.ok(p.core.asked.includes(`addStatus:${KEY}`), "found by its job's key");
  for (let i = 0; i < 6; i++) { p.later(130_000); await two.f.refresh(); }
  const legs = (await two.rows()).filter((a) => a.of === `mv-${KEY}`);
  assert.ok(legs.some((l) => l.network === "sol"), "its SOL leg went on, as if the page had never closed");
});

test("closed while signing, 1Click still waits, the chain shows the payment: on its way (never 'nothing moved')", async () => {
  const p = await closedWhileSigning();
  p.core.sent = "found";
  const two = p.page();
  await two.f.refresh();
  assert.ok(!p.core.asked.some((a) => a.startsWith("addSent")), "the chain isn't asked while its payment may still be landing");
  assert.equal((await two.row(`mv-${KEY}`))?.signing, "checking");
  p.later(3 * 60_000); await two.f.refresh();
  const r = await two.row(`mv-${KEY}`);
  assert.equal(r?.status, "on-its-way");
  assert.equal(r?.signing, undefined);
  assert.ok(p.core.asked.some((a) => a === `addSent:${DEP}:${new Date(1_000_000).toISOString()}`), "asked by its deposit address since it was saved");
});

test("QA's MUST: 'nothing moved' only once 1Click's price ran out AND the chain shows no payment", async () => {
  const p = await closedWhileSigning();
  p.core.sent = "none";
  const two = p.page();
  p.later(3 * 60_000); await two.f.refresh();
  assert.equal((await two.row(`mv-${KEY}`))?.signing, "checking", "control: before the price ran out, nothing is said");
  p.later(20 * 60_000); await two.f.refresh();
  const r = await two.row(`mv-${KEY}`);
  assert.equal(r?.status, "refused");
  assert.equal(r?.note, SIGNING_WORDS.notSent);
});

for (const how of ["unknown", "throws"] as const) {
  test(`QA's MUST: a chain read that ${how === "throws" ? "fails" : "can't tell"} says where a late payment goes, and keeps watching`, async () => {
    const p = await closedWhileSigning();
    p.core.sent = how;
    const two = p.page();
    p.later(23 * 60_000); await two.f.refresh();
    let r = await two.row(`mv-${KEY}`);
    assert.equal(r?.note, SIGNING_WORDS.ifSent);
    assert.notEqual(r?.status, "refused", "never 'nothing moved' on a read that failed");
    p.core.status = "refunded";
    p.later(60_000); await two.f.refresh();
    r = await two.row(`mv-${KEY}`);
    assert.equal(r?.status, "refunded", "1Click's refund ends it, said where it is");
  });
}

test("found after the price ran out: a late payment is on its way, never 'nothing moved'", async () => {
  const p = await closedWhileSigning();
  p.core.sent = "found";
  const two = p.page();
  p.later(23 * 60_000); await two.f.refresh();
  assert.equal((await two.row(`mv-${KEY}`))?.status, "on-its-way");
});

test("no quote kept for the job (closed before any sheet): the row goes without a word", async () => {
  const p = await closedWhileSigning();
  p.core.status = null;
  const two = p.page();
  await two.f.refresh();
  assert.equal(await two.row(`mv-${KEY}`), undefined);
});

test("control: the page stays open: one row, mv-<key>, from the save to its end; hidden while its Approve is up", async () => {
  // the ledger's movement is held "moving" (it settled on a 5 ms wall-clock timer, so a loaded gate read it "done")
  const p = await phone({ held: true });
  const one = p.page();
  const r = await one.svc.call<SpendingActivity>("spending.topUp", { usd: 6, legs: [{ network: "sol", usd: 6 }], key: KEY });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.equal(r.ok.id, `mv-${KEY}`, "the row's id is the job's");
  assert.equal(r.ok.signing, undefined);
  assert.equal((await one.rows()).filter((a) => a.kind === "top-up").length, 1, "one row, never two");
  assert.equal(p.savedRow()?.signing, undefined, "saved as it went");
  // opened again: the ledger's record still matches it (by the ledger's own id kept beside it)
  const two = p.page();
  await two.f.refresh();
  assert.equal((await two.row(`mv-${KEY}`))?.status, "on-its-way");
});

test("control: a no on the Safe's sheet, or a refusal before signing, leaves no job behind", async () => {
  for (const how of ["decline", "refuse"] as const) {
    const p = await phone();
    if (how === "decline") p.core.decline = true; else p.core.refuse = "wallet.balance.low";
    const one = p.page();
    await one.svc.call("spending.topUp", { usd: 6, legs: [{ network: "sol", usd: 6 }], key: KEY });
    assert.equal(p.savedRow(), undefined, how);
    assert.equal(await one.row(`mv-${KEY}`), undefined, how);
  }
});

test("control: a send whose answer was lost after signing keeps the job, to be checked", async () => {
  const p = await phone();
  p.core.refuse = "security.send.unconfirmed";
  const one = p.page();
  await one.svc.call("spending.topUp", { usd: 6, legs: [{ network: "sol", usd: 6 }], key: KEY });
  assert.ok(p.savedRow()?.signing, "kept: it may have gone");
  assert.equal((await one.row(`mv-${KEY}`))?.signing, "checking");
});
