// The Earn app: its tray (Earning, Stake, History), and the validator's card, the amount, staked, unstake, on its way
// back and ready as pushed screens or a sheet. One validator is suggested by the published rules; two more sit behind
// "Other pools" (D15, board v3). Every rate is named and worded as a forecast; the fee is read again on every visit.
// Every Problem goes to the shell's Problem screen and its next step is followed here; a held request goes to the
// shell's Waiting screen and is never shown as done (D17). The first open shows Welcome (D21, setup.ts) first.
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import type { NextStep, Problem } from "@zerofee/core/problem";
import type { TxOutcome } from "@zerofee/core/signer";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { isPositive } from "@zerofee/design/keypad.ts";
import { Mark } from "@zerofee/design/Mark.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import type { AppModule } from "@zerofee/shell-api/app-module.ts";
import { AppFrame, PushedFrame, useShell, type TrayItem } from "@zerofee/shell-api/AppFrame.tsx";
import type { Wait } from "../epoch.ts";
import type { Rate } from "../rate.ts";
import type { HistoryItem, Idle, Position, Validator, Validators } from "../types.ts";
import { agoText, forecastText, nearText, rateSpan, shareOf, startAmount, usdText, waitSpan, whenText } from "./format.ts";
import { TrayEarning, TrayHistory, TrayStake } from "./icons.tsx";
import { EarnProvider, useEarn, useEarnCall } from "./runtime.tsx";
import { later, loadSetup, saveSetup, showWelcome, staked, type SetupState } from "./setup.ts";
import "./earn.css";

type Tab = "earning" | "stake" | "history";
const TRAY: TrayItem<Tab>[] = [
  { id: "earning", label: "Earning", icon: TrayEarning },
  { id: "stake", label: "Stake", icon: TrayStake },
  { id: "history", label: "History", icon: TrayHistory },
];
const TABS = TRAY.map((t) => t.id);

type View =
  | { kind: "tabs" }
  | { kind: "card"; v: Validator; idle: Idle }
  | { kind: "amount"; v: Validator; idle: Idle }
  | { kind: "staked"; v: Validator; amount: string; wait?: Wait }
  | { kind: "waiting"; p: Position; amount: string; readyAtIso: string; reminder: boolean }
  | { kind: "ready"; p: Position }
  | { kind: "home"; p: Position };

type SheetState = null | { kind: "others"; list: Validator[]; idle: Idle } | { kind: "unstake"; p: Position };

const PRESETS = [25, 50, 75, 100];

