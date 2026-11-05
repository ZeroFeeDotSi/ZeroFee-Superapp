import { test } from "node:test";
import assert from "node:assert/strict";
import { rowTitle, type LiveTrack } from "./live-steps.ts";

const t = (title: string, end?: LiveTrack["end"]) => ({ title, end, steps: [], startMs: 0, kind: "move", wallets: [], id: "x" }) as unknown as LiveTrack;

test("one job reads one way: the asked form, never Moving/Moved (review, 5 Nov)", () => {
  for (const w of ["Moving $30.00 to your Safe", "Moved $30.00 to your Safe", "Move $30.00 to your Safe"]) assert.equal(rowTitle(t(w)), "Move $30.00 to your Safe");
  assert.equal(rowTitle(t("Adding $5.00 to your Safe")), "Add $5.00 to your Safe");
  assert.equal(rowTitle(t("Swapped $2.00 to SOL")), "Swap $2.00 to SOL");
  assert.equal(rowTitle(t("Sending $3.00 to Sam")), "Send $3.00 to Sam");
  assert.equal(rowTitle(t("Moving $30.00 to your Safe", { ok: false, line: "x" } as never)), "Move stopped", "control: a stopped one says so");
});
