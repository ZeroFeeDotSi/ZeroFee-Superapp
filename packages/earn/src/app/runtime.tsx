// One Earn service per bridge, shared by every Earn screen. For a real account it reads NEAR itself (two nodes, the
// account's own network); for MockBridge's sample account (?demo) it runs on the sample NEAR in demo.ts. The NEAR price
// for dollar forecasts comes from Wallet's ledger.tokens; without one, forecasts are in NEAR.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { RpcChain } from "@zerofee/core/chain";
import type { AccountInfo, Network } from "@zerofee/core/signer";
import { RpcNetwork } from "../network.ts";
import { createEarnService } from "../staking.ts";
import { isSampleAccount, sampleEarn } from "./demo.ts";

interface Runtime {
  /** The Earn service: earn.* answered here, everything else (tx.*, device.*) passes through to the shell's bridge. */
  earn: Bridge | null;
  network: Network | null;
  priceUsd?: number;
  /** Changes whenever something Earn shows may have moved (a stake, an unstake, coming back to the app). */
  tick: number;
  refresh: () => void;
  active: boolean;
  /** Why Earn couldn't start (no account yet, or the core said no), as the core's own Problem. */
  startProblem: BridgeResult<unknown> | null;
}

const Ctx = createContext<Runtime | null>(null);

export function EarnProvider({ bridge, active, children }: { bridge: Bridge; active: boolean; children: ReactNode }) {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [startProblem, setStartProblem] = useState<BridgeResult<unknown> | null>(null);
  const [priceUsd, setPriceUsd] = useState<number | undefined>(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active || account) return;
    let live = true;
    bridge.call<{ stage: string; account?: AccountInfo }>("account.state").then((r) => {
      if (!live) return;
      if ("problem" in r) setStartProblem(r);
      else if (r.ok.account) setAccount(r.ok.account);
    });
    bridge.call<{ assetId: string; priceUsd?: string }[]>("ledger.tokens").then((r) => {
      if (!live || !("ok" in r) || !Array.isArray(r.ok)) return;
      const p = Number(r.ok.find((t) => t.assetId === "nep141:wrap.near")?.priceUsd);
      if (Number.isFinite(p) && p > 0) setPriceUsd(p);
    });
    return () => {
      live = false;
    };
  }, [bridge, active, account]);

  const earn = useMemo(() => {
    if (!account) return null;
    if (isSampleAccount(account.accountId)) return sampleEarn(bridge, account.accountId);
    return createEarnService({ bridge, chain: new RpcChain(account.network), network: new RpcNetwork(account.network) });
  }, [bridge, account]);

  // Coming back to Earn reads everything again (fees are re-read on every visit).
  useEffect(() => {
    if (active) setTick((n) => n + 1);
  }, [active]);

  const value: Runtime = { earn, network: account?.network ?? null, priceUsd, tick, refresh: () => setTick((n) => n + 1), active, startProblem };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEarn(): Runtime {
  const rt = useContext(Ctx);
  if (!rt) throw new Error("useEarn() is only available inside <EarnProvider>");
  return rt;
}

/**
 * Calls `method` whenever Earn changes or comes back on screen, only while it's on screen and `enabled`; keeps the last
 * answer meanwhile.
 */
export function useEarnCall<T>(method: string, params?: Record<string, unknown>, deps: unknown[] = [], enabled = true): { value?: T; problem?: BridgeResult<T> & { problem: unknown }; loading: boolean } {
  const { earn, tick, active } = useEarn();
  const [state, setState] = useState<{ value?: T; problem?: BridgeResult<T> & { problem: unknown }; loading: boolean }>({ loading: true });
  useEffect(() => {
    if (!active || !earn || !enabled) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    earn.call<T>(method, params).then((r) => {
      if (!live) return;
      setState("problem" in r ? { problem: r as BridgeResult<T> & { problem: unknown }, loading: false } : { value: r.ok, loading: false });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earn, tick, active, enabled, method, ...deps]);
  return state;
}
