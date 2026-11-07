// the audit's filing (6 Nov): a Move's only part stopped after Private's part went. Its row ends at once with what stopped; it says no "Moved", and later news of that payment doesn't change it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { moved, settle } from "./float-private.ts";
import type { MoveRow } from "./float-view.ts";

const WORDS = "Only the part from Private was sent. Activity shows it.";
const row = (part: Record<string, unknown>): MoveRow => ({ id: "mv-x", kind: "add", usd: 5, status: "moving", where: "in-flight", at: 1, priv: { parts: [{ wallet: "w", chain: "sol", usd: 5, ids: [], ...part }] } } as unknown as MoveRow);

test("the only part stopped with Private's part gone: the row stops, by those words, at once", () => {
  const r = row({ ids: ["pocket-send:a"], stopped: WORDS });
  settle(r, 2);
  assert.equal(r.status, "failed");
  assert.equal(r.note, WORDS);
  assert.equal(moved(r, { id: "pocket-send:a", status: "done" }, 3), true, "the part is still this row's");
  assert.equal(r.status, "failed", "that payment landing never reads as the Move's Done");
  assert.equal(r.note, WORDS);
});

test("the only part stopped with no id (a plain throw): the same, it ends, never on its way for good", () => {
  const r = row({ stopped: "ZeroFee hit a problem on its side. Check Activity before you try again." });
  settle(r, 2);
  assert.equal(r.status, "failed");
});

test("control: a part with its payment and no stop stays on its way", () => {
  const r = row({ ids: ["pocket-send:a"] });
  settle(r, 2);
  assert.equal(r.status, "moving");
});
