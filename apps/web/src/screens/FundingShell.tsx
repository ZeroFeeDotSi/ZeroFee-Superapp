// While a new account waits for its money: the funding flow (FundFlow), or, once money is seen and the person closes it,
// every app to look at, each saying what is happening with one button back to the steps, under the funding's slim bar.
// Before money is seen there are no apps (J1, 2 Nov: each was a spinner, a door to nothing): the flow stays. The same in
// the real app (App.tsx) and in the walk (gallery/FundWalk.tsx), so what is walked is what ships.
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { AppHost, type HostedApp } from "../shell/AppHost.tsx";
import { FundFlow, FundThread, OpeningApp, useFundStatus } from "./FundStart.tsx";
import { mayGoToApp } from "./fund.ts";

export interface OpeningAppRow {
  id: HostedApp["id"];
  name: string;
  line: string;
  bridge: Bridge;
}

export function FundingShell({ bridge, wallet, apps, away: startAway = false, everyMs, onWords, onReroute, onProblem, onMenu, leave }: {
  bridge: Bridge;
  wallet?: Bridge;
  /** The apps to show while the account opens (Security first, as on Home). */
  apps: OpeningAppRow[];
  away?: boolean;
  everyMs?: number;
  /** The account is open: its backup words next. */
  onWords: () => void;
  /** Done, or nothing on record any more: the app routes again from the core's state. */
  onReroute: () => void;
  onProblem: (p: Problem) => void;
  /** The menu over the apps: Settings (Reset this iPhone is there on the phone). */
  onMenu?: () => void;
  /** Leaving set-up from the coins (FundFlow's `leave`). */
  leave?: { device: string; go: () => Promise<boolean> };
}) {
  const [away, setAway] = useState(startAway);
  // One reading for the bar and every app (never one poll per app).
  const [v, , , gone] = useFundStatus(bridge, away, everyMs);
  useEffect(() => {
    if (away && gone) onReroute();
  }, [away, gone]);
  // Nothing seen (an old "away" kept from before, or the address ran out): the flow, at the address, never the apps.
  useEffect(() => {
    if (away && v && !mayGoToApp(v)) setAway(false);
  }, [away, v]);
  if (!away) return <FundFlow bridge={bridge} wallet={wallet} {...(everyMs ? { everyMs } : {})} onAway={() => setAway(true)} onWords={onWords} onDone={onReroute} onProblem={onProblem} {...(leave ? { leave } : {})} />;
  const steps = () => setAway(false);
  const opening: HostedApp[] = apps.map((a) => ({ ...a, render: () => <OpeningApp name={a.name} v={v} onOpen={steps} onWords={onWords} /> }));
  // The one thread (Job 1) over the apps: Money in under way (or the words next); tap it, that step.
  const bar = v && !gone ? <FundThread v={v} onOpen={() => (v.stage === "needs-backup" ? onWords() : steps())} /> : null;
  return <AppHost apps={opening} onMenu={onMenu ?? steps} shellBridge={bridge} start={{ id: apps.find((a) => a.id === "wallet")?.id ?? apps[0].id }} notice={bar} />;
}
