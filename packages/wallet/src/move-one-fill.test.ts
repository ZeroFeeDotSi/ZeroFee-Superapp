// ONE fill for the whole Move, on the ledger (QA's ruling, 7 Nov; the owner's "prompt, success, prompt": Private
// $0, parts $5 + $30 raised two Safe sheets, $10 and $40). Fails on 31472605d: two Safe sheets, two fills.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { createApis, type Apis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { fits } from "./send-job.ts";
import { QUOTE_ADDRESS, fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";

const ME = "kid.near";
const POCKET = "a1".repeat(32);
const FLOAT = "f0".repeat(32);
const RELAY = "https://quotes.example";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const SOL = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const JOB = "move-private-0123456789abcdef0123";
const WALLETS = [{ kind: "private", id: "sw-private", chain: "near", address: POCKET }, { kind: "trade", id: "sw-trade-sol", chain: "sol", address: SOL }, { kind: "trade", id: "sw-trade-near", chain: "near", address: FLOAT }];

function setup(pocketUnits: string, sign: "done" | "declined" = "done") {
  const core = fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: pocketUnits }], subwallets: WALLETS as never, sign });
  let k = 0;
  const base = createApis(replayFetch({ privateQuotes: `${RELAY}/v0` }));
  const apis: Apis = {
    ...base,
    quote: async (req: any) => ({ quote: { depositAddress: req.dry ? undefined : `${(k++).toString(16).padStart(2, "0")}${"d".repeat(62)}`, amountIn: req.amount, amountOut: "7000", minAmountOut: "6900" }, zerofeeStatusTag: "tag-for-this-quote-0001" }) as any,
    generateIntent: async () => ({ payload: { message: "{}", nonce: "n", recipient: "intents.far" } }),
    submitIntent: async () => ({ intentHash: "h" }),
    status: async () => ({ status: "PENDING_DEPOSIT" }) as any,
  };
  const bridgeFor = (app: string) => ({ call: (m: string, q?: Record<string, unknown>) => core.call(m, { ...(q ?? {}), app }), on: (e: string, h: (v: unknown) => void) => core.on(e, h) }) as Bridge;
  const ledger = createLedgerService({ bridgeFor, chain: fakeNear(ME, { ledger: { [USDC]: "500000000" } }, { [QUOTE_ADDRESS]: { ledger: {} } }), apis, routes: { intents: false, nearOrigin: false }, trackMs: 2, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY, safeFillOpen: true } as never);
  return { ledger, core };
}
const move = (s: ReturnType<typeof setup>, parts: unknown[]) => s.ledger.call<{ parts: { wallet: string; ids: string[]; stopped?: string }[] }>("ledger.moveFromPrivate", { parts, job: JOB, caller: "trade" });

test("condition 2: Private $0, parts $5 + $30: the core's plan, ONE fill ($40), ONE Safe sheet, then two Private payments joined to that one fill, each naming the Move (31472605d: two sheets, $10 and $40)", async () => {
  const s = setup("0");
  const r = await move(s, [{ wallet: "near", usd: 5 }, { wallet: "sw-trade-sol", usd: 30 }]);
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.equal(s.core.movePlans.length, 1, "the core works out the plan once");
  assert.equal(s.core.signed.length, 1, "ONE Safe sheet");
  assert.deepEqual(s.core.privateIns.map((q) => [q.amount, q.job]), [["40000000", JOB]], "ONE fill, sized by the core's plan, bound to the Move");
  const legs = s.core.privatePays.filter((p) => typeof p.inDeposit === "string");
  assert.equal(legs.length, 2, "two Private payments");
  assert.ok(legs.every((p) => p.inDeposit === legs[0]!.inDeposit && p.pair === true && p.job === JOB), "both joined to the one fill, held for its one sheet, naming the Move");
  assert.deepEqual(r.ok.parts.map((p) => p.ids.filter((id) => id.startsWith("safe-send:")).length), [1, 1]);
});

test("one fill with Private's own share: Private pays the $5 it covers (no sheet), the one fill pays the $30 (control: Private covers both, no sheet at all)", async () => {
  const s = setup("12500000");
  const r = await move(s, [{ wallet: "near", usd: 5 }, { wallet: "sw-trade-sol", usd: 30 }]);
  assert.ok("ok" in r);
  assert.equal(s.core.signed.length, 1);
  assert.deepEqual(s.core.privateIns.map((q) => q.amount), ["40000000"]);
  assert.deepEqual(r.ok.parts.map((p) => p.ids.map((id) => id.split(":")[0])), [["pocket-send"], ["safe-send"]]);
  const all = setup("40000000");
  assert.ok("ok" in (await move(all, [{ wallet: "near", usd: 5 }, { wallet: "sw-trade-sol", usd: 30 }])));
  assert.deepEqual([all.core.signed.length, all.core.privateIns.length], [0, 0]);
});

test("a No on the one sheet: nothing sent, the Move refused as a No (Private paid nothing); with Private's own part gone first, the fill's parts say they didn't go", async () => {
  const s = setup("0", "declined");
  const r = await move(s, [{ wallet: "near", usd: 5 }, { wallet: "sw-trade-sol", usd: 30 }]);
  assert.ok("problem" in r && /declin/.test(r.problem.code), JSON.stringify(r));
  const p = setup("12500000", "declined");
  const q = await move(p, [{ wallet: "near", usd: 5 }, { wallet: "sw-trade-sol", usd: 30 }]);
  assert.ok("ok" in q);
  assert.equal(q.ok.parts[0]!.stopped, undefined, "Private's own part went");
  assert.ok(q.ok.parts[1]!.stopped && q.ok.parts[1]!.ids.length === 0, "the fill's part didn't go");
});

test("condition 3 on the follower (send-job fits): a leg of the one fill goes only when what landed covers it among the legs that fit, smallest first; a leg alone, as before", () => {
  const legs = ["4950000", "29700000"];
  assert.equal(fits({ leg2In: "4950000", fit: { legs, at: 0 } }, 30_000_000n), true);
  assert.equal(fits({ leg2In: "29700000", fit: { legs, at: 1 } }, 30_000_000n), false, "short: the $29.70 stays in Private");
  assert.equal(fits({ leg2In: "29700000", fit: { legs, at: 1 } }, 34_650_000n), true);
  assert.equal(fits({ leg2In: "29700000", fit: { legs, at: 0 } }, 34_650_000n), false, "a leg that isn't the one it says it is");
  assert.equal(fits({ leg2In: "5" }, 5n), true, "control: a Send's one leg");
  assert.equal(fits({ leg2In: "5" }, 4n), false);
});
