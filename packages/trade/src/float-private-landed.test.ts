// QA's real-money lap (5 Nov): a Move from the Safe to the NEAR wallet said "Done in 26 s" while
// the NEAR wallet read $0.01 for 2.5 more minutes. A Move paid from Private is Done only from a fresh balance read that
// shows the arrival (rule 11), never on a timer (audit, 5 Nov); three reads in a row that can't show it say so (the copy review's words).
// Pure functions, fixed figures: no wall clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANDED_MISSES, LANDED_UNREAD } from "@zerofee/core/private-route";
import { arrivedRead, missedRead, moved } from "./float-private.ts";
import type { MoveRow } from "./float-view.ts";
import { moveTrack } from "@zerofee/wallet/app/money/live-steps.ts";

const row = (chain: "near" | "sol", usd = 2.1): MoveRow => ({ id: "mv-k", kind: "add", usd, status: "moving", where: "in-flight", at: 0, priv: { parts: [{ wallet: chain === "near" ? "near" : "sw-sol", chain, usd, ids: ["pocket-send:1"] }] } } as MoveRow);

test("the ledger's word that the payment landed is not Done: the row waits for a read begun after it that shows the money in the NEAR wallet; then Done (control: a read from before, or one still at $0.01, keeps it on its way)", () => {
  const r = row("near");
  assert.equal(moved(r, { id: "pocket-send:1", status: "done" }, 26_000), true);
  assert.equal(r.status, "moving", "never Done on the ledger's word alone");
  assert.deepEqual(r.priv?.landed, { at: 26_000 });
  assert.equal(arrivedRead(r, { roundAt: 25_000, nearUsd: 2.11, base: 0.01 }), false, "control: an older read");
  assert.equal(arrivedRead(r, { roundAt: 30_000, nearUsd: 0.01, base: 0.01 }), false, "control: the read doesn't show it");
  assert.equal(arrivedRead(r, { roundAt: 30_000, nearUsd: undefined, base: 0.01 }), false, "control: no figure read");
  assert.equal(arrivedRead(r, { roundAt: 199_000, nearUsd: 2.11, base: 0.01 }), true, "the read that shows $2.11: Done in that round");
  const s = row("sol");
  moved(s, { id: "pocket-send:1", status: "done" }, 10_000);
  assert.equal(arrivedRead(s, { roundAt: 9_000, nearUsd: 0, base: 0 }), false, "control: a chain wallet's round that began before");
  assert.equal(arrivedRead(s, { roundAt: 12_000, nearUsd: 0, base: 0 }), true);
});

test("the audit's change (5 Nov): no time fallback: hours later a read that doesn't show it is still not Done; three fresh reads in a row that can't show it say exactly the copy review's line, and the row stays on its way (control: two misses say nothing; a read before the landing is no miss; a part that came back is failed at once)", () => {
  const r = row("near");
  moved(r, { id: "pocket-send:1", status: "done" }, 1_000);
  assert.equal(arrivedRead(r, { roundAt: 10 * 3_600_000, nearUsd: undefined, base: 0 }), false, "never Done on a timer");
  assert.equal(missedRead(r, 500), false, "control: a round begun before the landing is no miss");
  assert.equal(missedRead(r, 2_000), false);
  assert.equal(missedRead(r, 3_000), false);
  assert.equal(r.note, undefined, "control: two misses say nothing");
  assert.equal(LANDED_MISSES, 3);
  assert.equal(missedRead(r, 4_000), true, "the third miss in a row");
  assert.equal(r.note, "Can't read this right now. Your money is safe; it shows when the read works.");
  assert.equal(r.note, LANDED_UNREAD);
  assert.equal(r.status, "moving", "still on its way, never Done, never failed");
  // the job's row says it, as still going (a slow end, not a stop)
  const t = moveTrack({ id: "mv-k", kind: "top-up", usd: "2.10", status: "on-its-way", atIso: new Date(0).toISOString(), words: "Move $2.10", via: "private", note: r.note, goesTo: [] } as never, undefined, undefined)!;
  assert.deepEqual(t.end, { ok: false, slow: true, line: LANDED_UNREAD });
  const back = row("near");
  moved(back, { id: "pocket-send:1", status: "refunded" }, 5_000);
  assert.equal(back.status, "failed", "control: came back to Private, said at once");
  assert.equal(missedRead(back, 9e9), false);
});
