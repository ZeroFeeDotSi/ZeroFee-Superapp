// The app as an app, with sample data: http://127.0.0.1:5180/?demo
// The title draws itself, then you're in your bank: Security first, every other app a swipe away, settings top-left.
// Nothing is sent anywhere. The real app is at "/". Add `&hold=20` to have the account's protection hold every signature
// for 20 seconds (the Waiting screen, and "Waiting for you" on Security's Overview).
//
// The demo behaves as the real app, rule for rule (robot 3-17): Approve takes only a person's own tap (the mainnet core's
// requireActivation); the account contract's rules hold big payments and every change (MockBridge mainnetRules, with
// the real wait said beside the short sample one); Check my words and Get new words walk the real screens with sample
// words; and "See a move to a new phone" walks release 7's recovery on all three devices: the new phone waiting for the
// laptop's yes (its countdown and the account's fallback), the laptop's Approve or Refuse, and this phone's banner (who
// can stop it, the countdown). It starts as a new account does: the recovery wait is chosen first, and fixed.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Problem } from "@zerofee/core/problem";
import type { AccountInfo } from "@zerofee/core/signer";
import { Title } from "../screens/Title.tsx";
import { Check, RenewDone, Welcome, Words } from "../screens/Onboarding.tsx";
import { DemoMoneyIn } from "./DemoMoneyIn.tsx";
import { demoStart, forgetDemoSetup, keepDemoSetup } from "./demo-start.ts";
import { RecoveryWaiting, RestoreWords } from "../screens/Recovery.tsx";
import type { DelayChoice } from "../screens/recovery-words.ts";
import { LaptopRequestList, type LaptopRequest } from "../laptop/RecoveryRequest.tsx";
import { Mark } from "@zerofee/design/Mark.tsx";
import { Back } from "@zerofee/design/icons.tsx";
import type { TxOutcome } from "@zerofee/core/signer";
import { securityProblems } from "@zerofee/core/security-problems";
import type { RecoveryStatus } from "../shell/freeze.ts";
import { AppHost } from "../shell/AppHost.tsx";
import { SettingsPanel } from "../shell/SettingsPanel.tsx";
import { ProblemView } from "../shell/ProblemView.tsx";
import { ApprovalSheet } from "../shell/ApprovalSheet.tsx";
import { FreezeBanner } from "../shell/FreezeBanner.tsx";
import { freezeNotice, freezeNoticeItem } from "../shell/freeze.ts";
import { WaitingView, type Held } from "../shell/WaitingView.tsx";
import { requireActivation } from "../unlock/activation.ts";
import { LaptopWindow } from "../shell/LaptopWindow.tsx";
import { ACCOUNT, DEMO_KEEP, WORDS, demoBridge, demoSecurityBridge, demoShell, demoStartHome, demoWalletBridge, hosted } from "./Screens.tsx";
import { SAMPLE_LAPTOP_CODE, SAMPLE_LAPTOP_LETTERS } from "@zerofee/shell-api/MockBridge.ts";
import { PUBLIC_BUILD } from "../mode.ts";
import { SimIntro } from "./SimIntro.tsx";
import { introSeen } from "./sim-intro.ts";
import "./screens.css";

/** The shell's side of the demo bridge, guarded as the mainnet core's is (core.ts): a yes on the approval sheet counts
 *  only with a person's own tap on Approve, never a script's el.click() or a call to approval.answer (robot 3). */
export const demoShellBridge = requireActivation(demoBridge);
/** Settings' bridge (bug report, 5 Nov; Sim re-crawl: "You haven't connected any sites" over a funded pump.fun wallet): the
 *  routed shell, so Sites reads Spending's site wallets as the real app's shellBridge does. */
const demoSettingsBridge = requireActivation(demoShell);

type Words_ = null | { k: "check" } | { k: "checked"; matches: boolean } | { k: "renew"; words: string[] } | { k: "renewCheck"; words: string[] } | { k: "renewDone"; untilIso?: string };
/** Which device the demo shows: this phone (the app), the new phone, or the laptop (release 7's move to a new phone). */
type Device = "phone" | "newphone" | "laptop";

