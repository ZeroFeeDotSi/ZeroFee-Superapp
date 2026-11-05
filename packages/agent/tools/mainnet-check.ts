// Agent's mainnet proof, the reading half: what the account's own rules say about Agent, read on two nodes at one block.
// It holds no key and signs nothing; the operator runs every step in the app (packages/agent/PROOF.md) and this after each.
//
//   node packages/agent/tools/mainnet-check.ts <account>.near
//
// Each line it prints starts with RESULT. The last says PASS only when Agent's rules on the account stay inside the
// proof's caps (CAPS below), so a budget set up bigger than the proof needs reads as a failure, not a pass.
import { codeOf, RpcChain } from "../../core/src/chain.ts";
import { ACCOUNT_POLICY, policyVersion } from "../../core/src/known-contracts.ts";
import type { AgentView } from "../src/types.ts";

/** The most the proof's rules may allow, in the coin's smallest units: dust only. */
export const CAPS: Record<string, bigint> = {
  near: 50_000_000_000_000_000_000_000n, // 0.05 NEAR
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": 5_000_000n, // 5 USDC
};

/** The verdict on Agent's rules: every order's amount and every coin's day limit within CAPS. */
export function verdict(view: AgentView | null): { pass: boolean; lines: string[] } {
  if (!view) return { pass: false, lines: ["no Agent on this account yet (approve a plan in the app first)"] };
  const lines: string[] = [];
  let pass = true;
  const within = (coin: string, units: bigint, what: string) => {
    const cap = CAPS[coin];
    const ok = cap !== undefined && units <= cap;
    pass &&= ok;
    lines.push(`${ok ? "ok" : "OVER THE PROOF'S CAP"}: ${what} (${units} of ${coin}${cap === undefined ? ", a coin the proof doesn't use" : `, cap ${cap}`})`);
  };
  for (const o of view.orders) {
    const coin = o.payout === "Near" ? "near" : "Ft" in o.payout ? `nep141:${o.payout.Ft.token}` : o.payout.Ledger.token_id;
    const paid = o.slots.filter((s) => s.state === "Paid").length;
    within(coin, BigInt(o.amount), `order ${o.id} to ${o.to}: ${paid} of ${o.slots.length} paid`);
  }
  for (const c of view.budget.coins) within(c.coin, BigInt(c.per_day), `budget per day, converts up to ${c.convert_per_day}`);
  lines.push(`paused: ${view.paused}; agent key on this phone: ${view.keyOnThisPhone ?? "(not known here)"}`);
  return { pass, lines };
}

async function main(accountId: string) {
  const chain = new RpcChain("mainnet");
  const block = await chain.commonBlock();
  const [account, keys, raw] = await Promise.all([chain.account(accountId, block), chain.accessKeys(accountId, block), chain.view(accountId, "agent", {}, block).catch(() => null)]);
  if (!account) throw new Error(`${accountId} doesn't exist on mainnet`);
  console.log(`RESULT account contract version: ${policyVersion(codeOf(account))} (Agent needs 3 or later)`);
  const agentKey = keys.find((k) => k.permission.kind === "function-call" && k.permission.receiverId === accountId && k.permission.methods.join() === ACCOUNT_POLICY.agentMethods.join());
  console.log(`RESULT agent key: ${agentKey && agentKey.permission.kind === "function-call" ? `present, fee allowance left ${agentKey.permission.allowanceYocto ?? "unlimited"} yocto, calls only ${agentKey.permission.methods.join(", ")}` : "none"}`);
  const { pass, lines } = verdict(raw ? ({ ...(raw as object), keyOnThisPhone: undefined } as unknown as AgentView) : null);
  for (const line of lines) console.log(`RESULT ${line}`);
  console.log(`RESULT ${pass ? "PASS" : "FAIL"}: Agent's rules ${pass ? "stay inside" : "are not inside"} the proof's caps`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const accountId = process.argv[2];
  if (!accountId || !/^[a-z0-9._-]{2,64}$/.test(accountId)) {
    console.error("usage: node packages/agent/tools/mainnet-check.ts <account>.near");
    process.exit(2);
  }
  main(accountId).catch((e) => {
    console.error(`RESULT FAIL: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
