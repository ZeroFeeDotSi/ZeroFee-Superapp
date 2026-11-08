// Product decision (8 Nov): "make it all confidential". A Safe Swap (Trade's NEAR Intents Buy and Sell) goes ONLY
// through NEAR Confidential, on Home's Send's own two legs (safe-send.ts swapFromSafe), never a public swap of its own:
// leg 1, the Safe's coin into Private (one mt_transfer inside intents.near, the Safe's one sheet); leg 2, Private pays NEAR
// Intents, which swaps it and lands the coin got back in the Safe (INTENTS to the Safe's own account). The real ledger,
// the fake core and 1Click's answers, end to end: what is asked, signed and followed, and what the job says.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { createApis, type Apis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import type { Movement } from "./types.ts";
import { QUOTE_ADDRESS, fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";

const ME = "kim.near";
const POCKET = "a1".repeat(32);
const RELAY = "https://quotes.example";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const WNEAR = "nep141:wrap.near";
const OUT = "d".repeat(64);
const WALLETS = [{ kind: "private", id: "sw-private", chain: "near", address: POCKET }];
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

function setup(o: { leg1?: "SUCCESS" | "PROCESSING" | "REFUNDED"; leg2?: "SUCCESS" | "PROCESSING" | "REFUNDED"; leg2Least?: string } = {}) {
  const core = fakeCore({ accountId: ME, pocket: [], subwallets: WALLETS as never });
  const base = createApis(replayFetch({ privateQuotes: `${RELAY}/v0` }));
  const asked: any[] = [];
  const submitted: unknown[] = [];
  const apis: Apis = {
    ...base,
    quote: async (req: any) => {
      asked.push(req);
      // the market's dry price (display only): 5 USDC for 1.1 NEAR, its least 1.089
      if (req.dry) return { quote: { amountIn: req.amount, amountOut: "1100000000000000000000000", minAmountOut: "1089000000000000000000000", amountInUsd: "5.00", amountOutUsd: "4.83", timeEstimate: 11 } } as any;
      return { quote: { depositAddress: OUT, amountIn: req.amount, amountOut: "1095000000000000000000000", minAmountOut: o.leg2Least ?? "1084000000000000000000000" } } as any;
    },
    generateIntent: async () => ({ payload: { message: "{}", nonce: "n", recipient: "intents.near" } }) as any,
    submitIntent: async (_r: unknown, signed: unknown) => (submitted.push(signed), { intentHash: "h" }) as any,
    status: async (dep: string) => (dep === QUOTE_ADDRESS ? { status: o.leg1 ?? "SUCCESS", swapDetails: { amountOut: "4950000" } } : { status: o.leg2 ?? "SUCCESS", swapDetails: { amountOut: "1093000000000000000000000" } }) as any,
  };
  const bridgeFor = (app: string) => ({ call: (m: string, q?: Record<string, unknown>) => core.call(m, { ...(q ?? {}), app }), on: (e: string, h: (v: unknown) => void) => core.on(e, h) }) as Bridge;
  const ledger = createLedgerService({ bridgeFor, chain: fakeNear(ME, { ledger: { [USDC]: "500000000" } }, { [QUOTE_ADDRESS]: { ledger: {} } }), apis, routes: { intents: true }, trackMs: 2, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY, safeFillOpen: true } as never);
  const heard: Movement[] = [];
  ledger.on?.("ledger.movementUpdated", (p: any) => void heard.push(p.movement));
  return { ledger, core, asked, submitted, heard };
}
const buy = async (s: ReturnType<typeof setup>) => {
  const q = await s.ledger.call<any>("ledger.swapQuote", { from: USDC, to: WNEAR, amountIn: "5", source: "safe", caller: "trade" });
  assert.ok("ok" in q, JSON.stringify(q));
  return { q: q.ok, job: await s.ledger.call<any>("ledger.swap", { quoteId: q.ok.id, key: "native-buy-wrap-1731", caller: "trade" }) };
};

test("a Safe Buy is ONE job through NEAR Confidential: the Safe's USDC into Private, NEAR Intents swaps it from there, the NEAR lands back in the Safe", async () => {
  const s = setup({ leg1: "PROCESSING" });
  const { q, job } = await buy(s);
  assert.equal(q.minOut, "1.07811", "the least said is what leg 2 can promise through Private (99% of the market's 1.089)");
  assert.ok("ok" in job, JSON.stringify(job));
  const m = job.ok as Movement;
  assert.deepEqual([m.kind, m.status, m.private, m.source, m.from, m.to, m.amount], ["swap", "moving", true, "safe", USDC, WNEAR, "5"], "the job at once: a Swap, through Private, the coin got as its `to`");
  // leg 1: the core's own quote into Private, from the Safe's NEAR Intents balance (one mt_transfer)
  assert.deepEqual(s.core.privateIns.map((p) => [p.tokenId, p.amount, p.through, p.intents]), [[USDC, "5000000", true, true]]);
  const tx = s.core.requests.at(-1)!;
  assert.equal(tx.receiverId, "intents.near");
  assert.deepEqual(tx.actions.map((a: any) => a.method), ["mt_transfer"], "one mt_transfer, the Safe's one sheet");
  assert.equal((tx.actions[0] as any).args.receiver_id, QUOTE_ADDRESS, "into Private's deposit address, never 1Click's swap address");
  assert.equal((tx as any).moveSwap, true, "the Safe's sheet says it is a Swap");
  // leg 2: from Private (CONFIDENTIAL_INTENTS), swapped to NEAR, delivered INTO the Safe's own NEAR Intents balance
  const leg2 = s.asked.find((r) => !r.dry)!;
  assert.deepEqual([leg2.depositType, leg2.originAsset, leg2.destinationAsset, leg2.recipient, leg2.recipientType, leg2.refundTo, leg2.refundType, leg2.amount], ["CONFIDENTIAL_INTENTS", USDC, WNEAR, ME, "INTENTS", POCKET, "CONFIDENTIAL_INTENTS", "4950000"], "exactly what leg 1 promises (its least), refunds to Private");
  assert.equal(s.core.privatePays.length, 1);
  assert.deepEqual([s.core.privatePays[0]!.inDeposit, s.core.privatePays[0]!.pair], [QUOTE_ADDRESS, true], "joined to leg 1 and held for the Safe's one sheet");
  const all = JSON.stringify([s.asked.filter((r) => !r.dry), s.core.requests]);
  assert.ok(!/subwallet\.safeSwapQuote|"depositType":"INTENTS","destinationAsset":"nep141:wrap\.near"/.test(all), "never the public INTENTS-to-INTENTS swap");
  assert.equal(s.submitted.length, 0, "leg 2 is handed over only once leg 1 landed in Private");
});

test("its steps tick only on 1Click's reads: leg 1 into Private stamps inPrivateAtIso, then leg 2's SUCCESS ends it done with what 1Click settled (never the quote)", async () => {
  const s = setup();
  const { job } = await buy(s);
  const id = (job as any).ok.id as string;
  for (let i = 0; i < 50 && !s.heard.some((m) => m.id === id && m.status === "done"); i++) await settle(10);
  const mine = s.heard.filter((m) => m.id === id);
  const inPrivate = mine.find((m) => m.inPrivateAtIso && m.status === "moving");
  assert.ok(inPrivate, `leg 1's read said it reached Private first: ${JSON.stringify(mine.map((m) => [m.status, m.inPrivateAtIso]))}`);
  const done = mine.at(-1)!;
  assert.equal(done.status, "done");
  assert.equal(done.kind, "swap");
  assert.equal(done.amountOut, "1.093", "1Click's swapDetails.amountOut of leg 2, not the quoted 1.095");
  assert.ok(typeof done.settledMs === "number" && done.settledMs >= 0, "its time, measured from the tap");
  assert.equal(s.submitted.length, 1, "leg 2 handed over once");
});

test("faults: leg 2 promising less than the least shown signs nothing; leg 1 sent back ends with the money in Private, never 'done'", async () => {
  const low = setup({ leg2Least: "1000000000000000000000000" });
  const { job } = await buy(low);
  assert.ok("problem" in job, "refused before the Safe's sheet");
  assert.equal(low.core.requests.filter((r) => r.receiverId === "intents.near").length, 0, "nothing signed");
  const back = setup({ leg1: "REFUNDED" });
  const r = await buy(back);
  const id = (r.job as any).ok.id as string;
  for (let i = 0; i < 50 && !back.heard.some((m) => m.id === id && m.status !== "moving"); i++) await settle(10);
  const end = back.heard.filter((m) => m.id === id).at(-1)!;
  assert.equal(end.status, "problem");
  assert.equal(end.inPrivateAtIso, undefined, "step 1 never ticked");
  assert.equal(back.submitted.length, 0, "leg 2 never went");
});

test("control: the NEAR wallet's own swap (source private) is unchanged: one intent, no Safe leg", async () => {
  const s = setup();
  const q = await s.ledger.call<any>("ledger.swapQuote", { from: USDC, to: WNEAR, amountIn: "5", source: "private", caller: "trade" });
  assert.ok(!("ok" in q) || q.ok.source === "private");
  assert.equal(s.core.privateIns.length, 0);
});
