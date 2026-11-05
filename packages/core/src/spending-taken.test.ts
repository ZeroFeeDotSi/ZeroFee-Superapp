// QA's k-trade3 lap (5 Nov): a second Move was accepted while another job was on the same money. Both entry
// points (Home's Move and Trade's Move) go through spending.topUp: a Move saved before its Safe signed and not known to
// have gone still counts on its coin, which the Safe's read still shows, so a second Move that needs that money is
// refused (trade.float.taken) before it saves. Each test has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSpendingService, type EngineMove, type EngineSnapshot, type SpendingEngine } from "./spending.ts";

function engine(moves: EngineMove[]) {
  const asked: unknown[] = [];
  const s: EngineSnapshot = { loaded: true, totalUsd: 0, reserveUsd: 0, takeableUsd: 0, chains: [], moves };
  const e: SpendingEngine & { asked: unknown[] } = {
    asked,
    snapshot: () => s,
    subscribe: () => () => undefined,
    refresh: async () => undefined,
    async add(usd, from) { asked.push({ add: usd, from }); return { id: "a2", kind: "add", usd, status: "moving", at: 0 }; },
    async takeOut() { throw new Error("not here"); },
    setCap() {},
    async moveNow() { throw new Error("not here"); },
  };
  return e;
}
const BANDS = { bands: [{ up_to: null, level: "FaceId" }], usd: [{ upToUsd: 500, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 86_400 }] };
const usdc = (n: string) => ({ tokenId: "nep141:usdc", symbol: "USDC", amount: n, usd: n, listed: true });
const NEAR = { tokenId: "near", symbol: "NEAR", amount: "4", usd: "16", listed: true };
function service(e: SpendingEngine, coins: unknown[]) {
  const store = new Map<string, string>();
  return createSpendingService({
    engine: () => e,
    async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
      if (method === "device.store.get") return { value: store.get(String(params.key)) ?? null } as T;
      if (method === "device.store.set") { store.set(String(params.key), String(params.value)); return { ok: true } as T; }
      if (method === "account.protection.get") return BANDS as T;
      if (method === "ledger.balances") return coins as T;
      throw new Error(`no answer for ${method}`);
    },
  });
}
/** The first Move: $2.20 of USDC, saved before its Safe signed, its page closed on the sheet (not known to have gone). */
const first = (o: Partial<EngineMove> = {}): EngineMove => ({ id: "mv-lap-first-move-0001", kind: "add", usd: 2.2, status: "waiting", at: 0, signing: { orphan: true }, ...o });

test("lap FAIL 2: a second Move of $2.10 while $2.20 of the Safe's $3.90 USDC is promised to a Move not known to have gone: refused before it saves, with what is free (control: the same Move with nothing promised goes)", async () => {
  const e = engine([first()]);
  const r = await service(e, [usdc("3.90")]).call("spending.topUp", { usd: "2.10", key: "lap-second-move-00001" });
  assert.ok("problem" in r, JSON.stringify(r));
  assert.equal(r.problem.code, "trade.float.taken");
  assert.equal(r.problem.whatHappened, "Another move is using this money. $1.70 is free to move.");
  assert.equal(r.problem.money.state, "safe");
  assert.deepEqual(e.asked, [], "nothing saved, no sheet");
  const ok = engine([]);
  assert.ok("ok" in (await service(ok, [usdc("3.90")]).call("spending.topUp", { usd: "2.10", key: "lap-second-move-00002" })), "control");
  assert.deepEqual(ok.asked, [{ add: 2.1, from: undefined }]);
});

test("lap FAIL 2 controls: a first Move that signed (the Safe's read shows it gone), one paid with another coin, or a Safe that holds both: the second goes", async () => {
  for (const [moves, coins, why] of [
    [[first({ signing: undefined, status: "moving" })], [usdc("3.90")], "signed: the read ($6.10 less its $2.20) already shows it gone"],
    [[first({ signing: { orphan: true, tokenId: "near" } })], [usdc("3.90"), NEAR], "the first pays with NEAR, the second with USDC"],
    [[first()], [usdc("10.00")], "the Safe holds both"],
  ] as const) {
    const e = engine([...moves] as EngineMove[]);
    const r = await service(e, [...coins]).call("spending.topUp", { usd: "2.10", key: "lap-second-move-00003" });
    assert.ok("ok" in r, `${why}: ${JSON.stringify(r)}`);
    assert.equal(e.asked.length, 1, why);
  }
});
