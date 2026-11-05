// React hook over mailbox(bridge) for UI's AgentZero app (D122): one mailbox per bridge, its list loaded on mount.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { mailbox, type InboxItem } from "./mailbox.ts";

export function useMailbox(bridge: Bridge) {
  const box = useMemo(() => mailbox(bridge), [bridge]);
  const [address, setAddress] = useState<string | null>(null);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [line, setLine] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const [a, l] = await Promise.all([box.address(), box.list()]);
    if (a.ok) setAddress(a.value);
    if (l.ok) {
      setItems(l.value.items);
      setLine(null);
    } else setLine(l.line);
  }, [box]);
  useEffect(() => void refresh(), [refresh]);
  return { address, items, line, refresh, read: box.read, draft: box.draft, send: box.send };
}
