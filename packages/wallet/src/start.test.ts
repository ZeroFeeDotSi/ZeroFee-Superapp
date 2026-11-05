// A brand-new account's first NEAR (M7): bought with any coin 1Click quotes, before the account exists. Nothing is signed.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { createApis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { QUOTE_ADDRESS, STARTS, fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";
import type { StartNetwork, StartQuote } from "./types.ts";

const FRESH = "6e".repeat(32);
const NEED = "3700000000000000000000000"; // 3.7 NEAR, what M1 asks for
const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const BTC = "nep141:btc.omft.near";
const SOL_ADDR = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";

function setup() {
  // No account at all: the core says there's none, and nothing may be signed.
  const core = fakeCore({ stage: "none" });
  const fetch = replayFetch();
  const ledger = createLedgerService({ bridge: core, chain: fakeNear("nobody.near", {}), apis: createApis(fetch), readCall: async () => ({ kind: "ran" }) });
  return { core, fetch, ledger };
}
const ok = async <T>(ledger: Bridge, method: string, params?: Record<string, unknown>): Promise<T> => {
  const r = await ledger.call<T>(method, params);
  if ("problem" in r) assert.fail(`${method} gave ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const problem = async (ledger: Bridge, method: string, params?: Record<string, unknown>) => {
  const r = await ledger.call(method, params);
  assert.ok("problem" in r, `${method} should be refused`);
  return r.problem.code;
};

test("every network 1Click quotes, in Add money's order and names, each with its coins; NEAR itself isn't offered", async () => {
  const nets = await ok<StartNetwork[]>(setup().ledger, "ledger.startNetworks");
  assert.deepEqual(nets.slice(0, 5).map((n) => n.name), ["NEAR", "Ethereum", "Base", "Solana", "Bitcoin"]);
  assert.ok(nets.length > 15, `${nets.length} networks`);
  assert.ok(nets.find((n) => n.id === "sol")!.coins.some((c) => c.assetId === USDC_SOL));
  assert.ok(nets.every((n) => n.coins.every((c) => c.assetId !== "nep141:wrap.near")), "wNEAR is what's being bought");
  assert.ok(nets.every((n) => n.name && !/^[a-z]+$/.test(n.name)), "names people know, never codes");
});

test("a quote for the first NEAR: the new account's address, 5% headroom, refunds to the sender's own wallet, before any account exists", async () => {
  const { ledger, fetch, core } = setup();
  const q = await ok<StartQuote>(ledger, "ledger.startQuote", { fundAddress: FRESH, needYocto: NEED, from: { chain: "sol", assetId: USDC_SOL }, refundTo: SOL_ADDR });
  const asked = fetch.calls.find((c) => c.url.endsWith("/quote"))!.body;
  assert.deepEqual(
    { ...asked, deadline: undefined },
    { dry: false, swapType: "EXACT_OUTPUT", slippageTolerance: 100, originAsset: USDC_SOL, depositType: "ORIGIN_CHAIN", destinationAsset: "nep141:wrap.near", amount: "3885000000000000000000000", refundTo: SOL_ADDR, refundType: "ORIGIN_CHAIN", recipient: FRESH, recipientType: "DESTINATION_CHAIN", deadline: undefined },
  );
  const rate = STARTS.byOrigin[USDC_SOL].quote;
  assert.deepEqual([q.depositAddress, q.symbol, q.chain, q.tokenId, q.nearOut, q.refundTo, q.etaSeconds], [QUOTE_ADDRESS, "USDC", "sol", USDC_SOL, "3.885", SOL_ADDR, rate.timeEstimate]);
  assert.equal(q.amountIn, (Number(BigInt(rate.amountIn) * 3885n / 3900n) / 1e6).toString(), "at 1Click's recorded rate");
  assert.ok(Date.parse(q.expiresIso) > Date.now());
  assert.equal(core.signed.length, 0, "nothing signed");
  // D115: Bitcoin waits behind the core's switch (FUND_EVERY_CHAIN, off for release)
  assert.equal(await problem(ledger, "ledger.startQuote", { fundAddress: FRESH, needYocto: NEED, from: { chain: "btc", assetId: BTC }, refundTo: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" }), "ledger.token.unsupported");
});

test("refused plainly: not a new account's address, a coin not on that network, wNEAR itself, no refund address, a bad one", async () => {
  const { ledger } = setup();
  const base = { fundAddress: FRESH, needYocto: NEED, from: { chain: "sol", assetId: USDC_SOL }, refundTo: SOL_ADDR };
  assert.equal(await problem(ledger, "ledger.startQuote", { ...base, fundAddress: "kid.near" }), "ledger.recipient.invalid");
  assert.equal(await problem(ledger, "ledger.startQuote", { ...base, needYocto: "0" }), "ledger.amount.invalid");
  assert.equal(await problem(ledger, "ledger.startQuote", { ...base, from: { chain: "base", assetId: USDC_SOL } }), "ledger.token.unsupported");
  assert.equal(await problem(ledger, "ledger.startQuote", { ...base, from: { chain: "near", assetId: "nep141:wrap.near" } }), "ledger.token.unsupported");
  assert.equal(await problem(ledger, "ledger.startQuote", { ...base, refundTo: "" }), "ledger.start.refund-needed");
  assert.equal(await problem(ledger, "ledger.startQuote", { ...base, refundTo: "0x5a3e000000000000000000000000000000005a3e" }), "ledger.start.refund-needed", "an EVM address isn't a Solana one");
});