function EarnScreens() {
  const shell = useShell();
  const { earn, refresh, network } = useEarn();
  const asked = shell.requestedTab as Tab | undefined;
  const [tab, setTab] = useState<Tab>(asked && TABS.includes(asked) ? asked : "stake");
  const [view, setView] = useState<View>({ kind: "tabs" });
  const [sheet, setSheet] = useState<SheetState>(null);
  const [busy, setBusy] = useState(false);
  const wantOthers = useRef(false);

  // The first-open journey (D21): Welcome until Later, a stake, or NEAR already earning through Earn.
  const [setup, setSetup] = useState<SetupState | null>(null);
  useEffect(() => {
    if (!shell.active || setup) return;
    void loadSetup(shell.bridge).then(setSetup);
  }, [shell.active, setup, shell.bridge]);
  const update = (s: SetupState) => {
    setSetup(s);
    void saveSetup(shell.bridge, s);
  };
  const journey = setup !== null && showWelcome(setup, false);
  const held = useEarnCall<Position[]>("earn.positions", undefined, [], journey);
  // A position that can't be read doesn't hold the Welcome back.
  const earning = held.value ? held.value.some((r) => Number(r.staked) > 0 || Number(r.unstaked) > 0) : held.problem ? false : null;
  useEffect(() => {
    if (journey && earning) update(staked(setup!));
  }, [journey, earning]);
  const endJourney = () => {
    if (journey) update(staked(setup!));
  };

  const tabs = (t?: Tab) => {
    setView({ kind: "tabs" });
    if (t) setTab(t);
    refresh();
  };

  /** Do what a Problem's one next step says. `p` is the position it is about, when there is one. */
  const follow = (next: NextStep, p?: Position) => {
    if (next.kind === "retry") return refresh();
    if (next.kind !== "open") return;
    if (next.screen === "validators") {
      wantOthers.current = true;
      return tabs("stake");
    }
    if (next.screen === "move" && p) return setSheet({ kind: "unstake", p });
    if (next.screen === "withdraw" && p) return setView({ kind: "ready", p });
  };
  const show = (problem: Problem, p?: Position) => void shell.showProblem(problem).then((next) => follow(next, p));

  /** One tx through Earn. Done goes on; held goes to the shell's Waiting screen (after `onHeld`); declined just stays. */
  async function act<T>(method: string, params: Record<string, unknown>, outcomeOf: (ok: T) => TxOutcome, done: (ok: T) => void, p?: Position, onHeld?: () => void) {
    if (!earn || busy) return;
    setBusy(true);
    const r = await earn.call<T>(method, params);
    setBusy(false);
    if ("problem" in r) return show(r.problem, p);
    const outcome = outcomeOf(r.ok);
    if (outcome.status === "done") return done(r.ok);
    if (outcome.status === "waiting") {
      onHeld?.();
      setSheet(null);
      tabs("history");
      return shell.showWaiting(outcome);
    }
    if (outcome.status === "problem") return show(outcome.problem, p);
  }

  if (!earn) {
    return (
      <AppFrame name="Earn" tray={TRAY} tab={tab} onTab={setTab}>
        <div className="en-center"><Mark size={56} mode="loading" label="Opening Earn" /></div>
      </AppFrame>
    );
  }

  if (view.kind === "card") {
    const { v, idle } = view;
    return (
      <PushedFrame name={v.name} onBack={() => tabs()}>
        <div className="en en-col">
          <RateHero v={v} idle={idle.total} />
          <div className="en-says">
            <Say q="Where it comes from">NEAR pays the computers that run the network. {v.name} runs one, and your NEAR helps it. It keeps {v.feePercent}% of what you earn today.</Say>
            <GettingBack />
            <Say q="What it costs">Nothing to put in or take out, apart from the network's own tiny fee.</Say>
            <Say q="What could go wrong">{v.name} can raise its fee at any time, even to all you earn, or stop running. Your NEAR stays yours, and no one can change the staking code. But you'd earn less, or nothing, until you move it. Moving takes each day.</Say>
          </div>
          <div className="zf-fill" />
          <div className="zf-floor"><button className="zf-btn" onClick={() => setView({ kind: "amount", v, idle })}>Stake with {v.name}</button></div>
        </div>
      </PushedFrame>
    );
  }

  if (view.kind === "amount") {
    const { v, idle } = view;
    const stake = (amount: string) =>
      act<TxOutcome>("earn.stake", { poolId: v.poolId, amount, feeSeen: v.fee, ...(v.rate ? { rateSeen: v.rate.percent } : {}) }, (o) => o, () => {
        endJourney();
        setView({ kind: "staked", v, amount });
      }, undefined, endJourney);
    return <Amount v={v} idle={idle} busy={busy} onBack={() => setView({ kind: "card", v, idle })} onStake={stake} />;
  }

  if (view.kind === "staked") return <Staked v={view.v} amount={view.amount} onDone={() => tabs("earning")} />;

  if (view.kind === "waiting") {
    const { p, amount, readyAtIso, reminder } = view;
    return (
      <PushedFrame name="Earn" onBack={() => tabs("earning")}>
        <div className="en en-col en-centered">
          <Mark size={64} mode="loading" label="On its way back" />
          <div className="zf-label en-gap">On its way back</div>
          <div className="en-big">{nearText(amount)} NEAR</div>
          <p className="zf-small">Ready {whenText(readyAtIso, Date.now())}.{reminder ? " ZeroFee tells you." : ""}</p>
          <div className="en-kvs">
            <Kv k="Where it is now" v={`${p.name}'s pool, still yours`} />
            <Kv k="Earning" v="Not while it waits" />
            <Kv k="Then" v="One tap brings it home" />
          </div>
          <div className="zf-fill" />
          <div className="zf-floor"><button className="zf-btn" onClick={() => tabs("earning")}>Done</button></div>
        </div>
      </PushedFrame>
    );
  }

  if (view.kind === "ready") {
    const { p } = view;
    const toLedger = network === "mainnet";
    return (
      <PushedFrame name="Earn" onBack={() => tabs("earning")}>
        <div className="en en-col en-centered">
          <Mark size={64} mode="still" label="Ready" />
          <div className="zf-label en-gap">Ready</div>
          <div className="en-big">{nearText(p.unstaked)} NEAR</div>
          <p className="zf-small">is free to come back from {p.name}</p>
          <div className="en-kvs">
            <Kv k="Where it is now" v={`${p.name}'s pool, still yours`} />
            <Kv k="Goes to" v="Your Safe" />
            <Kv k="Cost" v="Only the network's fee" />
          </div>
          <div className="zf-fill" />
          <div className="zf-floor">
            <button className="zf-btn" disabled={busy} onClick={() => act<TxOutcome>("earn.withdraw", { poolId: p.poolId, toLedger }, (o) => o, () => setView({ kind: "home", p }), p)}>
              {busy ? <Mark size={20} mode="loading" label="Waiting for your yes" /> : `Bring ${nearText(p.unstaked)} NEAR home`}
            </button>
          </div>
        </div>
      </PushedFrame>
    );
  }

  if (view.kind === "home") {
    return (
      <PushedFrame name="Earn" onBack={() => tabs("earning")}>
        <div className="en en-col en-centered">
          <Mark size={64} mode="once" label="Home" />
          <div className="zf-label en-gap">Home</div>
          <div className="en-big">{nearText(view.p.unstaked)} NEAR</div>
          <p className="zf-small">is back from {view.p.name}</p>
          <div className="zf-fill" />
          <div className="zf-floor"><button className="zf-btn" onClick={() => tabs("earning")}>Done</button></div>
        </div>
      </PushedFrame>
    );
  }

  if (setup === null || (journey && earning === null)) {
    return (
      <AppFrame name="Earn" tray={TRAY} tab={tab} onTab={setTab}>
        <div className="en-center"><Mark size={56} mode="loading" label="Opening Earn" /></div>
      </AppFrame>
    );
  }

  if (journey && !earning) {
    // Back and Later both end the journey on Stake; Stake now opens the picked validator's card, and back from there
    // comes here again until a stake is made.
    const toStake = () => {
      update(later(setup));
      tabs("stake");
    };
    return (
      <PushedFrame name="Earn" onBack={toStake}>
        <Welcome onStake={(v, idle) => setView({ kind: "card", v, idle })} onLater={toStake} onProblem={show} />
      </PushedFrame>
    );
  }

  return (
    <AppFrame name="Earn" tray={TRAY} tab={tab} onTab={setTab}>
      {tab === "stake" && (
        <StakeTab
          onCard={(v, idle) => setView({ kind: "card", v, idle })}
          onOthers={(list, idle) => setSheet({ kind: "others", list, idle })}
          wantOthers={wantOthers}
          onProblem={show}
        />
      )}
      {tab === "earning" && (
        <EarningTab
          busy={busy}
          onStake={() => setTab("stake")}
          onUnstake={(p) => setSheet({ kind: "unstake", p })}
          onReady={(p) => setView({ kind: "ready", p })}
          onBringHome={(p) => act<TxOutcome>("earn.withdraw", { poolId: p.poolId, toLedger: network === "mainnet" }, (o) => o, () => setView({ kind: "home", p }), p)}
          onProblem={show}
        />
      )}
      {tab === "history" && <HistoryTab onProblem={show} />}
      {sheet?.kind === "others" && (
        <Sheet title="Other pools" onClose={() => setSheet(null)}>
          <div className="en-rows">
            {sheet.list.map((v) => (
              <button key={v.poolId} className="en-pick" onClick={() => { setSheet(null); setView({ kind: "card", v, idle: sheet.idle }); }}>
                <ValidatorRow v={v} />
              </button>
            ))}
          </div>
          <p className="zf-small en-gap">Each passes the same rules. The one ZeroFee would pick is on the Stake screen.</p>
        </Sheet>
      )}
      {sheet?.kind === "unstake" && (
        <UnstakeSheet
          p={sheet.p}
          busy={busy}
          onClose={() => setSheet(null)}
          onUnstake={(amount, all) =>
            act<{ outcome: TxOutcome; readyAtIso?: string; reminder?: boolean }>("earn.unstake", { poolId: sheet.p.poolId, amount: all ? "all" : amount }, (o) => o.outcome, (o) => {
              setSheet(null);
              setView({ kind: "waiting", p: sheet.p, amount, readyAtIso: o.readyAtIso ?? new Date().toISOString(), reminder: o.reminder === true });
            }, sheet.p)
          }
        />
      )}
    </AppFrame>
  );
}

