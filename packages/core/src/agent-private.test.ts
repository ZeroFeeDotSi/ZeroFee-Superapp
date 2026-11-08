// AgentZero's private payment (D89, D91): the core makes the 1Click quote itself and AgentZero's key pays only that
// quote's deposit address, for a person on the account's list. Each refusal has a control that passes, so a test fails
// for the reason it names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_USDC, agentPayPlan, agentPrivatePlan, agentPrivateRefusal, type AgentPayee } from "./agent-private.ts";
import type { Chain } from "./chain.ts";
import { AGENT_PRIVATE_OFF, AGENT_PRIVATE_ROUTE } from "./agent-route.ts";
import type { QuoteFacts } from "./intents.ts";
import { ProblemError } from "./problem.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const SAFE = "kim-safe.near";
const NOW = Date.parse("2026-11-02T16:00:00Z");
const DEPOSIT = "a".repeat(64);
const KIM: AgentPayee = { kind: "person", name: "kim.near" };
const SPENDING: AgentPayee = { kind: "spending", address: "b".repeat(64) };

const facts = (over: Partial<QuoteFacts> = {}): QuoteFacts => ({
  status: "PENDING_DEPOSIT",
  originAsset: AGENT_USDC,
  amountIn: "5000000",
  refundTo: SAFE,
  refundType: "INTENTS",
  destinationAsset: AGENT_USDC,
  minAmountOut: "4950000",
  recipient: "kim.near",
  recipientType: "INTENTS",
  deadline: new Date(NOW + 9 * 60_000).toISOString(),
  depositType: "INTENTS",
  swapType: "EXACT_INPUT",
  confidentiality: "basic",
  ...over,
});

test("the route stays shut until the test route-A proof, and its line says so (D91)", () => {
  assert.equal(AGENT_PRIVATE_ROUTE, false, "flip only after tools/wallet/PROOF.md step 2 prints RESULT: route A WORKS");
  assert.equal(AGENT_PRIVATE_OFF, "AgentZero can't pay this privately yet. Nothing was sent.");
});

