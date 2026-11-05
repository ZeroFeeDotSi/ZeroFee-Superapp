// The beta cap: $1,000 per account, in ONE constant. Add money and Receive say so plainly when it is reached; money
// already held and money coming home are never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { BETA_CAP_USD, betaCapRefusal, withVaultGate, type VaultView } from "./vault-gate.ts";

const view = (usd: number): VaultView => ({ usd, devices: [] });

test("the cap is $1,000, and it lives in one constant", () => {
  assert.equal(BETA_CAP_USD, 1_000);
  const src = readFileSync(new URL("./core.ts", import.meta.url), "utf8");
  assert.match(src, /withVaultGate\(routed, \(\) => readVault\(routed\), BETA_CAP_USD\)/);
  // No other file writes the number as the cap.
  for (const f of ["../../../packages/wallet/src/app/screens/Receive.tsx", "./App.tsx"]) assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /1_?000.*beta|beta.*1_?000/i);
});

test("reached: a plain Problem with where the money is and one step; over by an amount: how much room is left", () => {
  const full = betaCapRefusal(view(1_000))!;
  assert.equal(full.code, "security.beta.cap");
  assert.equal(full.whatHappened, "Your account has reached the beta's $1,000 limit.");
  assert.deepEqual(full.money, { state: "safe", where: "in your Safe" });
  assert.match(full.more!, /stays yours and works as before/);
  const over = betaCapRefusal(view(900), 250)!;
  assert.equal(over.code, "security.beta.cap-over");
  assert.match(over.more!, /You can add up to \$100 more\./);
  assert.equal(betaCapRefusal(view(900), 100), null, "up to the cap");
  assert.equal(betaCapRefusal(view(999)), null, "an unknown amount below it goes");
});

test("the gate: Wallet's and Pay's Add money stop at the cap; Trade's move home, an estimate and anything else go", async () => {
  const asked: string[] = [];
  const inner: Bridge = { call: async <T>(m: string) => { asked.push(m); return { ok: { address: "x" } } as BridgeResult<T>; }, on: () => () => {} };
  const gated = withVaultGate(inner, async () => view(1_200), BETA_CAP_USD);
  const r = await gated.call("ledger.depositAddress", { caller: "wallet", chain: "near" });
  assert.ok("problem" in r && r.problem.code === "security.beta.cap");
  assert.ok("problem" in (await gated.call("ledger.depositAddress", { caller: "pay", chain: "base" })));
  assert.ok("ok" in (await gated.call("ledger.depositAddress", { caller: "trade", chain: "near" })), "money coming home always goes");
  assert.ok("ok" in (await gated.call("ledger.depositAddress", { caller: "pay", chain: "base", purpose: "estimate" })));
  assert.ok("ok" in (await gated.call("ledger.balances", { caller: "wallet" })), "nothing held is touched");
  const nocap = withVaultGate(inner, async () => view(1_200));
  assert.ok("ok" in (await nocap.call("ledger.depositAddress", { caller: "wallet", chain: "near" })), "no cap given, none applied");
});