// ——— First open (D21) ———

/** What Earn does, with the person's own numbers, and one next step: Stake now, or Add NEAR when there's none. */
function Welcome({ onStake, onLater, onProblem }: { onStake: (v: Validator, idle: Idle) => void; onLater: () => void; onProblem: (p: Problem) => void }) {
  const { openMoney } = useShell();
  const { value: vs, problem } = useEarnCall<Validators>("earn.validators");
  useProblemOnce(problem, onProblem);
  if (!vs) return <Loading text="Checking each pool's fee and work on the network. The first time takes about 15 seconds; then it's kept for a day." />;
  const v = vs.picked;
  const empty = !isPositive(vs.idle.total);
  return (
    <div className="en en-col en-centered en-welcome">
      <div className="zf-fill" />
      <Mark size={56} mode="still" label="Earn" />
      <h1 className="zf-title en-gap">{empty ? "Let NEAR earn" : "Let your idle NEAR earn"}</h1>
      {v ? (
        <WelcomeLines v={v} idle={vs.idle.total} empty={empty} />
      ) : (
        <p className="zf-body">No pool meets ZeroFee's rules right now. Look again in a few hours.</p>
      )}
      <div className="zf-fill" />
      <div className="zf-floor">
        {!v ? (
          <button className="zf-btn" onClick={onLater}>Go back</button>
        ) : (
          <>
            {empty ? <button className="zf-btn" onClick={() => openMoney({ kind: "receive", link: "near" })}>Add NEAR</button> : <button className="zf-btn" onClick={() => onStake(v, vs.idle)}>Stake now</button>}
            <button className="zf-link" onClick={onLater}>Later</button>
          </>
        )}
      </div>
    </div>
  );
}

