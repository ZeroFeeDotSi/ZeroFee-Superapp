// D111, G1: AgentZero pays an address on any chain, not only a NEAR name. Off today (AGENT_CROSS_CHAIN, until release 11
// holds the payee list on chain): a non-NEAR payee is refused by name and a NEAR name pays exactly as before. With the
// switch on: only a payee on the on-chain list, the core's own exact-out quote, checked field by field.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_USDC, PAYEE_CHAIN_NAME, agentPayPlan, readPayee } from "./agent-private.ts";
import { AGENT_CROSS_CHAIN } from "./agent-route.ts";
import type { Chain } from "./chain.ts";
import { ProblemError } from "./problem.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const SAFE = "kim-safe.near";
const NOW = Date.parse("2026-11-03T02:00:00Z");
const DEPOSIT = "a".repeat(64);
const SOL_ADDR = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const EVM_ADDR = "0x" + "ab".repeat(20);
const SOL_COIN = "nep141:sol.omft.near";

/** 1Click as it answers an exact-out ask: what was asked, signed, costing `amountIn` USDC, with `over` bolted on. */
function quoter(over: { quote?: object; request?: object } = {}, amountIn = "5100000") {
  const asked: Record<string, unknown>[] = [];
  const q = async (req: Record<string, unknown>) => {
    asked.push(req);
    const body = { quoteRequest: { ...req, ...over.request }, quote: { depositAddress: DEPOSIT, amountIn, amountOut: req.amount, minAmountOut: req.amount, deadline: new Date(NOW + 9 * 60_000).toISOString(), ...over.quote } };
    return signedQuote(body, new Date(NOW).toISOString());
  };
  return { q, asked };
}

/** NEAR as agentPayPlan reads it: the agent's list (NEAR names) and, from release 11, the payee list. */
const chainOf = (o: { names?: string[]; payees?: object[] | null } = {}) =>
  ({
    network: "mainnet",
    commonBlock: async () => ({}),
    view: async (_a: string, method: string) => {
      if (method === "agent") return { budget: { recipients: o.names ?? ["kim.near"] } };
      if (method === "agent_payees") {
        if (o.payees === null || o.payees === undefined) throw new Error("no method agent_payees");
        return o.payees;
      }
      throw new Error(method);
    },
  }) as unknown as Chain;

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ProblemError ? `${e.problem.more ?? e.problem.whatHappened}` : String(e);
  }
};

const solAsk = (over: Record<string, unknown> = {}) => ({ kind: "pay-private", payout: undefined, to: SOL_ADDR, amount: "5000000", chain: "sol", usd: 5, ...over });
const on = (over: Record<string, unknown> = {}) => ({ chain: chainOf({ payees: [{ chain: "sol", address: SOL_ADDR }] }), accountId: SAFE, quoter: quoter().q, quoteKey: TEST_QUOTE_KEY, nowMs: NOW, route: true, crossChain: true, price: async () => 150, wallet: false, ...over }); // agent_pay's own path: AgentZero's wallet explicitly off (on, agent_pay is off: agent-sandbox.test.ts)

test("a payee is read per chain, its chain named when it isn't one; a NEAR name keeps its old words", () => {
  assert.deepEqual(readPayee("kim.near"), { chain: "near", address: "kim.near" });
  assert.deepEqual(readPayee(SOL_ADDR, "sol"), { chain: "sol", address: SOL_ADDR });
  assert.deepEqual(readPayee(EVM_ADDR, "hood"), { chain: "hood", address: EVM_ADDR });
  assert.deepEqual(readPayee("Kim.near"), { refused: "That isn't a NEAR account. Nothing was sent." });
  assert.deepEqual(readPayee("kim.near", "sol"), { refused: "That isn't a Solana address. Nothing was sent." });
  assert.deepEqual(readPayee(SOL_ADDR, "bsc"), { refused: "That isn't a BNB Chain address. Nothing was sent." });
  assert.deepEqual(readPayee(EVM_ADDR, "btc"), { refused: "AgentZero can't pay on that chain. Nothing was sent." });
  assert.deepEqual(readPayee(SOL_ADDR, "sol", "javascript:alert(1)"), { refused: "That coin isn't one AgentZero knows. Nothing was sent." });
  assert.equal(PAYEE_CHAIN_NAME.hood, "Robinhood Chain");
});

test("today the switch is off: a Solana payee is refused by name, nothing asked of 1Click; a NEAR name pays as before", async () => {
  assert.equal(AGENT_CROSS_CHAIN, false, "on only once release 11 holds the payee list on chain");
  const { q, asked } = quoter();
  assert.equal(await code(agentPayPlan(solAsk(), { ...on({ quoter: q }), crossChain: undefined })), "AgentZero can't pay a Solana address yet. Nothing was sent.");
  assert.equal(asked.length, 0);
  // Control: the same switch, a NEAR name (no chain, or "near"): the old path, unchanged.
  const near = quoter({}, "5000000");
  const plan = await agentPayPlan({ kind: "pay-private", payout: undefined, to: "kim.near", amount: "5000000", chain: "near" }, { ...on({ quoter: near.q }), crossChain: undefined });
  assert.deepEqual(plan, { payout: { Ledger: { token_id: AGENT_USDC } }, to: DEPOSIT, amount: "5000000" });
  assert.equal(near.asked[0]!.swapType, "EXACT_INPUT");
  assert.equal(near.asked[0]!.recipient, "kim.near");
});

