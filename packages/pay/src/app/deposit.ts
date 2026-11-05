// The person's own address for USDC on one chain (the ledger's deposit address), for the partner hand-off screens.
// Receiving is blocked until the backup words are confirmed (security.backup.needed): that Problem is passed on.
import { useEffect, useRef, useState } from "react";
import type { Problem } from "@zerofee/core/problem";
import { usePay } from "./runtime.tsx";

export function useDepositAddress(chain: string, enabled: boolean, onProblem: (p: Problem) => void): string | null {
  const { bridge, flow, ready } = usePay();
  const [address, setAddress] = useState<string | null>(null);
  const usdc = ready ? flow.tokens?.find(chain, { symbol: "USDC" }) : undefined;
  const report = useRef(onProblem);
  report.current = onProblem;
  useEffect(() => {
    if (!enabled || !usdc) return;
    let live = true;
    void bridge.call<{ address: string }>("ledger.depositAddress", { chain, token: usdc.assetId }).then((r) => {
      if (!live) return;
      if ("ok" in r) setAddress(r.ok.address);
      else report.current(r.problem);
    });
    return () => {
      live = false;
    };
  }, [bridge, chain, enabled, usdc, report]);
  return address;
}
