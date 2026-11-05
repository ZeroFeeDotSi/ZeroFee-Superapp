// UI-SIMPLICITY-RULES 3 and 6 (phone test, 2 Nov): a coin
// whose details can't be read is said plainly on the sheet's lines ("an amount of an unnamed coin"); its exact
// raw amount and its id move into the sheet's own disclosure, one tap down, never dropped. Two such coins on one sheet
// never blur: the second is "a second coin …", in the lines and the disclosure alike, across every step and group.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner } from "./dev-signer.ts";
import { INTENTS } from "./intents.ts";
import { Unnamed } from "./format.ts";
import { describeModuleCall } from "./account-modules.ts";
import { solWords } from "./sol/decode.ts";
import { heldRequests } from "./held.ts";
import type { SolDecoded } from "./sol/decode.ts";
import type { PlainWords, TxRequest } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";

const RAW = /nep141:|units of|\d{13,}/;

function setup() {
  const chain = new FakeChain("mainnet");
  const key = SoftwareKey.generate();
  chain.fund("alice.near", key.publicKey);
  chain.contract("intents.near", INTENTS.codeHashBase58, { mt_balance_of: () => "9".repeat(30) });
  const shown: PlainWords[] = [];
  // 1Click as recorded for an address it never gave out (its /status answers 404): hermetic, never the live service
  const signer = new DevSigner({ accountId: "alice.near", chain, key, approve: async (w) => (shown.push(w), true), oneClick: async () => null });
  return { signer, shown };
}
const mt = (to: string, token: string, amount: string) => ({ kind: "call" as const, method: "mt_transfer", args: { receiver_id: to, token_id: token, amount, approval: null }, depositYocto: "1", gas: "30000000000000" });
const req = (actions: TxRequest["actions"]): TxRequest => ({ receiverId: "intents.near", actions, why: "", from: "wallet" });

test("NEAR Intents: the line is plain, the warning stays, the exact amount and id are in the disclosure", async () => {
  const { signer } = setup();
  const w = await signer.describe(req([mt("bob.near", "nep141:nometa.near", "4906542056074766355140186")]));
  for (const l of [w.title, ...w.lines, ...w.warnings.map((x) => x.text)]) assert.doesNotMatch(l, RAW, l);
  assert.equal(w.title, "Send an amount of an unnamed coin to bob.near");
  assert.ok(w.warnings.some((x) => x.kind === "effect-unknown" && x.text.startsWith("The unnamed coin: its details didn't load")), "it still warns the coin can't be read");
  assert.deepEqual(w.details, [{ label: "The unnamed coin", lines: ["An unnamed coin: its id is nep141:nometa.near", "An unnamed coin: an amount ZeroFee can't read yet (4906542056074766355140186 units)"] }]);
});

test("two steps, two coins it can't name: one disclosure, each coin by the name its own line uses", async () => {
  const { signer } = setup();
  const w = await signer.describe(req([mt("bob.near", "nep141:one.near", "5"), mt("carol.near", "nep141:two.near", "7")]));
  assert.ok(w.lines.includes("Send an amount of an unnamed coin from your Safe to bob.near, on NEAR"), w.lines.join(" | "));
  assert.ok(w.lines.includes("Send an amount of a second unnamed coin from your Safe to carol.near, on NEAR"), w.lines.join(" | "));
  assert.deepEqual(w.details, [{
    label: "The unnamed coins",
    lines: [
      "An unnamed coin: its id is nep141:one.near",
      "An unnamed coin: an amount ZeroFee can't read yet (5 units)",
      "A second unnamed coin: its id is nep141:two.near",
      "A second unnamed coin: an amount ZeroFee can't read yet (7 units)",
    ],
  }]);
});

test("the Waiting screen keeps the disclosure: a held payment of a coin it can't name shows the same plain line, the exact amount one tap down", async () => {
  const chain = new FakeChain("mainnet");
  chain.fund("alice.near", SoftwareKey.generate().publicKey);
  chain.contract("intents.near", INTENTS.codeHashBase58, { mt_balance_of: () => "9".repeat(30) });
  const args = Buffer.from(JSON.stringify({ receiver_id: "bob.near", token_id: "nep141:nometa.near", amount: "4906542056074766355140186", approval: null })).toString("base64");
  const spend = { receiver_id: "intents.near", steps: [{ FunctionCall: { method_name: "mt_transfer", args, deposit: "1", gas: "30000000000000" } }] };
  (chain as any).views.set("alice.near waiting_requests", () => [{ id: "1", ready_at_ns: String(BigInt(Date.now() + 3_600_000) * 1_000_000n), needs_device: false, change: { Spend: spend } }]);
  const [held] = await heldRequests(chain, "alice.near");
  for (const l of [held!.title, ...held!.lines]) assert.doesNotMatch(l, RAW, l);
  assert.equal(held!.title, "Send an amount of an unnamed coin to bob.near");
  assert.deepEqual(held!.details, [{ label: "The unnamed coin", lines: ["An unnamed coin: its id is nep141:nometa.near", "An unnamed coin: an amount ZeroFee can't read yet (4906542056074766355140186 units)"] }]);
});