function WelcomeLines({ v, idle, empty }: { v: Validator; idle: string; empty: boolean }) {
  const { priceUsd } = useEarn();
  const rate = useRate(v);
  const measuring = rate.loading && !rate.value;
  return (
    <div className="en-welcome-lines">
      {empty ? (
        <p className="zf-body">Staked NEAR earns from the network itself{rate.value ? `: ${rate.value.percent}% a year at ${rateSpan(rate.value).at}, from ${v.name}'s pool.` : "."}</p>
      ) : (
        <p className="zf-body">You have {nearText(idle)} NEAR doing nothing. Staked, it earns from the network.</p>
      )}
      {(measuring || (!empty && rate.value)) && <p className="zf-body en-forecast">{rate.value ? `${forecastText(idle, rate.value, priceUsd)}.` : `Measuring today's rate from ${v.name}'s pool. The first time takes about 10 seconds.`}</p>}
      <p className="zf-body">Your NEAR stays yours. Take it back any time, in about a day.</p>
      <p className="zf-small">{empty ? "You have no NEAR yet. Add some, and it can start earning here." : "It runs on NEAR's own staking code. Nobody can change it."}</p>
    </div>
  );
}

// ——— Stake ———

function StakeTab({ onCard, onOthers, wantOthers, onProblem }: { onCard: (v: Validator, idle: Idle) => void; onOthers: (list: Validator[], idle: Idle) => void; wantOthers: MutableRefObject<boolean>; onProblem: (p: Problem) => void }) {
  const { priceUsd } = useEarn();
  const { openMoney } = useShell();
  const { value: vs, problem } = useEarnCall<Validators>("earn.validators");
  useProblemOnce(problem, onProblem);
  useEffect(() => {
    if (vs && wantOthers.current && vs.others.length) {
      wantOthers.current = false;
      onOthers(vs.others, vs.idle);
    }
  }, [vs]);
  if (!vs) return <Loading text="Checking each pool's fee and work on the network. The first time takes about 15 seconds; then it's kept for a day." />;
  const usd = usdText(vs.idle.total, priceUsd);
  return (
    <div className="en">
      <div className="zf-label">Not earning, in your Safe</div>
      <div className="en-idle"><CoinIcon symbol="NEAR" icon="near" size={24} /><span className="en-big">{nearText(vs.idle.total)} NEAR</span></div>
      <p className="zf-small">{usd ? `${usd} · ` : ""}not earning</p>

      {!vs.picked ? (
        <p className="zf-body en-gap">No pool meets ZeroFee's rules right now. Look again in a few hours.</p>
      ) : (
        <>
          <div className="zf-label en-gap">ZeroFee would stake with</div>
          <button className="en-pick en-picked" onClick={() => onCard(vs.picked!, vs.idle)}>
            <ValidatorRow v={vs.picked} />
          </button>
          <RateLines v={vs.picked} amount={vs.idle.total} />
          {vs.others.length > 0 && <button className="zf-link en-link" onClick={() => onOthers(vs.others, vs.idle)}>Other pools</button>}
          <p className="zf-small en-gap">Picked by public rules: works well, low fee, not one of the biggest.</p>
        </>
      )}
      {vs.idle.total === "0" && <button className="zf-link en-link" onClick={() => openMoney({ kind: "receive", link: "near" })}>Add NEAR</button>}
    </div>
  );
}

