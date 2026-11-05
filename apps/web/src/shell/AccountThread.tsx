// The one thread on Home (Job 1): the account's facts read from the core, kept on this device so the bar paints at once
// from what was last known (never a spinner, never a guess), and read again whenever the account changes. The bar shows
// while a step is open and leaves once all five are done; tapping it opens the next step.
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { FundView } from "@zerofee/core/fund-start";
import type { AccountInfo } from "@zerofee/core/signer";
import { ThreadBar } from "@zerofee/design/Thread.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { readProtection, useKnown } from "../apps/security/known.ts";
import { readVault } from "../vault-gate.ts";
import { threadOf, threadShows, type ThreadFacts, type ThreadKey } from "./thread.ts";

const KEY = "zf.thread";
type Kept = Omit<ThreadFacts, "fund" | "protection"> & { accountId: string };

function kept(accountId: string): Kept | null {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "null") as Kept | null;
    return v && v.accountId === accountId ? v : null;
  } catch {
    return null;
  }
}
function keep(v: Kept): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(v));
  } catch {
    // storage blocked: read again next time
  }
}

/** `onOpen`: the next step's one screen (the shell decides where each lives). */
export function AccountThread({ account, bridge, onOpen }: { account: AccountInfo; bridge: Bridge; onOpen: (step: Exclude<ThreadKey, "done">) => void }) {
  const shell = useShell();
  const known = useKnown();
  const [facts, setFacts] = useState<Kept>(() => kept(account.accountId) ?? { accountId: account.accountId, stage: "ready", wordsDone: account.keys.some((k) => k.role === "recovery"), moneyIn: null, secondDevice: null });
  const [fund, setFund] = useState<FundView | null>(null);
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    const offs = ["account.waiting.ended", "recovery.changed", "ledger.balancesChanged"].map((e) => bridge.on(e, () => setSeq((n) => n + 1)));
    return () => offs.forEach((off) => off());
  }, [bridge]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [state, vault, f] = await Promise.all([
        bridge.call<{ stage?: string; account?: AccountInfo; wordsCheckDue?: boolean }>("account.state"),
        readVault(bridge).catch(() => null),
        bridge.call<FundView>("account.fund.status"),
        readProtection(bridge),
      ]);
      if (!live) return;
      setFund("ok" in f && f.ok.state !== "done" ? f.ok : null);
      setFacts((was) => {
        const next: Kept = { ...was };
        if ("ok" in state) {
          const s = state.ok.stage;
          if (s === "ready" || s === "needs-backup" || s === "needs-funding") next.stage = s;
          const keys = state.ok.account?.keys ?? account.keys;
          next.wordsDone = keys.some((k) => k.role === "recovery") && state.ok.wordsCheckDue !== true;
          next.secondDevice = keys.some((k) => k.role === "second-device") || (vault ? vault.devices.length > 0 : was.secondDevice);
        }
        if (vault) {
          next.moneyIn = vault.usd > 0 || was.moneyIn === true;
          next.safeUsd = vault.usd;
          next.secondDevice = vault.devices.length > 0 || next.secondDevice === true;
        }
        keep(next);
        return next;
      });
    })();
    return () => { live = false; };
  }, [bridge, seq, shell.active]);
  const t = threadOf({ ...facts, fund, protection: known.protection });
  if (!threadShows(t)) return null;
  return <ThreadBar steps={t.steps} line={t.line} onOpen={() => t.next && onOpen(t.next)} />;
}