test("the same coin twice is one coin; the same amount twice is one label; a different amount gets its own", () => {
  const u = new Unnamed();
  assert.equal(u.amount("9", "x"), "an amount of an unnamed coin");
  assert.equal(u.amount("9", "x"), "an amount of an unnamed coin");
  assert.equal(u.amount("10", "x"), "amount 2 of an unnamed coin");
  assert.equal(u.the("y"), "the second unnamed coin");
  assert.equal(u.amount("1", undefined), "an amount of a third unnamed coin");
  assert.deepEqual(u.details()[0]!.lines, [
    "An unnamed coin: its id is x",
    "An unnamed coin: an amount ZeroFee can't read yet (9 units)",
    "An unnamed coin, amount 2: an amount ZeroFee can't read yet (10 units)",
    "A second unnamed coin: its id is y",
    "A third unnamed coin: the transaction doesn't say which coin",
    "A third unnamed coin: an amount ZeroFee can't read yet (1 units)",
  ]);
  assert.deepEqual(new Unnamed().details(), [], "every coin named: no disclosure");
  assert.deepEqual(new Unnamed().withDetails({ title: "t" }), { title: "t" });
});

test("Agent's budget in a coin it can't name: plain on the line, exact in the disclosure", () => {
  const u = new Unnamed();
  const args = { budget: { coins: [{ coin: "nep141:odd.near", per_day: "1000000000000000000", per_month: "30000000000000000000", convert_per_day: "0" }], recipients: ["bob.near"], max_spends_per_day: 3, ends_at_ns: "1800000000000000000" } };
  const d = describeModuleCall({ kind: "call", method: "agent_set_budget", args: new TextEncoder().encode(JSON.stringify(args)), gas: 0n, depositYocto: 0n } as any, { signerId: "alice.near", receiverId: "alice.near", actions: [] } as any, { account: true, coins: new Map(), legacy: null, agent: null } as any, u);
  assert.ok(d, "described");
  for (const l of [d!.title, ...d!.lines]) assert.doesNotMatch(l, RAW, l);
  assert.ok(d!.lines.some((l) => l.includes("up to an amount of an unnamed coin in 24 hours and amount 2 of an unnamed coin a month")), d!.lines.join(" | "));
  const shown = u.details().flatMap((x) => x.lines);
  assert.ok(shown.includes("An unnamed coin: its id is nep141:odd.near"), shown.join(" | "));
  assert.ok(shown.includes("An unnamed coin: an amount ZeroFee can't read yet (1000000000000000000 units)"));
  assert.ok(shown.includes("An unnamed coin, amount 2: an amount ZeroFee can't read yet (30000000000000000000 units)"));
});

test("Solana: a token move with no name says so; the mint in full and the raw amount are in the disclosure", () => {
  const MINT = "86sfVDuuHuNNDdJJsxqbmFnJ9zYPE5arPUcHx7A2pump";
  const d = { swaps: [], transfers: [], tokenMoves: [{ kind: "transfer", account: "Acc1111111111111111111111111111111111111111", to: "Dst1111111111111111111111111111111111111111", mint: MINT, amount: "123456789012345" }], stakeHandovers: [], unreadTokenSteps: 0, closedTo: [], closes: [], unreadSteps: [], unknownPrograms: [], networkFeeLamports: "5000", feePayer: "Acc1111111111111111111111111111111111111111" } as unknown as SolDecoded;
  const w = solWords(d);
  for (const l of [w.title, ...w.lines]) assert.doesNotMatch(l, RAW, l);
  assert.ok(w.lines[0]!.startsWith("Sends an amount of an unnamed coin from "), w.lines[0]);
  assert.deepEqual(w.details, [{ label: "The unnamed coin", lines: [`An unnamed coin: its id is ${MINT}`, "An unnamed coin: an amount ZeroFee can't read yet (123456789012345 units)"] }]);
});

test("security review 2 Nov (High 3): three sends of one coin, a million and two fives, each line maps to one exact figure", async () => {
  const { signer } = setup();
  const w = await signer.describe(req([mt("attacker.near", "nep141:x.near", "1000000"), mt("friend.near", "nep141:x.near", "5"), mt("friend2.near", "nep141:x.near", "5")]));
  assert.ok(w.lines.includes("Send an amount of an unnamed coin from your Safe to attacker.near, on NEAR"), w.lines.join(" | "));
  assert.ok(w.lines.includes("Send amount 2 of an unnamed coin from your Safe to friend.near, on NEAR"));
  assert.ok(w.lines.includes("Send amount 2 of an unnamed coin from your Safe to friend2.near, on NEAR"));
  assert.deepEqual(w.details![0]!.lines, [
    "An unnamed coin: its id is nep141:x.near",
    "An unnamed coin: an amount ZeroFee can't read yet (1000000 units)",
    "An unnamed coin, amount 2: an amount ZeroFee can't read yet (5 units)",
  ]);
});

test("security review 2 Nov (Medium 4): an id dressed as ZeroFee's own words is quoted and marked, never read as a line of ours", () => {
  const u = new Unnamed();
  u.amount("7", "nep141:x.near  An unnamed coin: an amount ZeroFee can't read yet (1 units)");
  const lines = u.details()[0]!.lines;
  assert.equal(lines[0], "An unnamed coin: its id is written strangely, and can't be shown as it is: nep141:x.near??An?unnamed?coin:?an?amount?ZeroFee?can?t?read?yet??1?units?");
  assert.equal(lines[1], "An unnamed coin: an amount ZeroFee can't read yet (7 units)");
  // Look-alike quotes can't fence a sentence either (re-review, Low).
  const curly = new Unnamed();
  curly.coin("x” An unnamed coin: an amount ZeroFee can't read yet (1 units) “");
  assert.doesNotMatch(curly.details()[0]!.lines[0]!, / An unnamed coin|[“”]/);
  // An empty id is odd, not "no coin given"; a missing one is.
  const empty = new Unnamed();
  empty.coin("");
  empty.coin(undefined);
  assert.deepEqual(empty.details()[0]!.lines, ["An unnamed coin: its id is written strangely, and can't be shown as it is: (empty)", "A second unnamed coin: the transaction doesn't say which coin"]);
  assert.equal(new Unnamed().coin("0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eB48"), "an unnamed coin");
});