export function Demo() {
  // A first visit starts at Welcome, as the iPhone app does; a visitor who set up here before opens on Home (demo-start.ts).
  const [first] = useState(() => demoStart());
  // The title is up only while a returning visitor's account is made (below); a first visit goes straight to Welcome.
  const [booted, setBooted] = useState(first.at !== "home");
  // Then set-up's recovery wait, as for a new account: null until the choices are read.
  const [choices, setChoices] = useState<DelayChoice[] | null>(null);
  // Then, as in the app, the 24 words are shown and three of them checked; only then is the account open.
  const [setup, setSetup] = useState<"welcome" | "restore" | "words" | "check" | "money" | "done">(first.at === "home" ? "done" : "welcome");
  // Bring back an account (finding 42): the sample account's 24 words bring it back; any others don't match it.
  const [restoreTyped, setRestoreTyped] = useState<string[] | null>(null);
  const [chosenWait, setChosenWait] = useState(first.at === "home" ? first.delaySeconds : 172_800);
  const [menu, setMenu] = useState(false);
  const [intro, setIntro] = useState(() => PUBLIC_BUILD && !introSeen());
  const [problem, setProblem] = useState<Problem | null>(null);
  // Security's own held requests open the shell's Waiting screen over everything, as App does for the real core.
  const [held, setHeld] = useState<Held | null>(null);
  const [words, setWords] = useState<Words_>(null);
  const [device, setDevice] = useState<Device>("phone");
  const [finished, setFinished] = useState(false);
  // The account's recovery, as the demo's MockBridge (the contract's rules) has it, read again whenever it changes.
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  useEffect(() => {
    const read = () => void demoBridge.call<RecoveryStatus>("recovery.status").then((r) => "ok" in r && setStatus(r.ok));
    read();
    return demoBridge.on("recovery.changed", read);
  }, []);
  // The sample's title is up only while its work runs (D134, splash.ts): the choices, and a returning visitor's account.
  useEffect(() => {
    void demoBridge.call<DelayChoice[]>("account.recoveryChoices").then((r) => setChoices("ok" in r ? r.ok : []));
    // a returning visitor: the account as they set it up, with the wait they chose
    if (first.at === "home") void demoBridge.call("account.create", { recoveryDelaySeconds: first.delaySeconds }).finally(() => setBooted(true));
  }, []);

  // A laptop added in the demo (Add my laptop, after its wait) is the account's second device on every screen: the
  // sample bridge's keys are read again whenever a held change ends or a move changes.
  const [laptops, setLaptops] = useState<AccountInfo["keys"]>([]);
  useEffect(() => {
    const read = () => void demoBridge.call<{ account?: AccountInfo }>("account.state").then((r) => "ok" in r && setLaptops(r.ok.account?.keys.filter((k) => k.role === "second-device") ?? []));
    read();
    const offs = [demoBridge.on("account.waiting.ended", read), demoBridge.on("recovery.changed", read)];
    return () => offs.forEach((off) => off());
  }, []);
  const delaySeconds = status?.delaySeconds ?? ACCOUNT.recovery?.delaySeconds ?? 172_800;
  const pending = status?.pending ?? null;
  const account: AccountInfo = useMemo(() => ({ ...ACCOUNT, keys: [...ACCOUNT.keys, ...laptops.filter((k) => !ACCOUNT.keys.some((x) => x.handle === k.handle))], recovery: { delaySeconds, pending } }), [delaySeconds, pending, laptops]);
  // Set-up done: the account is made with the wait on the words' screen (48 hours unless changed there, grade 1 Nov c,
  // P9), and kept in this browser (if it lets us), so the next visit opens on Home.
  const finishSetup = async () => {
    if (choices?.length) {
      const r = await demoBridge.call("account.create", { recoveryDelaySeconds: chosenWait });
      if ("problem" in r) return setProblem(r.problem);
    }
    keepDemoSetup(chosenWait);
    setSetup("money");
  };
  // The sample account, brought back with its words: made with the wait it was set up with, kept, and open on Home with its
  // money (an account brought back has its money already: no money step).
  const restoreSetup = async (typed: string[]) => {
    if (typed.join(" ") !== WORDS.join(" ")) return setRestoreTyped(typed);
    if (choices?.length) {
      const r = await demoBridge.call("account.create", { recoveryDelaySeconds: chosenWait });
      if ("problem" in r) return setProblem(r.problem);
    }
    keepDemoSetup(chosenWait);
    setRestoreTyped(null);
    setSetup("done");
  };
  // Start over (Settings): forget it and open from the first screen, a fresh page so every sample is as it began.
  const startOver = () => {
    forgetDemoSetup();
    // and the kept session (item 7): forgotten, and no save on the way out puts it back
    DEMO_KEEP?.forget();
    location.reload();
  };
  // The backup words start a move to a new phone, as the account is now (lib.rs, release 7): with a laptop added, the
  // move needs its yes (or the words-only fallback); with none, the words alone finish it after the recovery wait.
  const [laptopOn_, setLaptopOn] = useState(false);
  // after a reload mid-move (the session is kept), the move itself says whether the laptop is in it
  const laptopOn = laptopOn_ || status?.pending?.needsSecondDevice === true;
  // Who ended the move, so the new phone names it ("Your laptop refused…"), never "your other phone or your second device".
  const [stoppedBy, setStoppedBy] = useState<"laptop" | "old-phone" | undefined>(undefined);
  const startRecovery = () => {
    const move = demoBridge.startRecovery({ laptop: false });
    setLaptopOn(move.needsSecondDevice === true);
    setStoppedBy(undefined);
    setFinished(false);
    setDevice("newphone");
  };
  // This phone's stop (recovery.cancel): at once with no laptop's yes needed, else held a while for the laptop.
  const stopRecovery = async () => {
    const r = await demoShellBridge.call<TxOutcome>("recovery.cancel");
    if ("problem" in r) return setProblem(r.problem);
    if (r.ok.status === "problem") return setProblem(r.ok.problem);
    setStoppedBy("old-phone");
    if (r.ok.status === "waiting") setHeld({ id: r.ok.id, readyAtIso: r.ok.readyAtIso, needsSecondDevice: r.ok.needsSecondDevice });
  };
  // A key's removal (Devices' "Remove it", Quantum-safe's old key): the approval sheet, then done or held as the app does.
  const removeKey = async (handle: string) => {
    const r = await demoShellBridge.call<TxOutcome>("account.removeKey", { handle });
    if ("problem" in r) return setProblem(r.problem);
    if (r.ok.status === "problem") return setProblem(r.ok.problem);
    if (r.ok.status === "waiting") setHeld({ id: r.ok.id, readyAtIso: r.ok.readyAtIso, needsSecondDevice: r.ok.needsSecondDevice });
  };
  const finish = async () => {
    const r = await demoBridge.call("recovery.finish");
    if ("problem" in r) return setProblem(r.problem);
    setFinished(true);
  };
  // New words as the core makes them (QA sd-security (a), (b)): the bridge's next set, never the account's own; they
  // replace the old ones only through the sheet's yes (a person's own tap) and the rules' wait, in Waiting like any change.
  const startRenew = async () => {
    const r = await demoBridge.call<{ words: string[] }>("recovery.renew");
    if ("problem" in r) return setProblem(r.problem);
    setWords({ k: "renew", words: r.ok.words });
  };
  const renewConfirm = async (positions: number[], picked: string[]) => {
    const r = await demoShellBridge.call<TxOutcome>("recovery.renewConfirm", { positions, words: picked });
    if ("problem" in r) return setProblem(r.problem);
    if (r.ok.status === "problem") return setProblem(r.ok.problem);
    // a no: nothing changed; back where they were, as the app does (App.tsx renewSettled), never a check left half-answered
    if (r.ok.status === "declined") return setWords(null);
    setWords({ k: "renewDone", ...(r.ok.status === "waiting" ? { untilIso: r.ok.readyAtIso } : {}) });
  };
  // Check my words: against the account's words now (after new words ran, those), typed only; no sheet (ALPHA-MVP 1b.3).
  const checkWords = async (typed: string[]) => {
    const r = await demoBridge.call<{ matches: boolean }>("recovery.check", { words: typed });
    if ("problem" in r) return setProblem(r.problem);
    setWords({ k: "checked", matches: r.ok.matches });
  };
  const more = {
    onCheckWords: () => setWords({ k: "check" }),
    onNewWords: () => void startRenew(),
    onStopRecovery: () => void stopRecovery(),
    onRemoveKey: (handle: string) => void removeKey(handle),
    onSampleRecovery: startRecovery,
    // the Sim sends no email (QA sd-security (j)): no Email alerts row
    noEmail: true,
    sampleLaptop: { code: SAMPLE_LAPTOP_CODE, letters: SAMPLE_LAPTOP_LETTERS },
  };

  // Set-up's money screen shows Home's whole total, wallets included: Spending's engine runs from it (it said "…" for
  // 20 s, its wallets never read before Home); Home's own start takes over when the apps open.
  useEffect(() => (setup === "money" ? demoStartHome() : undefined), [setup]);

  if (!booted || choices === null) return <Title />;
  if (problem && setup !== "done") return <ProblemView close problem={problem} onBack={() => setProblem(null)} onNext={() => setProblem(null)} />;
  // D157: the public site opens on its intro once (it's the Sim; real money is the iPhone app and the extension)
  if (intro) return <SimIntro onTry={() => setIntro(false)} />;
  if (setup === "welcome") return <Welcome onCreate={() => setSetup("words")} onRestore={() => setSetup("restore")} money={false} />;
  if (setup === "restore") return <RestoreWords key={restoreTyped?.join(" ") ?? ""} purpose="restore" sample={WORDS} initial={restoreTyped ?? undefined} wrong={!!restoreTyped} onBack={() => { setRestoreTyped(null); setSetup("welcome"); }} onSubmit={(typed) => void restoreSetup(typed)} />;
  if (setup === "words") return <Words words={WORDS} wait={choices.length ? { choices, seconds: chosenWait, onChange: setChosenWait } : undefined} onDone={() => setSetup("check")} />;
  if (setup === "check") return <Check words={WORDS} onBack={() => setSetup("words")} onDone={() => void finishSetup()} />;
  if (setup === "money") return <DemoMoneyIn bridge={demoWalletBridge} onDone={() => setSetup("done")} />;
  // Every other screen sits OVER the apps, which stay where they were: Done on "Laptop added." or on "Your words are
  // right." is back in Security, never thrown back to Wallet (round 2 walk).
  return withApps(overScreen());

  function overScreen() {
  // a no to showing new words: its "Get new words" asks again (the same set; the check again first)
  const again = problem?.code === "security.words.renew-declined";
  if (problem) return <ProblemView close problem={problem} onBack={() => setProblem(null)} onNext={() => { setProblem(null); if (again) void startRenew(); }} />;
  if (finished) {
    return <ProblemView problem={{ code: "shell.recovery.finished", whatHappened: "Your account is on your new phone.", money: { state: "safe", where: "in your Safe" }, more: laptopOn ? "Your old phone can't approve anything any more. Your laptop is still your second device." : "Your old phone can't approve anything any more.", next: { kind: "nothing", label: "Open my account" } }} onNext={() => { setFinished(false); setDevice("phone"); }} />;
  }
  if (device === "laptop") return <DemoLaptop accountId={ACCOUNT.accountId} onBack={() => setDevice(pending ? "newphone" : "phone")} onAnswered={(by) => { if (by) setStoppedBy(by); setDevice("newphone"); }} onProblem={setProblem} />;
  if (device === "newphone") {
    if (!pending) {
      // The move ended (the laptop refused, or this phone stopped it): the new phone says so, then back to this phone.
      return <ProblemView problem={{ ...securityProblems.recoveryStopped(stoppedBy), next: { kind: "nothing", label: "Back to my old phone" } }} onNext={() => setDevice("phone")} />;
    }
    return <RecoveryWaiting pending={pending} delaySeconds={delaySeconds} device={laptopOn ? "laptop" : undefined} onFinish={() => void finish()} onBack={() => setDevice("phone")} onSee={pending.needsSecondDevice ? () => setDevice("laptop") : undefined}
      onSkip={() => void demoBridge.call("recovery.skip").then((r) => "problem" in r && setProblem(r.problem))} />;
  }
  // The sheet stays mounted (below): Send it now / Cancel it ask it, as the core's own sheets do.
  if (held) return <WaitingView key={held.id} bridge={demoShellBridge} held={held} onClose={() => setHeld(null)} />;
  if (words) {
    const home = () => setWords(null);
    let screen;
    switch (words.k) {
      case "check": screen = <RestoreWords purpose="check" sample={demoBridge.sampleWordsNow() ?? WORDS} onBack={home} onSubmit={(typed) => void checkWords(typed)} />; break;
      case "checked": screen = <ProblemView problem={{ code: "shell.words.checked", whatHappened: words.matches ? "Your words are right." : "These words don't match your account.", money: { state: "not-involved" }, more: words.matches ? "Keep your paper somewhere safe and dry. Check again every few months." : "Look at your paper again. A word is wrong, or two are out of order.", next: { kind: "nothing", label: words.matches ? "Done" : "Try again" } }} onNext={() => setWords(words.matches ? null : { k: "check" })} />; break;
      case "renew": screen = <Words renew words={words.words} onBack={home} onDone={() => setWords({ k: "renewCheck", words: words.words })} />; break;
      case "renewCheck": screen = <Check renew words={words.words} onBack={() => setWords({ k: "renew", words: words.words })} onDone={(pos, picked) => void renewConfirm(pos, picked)} />; break;
      case "renewDone": screen = <RenewDone waitingUntilIso={words.untilIso} onDone={home} />; break;
    }
    return <>{screen}</>;
  }
  return null;
  }

  /** A plain function, never a component: the apps must keep their place across renders. */
  function withApps(over: ReactNode) {
  const freeze = freezeNotice(status, Date.now(), undefined, laptopOn ? "your laptop" : undefined);
  return (
    <>
      {/* Under a screen over them, the apps can't be reached or read (one screen at a time). */}
      <div inert={over ? true : undefined} aria-hidden={over ? true : undefined} style={{ display: "contents" }}>
        <AppHost apps={hosted(account, () => {}, setProblem, setHeld, demoSecurityBridge, more, () => setMenu(true))} onMenu={() => setMenu(true)} shellBridge={demoShellBridge} firstTray run={demoStartHome}
          notice={freeze ? freezeNoticeItem(freeze, <FreezeBanner notice={freeze} onCancel={() => void stopRecovery()} onNewWords={() => void startRenew()} onSee={pending ? () => setDevice("newphone") : undefined} bare />) : null} />
        {/* sd-security (h): no sample address ("zf-account") to read or copy: it is no one's on any chain */}
        {menu && <SettingsPanel accountId="" bridge={demoSettingsBridge} onClose={() => setMenu(false)} onStartOver={startOver} />}
      </div>
      {over && <div className="demo-over">{over}</div>}
      {/* The demo sheet: the MockBridge asks it before every signature, as the core asks the shell's. */}
      <ApprovalSheet bridge={demoShellBridge} />
    </>
  );
  }
}

