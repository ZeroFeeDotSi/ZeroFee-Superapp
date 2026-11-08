// Audit 17's H10 (8 Nov): Activity → Account said "What your account did, and what approved each one." then "Nothing yet."
// after three Safe trades the Safe approved. Each Safe Buy or Sell is a row there: its name, what approved it (Face ID, by
// this device), through NEAR Confidential; the Sim's Account tab keeps it (its own rows only). Fails on main: no row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge, SAFE_TRADE_APPROVED } from "./MockBridge.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

test("H10: a Safe Buy that landed is a row in Activity → Account, with what approved it", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  mock.on<{ id: string }>("approval.needed", (p) => void mock.call("approval.answer", { id: p.id, approve: true }));
  await mock.call("account.create", { recoveryDelaySeconds: 172_800 });
  const q = await mock.call<{ id: string }>("ledger.swapQuote", { from: USDC, to: "nep141:token.rhealab.near", amountIn: "5", source: "safe", priceUsd: 0.05, symbol: "RHEA" });
  assert.ok("ok" in q);
  assert.ok("ok" in (await mock.call("ledger.swap", { quoteId: q.ok.id })));
  await new Promise((r) => setTimeout(r, 20));
  const rows = await mock.call<{ title: string; by?: string; lines?: string[]; txHash?: string }[]>("account.activity", { limit: 50 });
  assert.ok("ok" in rows);
  const row = rows.ok.find((r) => String(r.txHash).startsWith("sample-change-trade-"));
  assert.ok(row, "fails on main: no row for the Safe's trade");
  assert.equal(row!.title, "Buy of RHEA");
  assert.equal(row!.by, "This device");
  assert.deepEqual(row!.lines, [SAFE_TRADE_APPROVED, "It went through NEAR Confidential."]);
  assert.equal(SAFE_TRADE_APPROVED, "Your Safe approved it with Face ID.");
});

test("H10: the Sim's Account tab shows the Sim's own change rows (the trade's among them)", () => {
  const screens = readFileSync(new URL("../../../apps/web/src/gallery/Screens.tsx", import.meta.url), "utf8");
  assert.match(screens, /\/\^sample-\(agent\|change\)\/\.test\(String\(r\.txHash/);
});
