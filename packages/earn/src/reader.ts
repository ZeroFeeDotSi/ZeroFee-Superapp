// Earn, read-only, for the shell: it answers earn.positions and nothing else, so Wallet's one balance can count staked
// NEAR (docs/interfaces.md). It reads Earn's own storage, so the shell gives it the Earn app's bridge, forApps(base, "earn").
// It can't ask for a signature or write anything: its bridge passes only account.state, device.store.get and
// account.waiting.status (so a held stake that ran since counts, settled in memory). It reads the
// account's own network on two nodes, or for MockBridge's sample account (?demo) the same sample NEAR the Earn app shows.
// Earn's own code (staking.ts, its nodes, the sample) loads with the first earn.positions, never in Home's first load
// (Home's JS budget, 5 Nov: ~20 KB of Earn sat there for one read Home makes after it paints).
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { RpcChain, type Chain } from "@zerofee/core/chain";
import type { AccountInfo, Network } from "@zerofee/core/signer";
import { securityProblems } from "@zerofee/core/security-problems";
import type { NetworkInfo } from "./network.ts";

const READS = new Set(["account.state", "device.store.get", "account.waiting.status"]);

/** The account's network on two nodes; tests pass a fake one. */
type Nodes = (network: Network) => { chain: Chain; network: NetworkInfo };
const rpcNodes = async (): Promise<Nodes> => {
  const { RpcNetwork } = await import("./network.ts");
  return (network) => ({ chain: new RpcChain(network), network: new RpcNetwork(network) });
};

export function createEarnReader(earnBridge: Bridge, nodes?: Nodes): Bridge {
  const unknown = <T>(method: string): Promise<BridgeResult<T>> => Promise.resolve({ problem: securityProblems.methodUnknown(method) });
  const readOnly: Bridge = {
    call: <T>(method: string, params?: Record<string, unknown>) => (READS.has(method) ? earnBridge.call<T>(method, params) : unknown<T>(method)),
    on: () => () => {},
  };
  // One service per account, made on the first call (the account can be created after the shell starts).
  // A load that failed (offline) is tried again on the next call, never kept.
  let service: { accountId: string; earn: Promise<Bridge> } | null = null;
  const serviceFor = (account: AccountInfo): Promise<Bridge> => {
    if (service?.accountId !== account.accountId) {
      const earn = (async () => {
        const { isSampleAccount, sampleEarn } = await import("./app/demo.ts");
        if (isSampleAccount(account.accountId)) return sampleEarn(earnBridge, account.accountId);
        const [{ createEarnService }, on] = await Promise.all([import("./staking.ts"), nodes ?? rpcNodes()]);
        return createEarnService({ bridge: readOnly, ...on(account.network) });
      })();
      const mine = { accountId: account.accountId, earn };
      earn.catch(() => { if (service === mine) service = null; });
      service = mine;
    }
    return service.earn;
  };

  return {
    async call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
      if (method !== "earn.positions") return unknown<T>(method);
      const state = await earnBridge.call<{ account?: AccountInfo }>("account.state");
      if ("problem" in state) return state;
      if (!state.ok.account) return { ok: [] as T };
      return (await serviceFor(state.ok.account)).call<T>(method, params);
    },
    on: () => () => {},
  };
}
