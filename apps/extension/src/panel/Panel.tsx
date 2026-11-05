// The panel in Chrome's side panel: the first-run journey, locked, or the trading wallet with its tray (Trade, Positions,
// Activity).
// Every Problem goes to the same Problem screen the app uses (@zerofee/shell-api/ProblemView), and its one next step is
// followed here. The vault's state is read again every 30 s, so a wallet that locked itself shows as locked.
import { useEffect, useState, type ReactNode } from "react";
import { Back, Menu, TrayActivity } from "@zerofee/design/icons.tsx";
import { Mark } from "@zerofee/design/Mark.tsx";
import type { Problem } from "@zerofee/core/problem";
import { ProblemView } from "@zerofee/shell-api/ProblemView.tsx";
import type { TradeRecord } from "@zerofee/trade/service.ts";
import type { VaultStatus } from "../vault/vault.ts";
import { mintOf, usePageCoin } from "./page.ts";
import { ask, local, useLive, usePanel } from "./runtime.tsx";
import { SETUP_KEY, stepFor, type SetupStep } from "./setup.ts";
import { AddMoney, Confirm, Link, Settings, Unlock } from "./screens/Access.tsx";
import { Journey } from "./screens/Journey.tsx";
import { Bought } from "./screens/Bought.tsx";
import { Activity, Positions } from "./screens/Lists.tsx";
import { TradeView } from "./screens/TradeView.tsx";

type Tab = "trade" | "positions" | "activity";
export type View = { kind: "tabs" } | { kind: "bought"; rec: TradeRecord } | { kind: "settings" } | { kind: "add" } | { kind: "link" };
type ShownProblem = { problem: Problem; retry?: (passcode: string) => void };
/** Set once the panel's link QR has been shown, so "From my ZeroFee balance" is offered. */
const LINKED_KEY = "linked.v1";

const TrayTrade = () => <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path className="zf-hl" d="M8 4v15M8 4 5 7M8 4l3 3M16 20V5M16 20l-3-3M16 20l3-3" /></svg>;
const TrayPositions = () => <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path className="zf-hl" d="M5 19v-6M12 19V5M19 19v-9" /></svg>;
const Lock = () => <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path className="zf-hl" d="M7.5 11V8.5a4.5 4.5 0 0 1 9 0V11M6 11h12v9H6z" /></svg>;
const TRAY: { id: Tab; label: string; icon: () => ReactNode }[] = [
  { id: "trade", label: "Trade", icon: TrayTrade },
  { id: "positions", label: "Positions", icon: TrayPositions },
  { id: "activity", label: "Activity", icon: TrayActivity },
];