/** The validator's name, fee and rate; the rate fills in when measured. */
function ValidatorRow({ v }: { v: Validator }) {
  const rate = useRate(v);
  return (
    <span className="en-row">
      <CoinIcon symbol={v.name} size={32} />
      <span>
        <span className="t">{v.name}</span>
        <span className="d">{v.feePercent}% fee · out in about a day</span>
      </span>
      <span className="en-rate">{rate.value ? `${rate.value.percent}%` : rate.loading ? <Mark size={18} mode="loading" label="Measuring today's rate" /> : "–"}</span>
    </span>
  );
}

/** Where the rate is from, and the forecast for an amount: "At today's rate: about $26.49 a year". */
function RateLines({ v, amount }: { v: Validator; amount: string }) {
  const { priceUsd } = useEarn();
  const rate = useRate(v);
  if (rate.loading && !rate.value) return <p className="zf-small en-src">Measuring today's rate from {v.name}'s pool. The first time takes about 10 seconds.</p>;
  if (!rate.value) return <p className="zf-small en-src">NEAR didn't give {v.name}'s rate just now. Its fee is {v.feePercent}%.</p>;
  return (
    <>
      <p className="zf-small en-src">from {v.name}'s pool, {rateSpan(rate.value).over} · it changes</p>
      {Number(amount) > 0 && <p className="zf-small en-forecast">{forecastText(amount, rate.value, priceUsd)} on your {nearText(amount)} NEAR. Rates go up and down, and nobody promises them.</p>}
    </>
  );
}

function RateHero({ v, idle }: { v: Validator; idle: string }) {
  const rate = useRate(v);
  return (
    <div className="en-hero">
      <div className="en-display">{rate.value ? `${rate.value.percent}%` : rate.loading ? <Mark size={40} mode="loading" label="Measuring today's rate" /> : "–"}</div>
      <RateLines v={v} amount={idle} />
    </div>
  );
}

/** A validator's rate: the one it came with, else measured now (slow the first time, then kept). */
function useRate(v: Validator): { value: Rate | null; loading: boolean } {
  const r = useEarnCall<{ rate: Rate | null }>("earn.rate", { poolId: v.poolId }, [v.poolId, v.rate === null]);
  if (v.rate) return { value: v.rate, loading: false };
  return { value: r.value?.rate ?? null, loading: r.loading && !r.value };
}

