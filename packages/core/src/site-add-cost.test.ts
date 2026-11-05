// ST3: what a site's Add costs, from two DRY 1Click quotes of the Add's own legs (the Safe's coin → Spending's
// confidential USDC, then that USDC → SOL in the site's wallet on Solana). Display only: nothing is kept, signed, sent or
// shown on a sheet. A quote that pays out more than goes in is refused, never shown as a smaller fee.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOAT_USDC, type FloatRelay } from "./float-moves.ts";
import type { PlainWords } from "./signer.ts";
import { REFUSED_RECIPIENTS, STAND_IN } from "./site-add-cost.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";

const SOL = "nep141:sol.omft.near";
const WNEAR = "nep141:wrap.near";
/** 1Click's list: SOL $150, NEAR $4. */
const PRICES: Record<string, { usd: number; decimals: number; symbol: string }> = { [SOL]: { usd: 150, decimals: 9, symbol: "SOL" }, [WNEAR]: { usd: 4, decimals: 24, symbol: "wNEAR" } };

/** A relay whose dry quotes keep `keep1` of leg 1 and `keep2` of leg 2 (1 = no cost); `lie` rewrites an answer. */
function relay(o: { keep1?: number; keep2?: number; lie?: (req: any, q: any) => any; fail?: unknown } = {}) {
  const asked: any[] = [];
  const signed: string[] = [];
  const r: FloatRelay = {
    quote: async (req) => {
      asked.push(req);
      if (o.fail) throw o.fail;
      const leg1 = req.destinationAsset === FLOAT_USDC;
      const inUsd = req.originAsset === FLOAT_USDC ? Number(req.amount) / 1e6 : (Number(req.amount) / 1e24) * 4;
      const out = leg1 ? Math.floor(inUsd * (o.keep1 ?? 0.999) * 1e6) : Math.floor(((inUsd * (o.keep2 ?? 0.99)) / 150) * 1e9);
      const q = { amountIn: req.amount, amountOut: String(out), minAmountOut: String(Math.floor(out * 0.99)), timeEstimate: 20 };
      return { quote: o.lie ? o.lie(req, q) : q };
    },
    generateIntent: async () => (signed.push("generateIntent"), {}),
    submitIntent: async () => (signed.push("submitIntent"), {}),
    status: async () => null,
  };
  return { r, asked, signed };
}

async function setup(o: Parameters<typeof relay>[0] = {}) {
  const shown: PlainWords[] = [];
  const paid: unknown[] = [];
  const fake = relay(o);
  const vault = new MemoryVault();
  const sol = new Proxy({}, { get: () => () => { paid.push("sol"); throw new Error("no Solana call in a price"); } });
  const w = new SubWallets({
    vault, sol: sol as never, evm: {} as never, floatRelay: fake.r, mainAccount: async () => "kim.near",
    usdPrice: async (c) => (c === "sol" ? 150 : null), tokenPrice: async (t) => PRICES[t] ?? null,
    approve: async (words) => (shown.push(words), true), emit: () => {},
  });
  const float = await w.create("trade", "near");
  const pump = await w.create("site", "sol", undefined, "pump");
  const before = JSON.stringify(await w.floatMoveList());
  return { w, float, pump, shown, paid, vault, before, ...fake };
}

test("ST3: two dry quotes, the Add's own legs, priced in dollars; nothing kept, signed, sent or on a sheet", async () => {
  const s = await setup({ keep1: 0.999, keep2: 0.97 });
  const c = await s.w.siteAddCost({ id: s.pump.id, usd: "10.00" });
  // leg 1: $10 → $9.99 (1 cent); leg 2: $9.99 → SOL worth 97 % of it (30 cents)
  assert.deepEqual(c, { feeUsd: 0.31, legsUsd: [0.01, 0.3] });
  assert.equal(s.asked.length, 2);
  const [a, b] = s.asked;
  assert.deepEqual([a.dry, a.originAsset, a.depositType, a.destinationAsset, a.amount, a.recipient, a.recipientType, a.refundTo, a.refundType], [true, FLOAT_USDC, "ORIGIN_CHAIN", FLOAT_USDC, "10000000", STAND_IN.near, "CONFIDENTIAL_INTENTS", STAND_IN.near, "CONFIDENTIAL_INTENTS"]);
  assert.deepEqual([b.dry, b.originAsset, b.depositType, b.destinationAsset, b.amount, b.recipient, b.recipientType, b.refundTo, b.refundType], [true, FLOAT_USDC, "CONFIDENTIAL_INTENTS", SOL, "9990000", STAND_IN.sol, "DESTINATION_CHAIN", STAND_IN.near, "CONFIDENTIAL_INTENTS"]);
  // never a sign, a transfer or a sheet; nothing written to the float's moves
  assert.deepEqual(s.signed, []);
  assert.deepEqual(s.paid, []);
  assert.equal(s.shown.length, 0);
  assert.equal(JSON.stringify(await s.w.floatMoveList()), s.before);
  assert.deepEqual(Object.keys(c).sort(), ["feeUsd", "legsUsd"], "dollars only: no address, id or coin units");
});

