// The Sim's money adds up (a web test, grade D): a $25 USDC send from the Safe took 50 USDC (25 from Private at once,
// 25 more from the Safe's own row when it settled); Activity read the $25.00 send as $24.99 (USDC priced 0.999545 while its
// rows count it at $1); Move's row said $69.94 where the check sheet and the Safe said $73.00.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { movementDollars } from "@zerofee/wallet/app/format.ts";
import { costLine, costRows, fillLegs, fillLine, fillOf, type Leg } from "@zerofee/wallet/app/screens/move-split.ts";
import type { Balance, Movement, Token } from "@zerofee/wallet/types.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const usdcOf = (rows: Balance[]) => rows.filter((r) => r.tokenId === USDC).reduce((n, r) => ({ amount: n.amount + Number(r.amount), usd: n.usd + Number(r.usd) }), { amount: 0, usd: 0 });
const r2 = (x: number) => Math.round(x * 100) / 100;

test("a $25 USDC send from the Safe takes exactly 25 USDC and $25, once, and stays so after it settles; Activity says $25.00", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, hiddenStart: { usdc: "25", near: "2" }, freshHistory: true, mainnetRules: {} });
  mock.on<{ id: string }>("approval.needed", (p) => void mock.call("approval.answer", { id: p.id, approve: true }));
  assert.ok("ok" in (await mock.call("account.create", { recoveryDelaySeconds: 172_800 })));
  const read = async () => {
    const b = await mock.call<Balance[]>("ledger.balances"), p = await mock.call<{ rows: Balance[] }>("ledger.private");
    assert.ok("ok" in b && "ok" in p);
    return usdcOf([...b.ok, ...p.ok.rows]);
  };
  const before = await read();
  const sent = await mock.call<Movement[]>("ledger.sendFromSafe", { app: "wallet", tokenId: USDC, amount: "25", to: { kind: "chain", chain: "sol", address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" } });
  assert.ok("ok" in sent, JSON.stringify(sent));
  const now = await read();
  assert.equal(r2(before.amount - now.amount), 25, "25 USDC left at once");
  assert.equal(r2(before.usd - now.usd), 25, "and $25 with it (the row's dollars follow its coins)");
  await new Promise((r) => setTimeout(r, 60));
  const settled = await read();
  assert.equal(r2(before.amount - settled.amount), 25, "control: settling takes nothing more (the bug took 50)");
  assert.equal(r2(before.usd - settled.usd), 25);
  // Activity: the send's dollars at the sample's own USDC price
  const tokens = await mock.call<Token[]>("ledger.tokens");
  assert.ok("ok" in tokens);
  const byId = new Map(tokens.ok.map((t) => [t.assetId, t]));
  assert.equal(movementDollars(sent.ok[0]!, byId), "$25.00");
  // control: at the old price it read $24.99
  assert.equal(movementDollars(sent.ok[0]!, new Map([[USDC, { ...byId.get(USDC)!, priceUsd: "0.999545" }]])), "$24.99");
});

test("one figure per Move (QA's MUST, Sim test: typed $30, sheet \"$31 leaves\"): what leaves is what was typed; the Safe's top-up into Private is fillLine's own step, never a second figure (control: Private covers it, no step)", () => {
  const legs: Leg[] = [{ from: "safe", to: "sol", usd: 30 }];
  assert.equal(costRows(legs)!.rows[0]!.value, "$30.00");
  assert.match(costLine(legs)!, /^\$30\.00 leaves your Safe\./);
  assert.equal(costRows(legs)!.note, null, "no rounding note: the round-up is gone");
  // Private holds $20 of USDC: $10 short, the Safe tops it up by a whole step, said as its own line
  const coins = [{ tokenId: USDC, symbol: "USDC", amount: "500", usd: "500" }, { tokenId: USDC, symbol: "USDC", amount: "20", usd: "20", held: "private" as const }];
  // the $20 step is all paid on: the legs say it (Safe → SOL $20, Private → SOL $10), no second figure (Sim re-check)
  assert.equal(fillLine(legs, coins), null);
  assert.deepEqual(fillLegs(legs, fillOf(legs, coins)).legs, [{ from: "safe", to: "sol", usd: 20 }, { from: "private", to: "sol", usd: 10 }]);
  assert.equal(fillLine(legs, [{ tokenId: USDC, symbol: "USDC", amount: "500", usd: "500" }, { tokenId: USDC, symbol: "USDC", amount: "40", usd: "40", held: "private" as const }]), null, "control: Private covers it, no step");
});
