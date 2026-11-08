// Audit 12's rig SHOULD (8 Nov): there was no NEAR Confidential fault, so "NEAR Confidential is down" could not be shot.
// ?demo&fault=confidential:521 now injects it: every money move that goes through it is refused with its name, the
// banner says what can't go now and that trades work, and a trade-only call still answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { faultFromQuery, faultedBridge, METHOD_NEEDS } from "./faults.ts";
import { SERVICE_EFFECTS, SERVICE_NAMES, downLine } from "@zerofee/core/services";
import type { Bridge } from "@zerofee/core/bridge";

test("?fault=confidential:521 is a rig; the money moves refuse with NEAR Confidential's name (control: a read still answers)", async () => {
  assert.deepEqual(faultFromQuery("?demo&fault=confidential:521"), { service: "confidential", failure: 521 });
  assert.equal(SERVICE_NAMES.confidential, "NEAR Confidential");
  assert.equal(downLine("confidential"), "NEAR Confidential is down. Sends, swaps, moves, Safe Buy and Sell can't go now. Trades in Hot work.");
  assert.equal(SERVICE_EFFECTS.confidential.back, "Sends, swaps, moves, Safe Buy and Sell work again.");
  for (const m of ["ledger.toPrivate", "ledger.quoteToPrivate", "ledger.pay", "ledger.toTrading", "spending.topUp", "spending.putAway"]) assert.ok(METHOD_NEEDS[m]!.includes("confidential"), m);
  const inner: Bridge = { call: async () => ({ ok: "read" as never }), on: () => () => undefined } as never;
  const b = faultedBridge(inner, { service: "confidential", failure: 521 });
  const r = await b.call("ledger.toPrivate", { quoteId: "q" });
  assert.ok("problem" in r && r.problem.whatHappened === "NEAR Confidential didn't answer.", JSON.stringify(r));
  assert.deepEqual(await b.call("ledger.balances"), { ok: "read" }, "control: a read answers");
  const status = await b.call<{ service: string; state: string }[]>("ledger.status");
  assert.ok("ok" in status && status.ok[0]!.service === "confidential" && status.ok[0]!.state === "down");
});
