// Audit 16's G7 (8 Nov): tapping a Safe Sell's Activity row in the Sim threw "Cannot read properties of undefined
// (reading 'map')" and opened nothing: the Sim's Safe swap movement had no explorerUrls, and movementPage read
// m.explorerUrls.map. The Sim's movement now has the real one's shape (wallet safe-send.ts: explorerUrls []), and a page
// with no link to show never throws: it says "No receipt link yet.". Fails on main: movementPage throws; the Sim's
// movement has no explorerUrls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import type { Movement } from "../types.ts";
import { PROOF_WORDS, movementPage } from "./proof.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const NEAR_TX = "6Yt1aJ1wJ1dXk7vQbJ8m7Lw3Hq6nU3nK1QzF5n2W9pXo";

test("G7: a record with no explorerUrls opens its page and says no link yet while it goes (audit 17 H5: none once done)", () => {
  const m = { id: "safe-send:sim-1", kind: "swap", status: "moving", from: "nep141:wrap.near", to: USDC, amount: "79.5101", startedAtIso: "2026-11-08T03:00:00.000Z", updatedAtIso: "2026-11-08T03:00:06.000Z", private: true, source: "safe" } as unknown as Movement;
  const page = movementPage(m);
  assert.equal(page.noLink, true);
  assert.equal(PROOF_WORDS.noLink, "No receipt link yet.");
  assert.equal(movementPage({ ...m, explorerUrls: [] }).noLink, true, "the real record before a leg's link is read");
});

test("control: a record with a link has no such line", () => {
  const m = { id: "x", kind: "pay", status: "done", from: USDC, to: "bob.near", amount: "5", startedAtIso: "2026-11-08T03:00:00.000Z", updatedAtIso: "2026-11-08T03:00:06.000Z", explorerUrls: [`https://nearblocks.io/txns/${NEAR_TX}`] } as unknown as Movement;
  assert.equal(movementPage(m).noLink, undefined);
});

test("G7: the Sim's Safe swap movement has the real one's shape (explorerUrls) at every update", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  mock.on<{ id: string }>("approval.needed", (p) => void mock.call("approval.answer", { id: p.id, approve: true }));
  await mock.call("account.create", { recoveryDelaySeconds: 172_800 });
  const seen: Movement[] = [];
  mock.on<{ movement: Movement }>("ledger.movementUpdated", ({ movement }) => { if (movement.kind === "swap") seen.push(movement); });
  const q = await mock.call<{ id: string }>("ledger.swapQuote", { from: USDC, to: "nep141:token.rhealab.near", amountIn: "5", source: "safe", priceUsd: 0.05, symbol: "RHEA" });
  assert.ok("ok" in q);
  const s = await mock.call<Movement>("ledger.swap", { quoteId: q.ok.id });
  assert.ok("ok" in s);
  assert.deepEqual(s.ok.explorerUrls, [], "fails on main: undefined");
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(seen.length >= 1 && seen.every((m) => Array.isArray(m.explorerUrls)));
  for (const m of [s.ok, ...seen]) assert.doesNotThrow(() => movementPage(m));
});
