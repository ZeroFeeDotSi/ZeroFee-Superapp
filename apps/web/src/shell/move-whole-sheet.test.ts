// C2 end to end on the Sim's ledger, the real engine (trade float-core, paying from Private) and the real Spending
// (core spending.ts): the page's wallet parts go with spending.topUp, the core checks them against the engine's own read
// and keeps them under the Move's key, and the Safe's one sheet says the whole Move (the audit's conditions 2 to 4, 7 Nov).
// Fails on f7c52792d: topUp keeps nothing, so the sheet is the Safe's side only and a leg is never capped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService } from "@zerofee/core/spending";
import * as plan from "@zerofee/core/spending-move";
import type { PlainWords } from "@zerofee/core/signer";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "@zerofee/trade/float-core.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const nativeUsd = async (c: keyof typeof PX) => PX[c];

async function phone() {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 20, float: { moveMs: 10, opening: { hood: "3000000000000000" } }, safeFillOpen: true, hiddenStart: { usdc: "8", near: "0" } });
  for (const chain of ["sol", "hood", "bsc"]) await mock.call("subwallet.create", { kind: "trade", chain });
  const asked: Record<string, unknown>[] = [];
  const call: CoreFloatDeps["call"] = async (method, params) => {
    if (method === "ledger.moveFromPrivate") asked.push(params as Record<string, unknown>);
    const r = await mock.call<any>(method, params);
    if ("problem" in r) throw new ProblemError(r.problem);
    return r.ok as never;
  };
  const kept = new Map<string, unknown>();
  const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async (k) => structuredClone(kept.get(k)), set: async (k, v) => { kept.set(k, structuredClone(v)); }, now: () => 1_000_000, every: () => () => undefined, rng: () => 0.5, fromPrivate: true });
  const host = async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T;
  const svc = createSpendingService({ engine: () => f as never, call: host });
  let say = true;
  const sheets: PlainWords[] = [];
  mock.on<{ id: string; words: PlainWords }>("approval.needed", (a) => { sheets.push(a.words); void mock.call("approval.answer", { id: a.id, approve: say }); });
  await f.refresh();
  const hood = f.snapshot().chains.find((c) => c.chain === "hood")!;
  return { svc, asked, sheets, answer: (yes: boolean) => { say = yes; }, hoodUsd: hood.nativeUsd + hood.readyUsd + hood.coinsUsd };
}
const top = (s: Awaited<ReturnType<typeof phone>>, key: string, others?: unknown) => s.svc.call("spending.topUp", { usd: 30, legs: [{ network: "sol", usd: 20 }, { network: "near", usd: 10 }], key, caller: "wallet", ...(others ? { others } : {}) });
const block = (w: PlainWords) => [w.title, ...w.lines.slice(0, w.lines.indexOf("Anyone can see the Safe's part.") + 1)];

test("the audit's conditions 2 and 4: the engine's job key is topUp's own key; the Sim's one sheet says the whole Move from the core's check; two Moves back to back, each sheet its own parts", async () => {
  const s = await phone();
  assert.ok(s.hoodUsd >= 4, `the Sim's ETH (RH) wallet holds ${s.hoodUsd}`);
  const A = "whole-move-a-0123456789", B = "whole-move-b-0123456789";
  const ra = await top(s, A, [{ from: "hood", to: "sol", usd: 2.5 }, { from: "hood", to: "near", usd: 1.25 }]);
  assert.ok("ok" in ra, JSON.stringify(ra));
  assert.equal(s.asked.at(-1)?.job, A, "the engine asks the ledger under topUp's own key");
  const a = block(s.sheets.at(-1)!);
  assert.match(a[0]!, /^Move \$33\.75 to your SOL and NEAR wallets$/, a.join(" | "));
  assert.ok(a.includes("From your ETH (RH) wallet · about $3.75"), a.join(" | "));
  assert.ok(a.some((l) => /^Your SOL wallet gets · about \$/.test(l)) && a.some((l) => /^Your NEAR wallet gets · about \$/.test(l)), a.join(" | "));
  assert.equal(a.at(-1), "Anyone can see the Safe's part.");
  const rb = await top(s, B, [{ from: "hood", to: "sol", usd: 2 }]);
  assert.ok("ok" in rb, JSON.stringify(rb));
  const b = block(s.sheets.at(-1)!);
  assert.equal(b[0], "Move $32.00 to your SOL and NEAR wallets", b.join(" | "));
  assert.ok(b.includes("From your ETH (RH) wallet · about $2.00") && !b.some((l) => /3\.75/.test(l)), b.join(" | "));
});

test("the audit's condition 4: a page part higher than the engine's own read, or a wallet it can't see, is not said: the Safe's side only, the title its figure; control, no parts: the Safe's side as today", async () => {
  const s = await phone();
  const r = await top(s, "whole-move-c-0123456789", [{ from: "hood", to: "sol", usd: Math.ceil(s.hoodUsd) + 1 }]);
  assert.ok("ok" in r, JSON.stringify(r));
  const c = block(s.sheets.at(-1)!);
  assert.equal(c[0], "Move $30.00 to your SOL and NEAR wallets", c.join(" | "));
  assert.ok(!c.some((l) => /ETH \(RH\)/.test(l)), c.join(" | "));
  // control: a part at or under the read is said, on the same phone
  assert.ok("ok" in (await top(s, "whole-move-g-0123456789", [{ from: "hood", to: "sol", usd: 1 }])));
  assert.ok(block(s.sheets.at(-1)!).includes("From your ETH (RH) wallet · about $1.00"), block(s.sheets.at(-1)!).join(" | "));
  const fresh = await phone();
  const r2 = await top(fresh, "whole-move-d-0123456789");
  assert.ok("ok" in r2);
  assert.deepEqual(block(fresh.sheets.at(-1)!), c, "control: the same Move with no parts, the same sheet");
});

test("the audit's condition 3: Not now on the Safe's sheet ends the kept parts, and a wallet leg still carrying the key is refused; control: after a yes, the leg at its part goes once", async () => {
  const s = await phone();
  s.answer(false);
  const K = "whole-move-e-0123456789";
  const r = await top(s, K, [{ from: "hood", to: "sol", usd: 2.5 }]);
  assert.ok("ok" in r && "declined" in (r.ok as object), JSON.stringify(r));
  await new Promise((done) => setTimeout(done, 5));
  assert.match(plan.legCap(K, "hood", "sol", 2.5) ?? "", /no longer has this Move's plan/);
  s.answer(true);
  const Y = "whole-move-f-0123456789";
  assert.ok("ok" in (await top(s, Y, [{ from: "hood", to: "sol", usd: 2.5 }])));
  assert.match(plan.legCap(Y, "hood", "sol", 2.51) ?? "", /more than this Move planned/);
  assert.equal(plan.legCap(Y, "hood", "sol", 2.5), null);
});
