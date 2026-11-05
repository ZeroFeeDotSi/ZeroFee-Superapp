// One trade service for the Extension app, over the app's own bridge: the laptop wallet is a separate wallet of kind
// "extension" (subwallet.*), held by the trusted core once it is linked. Adding money is Wallet's ledger.withdraw to its
// address; bringing the SOL back is Trade's withdraw, signed by the core. Network reads run only while the app is on
// screen (useShell().active). In ?demo, sample addresses get Trade's demo engine, so nothing real is touched.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { createDemoEngine, isSampleAddress } from "@zerofee/trade/demo-engine.ts";
import { createMarket } from "@zerofee/trade/market/index.ts";
import type { Market } from "@zerofee/trade/market/types.ts";
import { createTradeService, type TradeService } from "@zerofee/trade/service.ts";
import { createSolChain } from "@zerofee/trade/sol/chain.ts";
import { createSolRpc } from "@zerofee/trade/sol/rpc.ts";

interface Runtime { svc: TradeService; market: Market; tick: number; active: boolean }
const Ctx = createContext<Runtime | null>(null);

export function ExtensionProvider({ bridge, active, children }: { bridge: Bridge; active: boolean; children: ReactNode }) {
  const [tick, setTick] = useState(0);
  const rt = useMemo(() => {
    const rpc = createSolRpc(), market = createMarket();
    const svc = createTradeService({
      bridge, walletKind: "extension", chains: ["sol"],
      nativeUsd: (chain) => market.nativeUsd(chain),
      meta: (chain, coin) => market.meta(chain, coin),
      engineFor: (chain, owner) => {
        if (isSampleAddress(owner)) return createDemoEngine({ chain, owner, nativeUsd: () => market.nativeUsd(chain), meta: (coin) => market.meta(chain, coin) });
        if (chain !== "sol") throw new Error("the laptop wallet is a Solana wallet");
        return createSolChain({ rpc, owner, solUsd: () => market.nativeUsd("sol"), meta: (mint) => market.meta("sol", mint) });
      },
    });
    return { svc, market };
  }, [bridge]);
  useEffect(() => rt.svc.on(() => setTick((n) => n + 1)), [rt]);
  return <Ctx.Provider value={{ ...rt, tick, active }}>{children}</Ctx.Provider>;
}

export function useExt(): Runtime {
  const rt = useContext(Ctx);
  if (!rt) throw new Error("useExt() is only available inside <ExtensionProvider>");
  return rt;
}

/** Re-runs `load` when the service changes or `deps` change, only while the app is on screen. */
export function useLive<T>(load: () => Promise<T>, deps: unknown[]): { value?: T; error?: unknown; reload: () => void } {
  const { tick, active } = useExt();
  const [state, setState] = useState<{ value?: T; error?: unknown }>({});
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    load().then((value) => { if (live) setState({ value }); }, (error) => { if (live) setState((s) => ({ ...s, error })); });
    return () => { live = false; };
  }, [tick, n, active, ...deps]);
  return { ...state, reload: () => setN((x) => x + 1) };
}