test("a quote is paid only if it is exactly the one asked: every field, each with its own refusal", () => {
  assert.equal(agentPrivateRefusal(facts(), SAFE, "5000000", KIM, NOW), null, "control: the quote asked for");
  const cases: [Partial<QuoteFacts>, RegExp][] = [
    [{ recipient: "mallory.near" }, /doesn't pay kim\.near/],
    [{ recipientType: "ORIGIN_CHAIN" }, /doesn't pay kim\.near/],
    [{ refundTo: "mallory.near" }, /refund must come back to your own Safe/],
    [{ refundType: "ORIGIN_CHAIN" }, /refund must come back/],
    [{ originAsset: "nep141:wrap.near" }, /terms don't match/],
    [{ destinationAsset: "nep141:wrap.near" }, /terms don't match/],
    [{ amountIn: "5000001" }, /terms don't match/],
    [{ depositType: "ORIGIN_CHAIN" }, /kind of price/],
    [{ swapType: "EXACT_OUTPUT" }, /kind of price/],
    [{ confidentiality: "" }, /isn't a private payment/],
    [{ confidentiality: "none" }, /isn't a private payment/],
    [{ status: "SUCCESS" }, /run out/],
    [{ deadline: new Date(NOW - 1).toISOString() }, /run out/],
    [{ deadline: new Date(NOW + 60 * 60_000).toISOString() }, /lasts longer/],
    [{ minAmountOut: "4800000" }, /too far/],
    [{ minAmountOut: "not a number" }, /too far/],
  ];
  for (const [over, why] of cases) assert.match(agentPrivateRefusal(facts(over), SAFE, "5000000", KIM, NOW) ?? "null", why, JSON.stringify(over));
  assert.match(agentPrivateRefusal(null, SAFE, "5000000", KIM, NOW) ?? "", /didn't confirm/);
  // Exactly 98 % is the least it takes; a hair under is refused.
  assert.equal(agentPrivateRefusal(facts({ minAmountOut: "4900000" }), SAFE, "5000000", KIM, NOW), null);
  assert.match(agentPrivateRefusal(facts({ minAmountOut: "4899999" }), SAFE, "5000000", KIM, NOW) ?? "", /too far/);
  // Into Spending: its own address, privately; a person's name there is refused.
  assert.equal(agentPrivateRefusal(facts({ recipient: SPENDING.kind === "spending" ? SPENDING.address : "", recipientType: "CONFIDENTIAL_INTENTS" }), SAFE, "5000000", SPENDING, NOW), null);
  assert.match(agentPrivateRefusal(facts({ recipientType: "CONFIDENTIAL_INTENTS" }), SAFE, "5000000", SPENDING, NOW) ?? "", /doesn't pay into your NEAR wallet/);
});

/** A quoter as 1Click answers: what the request asked, signed with the test key, with `over` bolted on. */
function quoter(over: { quote?: object; request?: object; sign?: boolean; throws?: boolean } = {}) {
  const asked: Record<string, unknown>[] = [];
  const q = async (req: Record<string, unknown>) => {
    asked.push(req);
    if (over.throws) throw new Error("521");
    const body = { quoteRequest: { ...req, ...over.request }, quote: { depositAddress: DEPOSIT, amountIn: req.amount, amountOut: "4990000", minAmountOut: "4950000", deadline: new Date(NOW + 9 * 60_000).toISOString(), ...over.quote } };
    return over.sign === false ? { ...body, timestamp: new Date(NOW).toISOString(), signature: "ed25519:1111" } : signedQuote(body, new Date(NOW).toISOString());
  };
  return { q, asked };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ProblemError ? `${e.problem.code}: ${e.problem.whatHappened} ${e.problem.more ?? ""}` : String(e);
  }
};

test("the plan: the core asks 1Click itself (USDC in NEAR Intents → kim.near, refund to the Safe) and pays only its signed deposit address", async () => {
  const { q, asked } = quoter();
  const plan = await agentPrivatePlan(q, SAFE, KIM, "5000000", NOW, TEST_QUOTE_KEY);
  assert.deepEqual(plan, { payout: { Ledger: { token_id: AGENT_USDC } }, to: DEPOSIT, amount: "5000000" });
  assert.equal(asked.length, 1);
  assert.deepEqual(
    { ...asked[0], deadline: "-" },
    { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: AGENT_USDC, depositType: "INTENTS", destinationAsset: AGENT_USDC, amount: "5000000", refundTo: SAFE, refundType: "INTENTS", recipient: "kim.near", recipientType: "INTENTS", deadline: "-", confidentiality: "basic" },
  );
});

test("a hostile relay or 1Click: a swapped recipient, an unsigned quote, a bolted-on referral, no address, a dead service: nothing is paid", async () => {
  assert.match(await code(agentPrivatePlan(quoter({ request: { recipient: "mallory.near" } }).q, SAFE, KIM, "5000000", NOW, TEST_QUOTE_KEY)), /doesn't pay kim\.near/);
  assert.match(await code(agentPrivatePlan(quoter({ request: { refundTo: "mallory.near" } }).q, SAFE, KIM, "5000000", NOW, TEST_QUOTE_KEY)), /refund must come back/);
  assert.match(await code(agentPrivatePlan(quoter({ sign: false }).q, SAFE, KIM, "5000000", NOW, TEST_QUOTE_KEY)), /didn't confirm/);
  assert.match(await code(agentPrivatePlan(quoter({ request: { referral: "mallory" } }).q, SAFE, KIM, "5000000", NOW, TEST_QUOTE_KEY)), /didn't confirm/);
  assert.match(await code(agentPrivatePlan(quoter({ quote: { depositAddress: "mallory.near" } }).q, SAFE, KIM, "5000000", NOW, TEST_QUOTE_KEY)), /gave no payment address/);
  assert.match(await code(agentPrivatePlan(quoter({ quote: { minAmountOut: "100" } }).q, SAFE, KIM, "5000000", NOW, TEST_QUOTE_KEY)), /too far/);
  assert.match(await code(agentPrivatePlan(quoter({ request: { confidentiality: undefined } }).q, SAFE, KIM, "5000000", NOW, TEST_QUOTE_KEY)), /isn't a private payment/);
  assert.match(await code(agentPrivatePlan(quoter({ throws: true }).q, SAFE, KIM, "5000000", NOW, TEST_QUOTE_KEY)), /NEAR Intents/);
  assert.match(await code(agentPrivatePlan(quoter().q, SAFE, KIM, "0", NOW, TEST_QUOTE_KEY)), /amount/);
  assert.match(await code(agentPrivatePlan(quoter().q, SAFE, KIM, "-5", NOW, TEST_QUOTE_KEY)), /amount/);
  // Control: the same quote, signed and untouched, is paid.
  assert.equal(await code(agentPrivatePlan(quoter().q, SAFE, KIM, "5000000", NOW, TEST_QUOTE_KEY)), "ok");
});

/** A chain that answers only what agentPayPlan reads: the account's agent view (its list) and a block. */
const chainOf = (network: "mainnet" | "testnet", recipients: string[] = ["kim.near"]) =>
  ({ network, view: async () => ({ budget: { recipients } }), commonBlock: async () => ({}) }) as unknown as Chain;

test("the signer's checks before AgentZero's key signs: no public send with real money, only listed names, the route's switch", async () => {
  const d = (network: "mainnet" | "testnet", over: { route?: boolean; recipients?: string[] } = {}) => ({ chain: chainOf(network, over.recipients), accountId: SAFE, quoter: quoter().q, quoteKey: TEST_QUOTE_KEY, nowMs: NOW, wallet: false, ...(over.route === undefined ? {} : { route: over.route }) });
  const ask = (kind: string, to = "kim.near") => ({ kind, payout: { Ledger: { token_id: AGENT_USDC } }, to, amount: "5000000" });
  // Real money: a plain pay is refused even to a listed name (review M1); a private one is shut while the route is.
  assert.match(await code(agentPayPlan(ask("pay"), d("mainnet"))), /can't pay this privately yet/);
  assert.match(await code(agentPayPlan(ask("pay-private"), d("mainnet"))), /can't pay this privately yet/);
  // An unlisted name, a near-miss of a listed one, or none: refused before any quote (the hostile address).
  for (const to of ["mallory.near", "kim.near ", "KIM.near", "kim.near."]) assert.match(await code(agentPayPlan(ask("pay-private", to), d("mainnet", { route: true }))), /only the people on your list/, to);
  assert.match(await code(agentPayPlan({ ...ask("pay-private"), to: undefined }, d("mainnet", { route: true }))), /only the people on your list/);
  // Route open (once the test proof passes): a listed name is paid through the core's own quote, its deposit address.
  assert.deepEqual(await agentPayPlan(ask("pay-private"), d("mainnet", { route: true })), { payout: { Ledger: { token_id: AGENT_USDC } }, to: DEPOSIT, amount: "5000000" });
  // Never on testnet (1Click is mainnet only); a testnet plain pay to a listed name passes through unchanged (tests, dev).
  assert.match(await code(agentPayPlan(ask("pay-private"), d("testnet", { route: true }))), /can't pay this privately yet/);
  assert.deepEqual(await agentPayPlan(ask("pay"), d("testnet")), ask("pay") && { payout: { Ledger: { token_id: AGENT_USDC } }, to: "kim.near", amount: "5000000" });
});

test("keep money in Spending (D89): the core's own quote into Spending's private balance; the app can't pick where it goes", async () => {
  const SPEND = "c".repeat(64);
  const { q, asked } = quoter();
  const d = (over: { route?: boolean; spending?: string | null; network?: "mainnet" | "testnet" } = {}) => ({ wallet: false,
    chain: chainOf(over.network ?? "mainnet", []),
    accountId: SAFE,
    quoter: q,
    quoteKey: TEST_QUOTE_KEY,
    nowMs: NOW,
    spending: async () => (over.spending === undefined ? SPEND : over.spending),
    ...(over.route === undefined ? {} : { route: over.route }),
  });
  const top = (amount = "5000000", to?: string) => ({ kind: "top-up", payout: undefined, to, amount });
  // Shut until route A is proven; never on testnet.
  assert.match(await code(agentPayPlan(top(), d())), /can't fill your SOL wallet privately yet/);
  assert.match(await code(agentPayPlan(top(), d({ route: true, network: "testnet" }))), /can't fill your SOL wallet privately yet/);
  // Under $2 is mostly fees; no Spending yet is said; nothing asked of 1Click either way.
  assert.match(await code(agentPayPlan(top("1999999"), d({ route: true }))), /under \$2/);
  assert.match(await code(agentPayPlan(top(), d({ route: true, spending: null }))), /Your NEAR wallet isn't set up/);
  assert.equal(asked.length, 0);
  // Open: into Spending, privately, refund to the Safe. A hostile `to` from app code is ignored (never on the list check
  // path either: a top-up has no person).
  const plan = await agentPayPlan(top("5000000", "mallory.near"), d({ route: true }));
  assert.deepEqual(plan, { payout: { Ledger: { token_id: AGENT_USDC } }, to: DEPOSIT, amount: "5000000" });
  assert.equal(asked[0]!.recipient, SPEND);
  assert.equal(asked[0]!.recipientType, "CONFIDENTIAL_INTENTS");
  assert.equal(asked[0]!.refundTo, SAFE);
  // A relay that swaps the quote to pay a person (or a public balance) instead of Spending: refused.
  const swapped = quoter({ request: { recipient: "mallory.near", recipientType: "INTENTS" } });
  assert.match(await code(agentPayPlan(top(), { ...d({ route: true }), quoter: swapped.q })), /doesn't pay into your NEAR wallet/);
  const publicSpend = quoter({ request: { recipientType: "INTENTS" } });
  assert.match(await code(agentPayPlan(top(), { ...d({ route: true }), quoter: publicSpend.q })), /doesn't pay into your NEAR wallet/);
});

test("budgetLoosens: more of anything loosens; the same or less doesn't (each with its control)", async () => {
  const { budgetLoosens } = await import("./agent-private.ts");
  const B = (o: { day?: string; any?: string; people?: string[]; end?: string; n?: number; coin?: string } = {}) => ({ coins: [{ coin: o.coin ?? AGENT_USDC, per_day: o.day ?? "20000000", per_month: "600000000", convert_per_day: o.any ?? "0" }], recipients: o.people ?? ["kim.near"], ends_at_ns: o.end ?? "100", max_spends_per_day: o.n ?? 12 });
  assert.equal(budgetLoosens(B(), B()), false, "the same budget");
  assert.equal(budgetLoosens(B(), B({ day: "5000000", people: [] })), false, "lower and fewer: a tightening");
  assert.equal(budgetLoosens(B(), B({ day: "50000000" })), true);
  assert.equal(budgetLoosens(B(), B({ any: "20000000" })), true, "the any-address cap opened");
  assert.equal(budgetLoosens(B(), B({ people: ["kim.near", "lee.near"] })), true, "a new person");
  assert.equal(budgetLoosens(B(), B({ end: "200" })), true, "a later end");
  assert.equal(budgetLoosens(B(), B({ n: 13 })), true);
  assert.equal(budgetLoosens(B(), B({ coin: "nep141:wrap.near" })), true, "a coin it couldn't pay before");
  assert.equal(budgetLoosens(null, B()), true, "from nothing");
  // Numbers the contract's parser would still read but that aren't canonical digits: loosening (fail closed).
  assert.equal(budgetLoosens(B(), B({ day: "+5000000" })), true);
  assert.equal(budgetLoosens(B(), B({ day: "005000000" })), true);
  assert.equal(budgetLoosens(B(), B({ day: "1".repeat(40) })), true);
  assert.equal(budgetLoosens(B(), B({ day: "5000000" })), false, "control: a plain lower number tightens");
});

test("pairing a computer: a No on the sheet sends nothing; a relay that doesn't answer is named; junk never reaches the sheet", async () => {
  const { agentPairComputer } = await import("./agent-private.ts");
  const { makeOffer } = await import("./pair.ts");
  const offer = makeOffer().offer;
  const posts: string[] = [];
  let sheets = 0;
  const base = { offer, seed: new Uint8Array(32).fill(3), accountId: "kim-safe.near", post: async (m: string) => (posts.push(m), true) };
  assert.equal((await agentPairComputer({ ...base, approve: async () => (sheets++, false) })).status, "declined");
  assert.equal(posts.length, 0, "a No sends nothing");
  // The host's own Face ID, when it has one, is required too.
  assert.equal((await agentPairComputer({ ...base, approve: async () => true, faceId: async () => false })).status, "declined");
  assert.equal(posts.length, 0);
  assert.match(await code(agentPairComputer({ ...base, approve: async () => true, post: async () => false })), /ZeroFee's server/);
  assert.match(await code(agentPairComputer({ ...base, offer: "zf-pair:2:junk", approve: async () => (sheets++, true) })), /isn't a computer's AgentZero code/);
  assert.equal(sheets, 1, "junk never reached a sheet");
  // D104: the sheet says the bounded loss plainly, with the account's own pocket money.
  let said: string[] = [];
  await agentPairComputer({ ...base, pocketUsd: 20, approve: async (w) => ((said = w.lines), false) });
  assert.ok(said.includes("The computer pays from AgentZero's wallet. It spends at most $20 in any 24 hours. It stops when you tap Stop."), said.join(" | "));
  assert.ok(said.includes("Your computer keeps its own day limit too. Your account's limit is the hard one."));
  // Control: yes (and Face ID yes) → one post, to that offer's mailbox.
  assert.equal((await agentPairComputer({ ...base, approve: async () => true, faceId: async () => true })).status, "paired");
  assert.equal(posts.length, 1);
});
