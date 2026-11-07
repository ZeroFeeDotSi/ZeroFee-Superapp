// the audit's MUST (7 Nov): the Safe-only top-ups keep one key per amount (topUpAsk) so a retry is the same move; but once a try's
// move exists, the same amount asked again on purpose must be a second move, never the first one handed back by the
// core's key check (no money moves, a "done" shows). Through the core's own spending.topUp (its key check, oneTopUp),
// each sheet's ask and end (topUpAsk, topUpEnded), for Home's Spending and Trade's Add. Controls: a try refused before
// its job, or declined, keeps the key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSpendingService } from "@zerofee/core/spending";
import type { Problem } from "@zerofee/core/problem";
import { topUpAsk, topUpEnded } from "@zerofee/shell-api/topup-ask.ts";

/** A refusal that proves nothing moved, and ones that say the money may have moved (money-calls moneyMayHaveMoved). */
const NOTHING_MOVED: Problem = { code: "ledger.private.short", whatHappened: "Private has $1.00.", money: { state: "safe", where: "in your Safe" }, next: { kind: "retry", label: "Try again" } };
const MAY_HAVE_MOVED: Problem[] = [
  { code: "ledger.send.unconfirmed", whatHappened: "No answer came back.", money: { state: "unsure", where: "either in your Safe or on its way", check: "Check Activity first." }, next: { kind: "open", label: "Open Activity", screen: "activity" } },
  { code: "ledger.send.partly", whatHappened: "Part of it went.", money: { state: "on-the-way", where: "to your NEAR wallet" }, next: { kind: "nothing", label: "OK" } },
];

/** The core's spending.topUp over an engine that records each Add it is asked for (a new move each time). */
function core() {
  const adds: (string | undefined)[] = [];
  const engine = {
    snapshot: () => ({ loaded: true, totalUsd: 0, reserveUsd: 0, takeableUsd: 0, chains: [], moves: [] }),
    subscribe: () => () => undefined, refresh: async () => undefined, setCap() {},
    async add(usd: number, _f: unknown, _r: unknown, _l: unknown, _t: unknown, _a: unknown, jobKey?: string) { adds.push(jobKey); return { id: `mv-${adds.length}`, kind: "add", usd, status: "moving", at: 0 }; },
    async takeOut() { throw new Error("not here"); }, async moveNow() { throw new Error("not here"); },
  };
  const store = new Map<string, string>();
  const svc = createSpendingService({
    engine: () => engine as never,
    async call<T>(method: string, q: Record<string, unknown>): Promise<T> {
      if (method === "device.store.get") return { value: store.get(String(q.key)) ?? null } as T;
      if (method === "device.store.set") { store.set(String(q.key), String(q.value)); return { ok: true } as T; }
      if (method === "account.protection.get") return { bands: [{ up_to: null, level: "FaceId" }], usd: [{ upToUsd: 500, level: "faceid" }] } as T;
      if (method === "ledger.balances") return [{ tokenId: "nep141:usdc", symbol: "USDC", amount: "100", usd: "100", listed: true }] as T;
      throw new Error(`no answer for ${method}`);
    },
  });
  return { svc, adds };
}

for (const prefix of ["home-topup", "trade-topup"]) {
  test(`the audit's MUST (${prefix}): a top-up that went, then the same amount again on purpose: a new key and a second move [the earlier move came back, one Add, without topUpEnded]; control: one refused before its job, or declined, then the same amount: the same key`, async () => {
    const c = core();
    const keys = new Map<string, string>();
    const first = topUpAsk(keys, "5", prefix);
    const r1 = await c.svc.call<{ id: string }>("spending.topUp", first.params);
    assert.ok("ok" in r1);
    topUpEnded(keys, "5", { job: {}, ok: r1.ok });
    const again = topUpAsk(keys, "5", prefix);
    assert.notEqual(again.key, first.key, "a new key");
    const r2 = await c.svc.call<{ id: string }>("spending.topUp", again.params);
    assert.ok("ok" in r2);
    assert.deepEqual(c.adds, [first.key, again.key], "two moves");
    assert.notEqual(r2.ok.id, r1.ok.id);
    // the audit (7 Nov): a refusal after its job that says nothing moved: a new key
    topUpEnded(keys, "5", { job: {}, problem: NOTHING_MOVED });
    assert.notEqual(topUpAsk(keys, "5", prefix).key, again.key, "nothing moved: a new key");
    // controls: refused before its job, or declined: the retry is the same move
    for (const end of [{ refused: {} }, { declined: true, after: false }]) {
      const k = new Map<string, string>();
      const a = topUpAsk(k, "5", prefix);
      topUpEnded(k, "5", end);
      assert.equal(topUpAsk(k, "5", prefix).key, a.key, JSON.stringify(end));
    }
  });
}

for (const prefix of ["home-topup", "trade-topup"]) {
  test(`the audit (7 Nov, ${prefix}): a refusal after its job that says the money may have moved (signed, then unsure), then the same amount: the same key, and the core hands back that move, no second Add [a new key and a second move on 3862c9d84]; control: one that says nothing moved, a new key`, async () => {
    const c = core();
    const keys = new Map<string, string>();
    const first = topUpAsk(keys, "5", prefix);
    const r1 = await c.svc.call<{ id: string }>("spending.topUp", first.params);
    assert.ok("ok" in r1);
    // the page heard a refusal after the Safe signed (a lost answer, an unsure send): the core's move may be real
    for (const unsure of MAY_HAVE_MOVED) {
      topUpEnded(keys, "5", { job: {}, problem: unsure });
      const again = topUpAsk(keys, "5", prefix);
      assert.equal(again.key, first.key, `${unsure.code}: the same key`);
      const r2 = await c.svc.call<{ id: string }>("spending.topUp", again.params);
      assert.ok("ok" in r2 && r2.ok.id === r1.ok.id, `${unsure.code}: the core's existing move, handed back`);
    }
    assert.deepEqual(c.adds, [first.key], "one Add: never a second pay");
    // control: nothing moved, a new key
    topUpEnded(keys, "5", { job: {}, problem: NOTHING_MOVED });
    assert.notEqual(topUpAsk(keys, "5", prefix).key, first.key);
  });
}

test("the audit's MUST: both sheets end each try with topUpEnded, on the try's own amount, before anything else (Spending's TopUpSheet, Trade's Add)", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  for (const src of [read("../screens/Spending.tsx"), read("../../../../trade/src/app/screens/AddTakeOut.tsx")]) {
    assert.match(src, /topUpEnded\(keys\.current, ask\.params\.usd, end\);\n\s+if \("declined" in end\)/);
  }
});