function Amount({ v, idle, busy, onBack, onStake }: { v: Validator; idle: Idle; busy: boolean; onBack: () => void; onStake: (amount: string) => void }) {
  const { priceUsd } = useEarn();
  const rate = useRate(v);
  const [amount, setAmount] = useState(() => startAmount(idle));
  const usd = usdText(amount, priceUsd);
  const positive = isPositive(amount);
  return (
    <PushedFrame name={v.name} onBack={onBack}>
      <div className="en en-col en-centered">
        <div className="en-amount">{amount} <small>NEAR</small></div>
        <p className="zf-small">{usd ? `${usd} · ` : ""}from your Safe, {nearText(idle.total)} NEAR</p>
        <p className="zf-small en-forecast">{positive && rate.value ? forecastText(amount, rate.value, priceUsd) : " "}</p>
        <div className="en-presets">
          {PRESETS.map((pc) => (
            <button key={pc} className={amount === shareOf(idle.total, pc) && positive ? "on" : ""} onClick={() => setAmount(shareOf(idle.total, pc))}>{pc === 100 ? "All" : `${pc}%`}</button>
          ))}
        </div>
        <Keypad value={amount} decimals={4} onChange={setAmount} />
        <div className="zf-fill" />
        <div className="zf-floor">
          <button className="zf-btn" disabled={!positive || busy} onClick={() => onStake(amount)}>
            {busy ? <Mark size={20} mode="loading" label="Waiting for your yes" /> : `Stake ${positive ? amount : ""} NEAR`}
          </button>
          <p className="zf-small">No fee but the network's · back in about a day when you ask · one Approve</p>
        </div>
      </div>
    </PushedFrame>
  );
}

function Staked({ v, amount, onDone }: { v: Validator; amount: string; onDone: () => void }) {
  const { value: wait } = useEarnCall<Wait>("earn.wait");
  // Staked NEAR starts earning from the network's next epoch: three epochs before NEAR asked back now would be ready.
  const nextEpochIso = wait ? new Date(Date.parse(wait.ifNowIso) - 3 * wait.epochHours * 3.6e6).toISOString() : null;
  return (
    <PushedFrame name={v.name} onBack={onDone}>
      <div className="en en-col en-centered">
        <Mark size={64} mode="once" label="Staked" />
        <div className="zf-label en-gap">Staked</div>
        <div className="en-big">{nearText(amount)} NEAR</div>
        <p className="zf-small">with {v.name}</p>
        <div className="en-kvs">
          <Kv k="Starts earning" v={nextEpochIso ? whenText(nextEpochIso, Date.now()) : "within hours"} />
          <Kv k={`${v.name}'s fee`} v={`${v.feePercent}% now · checked every visit`} />
          <Kv k="To get it back" v="about a day" />
          <Kv k="Where it is" v={`${v.name}'s pool, still yours`} />
        </div>
        <div className="zf-fill" />
        <div className="zf-floor"><button className="zf-btn" onClick={onDone}>Done</button></div>
      </div>
    </PushedFrame>
  );
}

// ——— Earning ———

