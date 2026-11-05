// The Safe's Face ID band (account.protection.get, the core's own: faceIdBandUsd), read once for a money sheet that must
// say, before the tap, exactly what the core will send (audit H1: the inflow grid; core spending.ts safeSends). Not read
// (yet, or a read that failed): undefined, and the sheet promises nothing it depends on.
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { faceIdBandUsd } from "@zerofee/core/spending";

export function useFaceIdBand(bridge: Bridge): number | null | undefined {
  const [band, setBand] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void bridge.call<{ usd?: { upToUsd: number | null; level: string }[] | null }>("account.protection.get", {}).then((r) => {
      if (live && "ok" in r) setBand(r.ok?.usd ? faceIdBandUsd(r.ok.usd) : null);
    }, () => undefined);
    return () => { live = false; };
  }, [bridge]);
  return band;
}
