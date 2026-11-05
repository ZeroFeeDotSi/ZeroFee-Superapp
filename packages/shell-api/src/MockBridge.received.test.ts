// The demo's "how much came in" (product decision, 3 Nov): ?demo's Activity lists money that came in the way the real ledger does
// (received.ts): a landed Add with its fee, the money that opened the account and money sent straight to the Safe, each
// once, beside the bridge deposit. AgentZero's 100-prompt suite on ?demo checks its answer against these.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "./MockBridge.ts";
import { describe } from "@zerofee/wallet/app/format.ts";
import { statementRows, summaryLine } from "@zerofee/wallet/app/statement.ts";
import type { Chain, Movement, Token } from "@zerofee/wallet/types.ts";

const ok = async <T,>(mock: ReturnType<typeof createMockBridge>, method: string, p: Record<string, unknown> = {}): Promise<T> => {
  const r = await mock.call<T>(method, p);
  if ("problem" in r) assert.fail(`${method}: ${r.problem.whatHappened}`);
  return r.ok;
};

test("?demo's Activity: one landed Add into the SOL wallet with its fee, the opening's NEAR and one 'in your Safe' receipt, each once; the Statement says $97.10 came in (control: a fresh history has none)", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const rows = await ok<Movement[]>(mock, "ledger.activity", { limit: 50 });
  const [tokens, chains] = await Promise.all([ok<Token[]>(mock, "ledger.tokens"), ok<Chain[]>(mock, "ledger.chains")]);
  const byId = new Map(tokens.map((t) => [t.assetId, t]));
  const ids = ["add:demo-sol", "open:demo", "safe:demo-usdc"];
  for (const id of ids) assert.equal(rows.filter((m) => m.id === id).length, 1, id);
  assert.deepEqual(rows.map((m) => m.updatedAtIso), [...rows.map((m) => m.updatedAtIso)].sort().reverse(), "newest first, as the ledger lists them");
  const words = (id: string) => describe(rows.find((m) => m.id === id)!, byId, chains);
  assert.deepEqual(words("add:demo-sol"), { title: "Received", detail: "0.2 SOL from Solana · in your SOL wallet · $0.41 in fees" });
  assert.deepEqual(words("open:demo"), { title: "Received", detail: "5 NEAR · opened your account" });
  assert.deepEqual(words("safe:demo-usdc"), { title: "Received", detail: "12.5 USDC · in your Safe" });
  // the Statement over every row the demo's Activity lists: the bridge deposit and the three, in dollars when they landed
  const now = new Date();
  const months = [...new Set(rows.map((m) => { const d = new Date(m.updatedAtIso); return `${d.getFullYear()}-${d.getMonth()}`; }))];
  const all = months.flatMap((k) => { const [y, mo] = k.split("-").map(Number); return statementRows(rows, [], byId, chains, y!, mo!); });
  const cameIn = all.filter((r) => r.way === 1).reduce((n, r) => n + Number(r.dollars || 0), 0);
  assert.equal(cameIn.toFixed(2), "97.10", "$42.10 + $20.35 + $22.15 + $12.50");
  assert.deepEqual(all.filter((r) => r.way === 1).map((r) => r.to).sort(), ["SOL wallet", "Safe", "Safe", "Safe"]);
  if (months.length === 1) assert.match(summaryLine(all, now.getFullYear(), now.getMonth()), /\$97\.10 came in/);
  assert.equal((await ok<Movement[]>(createMockBridge({ latencyMs: 0, freshHistory: true }), "ledger.activity", { limit: 50 })).length, 0, "control: a fresh history lists none");
});