/** What's earning, and anything on its way back. NEAR that is ready comes home with the screen's one pill: one tap. */
function EarningTab({ busy, onStake, onUnstake, onReady, onBringHome, onProblem }: { busy: boolean; onStake: () => void; onUnstake: (p: Position) => void; onReady: (p: Position) => void; onBringHome: (p: Position) => void; onProblem: (p: Problem, pos?: Position) => void }) {
  const { priceUsd } = useEarn();
  const { value: rows, problem } = useEarnCall<Position[]>("earn.positions");
  useProblemOnce(problem, onProblem);
  if (!rows) return <Loading text="Reading what you have in each pool, from the pools themselves." />;
  if (!rows.length) {
    return (
      <div className="en en-col">
        <div className="en-empty">
          <p className="zf-title">Nothing is earning yet.</p>
          <p className="zf-small">Staked NEAR earns from the network. Take it back any time, in about a day.</p>
        </div>
        <div className="zf-fill" />
        <div className="zf-floor"><button className="zf-btn" onClick={onStake}>Stake NEAR</button></div>
      </div>
    );
  }
  const total = sum(rows.map((r) => r.staked));
  const earned = sum(rows.map((r) => r.earned ?? "0"));
  const usd = usdText(total, priceUsd);
  const ready = rows.find((r) => Number(r.unstaked) > 0 && r.canWithdraw);
  return (
    <div className="en en-col">
      <div className="zf-label">Earning</div>
      <div className="en-display en-total">{usd ?? `${nearText(total)} NEAR`}</div>
      <p className="zf-small en-sub">{usd ? `${nearText(total)} NEAR` : ""}{Number(earned) > 0 ? `${usd ? " · " : ""}+${nearText(earned)} NEAR earned so far` : ""}</p>
      <div className="en-rows">
        {rows.filter((r) => Number(r.staked) > 0).map((r) => (
          <button key={`s-${r.poolId}`} className="en-pick" onClick={() => (r.alert ? onProblem(r.alert, r) : onUnstake(r))}>
            <span className="en-row">
              <CoinIcon symbol={r.name} size={30} />
              <span>
                <span className="t">{r.name}</span>
                <span className="d">{r.alert ? r.alert.whatHappened : `${r.feePercent}% fee${r.rate ? ` · ${r.rate.percent}% now` : ""}`}</span>
              </span>
              <span className="en-val">
                <span className="v">{nearText(r.staked)} NEAR</span>
                {r.earned && Number(r.earned) > 0 && <span className="vd">+{nearText(r.earned)} earned</span>}
              </span>
            </span>
          </button>
        ))}
        {rows.filter((r) => Number(r.unstaked) > 0).map((r) => (
          <button key={`u-${r.poolId}`} className="en-pick" onClick={() => (r.canWithdraw ? onReady(r) : undefined)} disabled={!r.canWithdraw}>
            <span className="en-row">
              <span className={`zf-tick ${r.canWithdraw ? "on" : "off"}`} />
              <span>
                <span className="t">{r.canWithdraw ? "Ready to bring home" : "On its way back"}</span>
                <span className="d">From {r.name}{r.canWithdraw ? " · ready now" : r.readyAtIso ? ` · ready ${whenText(r.readyAtIso, Date.now())}` : ""}</span>
              </span>
              <span className="en-val"><span className="v">{nearText(r.unstaked)} NEAR</span><span className="vd">not earning</span></span>
            </span>
          </button>
        ))}
      </div>
      {ready && (
        <>
          <div className="zf-fill" />
          <div className="zf-floor">
            <button className="zf-btn" disabled={busy} onClick={() => onBringHome(ready)}>
              {busy ? <Mark size={20} mode="loading" label="Waiting for your yes" /> : `Bring ${nearText(ready.unstaked)} NEAR home`}
            </button>
            <p className="zf-small">From {ready.name} · only the network's fee · to your Safe</p>
          </div>
        </>
      )}
    </div>
  );
}

function UnstakeSheet({ p, busy, onClose, onUnstake }: { p: Position; busy: boolean; onClose: () => void; onUnstake: (amount: string, all: boolean) => void }) {
  const { priceUsd } = useEarn();
  const { value: wait } = useEarnCall<Wait>("earn.wait");
  // Asking back starts at All (UI's ruling, 26 Oct); a preset changes it.
  const [pc, setPc] = useState(100);
  const amount = shareOf(p.staked, pc);
  const usd = usdText(amount, priceUsd);
  return (
    <Sheet title={`Ask ${p.name} for it back`} onClose={onClose}>
      <div className="en-centered">
        <div className="en-amount">{nearText(amount)} <small>NEAR</small></div>
        <p className="zf-small">{pc === 100 ? "all of it" : `${pc}% of it`}{usd ? ` · ${usd}` : ""}</p>
      </div>
      <div className="en-presets">
        {PRESETS.map((x) => <button key={x} className={pc === x ? "on" : ""} onClick={() => setPc(x)}>{x === 100 ? "All" : `${x}%`}</button>)}
      </div>
      <div className="en-kvs">
        <Kv k="Ready to take out" v={wait ? whenText(wait.ifNowIso, Date.now()) : "in about a day"} />
        <Kv k="Earning while it waits" v="No" />
        <Kv k="Cost" v="Only the network's fee" />
      </div>
      <div className="zf-floor en-sheet-floor">
        <button className="zf-btn" disabled={busy || !isPositive(amount)} onClick={() => onUnstake(amount, pc === 100)}>
          {busy ? <Mark size={20} mode="loading" label="Waiting for your yes" /> : `Ask for ${nearText(amount)} NEAR back`}
        </button>
        <p className="zf-small">Then one tap brings it home.</p>
      </div>
    </Sheet>
  );
}

// ——— History ———

