// Finding 61: an Add that Spending's own record says stopped short ends at once on the site's page and in the hub:
// "on its way" goes, so Add comes back, and the task ends with the record's words; through a reload too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADD_STOPPED, LANDING_MS, addStopped, landing, type AddRecord, type HubRow, type Landing } from "./hub-state.ts";
import { walletView } from "./site-wallet.ts";

const T0 = Date.parse("2026-11-04T12:08:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const row = { site: "pump", name: "pump.fun", usd: 0, wallet: "sw-site-pump-sol", wallets: [{ network: "sol", id: "sw-site-pump-sol", usd: 0, holds: "0 SOL" }] } as unknown as HubRow;
const was: Record<string, Landing> = { pump: { usd: 2, from: 0, sinceMs: T0 } };
const NOTE = "Your money is in your NEAR wallet. A move under $2 would mostly go on fees.";
const topUp = (o: Partial<AddRecord> = {}): AddRecord => ({ kind: "top-up", site: "pump", status: "done", atIso: iso(T0 - 20_000), ...o });

test("a refused move on to the site ends the Add now, with the record's words; Add is offered again", () => {
  const acts = [topUp({ note: NOTE, stoppedShort: true }), { kind: "ready", site: "pump", status: "refused", atIso: iso(T0 + 5_000), note: "A move under $2 would mostly go on fees." }];
  const r = landing([], was, [row], T0 + 60_000, acts);
  assert.deepEqual(r.moving, {}, "no longer on its way");
  assert.equal(r.stopped.pump, "A move under $2 would mostly go on fees.", "the newest record's words: its move on");
  // the page: Add back, the Add's row says it stopped, never "It's in your pump.fun wallet"
  const v = walletView({ site: "pump", name: "pump.fun", row, read: "ok", adds: [{ id: "a1", kind: "top-up", usd: "2.00", status: "done", shown: true, atIso: iso(T0 - 20_000), words: "", site: "pump", note: NOTE, stoppedShort: true }], now: T0 + 60_000 });
  assert.equal(v.canAdd, true);
  assert.deepEqual([v.moves[0]!.state, v.moves[0]!.detail], ["failed", NOTE]);
});

test("the Add's own record stopped (refused, failed, sent back, or short), the newest one only; else its words fall back", () => {
  for (const status of ["refused", "failed", "refunded"]) assert.equal(addStopped([topUp({ status, note: "N" })], "pump", T0), "N", status);
  assert.equal(addStopped([topUp({ stoppedShort: true })], "pump", T0), ADD_STOPPED);
});

test("controls: still going, landed, another site's, an older Add's stop, a leg of a Move: never a stop", () => {
  // the record is done and going on (its move on not made yet): still on its way, inside five minutes
  const going = landing([], was, [row], T0 + 60_000, [topUp()]);
  assert.ok(going.moving.pump, "a Top up that went on is still landing");
  assert.deepEqual(going.stopped, {});
  // a newer Add after an old refused one: the old stop never ends it
  assert.equal(addStopped([topUp({ status: "refused", atIso: iso(T0 - 30_000) }), topUp({ atIso: iso(T0 - 1_000) })], "pump", T0), null);
  // an old stop from before this Add's time
  assert.equal(addStopped([topUp({ status: "refused", atIso: iso(T0 - LANDING_MS - 1) })], "pump", T0), null);
  assert.equal(addStopped([topUp({ status: "refused", site: "gmgn" })], "pump", T0), null);
  assert.equal(addStopped([topUp({ status: "refused", of: "m1" })], "pump", T0), null);
  // the wallet grew: landed, whatever an older record says
  const grown = { ...row, usd: 1.9, solUsd: 1.9, wallets: [{ network: "sol", id: "sw-site-pump-sol", usd: 1.9, holds: "0.02 SOL" }] } as unknown as HubRow;
  const r = landing([], was, [grown], T0 + 60_000, [topUp({ status: "refused" })]);
  assert.deepEqual(r.landed, ["pump"]);
  // no record read (an older core, a failed read): as before, on its way until it lands or five minutes pass
  assert.ok(landing([], was, [row], T0 + 60_000, null).moving.pump);
});
