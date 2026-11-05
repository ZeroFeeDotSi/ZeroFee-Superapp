// Activity's last line on a device the account was moved to (A12): where the earlier history is, one tap away (grade
// 02e, E8: "isn't on this device" while Security's Activity, read from the account, listed it all).
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { useShell } from "./AppFrame.tsx";
import { EARLIER_HISTORY, restoredHere } from "./earlier-history.ts";

export function EarlierHistory({ bridge }: { bridge: Bridge }) {
  const { openApp } = useShell();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let on = true;
    void restoredHere(bridge).then((v) => on && setShown(v));
    return () => {
      on = false;
    };
  }, [bridge]);
  return shown ? (
    <p className="zf-small" role="note" style={{ textAlign: "center", marginTop: 18 }}>
      {EARLIER_HISTORY} <button className="zf-link" onClick={() => openApp("security", "activity")}>See it</button>
    </p>
  ) : null;
}