/** `start`: the screen to open on (the preview pages use it); the trading wallet's tabs otherwise. */
export function Panel({ start }: { start?: View }) {
  const { bridge } = usePanel();
  const [status, setStatus] = useState<VaultStatus>();
  const [shown, setShown] = useState<ShownProblem>();
  const [confirm, setConfirm] = useState<(passcode: string) => void>();
  const [view, setView] = useState<View>(start ?? { kind: "tabs" });
  const [tab, setTab] = useState<Tab>("trade");
  const [stored, setStored] = useState<SetupStep | undefined | null>(null);   // null: not read yet
  const [linked, setLinked] = useState(false);
  useEffect(() => {
    void local.get<SetupStep>(SETUP_KEY).then((s) => setStored(s), () => setStored(undefined));
    void local.get<boolean>(LINKED_KEY).then((l) => setLinked(!!l), () => undefined);
  }, []);
  const toStep = (s: SetupStep) => { setStored(s); void local.set(SETUP_KEY, s); };
  const onLinked = () => { setLinked(true); void local.set(LINKED_KEY, true); };

  const refresh = async () => {
    const r = await ask<VaultStatus>({ t: "vault.status" });
    if ("problem" in r) { setShown({ problem: r.problem }); return; }
    setStatus((before) => { if (before?.stage === "unlocked" && r.ok.stage !== "unlocked") bridge.locked(); return r.ok; });
  };
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 30_000); return () => clearInterval(t); }, []);

  const onProblem = (problem: Problem, retry?: (passcode: string) => void) => setShown({ problem, retry });
  const next = () => {
    const s = shown!;
    setShown(undefined);
    const n = s.problem.next;
    // the panel opened as a tab of its own: its one step closes that tab
    if (s.problem.code === "extension.panel.tab") { window.close(); return; }
    if (n.kind === "open" && n.screen === "unlock") void refresh();
    if (n.kind === "open" && n.screen === "fund") setView({ kind: "add" });
    if (n.kind === "open" && n.screen === "search") { setView({ kind: "tabs" }); setTab("positions"); }
    if (n.kind === "open" && n.screen === "confirm" && s.retry) setConfirm(() => s.retry);
  };
  const lock = async () => { await ask({ t: "vault.lock" }); setView({ kind: "tabs" }); await refresh(); };

  let body: ReactNode;
  if (shown) body = <ProblemView problem={shown.problem} onNext={next} />;
  else if (!status || stored === null) body = <div className="p-screen p-wait"><Mark size={56} mode="loading" /></div>;
  else if (status.stage === "locked") body = <div className="p-screen"><Unlock touch={status.touch} onOpen={() => void refresh()} onProblem={onProblem} /></div>;
  else if (stepFor(status.stage, stored) !== "done") {
    const step = stepFor(status.stage, stored) as Exclude<SetupStep, "done">;
    body = <div className="p-screen"><Journey step={step} sol={status.stage === "unlocked" ? status.sol : undefined} limitUsd={status.stage === "unlocked" ? status.perTradeUsd : 50} linked={linked}
      onStep={toStep} onMade={() => void refresh()} onLinked={onLinked} onProblem={onProblem} /></div>;
  } else if (status.stage === "none") body = <div className="p-screen p-wait"><Mark size={56} mode="loading" /></div>;
  else if (view.kind === "tabs") {
    body = (
      <div className="p-screen">
        <header className="p-top">
          <button className="zf-icon-btn p-top-l" aria-label="Settings" onClick={() => setView({ kind: "settings" })}><Menu /></button>
          <span className="zf-label p-title">Trading wallet</span>
          <button className="zf-icon-btn p-top-r" aria-label="Lock now" onClick={() => void lock()}><Lock /></button>
        </header>
        <main className="p-main">
          {tab === "trade" && <TradeTab limitUsd={status.perTradeUsd} onDone={(rec) => setView({ kind: "bought", rec })} onProblem={onProblem} onAdd={() => setView({ kind: "add" })} />}
          {tab === "positions" && <Positions onAdd={() => setView({ kind: "add" })} onCoin={() => setTab("trade")} />}
          {tab === "activity" && <Activity />}
        </main>
        <nav className="p-tray" aria-label="Trading wallet">
          {TRAY.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "on" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><Icon /><span>{label}</span></button>)}
        </nav>
      </div>
    );
  } else {
    const back = () => setView({ kind: "tabs" });
    const title = { bought: view.kind === "bought" && view.rec.kind === "sell" ? "Sold" : "Bought", settings: "Settings", add: "Add money", link: "Link" }[view.kind];
    body = (
      <div className="p-screen">
        <header className="p-top">
          <button className="zf-icon-btn p-top-l" aria-label="Back" onClick={back}><Back /></button>
          <span className="zf-label p-title">{title}</span>
        </header>
        <main className="p-main p-main--pushed">
          {view.kind === "bought" && <Bought rec={view.rec} onDone={back} onPosition={() => { back(); setTab("positions"); }} />}
          {view.kind === "settings" && <Settings limitUsd={status.perTradeUsd} sol={status.sol} touch={status.touch} onLink={() => setView({ kind: "link" })} onLock={() => void lock()} onChanged={() => void refresh()} onProblem={onProblem} />}
          {view.kind === "link" && <Link onProblem={onProblem} onShown={onLinked} />}
          {view.kind === "add" && <AddMoney address={status.sol} onDone={back} />}
        </main>
      </div>
    );
  }
  return (
    <>
      {body}
      {confirm && status?.stage === "unlocked" && <Confirm limitUsd={status.perTradeUsd} onClose={() => setConfirm(undefined)} onPass={(p) => { const go = confirm; setConfirm(undefined); go(p); }} />}
    </>
  );
}

/** The Trade tab: the coin on this page, or one line saying where coins come from. */
function TradeTab({ limitUsd, onDone, onProblem, onAdd }: { limitUsd: number; onDone: (r: TradeRecord) => void; onProblem: (p: Problem, retry?: (passcode: string) => void) => void; onAdd: () => void }) {
  const { rpc, market } = usePanel();
  const page = usePageCoin();
  const key = `${page?.site}|${page?.chain}|${page?.address}`;
  const [dismissed, setDismissed] = useState<string>();
  const mint = useLive(async () => (page ? mintOf(page, rpc, market) : undefined), [key]);
  if (page === undefined || (page && !mint.value)) return <div className="tr-center tr-tall"><Mark size={48} mode="loading" /></div>;
  const m = mint.value;
  if (!page || !m || ("problem" in m && dismissed === key)) return <Positions hint="Open a coin on Axiom, pump.fun or GMGN and it appears here, ready to trade." onAdd={onAdd} onCoin={() => undefined} />;
  // the page's Problem in the middle of the panel, top bar and tray kept
  if ("problem" in m) return <div className="p-slot"><ProblemView problem={m.problem} onNext={() => setDismissed(key)} /></div>;
  return <TradeView mint={m.mint} limitUsd={limitUsd} onDone={onDone} onProblem={onProblem} />;
}