test("switch on: a Solana payee on the account's list gets exactly $5 of SOL through the core's own exact-out quote", async () => {
  const { q, asked } = quoter();
  const plan = await agentPayPlan(solAsk(), on({ quoter: q }));
  assert.deepEqual(plan, { payout: { Ledger: { token_id: AGENT_USDC } }, to: DEPOSIT, amount: "5100000", hidden: true });
  assert.deepEqual(
    { ...asked[0], deadline: "-" },
    { dry: false, swapType: "EXACT_OUTPUT", slippageTolerance: 100, originAsset: AGENT_USDC, depositType: "INTENTS", destinationAsset: SOL_COIN, amount: "33333333", refundTo: SAFE, refundType: "INTENTS", recipient: SOL_ADDR, recipientType: "DESTINATION_CHAIN", deadline: "-", confidentiality: "basic" },
  );
  // Not hidden on that corridor: never paid by AgentZero (D70; the rail's review, Medium). The person can pay it in Plain.
  await assert.rejects(agentPayPlan(solAsk(), on({ quoter: quoter({ request: { confidentiality: undefined } }).q })), (e: any) => /It isn't a hidden payment on Solana/.test(String(e.problem.more)));
  // A seller's exact price in SOL (x402, MPP): that amount, in the payee's own coin.
  const seller = quoter();
  await agentPayPlan(solAsk({ amountOut: "1000000", usd: undefined }), on({ quoter: seller.q }));
  assert.equal(seller.asked[0]!.amount, "1000000");
});

test("switch on, refused by name: not on the list, no list yet, the route shut, no price, a closed chain; nothing asked", async () => {
  const { q, asked } = quoter();
  const cases: [ReturnType<typeof solAsk>, Record<string, unknown>, RegExp][] = [
    [solAsk(), { chain: chainOf({ payees: [] }) }, /That Solana address isn't on AgentZero's list\./],
    [solAsk(), { chain: chainOf({ payees: null }) }, /isn't on AgentZero's list/],
    [solAsk(), { chain: chainOf({ payees: [{ chain: "hood", address: SOL_ADDR }] }) }, /isn't on AgentZero's list/],
    [solAsk(), { route: false }, /can't pay this privately yet/],
    [solAsk({ kind: "pay" }), {}, /can't pay this privately yet/],
    [solAsk(), { price: async () => null }, /Solana's price couldn't be read/],
    [solAsk({ usd: 0 }), {}, /more than \$0/],
    [solAsk({ amount: "0" }), {}, /the most AgentZero may pay/],
    [{ ...solAsk(), chain: "bsc", to: EVM_ADDR }, { chain: chainOf({ payees: [{ chain: "bsc", address: EVM_ADDR }] }) }, /can't pay that coin on BNB Chain yet/],
  ];
  for (const [ask, over, why] of cases) assert.match(await code(agentPayPlan(ask, on({ quoter: q, ...over }))), why, JSON.stringify([ask, Object.keys(over)]));
  assert.equal(asked.length, 0, "refused before any quote");
});

test("switch on, a hostile relay or 1Click: every swapped field refused, each naming what's wrong; control paid", async () => {
  const cases: [Parameters<typeof quoter>[0], string | undefined, RegExp][] = [
    [{ request: { recipient: "8".repeat(44) } }, undefined, /doesn't pay that Solana address/],
    [{ request: { recipientType: "INTENTS" } }, undefined, /doesn't pay that Solana address/],
    [{ request: { refundTo: "mallory.near" } }, undefined, /refund must come back/],
    [{ request: { destinationAsset: "nep141:wrap.near" } }, undefined, /terms don't match/],
    [{ request: { swapType: "EXACT_INPUT" } }, undefined, /kind of price/],
    [{ quote: { amountOut: "1", minAmountOut: "1" } }, undefined, /pays less than asked on Solana/],
    [{}, "5650001", /costs more than AgentZero may pay/],
  ];
  for (const [over, amountIn, why] of cases) assert.match(await code(agentPayPlan(solAsk(), on({ quoter: quoter(over, amountIn).q }))), why, JSON.stringify(over));
  // The most it may cost: $5 plus 3 % and $0.50, the same room as Spending's moves (5,650,000).
  assert.equal(await code(agentPayPlan(solAsk(), on({ quoter: quoter({}, "5650000").q }))), "ok");
});

test("the rail's cost ceiling (review, Medium): 'Ask me above $5' counts what a Solana payment may cost at most (3 % and $0.50 on top), not its amount; a NEAR name counts its amount, as before", async () => {
  const { MemoryVault } = await import("./vault.ts");
  const { setAskAbove, payeeCeiling } = await import("./agent-private.ts");
  const vault = new MemoryVault();
  const USDC_PAYOUT = { Ledger: { token_id: AGENT_USDC.replace(/^nep141:/, "") } };
  await setAskAbove(5, { vault, approve: async () => true, strong: async () => {} });
  assert.equal(payeeCeiling("4370000"), "5001100", "$4.37 may cost $5.0011");
  const asked = (e: any) => e?.problem?.code === "security.agent.ask-first";
  await assert.rejects(agentPayPlan(solAsk({ amount: "4370000", usd: 4.37, payout: USDC_PAYOUT }), on({ vault })), asked, "a quote that may cost $5.0011 asks first");
  const fits = await agentPayPlan(solAsk({ amount: "4360000", usd: 4.36, payout: USDC_PAYOUT }), on({ vault, quoter: quoter({}, "4400000").q }));
  assert.equal((fits as { to: string }).to, DEPOSIT, "control: at most $4.99 goes on");
  // A NEAR name: its own $5.00 is at the line, so it doesn't ask (unchanged).
  const near = quoter({}, "5000000");
  await assert.doesNotReject(agentPayPlan({ kind: "pay-private", payout: USDC_PAYOUT, to: "kim.near", amount: "5000000", chain: "near" }, { ...on({ quoter: near.q, vault }), crossChain: undefined }));
});
