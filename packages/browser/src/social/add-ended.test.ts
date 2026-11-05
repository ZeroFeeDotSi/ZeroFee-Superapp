// Sim crawl recheck (5 Nov): the pump.fun Add landed ("In your pump.fun wallet.") while its task said "Not seen yet.
// Check your pump.fun wallet in a minute.": its task was made after the money had landed (the sheet's Done tapped late),
// so nothing was on its way to follow. Spending's own record of the newest Add says how it ended.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LANDING_MS, addEnded, addTaskAt, type AddRecord } from "./hub-state.ts";
import { addTask } from "../site-tasks.ts";

const T0 = Date.parse("2026-11-05T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const rec = (o: Partial<AddRecord> = {}): AddRecord => ({ kind: "top-up", site: "pump", status: "done", atIso: iso(T0 - 5_000), ...o });

test("an Add's task made after it landed ends landed from Spending's record; a stop ends with its words; else nothing is claimed (controls: another site, an older Add, a move on, still going)", () => {
  assert.deepEqual(addEnded([rec()], "pump", T0), { landed: true }, "the record says done: it landed");
  assert.deepEqual(addEnded([rec({ status: "refused", note: "N" })], "pump", T0), { stopped: "N" });
  assert.deepEqual(addEnded([rec({ stoppedShort: true, note: "Short" })], "pump", T0), { stopped: "Short" }, "done but short of the wallet is never landed");
  // the newest record wins: a newer one still going is not an older one's landing
  assert.equal(addEnded([rec(), rec({ status: "on-its-way", atIso: iso(T0 - 1_000) })], "pump", T0), null);
  // controls
  assert.equal(addEnded([rec({ site: "gmgn" })], "pump", T0), null, "another site's");
  assert.equal(addEnded([rec({ atIso: iso(T0 - LANDING_MS - 1) })], "pump", T0), null, "an Add from before this one");
  assert.equal(addEnded([rec({ of: "m1" })], "pump", T0), null, "a move on is not the Add");
  assert.equal(addEnded(null, "pump", T0), null);
});

test("an Add's task id gives back the moment it was made; anything else none", () => {
  assert.equal(addTaskAt(addTask("pump.fun", "$10.00 is on its way to pump.fun.", T0).id), T0);
  assert.equal(addTaskAt("signin-pump-fun"), null);
});

test("the site's page and the hub both end an open Add's task from that record, never 'Not seen yet' beside money that landed", () => {
  for (const f of ["./SiteWalletApp.tsx", "./SocialHub.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /addEnded\(/, f);
    assert.ok(src.indexOf("addEnded(") < src.indexOf("addNotSeen(name)"), `${f}: the record is asked before "Not seen yet"`);
  }
});
