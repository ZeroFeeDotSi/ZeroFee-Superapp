// C2 (QA's headline rule, the audit's five conditions, 7 Nov): the Safe's one Move sheet says the whole Move, its
// wallet parts from the core's own check, never the page's words. Fails on f7c52792d: the core has no confirmOthers,
// keepOthers, othersForSheet or legCap, and the sheet never names a wallet part ("Move $109.87 ...", the Safe's side only).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as plan from "./move-plan.ts";
import * as door from "./spending-move.ts";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner } from "./dev-signer.ts";
import { INTENTS, PRIVATE_POCKET, TRADING_BALANCE } from "./intents.ts";
import type { OtherPart, PrivateLegRecord } from "./private-route.ts";
import type { TxRequest } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const P = { ...(plan as unknown as Record<string, any>), ...(door as unknown as Record<string, any>) };
const has = (name: string) => assert.equal(typeof P[name], "function", `the core exports ${name}`);
const chain = (c: string, usd: number, o: { unread?: true } = {}) => ({ chain: c, nativeUsd: usd, readyUsd: 0, coinsUsd: 0, ...o });
const READ = { reserveUsd: 20, chains: [chain("sol", 5), chain("hood", 9.5), chain("bsc", 50, { unread: true })] };

test("the audit's condition 4: the page's wallet parts are checked against the engine's own read; the page can only lower, never raise or add a wallet the read doesn't show", () => {
  has("confirmOthers");
  const rows: [string, unknown, OtherPart[] | null][] = [
    ["the owner's Move: $3.94 and $5.52 from the ETH (RH) wallet's $9.50", [{ from: "hood", to: "sol", usd: 3.94 }, { from: "hood", to: "near", usd: 5.52 }], [{ from: "hood", to: "sol", cents: "394" }, { from: "hood", to: "near", cents: "552" }]],
    ["lower than the read: kept as the page said it", [{ from: "hood", to: "sol", usd: 1 }], [{ from: "hood", to: "sol", cents: "100" }]],
    ["higher than the read: none", [{ from: "hood", to: "sol", usd: 9.51 }], null],
    ["two parts together over the read: none", [{ from: "hood", to: "sol", usd: 5 }, { from: "hood", to: "near", usd: 5 }], null],
    ["a wallet the read didn't reach: none", [{ from: "bsc", to: "sol", usd: 1 }], null],
    ["a wallet not in the read at all: none", [{ from: "sol", to: "hood", usd: 1 }, { from: "nope", to: "sol", usd: 1 }], null],
    ["the NEAR wallet's cash: its own read", [{ from: "near", to: "sol", usd: 20 }], [{ from: "near", to: "sol", cents: "2000" }]],
    ["the NEAR wallet over its cash: none", [{ from: "near", to: "sol", usd: 20.01 }], null],
    ["to the Safe, the same wallet, no figure, \"all\": none", [{ from: "hood", to: "safe", usd: 1 }], null],
    ["the same wallet", [{ from: "hood", to: "hood", usd: 1 }], null],
    ["\"all\"", [{ from: "hood", to: "sol", usd: "all" }], null],
    ["nothing", [], null],
  ];
  for (const [name, raw, want] of rows) assert.deepEqual(P.confirmOthers(raw, READ), want, name);
});

test("the audit's condition 1: each wallet leg of the Move, by its key, at most its kept part, once each; above it refused; no kept parts, as before", () => {
  has("legCap"); has("keepOthers");
  const job = "cap-job-0123456789";
  P.keepOthers(job, [{ from: "hood", to: "sol", cents: "394" }, { from: "hood", to: "near", cents: "552" }]);
  assert.match(P.legCap(job, "hood", "sol", 3.95), /more than this Move planned/, "a cent above its part: refused");
  assert.equal(P.legCap(job, "hood", "sol", 3.94), null, "at its part: goes");
  assert.match(P.legCap(job, "hood", "sol", 1), /isn't in this Move's plan/, "the same part again: refused (once each)");
  assert.match(P.legCap(job, "sol", "near", 1), /isn't in this Move's plan/, "a part the sheet never said: refused");
  assert.equal(P.legCap(job, "hood", "near", 5), null, "below its part: goes");
  assert.equal(P.legCap(job, "hood", "near", 5), null, "every part used: the kept parts are gone, the key reads as nothing kept");
  assert.equal(P.legCap("no-such-job-0123456", "hood", "sol", 50), null, "control: nothing kept under the key, as before");
  assert.equal(P.legCap(undefined, "hood", "sol", 50), null, "control: no key, as before");
});

