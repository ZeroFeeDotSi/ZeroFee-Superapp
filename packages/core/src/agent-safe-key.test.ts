// QA (5 Nov): with AgentZero's own wallet on, no agent_pay key goes on the Safe's account and none is sealed
// to a computer: agent_set, a looser budget, a standing order, a resume and pairing are refused by name before any sheet
// or chain call. Controls: wallet off, each goes on as before; with the wallet on, the narrowing doors still run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentCall, PAIR_WALLET_OFF_LINE, type AgentCtx } from "./agent-door.ts";
import { AGENT_PAY_OFF_LINE } from "./agent-private.ts";

const ctx = (walletOn: boolean) => {
  const calls: string[] = [];
  const c = {
    subwallets: { agentKit: () => ({ o: { agentWallet: { on: walletOn } } }) },
    nativeSheet: async () => true,
    chain: { commonBlock: async () => ({ height: 1, hash: "h" }), view: async () => null, accessKeys: async () => [] },
    vault: { get: async () => null, put: async () => undefined, delete: async () => undefined },
    noteMine: () => undefined,
    stopped: () => false,
    modulesSigner: async () => ({ accountId: "zf-aaaaaaaaaa.near", run: async (_a: string, acts: { method?: string }[]) => (calls.push(acts.map((a) => a.method ?? "?").join()), { status: "done" }) }),
  } as unknown as AgentCtx;
  return { c, calls };
};
const budget = { coins: [{ coin: "nep141:usdc", per_day: "20000000", per_month: "600000000", convert_per_day: "0" }], recipients: [], ends_at_ns: "1", max_spends_per_day: 5 };
const refusal = async (p: Promise<unknown>) => p.then(() => null, (e: { problem?: { code: string; more?: string; whatHappened: string } }) => e.problem ?? null);

test("wallet on: set, a looser budget, an order and a resume are refused by name; nothing is signed", async () => {
  const { c, calls } = ctx(true);
  for (const [m, p] of [["account.agent.set", { budget, orders: [] }], ["account.agent.setBudget", { budget }], ["account.agent.addOrder", { plan: {} }], ["account.agent.resume", {}]] as const) {
    const r = await refusal(agentCall(c, m, p as Record<string, unknown>));
    assert.equal(r?.code, "security.request.not-allowed", m);
    assert.equal(r?.more ?? r?.whatHappened, AGENT_PAY_OFF_LINE, m);
  }
  assert.deepEqual(calls, [], "no agent_set, agent_set_budget, agent_add_order or agent_resume went out");
});

test("wallet on: pairing a computer seals no Safe key (refused by name)", async () => {
  const { c } = ctx(true);
  const r = await refusal(agentCall(c, "account.agent.pairComputer", { offer: "zf-pair:2:x" }));
  assert.equal(r?.more ?? r?.whatHappened, PAIR_WALLET_OFF_LINE);
});

test("control: wallet on, the narrowing doors still run (Stop, pause, remove an order)", async () => {
  const { c, calls } = ctx(true);
  await agentCall(c, "account.agent.revoke", {});
  await agentCall(c, "account.agent.pause", {});
  await agentCall(c, "account.agent.removeOrder", { id: "1" });
  assert.deepEqual(calls, ["agent_revoke", "agent_pause", "agent_remove_order"]);
});

test("control: wallet off, set and a budget go to the account as before", async () => {
  const { c, calls } = ctx(false);
  await agentCall(c, "account.agent.set", { budget, orders: [] });
  await agentCall(c, "account.agent.setBudget", { budget });
  assert.deepEqual(calls, ["agent_set", "agent_set_budget"]);
});
