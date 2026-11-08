// the audit's S13 (8 Nov): a Send that stopped with no words of its own ended "It didn't go. Activity shows where the money is.",
// (the M4 family). It now names the step that stopped, by its protocol, then where the money is now (rule 8; QA 16: never
// a past-tense "left" alone): this end comes only after the money left, with no read of where it is, so Activity shows it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Movement } from "../../types.ts";
import { sendStopped, sendTrack } from "./live-steps.ts";
import { bannedIn } from "../../../../../tools/copy/voice.ts";

const iso = (s: number) => new Date(Date.UTC(2026, 10, 8, 0, 0, s)).toISOString();
const mv = (o: Partial<Movement>): Movement => ({ id: "safe-send:s1", kind: "pay", status: "problem", amount: "5000000", startedAtIso: iso(0), updatedAtIso: iso(9), explorerUrls: ["https://nearblocks.io/txns/abc"], to: "kiosk.near", private: true, ...o });

test("S13: a Send that stopped after it left names the protocol's step, then where the money is now", () => {
  const near = sendTrack(mv({}), undefined, "kiosk.near")!;
  assert.equal(near.end?.line, "NEAR Confidential didn't pay kiosk.near. Activity shows where your money is.");
  assert.equal(near.steps[1]!.state, "failed", "the step it names is the one shown stopped");
  const plain = sendTrack(mv({ private: false }), undefined, "kiosk.near")!;
  assert.equal(plain.end?.line, "NEAR Intents didn't pay kiosk.near. Activity shows where your money is.");
  const sol = sendTrack(mv({ toChain: "sol" } as Partial<Movement>), "sol", "7xKX…9fQ2")!;
  assert.equal(sol.end?.line, "NEAR Confidential didn't move it to Solana. Activity shows where your money is.");
  // control: a problem with its own words keeps them
  const said = sendTrack(mv({ problem: { code: "x", whatHappened: "NEAR Intents said no.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Close" } } as never }), undefined, "kiosk.near")!;
  assert.equal(said.end?.line, "NEAR Intents said no. Your money is in your Safe.");
  for (const l of [near, plain, sol].map((t) => t.end!.line)) {
    assert.doesNotMatch(l, /\bleft\b|It didn't go/, l);
    assert.deepEqual(bannedIn("packages/wallet/src/app/money/live-steps.ts", l), [], l);
  }
  assert.equal(sendStopped({ by: "NEAR Intents", payee: "bob.near" }), "NEAR Intents didn't pay bob.near. Activity shows where your money is.");
  // control: a Send whose step never took the money says it is still there (live-steps' own "stayed" end)
  const kept = sendTrack(mv({ explorerUrls: [] }), undefined, "kiosk.near")!;
  assert.doesNotMatch(kept.end!.line, /Activity shows/, kept.end!.line);
  const src = readFileSync(new URL("./live-steps.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /It didn't go\. Activity shows where the money is\./, "control: the old line is gone");
});
