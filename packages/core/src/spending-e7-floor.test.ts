// Swap directions (5 Nov): E7, the Safe's NEAR → the Safe's USDC (spending.topUp { swap: "NEAR", home: true }), was
// offered from $2.00, but its move home is refused under $2 of what came in (trade float-two.ts MIN_USD): a $2.00 swap
// passed Face ID, then stopped in the NEAR wallet ("Too little came in"). It is now refused before any sheet under
// SAFE_LEG_MIN_USD ($2.09), with the money named where it is; at $2.09 it goes (control).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SAFE_LEG_MIN_USD } from "./float-floors.ts";
import { createSpendingService, type EngineMove, type EngineSnapshot, type SpendingEngine } from "./spending.ts";

const NEAR = { tokenId: "nep141:wrap.near", symbol: "NEAR", amount: "312.4", usd: "1383.93", listed: true };
const BANDS = { bands: [{ up_to: null, level: "FaceId" }], usd: [{ upToUsd: 500, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 86_400 }] };

function rig(o: { homeProof?: boolean } = {}) {
  const asked: unknown[] = [];
  const s: EngineSnapshot = { loaded: true, totalUsd: 0, reserveUsd: 0, takeableUsd: 0, chains: [], moves: [] };
  const e: SpendingEngine = {
    snapshot: () => s,
    subscribe: () => () => undefined,
    refresh: async () => undefined,
    async add(usd, from, _ready, _legs, then) { asked.push({ add: usd, from, then }); return { id: "a1", kind: "add", usd, status: "moving", at: 0 } satisfies EngineMove; },
    async takeOut(usd) { return { id: "h1", kind: "home", usd: usd === "all" ? 0 : usd, status: "waiting", at: 0 }; },
    setCap() {},
    async moveNow(chain, usd) { return { id: "s1", kind: "out", chain, usd, status: "moving", at: 0 }; },
  };
  const store = new Map<string, string>();
  const answers: Record<string, unknown> = { "account.protection.get": BANDS, "ledger.balances": [NEAR], "account.state": {}, "account.waiting": [] };
  const svc = createSpendingService({
    engine: () => e,
    homeProof: o.homeProof ?? true,
    async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
      if (method === "device.store.get") return { value: store.get(String(params.key)) ?? null } as T;
      if (method === "device.store.set") { store.set(String(params.key), String(params.value)); return { ok: true } as T; }
      if (method in answers) return answers[method] as T;
      throw new Error(`no answer for ${method}`);
    },
  } as never);
  return { svc, asked };
}

test("E7 under $2.09 ($2.00, $2.08) is refused before any sheet, the money named in the Safe; nothing is asked of the engine (control: $2.09 and $25 go, as one Add with its move home)", async () => {
  assert.equal(SAFE_LEG_MIN_USD, 2.09);
  for (const usd of ["2", "2.08"]) {
    const { svc, asked } = rig();
    const r = await svc.call("spending.topUp", { usd, swap: "NEAR", home: true });
    assert.ok("problem" in r && r.problem.code === "spending.move.too-small", `${usd}: ${JSON.stringify(r)}`);
    assert.equal(r.problem.money.state, "safe");
    assert.match(r.problem.whatHappened, /\$2\.09/);
    assert.equal(r.problem.whatHappened, "Swap at least $2.09 from your Safe.");
    assert.equal(r.problem.money.where, "in your Safe", "ProblemView says where the money is, once");
    assert.equal(asked.length, 0, `${usd}: no Add, no Face ID`);
  }
  for (const usd of ["2.09", "25"]) {
    const { svc, asked } = rig();
    const r = await svc.call("spending.topUp", { usd, swap: "NEAR", home: true });
    assert.ok("ok" in r, `control ${usd}: ${JSON.stringify(r)}`);
    assert.deepEqual((asked.at(-1) as { then?: unknown }).then, { home: true }, "E7: the Add goes home");
  }
});

test("the floor is E7's only: a plain Safe → NEAR wallet Top up of $2.00 still goes (control), and E7 off (no proof build) keeps its own refusal", async () => {
  const plain = rig();
  assert.ok("ok" in (await plain.svc.call("spending.topUp", { usd: "2", swap: "NEAR" })), "control: no home, no E7 floor");
  const off = rig({ homeProof: false });
  const r = await off.svc.call("spending.topUp", { usd: "25", swap: "NEAR", home: true });
  assert.ok("problem" in r && r.problem.code === "spending.move.not-open");
});
