// planSend's bounds on numbers it is handed by others (audit W-6, W-7): the bridge's withdraw fee and the receiver's
// storage deposit on a coin contract. Either one past its bound is refused before anything is signed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProblemError } from "@zerofee/core/problem";
import { Catalogue } from "./catalogue.ts";
import { fundingSteps } from "./convert.ts";
import { MAX_STORAGE_DEPOSIT_YOCTO } from "./moves.ts";
import { planSend, type SendInput } from "./send.ts";
import { RECORDED, SAMPLE_ADDRESS } from "./testing/replay.ts";

const SOL = "nep141:sol.omft.near";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const NEAR = 10n ** 24n;
const rows = RECORDED.supported.response.result.tokens as { intents_token_id: string; defuse_asset_identifier: string; withdrawal_fee: string }[];
/** The recorded catalogue with SOL's bridge fee replaced. */
const withSolFee = (fee: string) =>
  new Catalogue(RECORDED.tokens.tokens, rows.map((r) => (r.intents_token_id === SOL && r.defuse_asset_identifier.startsWith("sol:mainnet") ? { ...r, withdrawal_fee: fee } : r)) as never);
const home = (cat: Catalogue, amount: string): SendInput => ({
  cat, me: "kid.near", tokenId: SOL, amount, to: { kind: "chain", chain: "sol", address: SAMPLE_ADDRESS.sol }, held: { ledger: 10n ** 15n, account: 0n }, nearSpendable: NEAR, why: "Send SOL",
});
const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof ProblemError) return e.problem.code;
    throw e;
  }
  return "planned";
};

test("W-6: a bridge fee as large as the amount, or larger, is refused", () => {
  // 0.002 SOL arriving, the bridge saying its fee is 0.002 SOL too: half of what leaves would be fee
  assert.equal(code(() => planSend(home(withSolFee("2000000"), "0.002"))), "ledger.fee.too-high");
  // a fee of a million SOL on 0.01 SOL: never planned, whatever the balance
  assert.equal(code(() => planSend(home(withSolFee("1000000000000000"), "0.01"))), "ledger.fee.too-high");
  // control: the recorded fee (0.000014 SOL) on 0.01 SOL is planned, the fee on top
  const plan = planSend(home(withSolFee("14000"), "0.01"));
  assert.deepEqual([plan.arrives, plan.fee, plan.leaves], [10_000_000n, 14_000n, 10_014_000n]);
});

test("W-7: a receiver's storage deposit over MAX_STORAGE_DEPOSIT_YOCTO (0.01 NEAR) is refused, on a send and on a convert", () => {
  assert.equal(MAX_STORAGE_DEPOSIT_YOCTO, 10n ** 22n);
  const cat = new Catalogue(RECORDED.tokens.tokens, RECORDED.supported.response.result.tokens);
  const toNear = (yocto: string): SendInput => ({
    cat, me: "kid.near", tokenId: USDC, amount: "1", to: { kind: "chain", chain: "near", address: "friend.near" }, held: { ledger: 10n ** 9n, account: 0n }, nearSpendable: NEAR,
    storage: { registered: false, yocto }, why: "Send USDC",
  });
  assert.equal(code(() => planSend(toNear((100n * NEAR).toString()))), "ledger.storage.too-high", "a contract asking 100 NEAR");
  assert.equal(code(() => planSend(toNear((10n ** 22n + 1n).toString()))), "ledger.storage.too-high", "one yocto over the cap");
  assert.equal(code(() => planSend(toNear("-1"))), "ledger.storage.too-high", "not a whole number");
  const ok = planSend(toNear("1250000000000000000000"));
  assert.equal(ok.steps[0]!.actions[0]!.kind === "call" && ok.steps[0]!.actions[0]!.depositYocto, "1250000000000000000000", "control: NEAR's usual 0.00125");
  // the same bound on a convert's or an Add's deposit address
  const funding = (storageYocto: string) => () => fundingSteps("near-ledger", { tokenId: USDC, units: 1n, depositAddress: "a".repeat(64), registered: false, storageYocto, me: "kid.near", why: "Convert" });
  assert.equal(code(funding((100n * NEAR).toString())), "ledger.storage.too-high");
  assert.equal(code(funding("1250000000000000000000")), "planned");
});
