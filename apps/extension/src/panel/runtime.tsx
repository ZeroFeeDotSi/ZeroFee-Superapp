// The panel's one link to the vault, one market and one trade service. Trade's createTradeService and Solana engine run
// here unchanged, on the extension's own wallet (walletKind "extension"), through the bridge in bridge.ts.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { BridgeResult } from "@zerofee/core/bridge";
import { createMarket } from "@zerofee/trade/market/index.ts";
import type { Market } from "@zerofee/trade/market/types.ts";
import { createTradeService, type TradeService, type TradeServiceDeps } from "@zerofee/trade/service.ts";
import { createSolChain } from "@zerofee/trade/sol/chain.ts";
import { createSolRpc, type SolRpc } from "@zerofee/trade/sol/rpc.ts";
import type { PanelMessage } from "../messages.ts";
import { extProblems } from "../problems.ts";
import type { Store } from "../vault/vault.ts";
import { extensionBridge } from "./bridge.ts";
import { sendWaking } from "./wake.ts";
import { pageIsTab } from "./in-tab.ts";

/** One question to the vault in the background worker. Never throws: a worker that didn't answer is a Problem; a panel
 *  opened as a tab of its own says so (5 Nov: it said "the extension stopped partway" there). */
export async function ask<T>(m: PanelMessage): Promise<BridgeResult<T>> {
  if (await pageIsTab()) return { problem: extProblems.inTab() };
  const r = await sendWaking(() => chrome.runtime.sendMessage<BridgeResult<T> | undefined>(m));
  return r ?? { problem: extProblems.stopped() };
}

export const local: Store = {
  async get<T>(k: string) { return (await chrome.storage.local.get(k))[k] as T | undefined; },
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
  remove: (k) => chrome.storage.local.remove(k),
};

interface Runtime { svc: TradeService; market: Market; rpc: SolRpc; bridge: ReturnType<typeof extensionBridge>; tick: number }
const Ctx = createContext<Runtime | null>(null);

/** `stand-ins` replace the network for the preview pages (src/preview), never in the extension. */
export interface StandIns { rpc: SolRpc; market: Market; engineFor: TradeServiceDeps["engineFor"] }

export function PanelProvider({ children, standIns }: { children: ReactNode; standIns?: StandIns }) {
  const [tick, setTick] = useState(0);
  const rt = useMemo(() => {
    const rpc = standIns?.rpc ?? createSolRpc(), market = standIns?.market ?? createMarket(), bridge = extensionBridge({ ask, store: local });
    const svc = createTradeService({
      bridge, walletKind: "extension", chains: ["sol"],
      nativeUsd: (chain) => market.nativeUsd(chain),
      meta: (chain, coin) => market.meta(chain, coin),
      engineFor: standIns?.engineFor ?? ((chain, owner) => {
        if (chain !== "sol") throw new Error("the panel trades Solana coins");
        return createSolChain({ rpc, owner, solUsd: () => market.nativeUsd("sol"), meta: (mint) => market.meta("sol", mint) });
      }),
    });
    return { svc, market, rpc, bridge };
  }, []);
  useEffect(() => rt.svc.on(() => setTick((n) => n + 1)), [rt]);
  useEffect(() => { void rt.svc.resume().catch(() => undefined); }, [rt]);
  return <Ctx.Provider value={{ ...rt, tick }}>{children}</Ctx.Provider>;
}

export function usePanel(): Runtime {
  const rt = useContext(Ctx);
  if (!rt) throw new Error("usePanel() is only available inside <PanelProvider>");
  return rt;
}

/** Re-runs `load` whenever the service changes (a trade landed) or `deps` change. */
export function useLive<T>(load: () => Promise<T>, deps: unknown[]): { value?: T; error?: unknown; reload: () => void } {
  const { tick } = usePanel();
  const [state, setState] = useState<{ value?: T; error?: unknown }>({});
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    load().then((value) => { if (live) setState({ value }); }, (error) => { if (live) setState((s) => ({ ...s, error })); });
    return () => { live = false; };
  }, [tick, n, ...deps]);
  return { ...state, reload: () => setN((x) => x + 1) };
}