test("ST3: the Safe paying in NEAR prices leg 1 from NEAR at 1Click's own list (wNEAR, the only NEAR 1Click takes)", async () => {
  const s = await setup({ keep1: 0.98, keep2: 0.99 });
  const c = await s.w.siteAddCost({ id: s.pump.id, usd: "10", tokenId: "near" });
  assert.equal(s.asked[0].originAsset, WNEAR);
  assert.equal(s.asked[0].amount, "25" + "0".repeat(23), "$10 of NEAR at $4");
  assert.deepEqual(c.legsUsd, [0.2, 0.1]);
  assert.equal(c.feeUsd, 0.3);
});

test("ST3: a tampered quote (pays out more than goes in, another amount, no amount) is refused, never a smaller fee", async () => {
  const lies: [string, (req: any, q: any) => any][] = [
    ["leg 2 pays 5x", (req, q) => (req.destinationAsset === SOL ? { ...q, amountOut: String(Number(q.amountOut) * 5) } : q)],
    ["leg 1 pays more USDC than in", (req, q) => (req.destinationAsset === FLOAT_USDC ? { ...q, amountOut: "20000000" } : q)],
    ["another amount in", (_req, q) => ({ ...q, amountIn: "1" })],
    ["no amount out", (_req, q) => ({ ...q, amountOut: undefined })],
    ["zero out", (_req, q) => ({ ...q, amountOut: "0" })],
    ["not digits", (_req, q) => ({ ...q, amountOut: "1e9" })],
  ];
  for (const [name, lie] of lies) {
    const s = await setup({ lie });
    await assert.rejects(s.w.siteAddCost({ id: s.pump.id, usd: "10" }), (e: any) => e.problem?.code === "security.subwallet.refused", name);
    assert.deepEqual(s.signed, [], name);
  }
  // control: an honest quote with 1Click's quote a hair better than its list (within 1 %) is a price of $0
  const ok = await setup({ keep1: 1, keep2: 1.005 });
  assert.equal((await ok.w.siteAddCost({ id: ok.pump.id, usd: "10" })).feeUsd, 0);
});

test("ST3: refusals before any quote: another kind of wallet, an amount out of range, a coin not named nep141; 1Click down names 1Click", async () => {
  const s = await setup();
  const gmgnBase = await s.w.create("site", "base", undefined, "gmgn");
  const trade = await s.w.create("trade", "sol");
  for (const id of [gmgnBase.id, trade.id, s.float.id, "nope"]) await assert.rejects(s.w.siteAddCost({ id: id, usd: "10" }), (e: any) => e.problem?.code === "security.subwallet.unknown", id);
  for (const usd of ["1.99", "0", "-5", "abc", 10, "100001", "10.001"]) await assert.rejects(s.w.siteAddCost({ id: s.pump.id, usd: usd }), (e: any) => e.problem?.code === "security.request.invalid", String(usd));
  for (const coin of ["usdc", "nep245:x", 7]) await assert.rejects(s.w.siteAddCost({ id: s.pump.id, usd: "10", tokenId: coin }), (e: any) => e.problem?.code === "security.request.invalid", String(coin));
  assert.equal(s.asked.length, 0, "nothing asked of 1Click");
  // 1Click down (the relay throws): its own Problem, by name
  const down = await setup({ fail: new Error("521") });
  await assert.rejects(down.w.siteAddCost({ id: down.pump.id, usd: "10" }), (e: any) => e.problem?.code === "security.partner.unreachable" && /NEAR Intents/.test(e.problem.whatHappened));
  // 1Click's list has no SOL price: 1Click, by name, and no quote asked
  const s2 = await setup();
  delete (PRICES as any)[SOL];
  try {
    await assert.rejects(s2.w.siteAddCost({ id: s2.pump.id, usd: "10" }), (e: any) => e.problem?.code === "security.partner.unreachable");
    assert.equal(s2.asked.length, 0);
  } finally {
    PRICES[SOL] = { usd: 150, decimals: 9, symbol: "SOL" };
  }
});

