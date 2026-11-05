import { test } from "node:test";
import assert from "node:assert/strict";
import { bandsCountFewCoins, holdsCoin, savedEveryCoinRules, WNEAR } from "./every-coin.ts";

// The test account on mainnet, 2 Nov, as the contract answers it (release 4): rules from 25 Oct, and two saved changes.
const OWNER_BANDS = [{ up_to: [["near", "5000000000000000000000000"]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];
const saved = (id: string, readyNs: string, first: unknown[] = [["near", "4906542056074766355140186"], [WNEAR, "4906542056074766355140186"]]) =>
  ({ id, change: { SetProtection: { bands: [{ up_to: first, level: "FaceId" }, { up_to: null, level: "FaceId" }] } }, ready_at_ns: readyNs, needs_device: false, approved: false });

test("rules that list coins but not wNEAR count few coins; unlimited or wNEAR-listing first bands don't", () => {
  assert.equal(bandsCountFewCoins(OWNER_BANDS), true);
  assert.equal(bandsCountFewCoins([{ up_to: [["near", "1"], [WNEAR, "1"]], level: "FaceId" }]), false);
  assert.equal(bandsCountFewCoins([{ up_to: null, level: "FaceId" }]), false);
  assert.equal(bandsCountFewCoins(null), false);
});

test("holdsCoin: product decision, 25 Oct rules hold wNEAR (its first fitting band waits) but not NEAR; an all-Face-ID last band holds nothing", () => {
  assert.equal(holdsCoin(OWNER_BANDS, WNEAR), true);
  assert.equal(holdsCoin(OWNER_BANDS, "near"), false);
  assert.equal(holdsCoin([OWNER_BANDS[0], { up_to: null, level: "FaceId" }], WNEAR), false);
});

test("savedEveryCoinRules: the newest saved change that counts every coin, ready or not; never one that counts few coins or needs the device", () => {
  const ready = savedEveryCoinRules([saved("2", "1793588014817891495"), saved("3", "1793588271253728689")], Date.parse("2026-11-02T03:10:00Z"));
  assert.deepEqual(ready, { id: "3", readyAtIso: "2026-11-02T02:57:51.253Z", ready: true });
  assert.equal(savedEveryCoinRules([saved("3", "1793588271253728689")], Date.parse("2026-11-02T02:57:00Z"))?.ready, false);
  assert.equal(savedEveryCoinRules([saved("5", "1", [["near", "1"]])]), null, "a save that still counts NEAR only doesn't help");
  assert.equal(savedEveryCoinRules([{ ...saved("6", "1"), needs_device: true }]), null);
  assert.equal(savedEveryCoinRules(null), null);
});