/**
 * The demo's laptop, release 7: the laptop page's own list (LaptopRequestList), read from the demo's MockBridge as the
 * laptop's core reads the contract. Approve or Refuse a waiting move; the answer goes back to the new phone.
 */
function DemoLaptop({ accountId, onBack, onAnswered, onProblem }: { accountId: string; onBack: () => void; onAnswered: (by?: "laptop" | "old-phone") => void; onProblem: (p: Problem) => void }) {
  const [requests, setRequests] = useState<LaptopRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const read = () => void demoBridge.call<{ accountId: string; requests: Omit<LaptopRequest, "accountId">[] }[]>("secondDevice.requests").then((r) => {
    if ("problem" in r) return onProblem(r.problem);
    setRequests(r.ok.flatMap((a) => a.requests.map((q) => ({ ...q, accountId: a.accountId }))));
  });
  useEffect(read, []);
  const answer = async (account: string, id: string, approve: boolean, freeze?: boolean) => {
    setBusy(id);
    const r = await demoBridge.call<TxOutcome>("secondDevice.answer", { accountId: account, id, approve, ...(freeze !== undefined ? { freeze } : {}) });
    setBusy(null);
    if ("problem" in r) return onProblem(r.problem);
    // a refusal is the laptop's; a yes to the phone's stop ends the move as the old phone asked
    if (!approve) return onAnswered("laptop");
    if (id === "recovery") return onAnswered();
    if (r.ok.status === "done") return onAnswered("old-phone");
    read();
  };
  return (
    <div className="zf-screen zf-pad demo-laptop">
      <div className="zf-top">
        <button className="zf-icon-btn" onClick={onBack} aria-label="Back"><Back /></button>
        <span className="zf-label">Your laptop</span>
        <span style={{ width: 28 }} />
      </div>
      <div className="sec-center-text zf-enter" style={{ marginTop: 24, textAlign: "center" }}>
        <h1 className="zf-title">On your laptop</h1>
        <p className="zf-small" style={{ marginTop: 8 }}>ZeroFee on your laptop guards your account. It shows this:</p>
      </div>
      <div className="zf-fill" />
      <LaptopWindow>
        {requests !== null && requests.length === 0 && <><div className="lp-top"><Mark size={22} mode="still" /><span style={{ font: "500 14px/1.2 var(--font)" }}>Waiting for your yes</span></div><p className="zf-small" style={{ marginTop: 10 }}>Nothing right now.</p></>}
        {requests && <LaptopRequestList compact requests={requests} busy={busy} onAnswer={(a, id, approve, freeze) => void answer(a, id, approve, freeze)} />}
      </LaptopWindow>
      <div className="zf-fill" />
      <div className="zf-floor" style={{ textAlign: "left", gap: 6 }}>
        <p className="zf-small"><b>Approve:</b> the new phone gets your account when the wait is over.</p>
        <p className="zf-small"><b>Refuse:</b> the move ends now, and payments pause for your rule-change wait.</p>
        <p className="zf-small">Your laptop only says yes or no. It can't start a payment or change your rules.</p>
      </div>
    </div>
  );
}
