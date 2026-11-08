// FLOW-V5 §0's proof row for Send (V4 step 4, D111): every payee chain × Hidden, through the ledger the Send sheet uses.
// Hidden pays from the pocket through NEAR Intents' confidential path (CONFIDENTIAL_INTENTS in, DESTINATION_CHAIN out) to
// an address on SOL, ETH (RH), BNB, or a NEAR account; a coin only 1Click lists (BTC) is a corridor Hidden can't
// carry today, so the sheet says so in its own line and offers Plain (chat-private.ts hiddenCantLine). A NEAR-only path
// is never taken: a Solana address and an EVM address are paid as themselves, never refused for not being a NEAR name.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { createApis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";
import { cantSendYetLine, checksAddressOn, hiddenCantCarry, hiddenCantLine } from "./app/money/chat-private.ts";

const ME = "kid.near";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const POCKET = "a1".repeat(32);
const RELAY = "https://quotes.example";
const SERVER = `${RELAY}/v0`;

function setup() {
  const core = fakeCore({ accountId: ME, subwallets: [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }] });
  const fetch = replayFetch({ privateQuotes: SERVER });
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, { ledger: { [USDC]: "500000000" } }), apis: createApis(fetch), routes: { intents: false, nearOrigin: true }, trackMs: 5, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY });
  return { core, fetch, ledger };
}
const asked = (fetch: ReturnType<typeof replayFetch>) => fetch.calls.filter((c) => c.url === `${SERVER}/quote`).at(-1)?.body as Record<string, unknown> | undefined;
const hiddenQuote = (ledger: Bridge, toTokenId: string, to: Record<string, unknown>) => ledger.call<{ id: string; refundTo: string }>("ledger.quotePay", { fromTokenId: USDC, toTokenId, to, amountOut: "1", confidential: true, caller: "wallet" });

const SOL_ADDR = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const EVM_ADDR = "0x7d06e272b5305a4b9d40e872c7950d3437547e3d";
const CELLS = [
  { row: "SOL", toTokenId: "nep141:sol.omft.near", to: { kind: "chain", chain: "sol", address: SOL_ADDR }, recipient: SOL_ADDR, type: "DESTINATION_CHAIN" },
  { row: "Robinhood", toTokenId: "nep141:hood.omft.near", to: { kind: "chain", chain: "hood", address: EVM_ADDR }, recipient: EVM_ADDR, type: "DESTINATION_CHAIN" },
  { row: "BNB", toTokenId: "nep245:v2_1.omni.hot.tg:56_11111111111111111111", to: { kind: "chain", chain: "bsc", address: EVM_ADDR }, recipient: EVM_ADDR, type: "DESTINATION_CHAIN" },
  { row: "NEAR", toTokenId: USDC, to: { kind: "ledger", accountId: "bob.near" }, recipient: "bob.near", type: "INTENTS" },
] as const;

for (const cell of CELLS) {
  test(`proof row, Hidden out to ${cell.row}: quoted from the pocket, confidential in, paid out to the address as given`, async () => {
    const { ledger, fetch, core } = setup();
    const q = await hiddenQuote(ledger, cell.toTokenId, cell.to);
    assert.ok("ok" in q, `Hidden to ${cell.row}: ${"problem" in q ? q.problem.code : ""}`);
    assert.equal(q.ok.refundTo, POCKET, "refunds go back to your private balance, never to a public wallet");
    const a = asked(fetch)!;
    assert.deepEqual([a.depositType, a.refundType, a.recipient, a.recipientType, a.confidentiality, a.destinationAsset], ["CONFIDENTIAL_INTENTS", "CONFIDENTIAL_INTENTS", cell.recipient, cell.type, "basic", cell.toTokenId]);
    assert.ok(!JSON.stringify(a).includes(ME), "the quote never carries the person's own account");
    assert.equal(core.signed.length, 0, "a quote signs nothing");
  });
}

test("proof row, Hidden out to BTC (a coin only 1Click lists): refused before any sheet, and the Send sheet says ZeroFee can't send BTC yet", async () => {
  const { ledger, core } = setup();
  const q = await hiddenQuote(ledger, "nep141:btc.omft.near", { kind: "chain", chain: "btc", address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" });
  assert.ok("problem" in q, "Hidden can't carry BTC today");
  assert.equal(q.problem.code, "ledger.address.invalid");
  assert.equal(checksAddressOn("btc"), false, "no Bitcoin address check yet, so Plain can't send it either: no dead-end Plain offer (review M2)");
  assert.equal(cantSendYetLine("BTC"), "ZeroFee can't send BTC yet. Nothing moved.");
  assert.equal(checksAddressOn("sol") && checksAddressOn("hood") && checksAddressOn("bsc"), true, "control: a garbled SOL or EVM address is an address problem, not a can't-carry");
  assert.equal(hiddenCantCarry("ledger.address.invalid"), false, "a wrong address is never offered Plain");
  assert.equal(core.signed.length + core.privatePays.length, 0, "nothing signed, nothing sent in public");
});

test("a NEAR-only path is refused: a Solana and an EVM address are Hidden payees as themselves (control: a garbled one is not)", async () => {
  const { ledger } = setup();
  for (const to of [{ kind: "chain", chain: "sol", address: SOL_ADDR }, { kind: "chain", chain: "hood", address: EVM_ADDR }]) {
    const q = await hiddenQuote(ledger, to.chain === "sol" ? "nep141:sol.omft.near" : "nep141:hood.omft.near", to);
    assert.ok("ok" in q, `${to.chain} address accepted`);
  }
  const bad = await hiddenQuote(ledger, "nep141:sol.omft.near", { kind: "chain", chain: "sol", address: "bob.near" });
  assert.ok("problem" in bad && bad.problem.code === "ledger.address.invalid", "control: a NEAR name given as a Solana address is refused");
});

test("the can't-carry line: names the coin; never Private; a short Hidden is not a can't-carry (it stops, D85)", () => {
  assert.equal(hiddenCantLine("doge"), "Private can't send DOGE yet. Send it plain?");
  assert.equal(hiddenCantLine(undefined, "Bitcoin"), "Private can't send to Bitcoin yet. Send it plain?");
  assert.equal(hiddenCantLine("<b>x</b>"), "Private can't send this yet. Send it plain?", "a symbol from outside is never echoed raw");
  assert.equal(hiddenCantCarry("pay.private.short"), false, "short stops on the form, never offers Plain");
  assert.equal(hiddenCantCarry("ledger.private.unavailable"), false, "not set up: set it up, never a public send");
  assert.equal(hiddenCantCarry("pay.route.none"), true);
});