test("review M: a leg a hair better than the list never credits the other; leg 2 is quoted on no more than the dollars asked", async () => {
  // leg 1 promises 0.9 % MORE than paid (inside the 1 % allowance); leg 2 costs 3 %
  const s = await setup({ keep1: 1.009, keep2: 0.97 });
  const c = await s.w.siteAddCost({ id: s.pump.id, usd: "10" });
  assert.equal(s.asked[1].amount, "10000000", "leg 2 on $10, not the $10.09 promised");
  assert.deepEqual(c, { feeUsd: 0.3, legsUsd: [0, 0.3] }, "the whole 3 % shows (summed signed it was $0.21: under the 2 % line)");
});

test("review Lows: a 4xx is 1Click saying no (never an outage asked again); a coin priced near zero is no price; asks are capped", async () => {
  const no = await setup({ fail: Object.assign(new Error("HTTP 400"), { refused: true }) });
  await assert.rejects(no.w.siteAddCost({ id: no.pump.id, usd: "10" }), (e: any) => e.problem?.code === "security.subwallet.refused" && e.problem.service === undefined && /NEAR Intents said no/.test(e.problem.more));
  PRICES["nep141:dust.near"] = { usd: 1e-300, decimals: 24, symbol: "DUST" };
  try {
    const dust = await setup();
    await assert.rejects(dust.w.siteAddCost({ id: dust.pump.id, usd: "10", tokenId: "nep141:dust.near" }), (e: any) => e.problem?.code === "security.partner.unreachable");
  } finally {
    delete PRICES["nep141:dust.near"];
  }
  // the same ask within 10 s: one pair of quotes; 30 different asks a minute, then a plain refusal (nothing asked)
  const s = await setup();
  await s.w.siteAddCost({ id: s.pump.id, usd: "10" });
  await s.w.siteAddCost({ id: s.pump.id, usd: "10" });
  assert.equal(s.asked.length, 2);
  for (let i = 0; i < 29; i++) await s.w.siteAddCost({ id: s.pump.id, usd: `${11 + i}` });
  const before = s.asked.length;
  await assert.rejects(s.w.siteAddCost({ id: s.pump.id, usd: "99" }), (e: any) => e.problem?.code === "security.subwallet.refused" && /Too many/.test(e.problem.more));
  assert.equal(s.asked.length, before);
});

test("D70 (QA High): the price's dry quotes never carry his addresses (Trading's hidden one, the site wallet's), only stand-ins of the right shape; control: the real Add's quote does", async () => {
  const s = await setup();
  await s.w.siteAddCost({ id: s.pump.id, usd: "10" });
  await s.w.siteAddCost({ id: s.pump.id, usd: "25", tokenId: "near" });
  assert.equal(s.asked.length, 4);
  const sent = JSON.stringify(s.asked);
  for (const mine of [s.float.address, s.pump.address, "kim.near"]) assert.ok(!sent.includes(mine), `a price carried ${mine}`);
  assert.match(STAND_IN.near, /^[0-9a-f]{64}$/);
  assert.match(STAND_IN.sol, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.match(STAND_IN.evm, /^0x[0-9a-f]{40}$/);
  // 1Click refuses these as a recipient (checked 3 Nov): a stand-in is never one (control: the list names the old two)
  for (const x of [STAND_IN.sol, STAND_IN.evm]) assert.ok(!REFUSED_RECIPIENTS.some((r) => r.toLowerCase() === x.toLowerCase()), x);
  assert.ok(REFUSED_RECIPIENTS.includes("11111111111111111111111111111111") && REFUSED_RECIPIENTS.includes("0x000000000000000000000000000000000000dEaD"));
  // control: the real Add's quote (the move itself, after his tap) carries his own Trading address
  await s.w.floatQuoteAdd("10000000").catch(() => undefined);
  const real = s.asked.at(-1);
  assert.equal(real.dry, false);
  assert.equal(real.recipient, s.float.address);
});
