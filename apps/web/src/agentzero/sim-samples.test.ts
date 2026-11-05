// AgentZero in the Sim answers its three suggestions with sample answers made in the page (a web test: every
// suggestion answered "AgentZero's free reading refused that"; the prepaid rule means the Sim's AgentZero, with $0, is
// refused by the relay). No fetch, each answer says it is a sample, the balance is the Sim's own total, anything typed
// gets the one line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { readBalanceTotal } from "@zerofee/wallet/app/BalanceTotal.ts";
import { dollars } from "@zerofee/wallet/app/format.ts";
import { SIM_ANSWERS, SIM_ONLY_STARTERS, SIM_SAMPLE_TAG, SIM_STARTERS, simReply, starterOf } from "./sim-chat.ts";

const textOf = (parts: Awaited<ReturnType<typeof simReply>>) => parts.map((p) => (p.type === "text" ? p.text : "")).join("\n");

test("each suggestion gets its sample answer, tagged, with no network call; control: a typed question gets the one line", async () => {
  const g = globalThis as { fetch: typeof fetch };
  const real = g.fetch;
  const asked: string[] = [];
  g.fetch = (async (u: unknown) => { asked.push(String(u)); throw new Error("the Sim's AgentZero reached the network"); }) as typeof fetch;
  try {
    for (const s of SIM_STARTERS) {
      const t = textOf(await simReply(s, async () => "5460.55"));
      assert.ok(t.startsWith(`*${SIM_SAMPLE_TAG}*\n\n`), s);
      assert.ok(!t.includes("refused") && !t.includes("{total}"), t);
      assert.ok(SIM_ANSWERS[s].filter((l) => !l.includes("{total}")).every((l) => t.includes(l)), s);
    }
    const typed = await simReply("How do I buy bitcoin?", async () => "1");
    assert.deepEqual(typed, [{ type: "text", text: SIM_ONLY_STARTERS }]);
    assert.deepEqual(asked, [], "no fetch");
    // control: the spy is live
    await g.fetch("https://example.invalid/").catch(() => undefined);
    assert.deepEqual(asked, ["https://example.invalid/"]);
  } finally {
    g.fetch = real;
  }
  // a suggestion typed by hand (case, no "?", a curly apostrophe) is the suggestion; a longer question isn't
  assert.equal(starterOf("what’s my balance"), "What's my balance?");
  assert.equal(starterOf("  WHAT CAN YOU DO  "), "What can you do?");
  assert.equal(starterOf("What can you do with my money?"), null);
  // no Face ID, no "Hidden", no "payee" in the Sim's words
  for (const l of [...Object.values(SIM_ANSWERS).flat(), SIM_ONLY_STARTERS, SIM_SAMPLE_TAG]) assert.doesNotMatch(l, /Face ID|Hidden|payee/, l);
});

test("the balance answer shows the Sim's own total (Home's sum) as a read figure, and follows a send; control: no total, no figure", async () => {
  const mock = createMockBridge({ latencyMs: 0, tradeChains: ["sol", "hood"], hiddenStart: { usdc: "25", near: "2" }, freshHistory: true, mainnetRules: {}, account: { accountId: "zf-account", network: "mainnet" } });
  mock.on<{ id: string }>("approval.needed", (p) => void mock.call("approval.answer", { id: p.id, approve: true }));
  assert.ok("ok" in (await mock.call("account.create", { recoveryDelaySeconds: 172_800 })));
  const before = await readBalanceTotal(mock);
  assert.ok(before !== null && Number(before) > 0);
  const p = (await simReply("What's my balance?", () => readBalanceTotal(mock)))[0]!;
  assert.ok(p.type === "text" && p.facts);
  assert.match(p.text, /You have \{\{f1\}\} in all\./);
  assert.equal(p.facts.f1!.shown, dollars(before));
  // the Sim's money moves: the next answer says the new total
  const sent = await mock.call("ledger.transfer", { amount: "10", toAccountId: "sam.near", tokenId: "nep141:wrap.near" });
  assert.ok("ok" in sent, JSON.stringify(sent));
  await new Promise((r) => setTimeout(r, 60));
  const after = await readBalanceTotal(mock);
  assert.ok(after !== null && after !== before, `${before} -> ${after}`);
  const again = (await simReply("What's my balance?", () => readBalanceTotal(mock)))[0]!;
  assert.ok(again.type === "text" && again.facts?.f1?.shown === dollars(after));
  // control: a total that can't be read gives no figure at all (never a made-up one)
  const none = (await simReply("What's my balance?", async () => null))[0]!;
  assert.ok(none.type === "text" && !none.facts && !/\{|\$/.test(none.text), none.type === "text" ? none.text : "");
});
