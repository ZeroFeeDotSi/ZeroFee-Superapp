// Product decision (4 Nov): "Safe → SOL $5: on its way." lagged many seconds behind AgentZero's "Landed". The line a Move
// leaves ends in the same read that shows the move landed. Each test has a control. No wall clock: the reads are counted.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import { sayWent, wentNow } from "@zerofee/shell-api/money.ts";
import { LANDED_LINE, endOnLanding } from "./landing-notice.ts";

const at = new Date().toISOString();
const rows = (leg: SpendingActivity["status"]): SpendingActivity[] => [
  { id: "t5", kind: "top-up", usd: "5.00", status: "done", shown: true, atIso: at, words: "Moving $5.00 to your SOL wallet", goesTo: ["sol"] },
  { id: "t5-sol", kind: "ready", usd: "4.90", status: leg, shown: true, atIso: at, words: "Moving $4.90 to Solana", network: "sol", of: "t5" },
];
function bridge() {
  let answer = rows("on-its-way");
  let reads = 0;
  const handlers = new Set<() => void>();
  return {
    set: (r: SpendingActivity[]) => { answer = r; },
    reads: () => reads,
    changed: async () => { for (const h of handlers) h(); for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); },
    b: { call: async (m: string) => { if (m === "spending.activity") reads++; return { ok: m === "spending.activity" ? answer : null }; }, on: (_e: string, h: () => void) => { handlers.add(h); return () => handlers.delete(h); } } as never,
  };
}

test("the line ends in the same read that shows the move landed, saying Moved. (control: while the leg is on its way it stays)", async () => {
  const x = bridge();
  const line = "Safe → SOL $5: on its way.";
  sayWent(line);
  const stop = endOnLanding(x.b, "t5", line, sayWent, { every: 60_000 });
  await x.changed();
  assert.equal(wentNow(), line, "control: still on its way");
  x.set(rows("done"));
  const before = x.reads();
  await x.changed();
  assert.equal(x.reads(), before + 1, "one read");
  assert.equal(wentNow(), LANDED_LINE, "the same read ends it");
  stop();
  sayWent("");
});

test("a move that stopped clears the line (its task says where the money is); a line already replaced is never touched (control)", async () => {
  const x = bridge();
  const line = "Safe → SOL $5: on its way.";
  sayWent(line);
  endOnLanding(x.b, "t5", line, sayWent, { every: 60_000 });
  x.set(rows("failed"));
  await x.changed();
  assert.equal(wentNow(), null);
  const y = bridge();
  sayWent(line);
  endOnLanding(y.b, "t5", line, sayWent, { every: 60_000 });
  sayWent("Sent $2.00 to alex.near");
  y.set(rows("done"));
  await y.changed();
  assert.equal(wentNow(), "Sent $2.00 to alex.near", "control: another line stays");
  sayWent("");
});