function HistoryTab({ onProblem }: { onProblem: (p: Problem) => void }) {
  const { value: items, problem } = useEarnCall<HistoryItem[]>("earn.history");
  useProblemOnce(problem, onProblem);
  if (!items) return <Loading text="Reading what moved." />;
  if (!items.length) return <div className="en-empty"><p className="zf-title">Nothing here yet.</p><p className="zf-small">What you stake and take out shows here.</p></div>;
  const now = Date.now();
  // Only what ran is in the past tense; a held request says what it would do, and how it ended if it never ran.
  const done = (h: HistoryItem) => (h.kind === "stake" ? `Staked ${nearText(h.amount)} NEAR` : h.kind === "unstake" ? `Asked ${nearText(h.amount)} NEAR back` : `Brought ${nearText(h.amount)} NEAR home`);
  const asked = (h: HistoryItem) => (h.kind === "stake" ? `stake ${nearText(h.amount)} NEAR` : h.kind === "unstake" ? `ask ${nearText(h.amount)} NEAR back` : `bring ${nearText(h.amount)} NEAR home`);
  const title = (h: HistoryItem) => (h.status === "on-hold" ? `On hold: ${asked(h)}` : h.status === "cancelled" ? `Cancelled: ${asked(h)}` : done(h));
  const detail = (h: HistoryItem) =>
    h.status === "on-hold"
      ? `${h.name} · held by your protection`
      : h.status === "cancelled"
        ? `${h.name} · nothing moved`
        : h.kind === "unstake" && h.readyAtIso && Date.parse(h.readyAtIso) > now
          ? `${h.name} · ready ${whenText(h.readyAtIso, now)}`
          : h.name;
  return (
    <div className="en">
      <div className="en-rows">
        {items.map((h) => (
          <div key={`${h.atIso}-${h.kind}-${h.poolId}`} className="en-row en-hist">
            <span className={`zf-tick ${h.status === "done" ? "on" : "off"}`}>{h.status === "done" ? <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path className="zf-hl" style={{ strokeWidth: 1.6 }} d="m2.5 6.2 2.3 2.3 4.7-5" /></svg> : null}</span>
            <span><span className="t">{title(h)}</span><span className="d">{detail(h)}</span></span>
            <span className="en-val"><span className="vd">{agoText(h.atIso, now)}</span></span>
          </div>
        ))}
      </div>
      <p className="zf-small en-gap">Earnings aren't listed one by one. They show as the growing total on Earning.</p>
    </div>
  );
}

// ——— Small pieces ———

/** The card's way back, timed from the live epoch (earn.wait), as the unstake sheet is. */
function GettingBack() {
  const { value: wait } = useEarnCall<Wait>("earn.wait");
  return <Say q="Getting it back">Ask, then wait {waitSpan(wait)}. It doesn't earn while it waits.</Say>;
}

/** A wait that says what it's doing and why, so a slow first visit never looks stuck. */
function Loading({ text }: { text: string }) {
  return (
    <div className="en-center en-loading">
      <Mark size={56} mode="loading" label={text} />
      <p className="zf-small">{text}</p>
    </div>
  );
}

function Say({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div className="en-say">
      <div className="zf-label">{q}</div>
      <p>{children}</p>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="en-kv"><span>{k}</span><span>{v}</span></div>
  );
}

/** Show a failed read on the shell's Problem screen once per failure. */
function useProblemOnce(r: { problem: unknown } | undefined, show: (p: Problem) => void) {
  const shown = useRef<unknown>(null);
  useEffect(() => {
    if (r && shown.current !== r) {
      shown.current = r;
      show(r.problem as Problem);
    }
  }, [r]);
}

/** Exact sum of NEAR decimal strings (24 decimals). */
function sum(amounts: string[]): string {
  const total = amounts.reduce((acc, a) => {
    const [w, f = ""] = a.split(".");
    return acc + BigInt(w + f.padEnd(24, "0").slice(0, 24));
  }, 0n);
  const s = total.toString().padStart(25, "0");
  const frac = s.slice(-24).replace(/0+$/, "");
  return `${s.slice(0, -24)}${frac ? `.${frac}` : ""}`;
}

function EarnRoot() {
  const shell = useShell();
  return (
    <EarnProvider bridge={shell.bridge} active={shell.active}>
      <EarnScreens />
    </EarnProvider>
  );
}

export const earnApp: AppModule = { id: "earn", name: "Earn", line: "NEAR that earns", Root: EarnRoot };
