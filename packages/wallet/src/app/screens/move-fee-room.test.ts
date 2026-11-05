// Finding 2 (real money, 4 Nov): the Safe's slider reached its whole $46.00 of NEAR, then the Move was refused "You need
// 11.44 NEAR for this, with its fee"; the Safe's row read "$-0". The slider's top leaves the Move's own fees, and no
// row is ever under $0. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FEE_RESERVE_YOCTO, upfrontYocto } from "../../ledger.ts";
import { WRAP_STORAGE_YOCTO, nearAsWnearTo } from "../../moves.ts";
import { COIN_MIN_USD, SAFE_NEAR_MOVE_ROOM, safeCoinMost, usdShort } from "./move-split.ts";

test("finding 2: the Move's NEAR fee room is ledger.ts's own sums (the wrap's up-front gas and two storage deposits, past a plain Send's reserve)", () => {
  const wrap = nearAsWnearTo({ accountId: "zf-1.near", to: "deposit.near", yocto: 10n ** 24n, registerTo: true, why: "Move" });
  const room = upfrontYocto([wrap]) + 2n * BigInt(WRAP_STORAGE_YOCTO) - FEE_RESERVE_YOCTO;
  assert.equal(BigInt(Math.round(SAFE_NEAR_MOVE_ROOM * 1e6)) * 10n ** 18n, room);
});

test("finding 2: the Safe's own NEAR can move only what is left after its Move's fees (control: wNEAR and USDC move whole)", () => {
  // a sample account: 11.5 NEAR spendable at $4.00, $46.00 on its row
  const near = { tokenId: "near", amount: "11.5", usd: "46.00", listed: true, held: "account" };
  const most = safeCoinMost([near]);
  assert.ok(most < 46 && most > 45.6, String(most));
  assert.equal(most, Math.floor(46 * (11.5 - SAFE_NEAR_MOVE_ROOM) / 11.5 * 100) / 100);
  assert.equal(safeCoinMost([{ tokenId: "nep141:wrap.near", amount: "11.5", usd: "46.00", held: "ledger" }]), 46, "control: wNEAR in the Safe pays no wrap");
  assert.equal(safeCoinMost([near, { tokenId: "nep141:usdc", amount: "60", usd: "60", held: "ledger" }]), 60, "the largest coin pays");
  assert.equal(safeCoinMost([{ tokenId: "near", amount: "0.05", usd: "0.2" }]), 0, "NEAR under its room moves nothing");
  assert.equal(safeCoinMost([{ tokenId: "nep141:usdc", amount: "1", usd: String(COIN_MIN_USD - 0.01) }]), 0, "under $2 can't pay");
  assert.equal(safeCoinMost([{ ...near, test: true }, { ...near, listed: false }]), 0, "test and unlisted coins never pay (Private's coins do: move-new-safe.test.ts)");
});

test("finding 2: a row under a cent below zero reads $0, never $-0 (control: real figures unchanged)", () => {
  assert.equal(usdShort(-0.001), "$0");
  assert.equal(usdShort(-0), "$0");
  assert.equal(usdShort(45.75), "$45.75");
  assert.equal(usdShort(1200), "$1,200");
});
