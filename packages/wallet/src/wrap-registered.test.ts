// The saving on top of the audit's ruling (6 Nov, T-F): the Safe's wrap of its NEAR on the account leaves out its own
// storage_deposit only when wrap.near's storage_balance_of says it is set up there. No storage (null), any other answer,
// or a read that fails keeps the step: never skipped on an unknown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NEAR_STORAGE_MAX_YOCTO } from "@zerofee/core/near-gate";
import { fundingSteps } from "./convert.ts";
import { isRegisteredRead, nearAsWnearTo, WRAP_STORAGE_YOCTO, wrapRegistered } from "./moves.ts";

const ME = "kid.near", DEP = "0a".repeat(32);

test("isRegisteredRead: only a { total } read is set up", () => {
  const rows: [unknown, boolean][] = [
    [{ total: "1250000000000000000000", available: "0" }, true],
    [null, false], [undefined, false], [{}, false], [{ total: 1 }, false], ["registered", false], [true, false],
  ];
  for (const [v, want] of rows) assert.equal(isRegisteredRead(v), want, JSON.stringify(v));
});

test("wrapRegistered: reads wrap.near for the account; a failed read is false", async () => {
  const asked: unknown[] = [];
  assert.equal(await wrapRegistered(async (c, m, a) => (asked.push([c, m, a]), { total: "1", available: "0" }), ME), true);
  assert.deepEqual(asked, [["wrap.near", "storage_balance_of", { account_id: ME }]]);
  assert.equal(await wrapRegistered(async () => null, ME), false, "none there");
  assert.equal(await wrapRegistered(async () => { throw new Error("the node didn't answer"); }, ME), false, "unknown: the step stays");
});

test("nearAsWnearTo / fundingSteps near-account: the Safe's own storage step only without meRegistered", () => {
  const self = (r: ReturnType<typeof nearAsWnearTo>) => r.actions.filter((a: any) => a.method === "storage_deposit" && a.args.account_id === ME).length;
  const rows: [string, boolean | undefined, number][] = [["not set up", false, 1], ["unknown (absent)", undefined, 1], ["set up", true, 0]];
  for (const [name, meRegistered, want] of rows) {
    const [step] = fundingSteps("near-account", { tokenId: "near", units: 5n, depositAddress: DEP, registered: true, storageYocto: WRAP_STORAGE_YOCTO, me: ME, why: "", ...(meRegistered === undefined ? {} : { meRegistered }) });
    assert.equal(self(step!), want, name);
    assert.deepEqual(step!.actions.slice(-2).map((a: any) => a.method), ["near_deposit", "ft_transfer"], `${name}: the wrap and the payment as before`);
  }
  // another coin than NEAR never reads it: the flag changes nothing there
  const usdt = fundingSteps("near-account", { tokenId: "nep141:usdt.tether-token.near", units: 5n, depositAddress: DEP, registered: true, storageYocto: WRAP_STORAGE_YOCTO, me: ME, why: "", meRegistered: true });
  assert.deepEqual(usdt.map((s) => s.actions.map((a: any) => a.method)), [["ft_transfer"]]);
  assert.equal(BigInt(WRAP_STORAGE_YOCTO), NEAR_STORAGE_MAX_YOCTO, "the wallet's and the core's wrap.near storage are one figure");
});
