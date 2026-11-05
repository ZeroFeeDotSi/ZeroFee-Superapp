// Sim Jobs (5 Nov): a Move that the Safe tops up showed as 2 rows. The real ledger keeps the Safe's fill inside the one
// "safe-send:" payment (wallet/src/safe-send.ts); the Sim recorded the fill as its own movement and left it out of the
// leg's ids, so Activity couldn't fold it. Now the fill's id goes with the filled leg. Control: a Move Private pays
// alone has one id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "./MockBridge.ts";

const ok = <T,>(r: { ok: T } | { problem: unknown }): T => { assert.ok("ok" in r, JSON.stringify(r)); return (r as { ok: T }).ok; };

async function sim() {
  const b = createMockBridge({ latencyMs: 0, settleMs: 5, hiddenStart: { usdc: "25", near: "0" }, safeFillOpen: true });
  b.on<{ id: string }>("approval.needed", (p) => void b.call("approval.answer", { id: p.id, approve: true }));
  const ws = ok(await b.call<{ id: string; chain: string; kind: string }[]>("subwallet.list", {}));
  return { b, sol: ws.find((w) => w.chain === "sol" && w.kind === "trade")! };
}

test("a Move the Safe tops up returns the fill's id with its leg, so Activity shows one row (control: Private alone, one id)", async () => {
  const s = await sim();
  const r = ok(await s.b.call<{ parts: { ids: string[] }[] }>("ledger.moveFromPrivate", { app: "wallet", parts: [{ wallet: s.sol.id, usd: 50 }], job: "home-move-onerow" }));
  const ids = r.parts[0]!.ids;
  assert.equal(ids.length, 2, "the payment and the fill");
  const moves = ok(await s.b.call<{ id: string; kind: string }[]>("ledger.activity", { limit: 50 }));
  assert.ok(moves.some((m) => m.kind === "private" && ids.includes(m.id)), "the fill's ledger row is one of the leg's ids");
  const only = await sim();
  const r2 = ok(await only.b.call<{ parts: { ids: string[] }[] }>("ledger.moveFromPrivate", { app: "wallet", parts: [{ wallet: only.sol.id, usd: 20 }] }));
  assert.equal(r2.parts[0]!.ids.length, 1, "control: no fill, one id");
});
