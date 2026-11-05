import { test } from "node:test";
import assert from "node:assert/strict";
import { meterLine, thinkingLine } from "./use-chat-turn.ts";

test("read_meter says jobs' pocket money off as off, never as AgentZero off (QA 4 Nov: \"nothing has been charged… AgentZero is off\" beside a $0.030 meter), and where to turn it on (the menu, top left); control: a set limit reads what's left", () => {
  assert.equal(meterLine(null), "AgentZero's wallet for jobs (not its thinking): off. The person funds it in the menu, top left, under Jobs and limits.");
  assert.doesNotMatch(meterLine(null), /AgentZero is off/);
  assert.equal(meterLine({ limitUsd: 0, spentUsd: 0 }), meterLine(null));
  assert.equal(meterLine({ limitUsd: 20, spentUsd: 5 }), "AgentZero's wallet for jobs (not its thinking): $15.00 of $20.00 left. Never say it as a price per day.");
  assert.equal(meterLine({ limitUsd: 20, spentUsd: 25 }), "AgentZero's wallet for jobs (not its thinking): $0.00 of $20.00 left. Never say it as a price per day.");
});

test("D37: read_meter carries the true thinking meter first (QA 5 Nov: \"What did my last message cost?\" got no figure): the last message's own cost, today's cost and paid, what the wallet holds; control: none given, jobs only", () => {
  const t = thinkingLine({ usedUsd: 0.045, paidUsd: 0.02, owedUsd: 0.025, walletUsd: 4.955, lastUsd: 0.012 });
  assert.equal(t, "The person's last message cost $0.012 (Claude's price, nothing added). AgentZero's thinking today (each reply paid from AgentZero's own wallet): cost $0.045, paid $0.020, still to pay $0.025. Its wallet holds $4.955. Say these figures as they are. A question about what a message or this chat cost is answered with them, never by naming a screen.");
  assert.equal(meterLine(null, t), `${t}\n${meterLine(null)}`, "the thinking first, the jobs' pocket money after");
  assert.doesNotMatch(thinkingLine({ usedUsd: 0, paidUsd: 0, owedUsd: 0, walletUsd: 1, lastUsd: null }), /last message/, "control: no reply yet, no last figure");
  assert.match(thinkingLine({ usedUsd: 0, paidUsd: 0, owedUsd: 0, walletUsd: null }), /cost \$0\.000.*can't be read right now/);
  assert.equal(meterLine({ limitUsd: 20, spentUsd: 5 }, null), "AgentZero's wallet for jobs (not its thinking): $15.00 of $20.00 left. Never say it as a price per day.");
});
