// The phone test (3 Nov): "Put money in pump.fun" sat on a slow quote, its ✕ did nothing, the tester force-quit. The sheet
// now closes at once whatever is in flight, and what it started that isn't signed yet asks for no signature after that:
// the ledger's signAll answers as a No (core money-closed.ts). Here: an Add (ledger.toTrading) whose quote answers only
// after the sheet was closed asks the core for no signature, so no Approve and no Face ID come up.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { moneyClosed } from "@zerofee/core/money-closed";
import { createApis } from "./apis.ts";
import { TRADING_USDC, createLedgerService } from "./ledger.ts";
import { fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";

const ME = "kid.near";
const T0 = Date.parse("2026-10-27T10:00:00.000Z");

function setup() {
  const core = fakeCore({ accountId: ME, now: () => T0 });
  let release!: () => void;
  const quoteHeld = new Promise<void>((r) => (release = r));
  let hold = false, waiting = 0;
  // the core, with the Add's quote held back while `hold` is on (a slow 1Click)
  const bridge: Bridge = {
    call: (async (method: string, p?: Record<string, unknown>) => {
      if (method === "subwallet.float.quoteAdd" && hold) { waiting++; await quoteHeld; }
      return core.call(method, p);
    }) as Bridge["call"],
    on: (e, h) => core.on(e, h),
  };
  const ledger = createLedgerService({
    bridge,
    chain: fakeNear(ME, { ledger: { [TRADING_USDC]: "500000000", "nep141:wrap.near": "0" } }),
    apis: createApis(replayFetch({ privateQuotes: "https://quotes.example/v0" })),
    trackMs: 5,
    now: () => T0,
    readCall: async () => ({ kind: "ran" }),
    privateQuotes: "https://quotes.example",
  });
  return { core, ledger, holdQuote: () => (hold = true), release: () => release(), waiting: () => waiting };
}

test("a money sheet closed while its Add was getting ready: the Add asks for no signature (no Approve, no Face ID), as a No; control: one started after the close is signed", async () => {
  const s = setup();
  s.holdQuote();
  const going = s.ledger.call("ledger.toTrading", { amount: "10" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(s.waiting(), 1, "the Add's quote was asked, and is still on its way");
  moneyClosed();                                                          // the person taps ✕
  s.release();                                                            // 1Click answers after the sheet closed
  const r = await going;
  assert.ok("problem" in r && r.problem.code === "ledger.signature.declined", JSON.stringify(r));
  assert.equal(s.core.signed.length, 0, "nothing was asked to be signed");
  // control: a sheet opened after that one closed signs as before
  await new Promise((r) => setTimeout(r, 2));
  const c = setup();
  const after = await c.ledger.call("ledger.toTrading", { amount: "10" });
  assert.ok("ok" in after, JSON.stringify(after));
  assert.ok(c.core.signed.length >= 1, "control: signed");
});