test("the cap's words are planLegRefusal's, word for word", () => {
  has("legCap");
  assert.deepEqual([P.LEG_CAP_WORDS.gone, P.LEG_CAP_WORDS.none, P.LEG_CAP_WORDS.more], [plan.planLegRefusal(null, "x", 1n), plan.planLegRefusal(new Map(), "x", 1n), plan.planLegRefusal(new Map([["x", 0n]]), "x", 1n)]);
});

test("the audit's conditions 2 and 3: the parts only for the sheet of their own key, bound to its one fill; any end but a yes ends them and refuses a leg still carrying the key", () => {
  has("othersForSheet"); has("endOthers");
  const a = "move-a-0123456789ab", b = "move-b-0123456789ab";
  P.keepOthers(a, [{ from: "hood", to: "sol", cents: "394" }]);
  P.keepOthers(b, [{ from: "sol", to: "near", cents: "200" }]);
  // two Moves back to back: each sheet its own parts
  assert.deepEqual(P.othersForSheet(a, "dep-a"), [{ from: "hood", to: "sol", cents: "394" }]);
  assert.deepEqual(P.othersForSheet(b, "dep-b"), [{ from: "sol", to: "near", cents: "200" }]);
  assert.equal(P.othersForSheet(a, "dep-b"), undefined, "another fill: none (bound to its first)");
  assert.deepEqual(P.othersForSheet(a, "dep-a"), [{ from: "hood", to: "sol", cents: "394" }], "the same fill read again (the sheet and its check): the same parts");
  // Not now / Close / a refusal: gone, and a leg with the key is refused
  P.endOthers(a);
  assert.equal(P.othersForSheet(a, "dep-a"), undefined);
  assert.match(P.legCap(a, "hood", "sol", 3.94), /no longer has this Move's plan/);
  // a new try under the same key with nothing confirmed: nothing kept, as before
  P.keepOthers(a, null);
  assert.equal(P.legCap(a, "hood", "sol", 3.94), null);
  // past OTHERS_MS: gone
  P.keepOthers(b, [{ from: "sol", to: "near", cents: "200" }], 0);
  assert.equal(P.othersForSheet(b, "dep-b", plan.OTHERS_MS + 1), undefined);
});

/** The real core's sheet for the owner's Move: the Safe's $150.00 fill, NEAR wallet $101.48 from it, SOL wallet $8.39 from Private. */
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DEPOSIT = "1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c";
const POCKET = "a1".repeat(32), SOLW = "So1aWa11et1111111111111111111111111111111111", FLOAT = "f1oat.near";
const u = (usd: number) => String(Math.round(usd * 100) * 10_000);
async function sheet(others: OtherPart[] | undefined) {
  const fc = new FakeChain("mainnet");
  const key = SoftwareKey.generate();
  fc.fund("alice.near", key.publicKey);
  fc.contract("intents.near", INTENTS.codeHashBase58, { mt_balance_of: ({ token_id }) => (token_id === `nep141:${USDC}` ? "900000000" : "0") });
  fc.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const step = u(150);
  const quote = { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({
    quoteRequest: { dry: false, originAsset: `nep141:${USDC}`, destinationAsset: `nep141:${USDC}`, recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS", refundTo: POCKET, refundType: "CONFIDENTIAL_INTENTS", depositType: "ORIGIN_CHAIN", deadline: soon },
    quote: { depositAddress: DEPOSIT, amountIn: step, minAmountOut: step, amountOut: step, deadline: soon },
  }) };
  const move = [{ recipient: SOLW, own: true, units: u(8.39), payUnits: "0" }, { recipient: FLOAT, own: true, units: "0", payUnits: u(101.48) }];
  const leg: PrivateLegRecord = { tokenId: `nep141:${USDC}`, payUnits: u(101.48), recipient: FLOAT, own: true, move, ...(others ? { others } : {}) };
  const signer = new DevSigner({ accountId: "alice.near", chain: fc, key, approve: async () => true, oneClick: async (a) => (a === DEPOSIT ? quote : null), quoteKey: TEST_QUOTE_KEY, privateLeg: async () => leg, ownWallets: async () => new Map([[POCKET, PRIVATE_POCKET], [SOLW, "your SOL wallet"], [FLOAT, TRADING_BALANCE]]) });
  const req = { receiverId: "intents.near", actions: [{ kind: "call", method: "ft_withdraw", args: { token: USDC, receiver_id: DEPOSIT, amount: step }, depositYocto: "1", gas: "30000000000000" }], why: "", from: "wallet", moveFill: true } as TxRequest;
  const before = JSON.stringify(req);
  const w = await signer.describe(req);
  assert.equal(JSON.stringify(req), before, "the request (what is signed) is never touched");
  return w;
}
const OWNER: OtherPart[] = [{ from: "hood", to: "sol", cents: "394" }, { from: "hood", to: "near", cents: "552" }];

test("C2 on the real core's sheet: the whole Move's title from the core's figures, every wallet once in the plan's order; a wallet part's rows said \"about\"; the Safe's figure and what is signed unchanged", async () => {
  const w = await sheet(OWNER);
  assert.equal(w.title, "Move $119.33 to your SOL and NEAR wallets");
  const seen = w.lines.indexOf("Anyone can see the Safe's part.");
  assert.deepEqual(w.lines.slice(0, seen + 1), [
    "Your SOL wallet gets · about $12.33",
    "Your NEAR wallet gets · about $107.00",
    "From your Safe · $150.00",
    "From your ETH (RH) wallet · about $9.46",
    "Private keeps the rest · about $40.13",
    "Fee · $0.00",
    "Face ID approves the Safe's part. Your ETH (RH) wallet and Private send on their own.",
    "Anyone can see the Safe's part.",
  ], w.lines.join(" | "));
  // control: the Safe's side only (no kept parts) is today's sheet, word for word; the amount the sheet binds is the same
  const safeOnly = await sheet(undefined);
  assert.equal(safeOnly.title, "Move $109.87 to your SOL and NEAR wallets");
  assert.deepEqual(safeOnly.lines.slice(0, 7), ["Your SOL wallet gets · $8.39", "Your NEAR wallet gets · $101.48", "From your Safe · $150.00", "Private keeps the rest · about $40.13", "Fee · $0.00", "Face ID approves the Safe's part. Private sends on its own.", "Anyone can see the Safe's part."]);
  assert.equal(w.amount, safeOnly.amount, "the bound amount never moves");
  assert.deepEqual(w.effects ?? null, safeOnly.effects ?? null);
});

test("C2: a kept part the core can't read as a place and a figure: the Safe's side only, never a guess", async () => {
  assert.equal((await sheet(OWNER)).title, "Move $119.33 to your SOL and NEAR wallets", "control: every part readable, the whole Move");
  for (const bad of [[{ from: "hood", to: "mars", cents: "394" }], [{ from: "hood", to: "sol", cents: "-1" }], [{ from: "hood", to: "sol", cents: "3.94" }]] as OtherPart[][]) {
    const w = await sheet([...OWNER, ...bad]);
    assert.equal(w.title, "Move $109.87 to your SOL and NEAR wallets", JSON.stringify(bad));
    assert.ok(!w.lines.some((l) => /ETH \(RH\)/.test(l)), w.lines.join(" | "));
  }
});
