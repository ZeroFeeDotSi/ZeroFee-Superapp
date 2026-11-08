// Audit 18's I3 (builder 22, 8 Nov): the Safe Buy/Sell's clock was 5x off in the Sim: the sheet said "about 32 s", the
// first frame "About 32 seconds left.", then "Took 6 s." (the measured mainnet fill, 30 s, plus the quote's 2 s). One
// clock, true from the first frame: the Sim's quote says its own pace (fillSeconds), and once this device has finished a
// Safe trade the clock is its own measured pace (the median of its last trades' legs, as read), the quote's legs only
// before any. Fails on main: no fillSeconds, no paceLegs, the Sim's first frame counts 32 s.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { confidentialLegs, keepPace, legsTime, paceLegs, runSwap, type SafeQuote, type SwapMove } from "./swap.ts";
import { SAFE_CASH } from "./assets.ts";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
const Q: SafeQuote = { id: "q1", from: SAFE_CASH, to: "nep141:wrap.near", amountIn: "25", amountOut: "6.2", minOut: "6.1", feeUsd: 0.05, etaSeconds: 11, expiresAtIso: new Date(Date.now() + 30_000).toISOString(), source: "safe" };
const MOVE: SwapMove = { id: "m1", kind: "swap", status: "moving", from: SAFE_CASH, to: "nep141:wrap.near", amount: "25" };

function fake(after: (emit: (m: SwapMove) => void) => void) {
  let handler: ((p: { movement: SwapMove }) => void) | undefined;
  const published: { endsAt?: number }[] = [];
  const bridge = {
    async call(method: string) { if (method === "ledger.swap") { queueMicrotask(() => after((m) => handler?.({ movement: m }))); return { ok: MOVE }; } return { ok: null }; },
    on(_e: string, h: (p: { movement: SwapMove }) => void) { handler = h; return () => { handler = undefined; }; },
  };
  const tasks = { publish: (t: { endsAt?: number }) => (published.push(t), true), update: () => true, end: () => true, open: () => undefined };
  return { bridge: bridge as never, tasks: tasks as never, published };
}

test("safe-pace-b22: the Sim's quote says its own pace: about 6 s, never 32 s", async () => {
  const b = createMockBridge({ latencyMs: 0 });
  b.on<{ id: string }>("approval.needed", (p) => void b.call("approval.answer", { id: p.id, approve: true }));
  await b.call("account.create", { recoveryDelaySeconds: 172_800 });
  const r = await b.call<SafeQuote>("ledger.swapQuote", { from: SAFE_CASH, to: "nep141:token.rhealab.near", amountIn: "5", source: "safe", priceUsd: 0.05, symbol: "RHEA" });
  assert.ok("ok" in r, JSON.stringify(r));
  const q = (r as { ok: SafeQuote }).ok;
  const legs = paceLegs(q, mem());
  assert.deepEqual(legs, [3, 3, 0], "fails on main: [30, 2, 0], 32 s");
  assert.equal(legsTime(legs), "6 s");
  assert.deepEqual(confidentialLegs(11), [30, 11, 0], "control: a quote with no fill time keeps the measured mainnet hop");
});

test("safe-pace-b22: once a Safe trade finished here, the next clock is this device's measured pace", async () => {
  const store = mem();
  assert.deepEqual(paceLegs(Q, store), [30, 11, 0], "before any: the quote's legs");
  const f = fake((emit) => { emit({ ...MOVE, inPrivateAtIso: new Date(Date.now() + 2_000).toISOString() }); emit({ ...MOVE, status: "done", amountOut: "6.2", settledMs: 6_000, inPrivateAtIso: new Date(Date.now() + 2_000).toISOString() }); });
  const tap = Date.now();
  assert.equal(await runSwap({ bridge: f.bridge, tasks: f.tasks, taskId: "t", title: "Buy $25.00 of NEAR", usd: "$25.00", quote: Q, tapMs: tap, got: "NEAR", storage: store }), "done");
  assert.equal(f.published[0]!.endsAt, tap + 41_000, "the first trade ever: the quote's legs");
  const legs = paceLegs(Q, store);
  assert.deepEqual(legs, [2, 4, 0], "into Private at its read, the rest to the end");
  const g = fake((emit) => emit({ ...MOVE, status: "done", amountOut: "6.2", settledMs: 6_000 }));
  const tap2 = Date.now();
  await runSwap({ bridge: g.bridge, tasks: g.tasks, taskId: "t2", title: "x", usd: "$25.00", quote: Q, tapMs: tap2, got: "NEAR", storage: store });
  assert.equal(g.published[0]!.endsAt, tap2 + 6_000, "the second trade's first frame: 6 s, its own pace");
});

test("safe-pace-b22: the median of the last five, each leg as read", () => {
  const store = mem();
  for (const [fill, rest] of [[2_000, 4_000], [3_000, 3_000], [40_000, 20_000], [2_500, 3_500], [3_000, 4_000]]) keepPace(fill!, rest!, store);
  assert.deepEqual(paceLegs(Q, store), [3, 4, 0], "one slow trade never sets the clock");
  for (let i = 0; i < 5; i++) keepPace(1_000, 1_000, store);
  assert.deepEqual(paceLegs(Q, store), [1, 1, 0], "only the last five");
});

test("safe-pace-b22: the sheet, the coin page and the receipt read the one pace", () => {
  const page = readFileSync(new URL("./NativeScreens.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("legsTime(paceLegs(q))"));
  assert.ok(page.includes("etaSec={paceLegs(sent).reduce((n, x) => n + x, 0)}"));
  assert.doesNotMatch(page, /confidentialLegs\(/, "no screen counts its own legs");
});
