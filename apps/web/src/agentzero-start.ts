// AgentZero pays a Chat request (AZ2 job 3, "Pay my list in Chat"): the shell's payer, set once on the agent app's own
// bridge. core.ts loads this module after the first screen, and the engine itself loads on first use, so Home's first
// load carries neither; Chat, which loads later, finds the payer set.
import type { Bridge } from "@zerofee/core/bridge";
import { lazyAgentZeroPayer, setAgentZeroPayer } from "@zerofee/shell-api/agentzero-pay.ts";

export function startAgentZeroPayer(agentBridge: Bridge): void {
  setAgentZeroPayer(lazyAgentZeroPayer(() => import("@zerofee/agent/zero/engine").then((m) => m.zeroEngine(agentBridge))));
}
