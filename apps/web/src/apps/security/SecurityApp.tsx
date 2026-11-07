// Security, inside Home (Job 1, the spine; B24: Wallet and Security are one app). Home shows its rows (SecurityRows):
// what the account holds for you, then Protection, Devices and Recovery; each opens its own place (SecurityPlace), and
// what the account did is Activity's "Account" part (AccountActivity). It is the shell's own part, so it uses the full
// bridge; every failure goes to the shell's Problem screen.
import { useEffect, useRef, useState } from "react";
import type { AccountInfo, TxOutcome } from "@zerofee/core/signer";
import type { Problem } from "@zerofee/core/problem";
import { forApps, type Bridge } from "@zerofee/core/bridge";
import { More } from "@zerofee/design/More.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { useBack } from "@zerofee/design/back.ts";
import { Back, Check } from "@zerofee/design/icons.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import type { AccountPlace } from "@zerofee/shell-api/home-slots.ts";
import { NavRow } from "@zerofee/wallet/app/screens/NavRow.tsx";
import { guardianUsed, keepPhone, keptPhones, localEvents, markGuardianUsed } from "./local.ts";
import { GuardianSide } from "./GuardianSide.tsx";
import type { Held } from "../../shell/WaitingView.tsx";
import { useCountdown } from "../../screens/Recovery.tsx";
import { SECOND_DEVICE_MOVE_WORDS, oldPhoneCount, phoneCanStop, recoveryFacts, waitName, whoCanStop } from "../../screens/recovery-words.ts";
import { Protection } from "./Protection.tsx";
import { EmailAlerts } from "./EmailAlerts.tsx";
import { Rearm } from "./Rearm.tsx";
import { ALL_LOST_WORDS } from "../../words-copy.ts";
import { KeyProofCard } from "./KeyProof.tsx";
import { setupWindowLine } from "./setup-window.ts";
import { countsFullyLine } from "../../vault-gate.ts";
import { askDeviceNext, devicesLine, fallbackSeconds, lostName, refillName, removableDevices, type SecondDevice } from "./devices.ts";
import { ruleChangeWaitWords, waitPlain } from "./rules.ts";
import { accountRowWords } from "./account-rows.ts";
import { PAIR_STEP_TWO, pairStepTwo } from "./pair-steps.ts";
import { laptopWords } from "./laptop-words.ts";
import { LaptopWindow } from "../../shell/LaptopWindow.tsx";
import { PUBLIC_RELEASE } from "@zerofee/shell-api/release.ts";
import { MAINNET, MODE } from "../../mode.ts";
import { DEFAULT_PROTECTION } from "@zerofee/core/protection-bands";
import { isPairingCode } from "@zerofee/core/pairing-code";
import { securityProblems } from "@zerofee/core/security-problems";
import { ThisDevice, onPhone, thisDevice } from "@zerofee/shell-api/approval-words.ts";
import { ACCOUNT_NAME_KEY, accountNameShown } from "../../shell/settings-words.ts";
import { readProtection, setKnown, useKnown } from "./known.ts";
import { oneRowEach } from "./waiting-rows.ts";
import { QUANTUM_WORDS, canRemoveKey, otherKeyLine, quantumOf, quantumRowsShown, type OldKey } from "./quantum.ts";
import "./security.css";


export interface SecurityActions {
  bridge: Bridge;
  onProblem: (problem: Problem) => void;
  /** `what`: "second device" for a lost laptop or guardian (H09), so the working line names it; else another phone. */
  onRemoveKey: (handle: string, what?: "second device") => void;
  onStopRecovery: () => void;
  onCheckWords: () => void;
  /** New backup words (recovery.renew): for words someone else may have seen. */
  onNewWords?: (back?: { id: string; tab?: string }) => void;
  onChanged: () => void;
  /** A change the account's protection is holding (it takes the strictest level): the shell's Waiting screen. `tab`: the
   *  Security place it was opened from ("protection"), where its Done returns (grade 01d, Q11). */
  onWaiting: (held: Held, tab?: string) => void;
  /** The Safe's update held screen (SafeUpdateHeld.tsx): always findable from Protection. */
  onSafeUpdate?: () => void;
  /** On the phone only (its own words screen): turn approvals back on after Face ID changed; `onMoving` once the
   *  account key's move to this phone has started (the shell shows its wait). */
  rearm?: { onMoving: () => void };
  /** The web demo only: someone starts a recovery with the words, to see it and the freeze it brings. */
  onSampleRecovery?: () => void;
  /** No email alerts here (the Sim sends no email): the row is hidden, never "This isn't available yet" (drop, don't degrade). */
  noEmail?: boolean;
  /** The web demo only: its laptop, simulated beside the phone (the code it shows and the letters to check). */
  sampleLaptop?: { code: string; letters: string };
}

/** Phone keys on the account other than this device's: a kept second phone, or an older phone's leftover key. */
const otherPhones = (account: AccountInfo) => account.keys.filter((k) => k.role === "device" && !k.current);

/** "ml-dsa-65-hash:91bshR…cLuH" → "91bshR…cLuH", the same short form the approval sheet shows. */
const shortHandle = (handle: string) => {
  const h = handle.slice(handle.indexOf(":") + 1);
  return h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
};

/** The account's facts the rows and the places read, kept for the page (painted from the last known, never blank). */
type Facts = { devices: SecondDevice[] | null; mainUsd: number; checkDue: boolean; setupUntil?: string; fresh: AccountInfo | null; guardWaiting: number };
let lastFacts: Facts = { devices: null, mainUsd: 0, checkDue: false, fresh: null, guardWaiting: 0 };

/** Reads the account's facts (second devices, the Safe in dollars, the words check, the set-up window), again whenever
 *  `seq` changes; starts from what was last read, so nothing waits on the network. */
function useFacts(bridge: Bridge, seq: unknown[]): [Facts, () => void] {
  const [facts, setFacts] = useState<Facts>(lastFacts);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let live = true;
    const put = (next: Partial<Facts>) => {
      if (!live) return;
      lastFacts = { ...lastFacts, ...next };
      setFacts(lastFacts);
    };
    void bridge.call<SecondDevice[]>("account.secondDevices").then((r) => "ok" in r && put({ devices: r.ok }));
    void bridge.call<{ usd?: string }[]>("ledger.balances").then((r) => "ok" in r && put({ mainUsd: r.ok.reduce((sum, b) => sum + (Number(b.usd) || 0), 0) }));
    void bridge.call<{ account?: AccountInfo; wordsCheckDue?: boolean; setupUntilIso?: string }>("account.state").then((res) => {
      if (!("ok" in res)) return;
      put({ checkDue: res.ok.wordsCheckDue === true, setupUntil: typeof res.ok.setupUntilIso === "string" ? res.ok.setupUntilIso : undefined, ...(res.ok.account ? { fresh: res.ok.account } : {}) });
      if (res.ok.account) setKnown({ account: res.ok.account });
    });
    if (guardianUsed()) void bridge.call<unknown[]>("guardian.requests").then((r) => "ok" in r && put({ guardWaiting: r.ok.length }));
    return () => { live = false; };
  }, [bridge, again, ...seq]);
  return [facts, () => setAgain((n) => n + 1)];
}

/** What the account holds for the person ("Waiting for you"), on Home itself while something is held; else nothing. */
export function SecurityWaiting({ bridge }: { bridge: Bridge }) {
  const shell = useShell();
  const [ended, setEnded] = useState(0);
  useEffect(() => {
    const offs = ["account.waiting.ended", "recovery.changed"].map((e) => bridge.on(e, () => setEnded((n) => n + 1)));
    return () => offs.forEach((off) => off());
  }, [bridge]);
  return <WaitingForYou bridge={bridge} onOpen={(h) => shell.showWaiting(h)} seq={ended} />;
}

/**
 * The account's rows (Job 1; design review §1.1: behind Home's menu glyph, off the money screen): Protection, Devices and
 * Recovery, each one short line and one tap to its own screen. Painted at once from what was last read; nothing here
 * waits on the network.
 */
export function SecurityRows({ account: given, bridge, open }: { account: AccountInfo; bridge: Bridge; open: (place: AccountPlace, step?: string) => void }) {
  const shell = useShell();
  const shared = useKnown();
  const [ended, setEnded] = useState(0);
  useEffect(() => {
    const offs = ["account.waiting.ended", "recovery.changed"].map((e) => bridge.on(e, () => setEnded((n) => n + 1)));
    return () => offs.forEach((off) => off());
  }, [bridge]);
  useEffect(() => void readProtection(bridge), [bridge, ended, shell.active]);
  const [facts] = useFacts(bridge, [ended, shell.active]);
  const account = facts.fresh ?? given;
  const pending = account.recovery?.pending;
  const devices = facts.devices;
  const protection = shared.protection;
  const quantum = account.keys.length ? quantumOf(account.keys, undefined, account.rules === true) : null;
  // the audit: a full-access key on an account with rules bypasses the contract: red, in those words, never just "old".
  const bypass = !!quantum?.bypass.length;
  const says = accountRowWords({ web: !onPhone(), quantumOn: quantum ? quantum.on : null, protection, pending: !!pending, checkDue: facts.checkDue });
  return (
    <>
      {/* Quantum-safe (review, 5 Nov): first, from the account's own key list (quantum.ts), never a fixed On */}
      {quantum && <NavRow title={QUANTUM_WORDS.title} icon="shield-check" tone={bypass ? "red" : undefined} line={bypass ? QUANTUM_WORDS.bypassLine : quantum.on ? QUANTUM_WORDS.rowLine : QUANTUM_WORDS.oldCount(quantum.old)} value={says.quantum} onClick={() => open("quantum")} />}
      <NavRow title="Protection" icon="shield" line={protection === false ? "Choose what big payments need" : "What big payments need"} value={says.protection} onClick={() => open("protection")} />
      <NavRow title="Devices" icon="phone" line={devices ? devicesLine(devices) : "Who can say yes"} value={facts.guardWaiting > 0 ? `${facts.guardWaiting} waiting` : devices?.some((d) => d.needsReAdd || d.needsRefill) ? "Needs you" : ""} onClick={() => open("devices")} />
      <NavRow title="Recovery" icon="words" {...(says.recovery.line ? { line: says.recovery.line } : {})} value={says.recovery.value} onClick={() => open("recovery")} />
    </>
  );
}

/**
 * Quantum-safe's sheet (D135: the whole screen, Close in its corner): one row each for this phone, the laptop, the backup
 * words and AgentZero, ticked only when that key is on the account and is ML-DSA-65, else "Not yet"; an old classical
 * key, with its Remove (the same remove-key path as Devices). Never a word about connections.
 */
function QuantumSheet({ account, wordsChecked, waitWords, onClose, onRemove, onNewWords, onPairAgain }: { account: AccountInfo; wordsChecked: boolean; waitWords: string | null; onClose: () => void; onRemove: (handle: string) => void; onNewWords: () => void; onPairAgain: () => void }) {
  const phone = onPhone();
  const q = quantumOf(account.keys, phone ? "This phone" : "This device", account.rules === true);
  // the audit's MUST, the copy review's S1 (7 Nov): what each row SAYS; on the web never the phone's chip or a tick for a phone-only key.
  const shown = quantumRowsShown(q.rows, !phone, wordsChecked);
  // Remove is never one tap (audit): it opens a confirm that names the key, what stops working and the wait.
  const [ask, setAsk] = useState<string | null>(null);
  const oldLabel = (k: OldKey) => (k.fix === "other-device" ? QUANTUM_WORDS.otherDevice : k.fix === "new-words" ? QUANTUM_WORDS.oldWords : k.fix === "pair-again" ? QUANTUM_WORDS.oldLaptop : QUANTUM_WORDS.oldRow);
  const oldLine = (k: OldKey) => (k.fix === "other-device" ? QUANTUM_WORDS.otherDeviceLine : k.fix === "new-words" ? QUANTUM_WORDS.oldWordsLine : k.fix === "pair-again" ? QUANTUM_WORDS.oldLaptopLine : k.fix === "none" ? QUANTUM_WORDS.oldThisDevice : QUANTUM_WORDS.oldLine);
  return (
    <>
    <Sheet title={QUANTUM_WORDS.title} onClose={onClose}>
      <div className="sec-q">
        {/* the copy review's S1: "Quantum-safe" once (the title); On's headline folds into one body line */}
        {!q.on && <h2 className="zf-title sec-q__head">{q.bypass.length ? QUANTUM_WORDS.bypassHead(q.bypass.length) : QUANTUM_WORDS.oldCount(q.old)}</h2>}
        <p className="zf-body sec-q__line">{q.on ? QUANTUM_WORDS.bodyOn : QUANTUM_WORDS.lineOld}</p>
        {q.bypass.length > 0 && (
          <div className="sec-dev__rows sec-q__rows">
            {q.bypass.map((k) => (
              <div key={k.handle} className="sec-fact-row sec-q__old sec-q__bypass">
                <span className="sec-q__t">{QUANTUM_WORDS.bypassRow}<span className="sec-q__sub">{QUANTUM_WORDS.bypassLine}</span></span>
                {k.remove && <button className="zf-chip sec-q__remove" onClick={() => setAsk(k.handle)}>{QUANTUM_WORDS.remove}</button>}
              </div>
            ))}
          </div>
        )}
        <div className="sec-dev__rows sec-q__rows">
          {shown.map((r) => (
            <div key={r.id} className="sec-fact-row" data-safe={r.tick || undefined}>
              <span className="sec-q__t">{r.label}{r.line && <span className="sec-q__sub">{r.line}</span>}</span>
              <span className="v">{r.value}{r.tick && <span className="zf-tick on sec-key-row__tick" role="img" aria-label="Quantum-safe"><Check /></span>}</span>
            </div>
          ))}
          {q.leftovers.map((h) => (
            <div key={h} className="sec-fact-row"><span className="sec-q__t">{QUANTUM_WORDS.leftoverRow}<span className="sec-q__sub">{QUANTUM_WORDS.leftoverLine}</span></span></div>
          ))}
          {q.sessions.map((h) => (
            <div key={h} className="sec-fact-row"><span className="sec-q__t">{QUANTUM_WORDS.session}<span className="sec-q__sub">{QUANTUM_WORDS.sessionLine}</span></span></div>
          ))}
        </div>
        {q.old.length > 0 && (
          <div className="sec-dev__rows sec-q__rows">
            {q.old.map((k) => (
              <div key={k.handle} className="sec-fact-row sec-q__old">
                <span className="sec-q__t">{oldLabel(k)}<span className="sec-q__sub">{oldLine(k)}</span></span>
                {k.fix === "remove" && <button className="zf-chip sec-q__remove" onClick={() => setAsk(k.handle)}>{QUANTUM_WORDS.remove}</button>}
                {k.fix === "new-words" && <button className="zf-chip sec-q__remove" onClick={onNewWords}>{QUANTUM_WORDS.newWords}</button>}
                {k.fix === "pair-again" && <button className="zf-chip sec-q__remove" onClick={onPairAgain}>{QUANTUM_WORDS.pairAgain}</button>}
              </div>
            ))}
          </div>
        )}
        <p className="zf-small sec-q__trade">{QUANTUM_WORDS.trade}</p>
      </div>
    </Sheet>
    {ask && (
      <Sheet title={QUANTUM_WORDS.confirmTitle} onClose={() => setAsk(null)}>
        <div className="sec-q sec-q--ask">
          <h2 className="zf-title sec-q__head">{q.bypass.some((k) => k.handle === ask) ? QUANTUM_WORDS.confirmHeadBypass : QUANTUM_WORDS.confirmHead}</h2>
          <p className="zf-body sec-q__line">{QUANTUM_WORDS.confirmLine}</p>
          <p className="zf-small sec-q__line">{QUANTUM_WORDS.confirmWait(waitWords)}</p>
          <div className="zf-fill" />
          <div className="sec-q__floor">
            <button className="zf-btn" onClick={() => { const h = ask; setAsk(null); onRemove(h); }}>{QUANTUM_WORDS.confirmGo}</button>
            <button className="zf-link" onClick={() => setAsk(null)}>{QUANTUM_WORDS.confirmNo}</button>
          </div>
        </div>
      </Sheet>
    )}
    </>
  );
}

/** What the account itself did (who approved what): Activity's "Account" part. */
export function AccountActivity({ bridge }: { bridge: Bridge }) {
  return <ActivityTab bridge={bridge} bare />;
}

/**
 * One of the account's places inside Home (Job 1): Protection (its rules for big payments), Devices (this phone's key,
 * a second device, a guardian) or Recovery (the backup words). `step` opens a step in it ("laptop", "new-words").
 * Back returns to Home. It is the shell's own part, so it uses the full bridge; every failure goes to the shell's
 * Problem screen.
 */
export function SecurityPlace({ account: given, actions, place, step, onBack }: { account: AccountInfo; actions: SecurityActions; place: AccountPlace; step?: string; onBack: () => void }) {
  const shell = useShell();
  const [flow, setFlow] = useState<"laptop" | "guardian" | "phone" | "laptop-limit" | "guardian-limit" | "guard" | "lost" | null>(null);
  /** No laptop page to send anyone to yet (mainnet before launch, the iPhone's test build): "Add my laptop" isn't offered
   *  (UX walk 2 Nov: it named superapp.zerofee.si/laptop, a 404). The demo draws its own laptop. */
  const noLaptopPage = Boolean(LAPTOP.later && !actions.sampleLaptop);
  // A step asked for with the place ("security/laptop", "security/new-words"): straight into it, each time it is asked.
  useEffect(() => {
    if (step === "laptop" && !noLaptopPage) setFlow("laptop");
    if (step === "guardian") setFlow("guardian");
    if (step === "guard") (markGuardianUsed(), setFlow("guard"));
    if (step === "lost") setFlow("lost");
    if (step === "new-words") actions.onNewWords?.({ id: "security", tab: "recovery" });
  }, [step, shell.requestSeq]);
  // A held change that ends (a laptop added after its wait, new rules) or a move that changes: everything here is read
  // again at once (grade 30 Oct, item 4).
  const [ended, setEnded] = useState(0);
  useEffect(() => {
    const offs = ["account.waiting.ended", "recovery.changed"].map((e) => actions.bridge.on(e, () => setEnded((n) => n + 1)));
    return () => offs.forEach((off) => off());
  }, [actions.bridge]);
  // Shared with Home's rows (known.ts): one answer everywhere. A failed read keeps what was known (D3).
  const shared = useKnown();
  const levels = shared.levels;
  const [rulesWaiting, setRulesWaiting] = useState(false);
  // A second device's add already waiting (its change wait): never offered again beside it; its row opens that wait.
  const [addWaiting, setAddWaiting] = useState<Held | null>(null);
  useEffect(() => {
    void readProtection(actions.bridge);
    void actions.bridge.call<(Held & { title: string })[]>("account.waiting").then((res) => {
      const list = "ok" in res && Array.isArray(res.ok) ? res.ok : [];
      setRulesWaiting(list.some((w) => /^Ask my (laptop|guardian)|protection rules/i.test(String(w.title))));
      const add = list.find((w) => /^Add a second device/i.test(String(w.title)));
      setAddWaiting(add ? { id: String(add.id), readyAtIso: add.readyAtIso, needsSecondDevice: add.needsSecondDevice } : null);
    });
  }, [actions.bridge, flow, ended, shell.active]);
  const [refilled, setRefilled] = useState(0);
  const [facts] = useFacts(actions.bridge, [flow, ended, refilled]);
  const account = facts.fresh ?? given;
  const devices = facts.devices;
  // The account's name as the person wrote it in Settings (Wallet's store), else "Your account"; never the raw id.
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    void forApps(actions.bridge, "wallet").call<{ value: string | null }>("device.store.get", { key: ACCOUNT_NAME_KEY }).then((r) => "ok" in r && setName(r.ok.value));
  }, [actions.bridge]);
  const [, bump] = useState(0);
  const refill = async () => {
    const res = await actions.bridge.call<TxOutcome>("account.secondDevice.refill");
    if ("problem" in res) return actions.onProblem(res.problem);
    if (res.ok.status === "problem") return actions.onProblem(res.ok.problem);
    if (res.ok.status === "waiting") actions.onWaiting({ id: res.ok.id, readyAtIso: res.ok.readyAtIso, needsSecondDevice: res.ok.needsSecondDevice });
    setRefilled((n) => n + 1);
  };
  // The account's release: before release 5 a change to the rules waits only its strictest band's wait (UX walk 2 Nov).
  const [release, setRelease] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void actions.bridge.call<{ release: number }>("account.rules").then((r) => {
      if (!live) return;
      if ("ok" in r && typeof r.ok.release === "number") setRelease(r.ok.release);
    });
    return () => { live = false; };
  }, [actions.bridge, ended, flow]);
  const changeFloor = release !== null && release < 5 ? 0 : undefined;
  const flowBack = () => setFlow(null);
  if (flow === "laptop" || flow === "guardian" || flow === "phone") return <LaptopFlow kind={flow} actions={actions} onDone={() => { setFlow(null); actions.onChanged(); }} onHeld={flowBack} />;
  if (flow === "laptop-limit" || flow === "guardian-limit") return <LaptopFlow kind={flow === "laptop-limit" ? "laptop" : "guardian"} start="amount" actions={actions} onDone={() => { setFlow(null); actions.onChanged(); }} onHeld={flowBack} />;
  if (flow === "lost") return <LostDevice devices={removableDevices(devices)} delaySeconds={account.recovery?.delaySeconds ?? 0} onBack={flowBack} onRemove={(d) => { setFlow(null); actions.onRemoveKey(d.handle, "second device"); }} />;
  if (flow === "guard") return <GuardianSide bridge={actions.bridge} mainnet={account.network === "mainnet"} onBack={flowBack} onProblem={actions.onProblem} />;
  if (place === "quantum") return <QuantumSheet account={account} wordsChecked={account.keys.some((k) => k.role === "recovery") && !facts.checkDue} waitWords={release === null ? null : ruleChangeWaitWords(shared.strictestWait ?? 0, changeFloor === 0 ? 0 : account.recovery?.delaySeconds ?? 0)} onClose={onBack} onRemove={(h) => { onBack(); actions.onRemoveKey(h); }} onNewWords={() => actions.onNewWords?.({ id: "security", tab: "recovery" })} onPairAgain={() => setFlow(noLaptopPage ? "phone" : "laptop")} />;
  if (place === "protection") return <Protection bridge={actions.bridge} network={account.network} accountId={account.accountId} hasSecondDevice={account.keys.some((k) => k.role === "second-device")} recoveryDelaySeconds={release !== null && release < 5 ? 0 : account.recovery?.delaySeconds ?? 0} onBack={onBack} onProblem={actions.onProblem} onPairDevice={() => setFlow(noLaptopPage ? "phone" : "laptop")} onWaiting={(h) => actions.onWaiting(h, "protection")} {...(actions.onSafeUpdate ? { onSafeUpdate: actions.onSafeUpdate } : {})} />;
  if (place === "recovery") {
    return (
      <Sheet title="Recovery" onClose={onBack}>
        <RecoveryTab account={account} actions={actions} checkDue={facts.checkDue} devices={devices} bandWait={shared.strictestWait} changeFloor={changeFloor} />
      </Sheet>
    );
  }
  const askNext = devices ? askDeviceNext(devices, levels, rulesWaiting) : null;
  const kept = keptPhones();
  const lost = removableDevices(devices);
  const hasSecond = account.keys.some((k) => k.role === "second-device") || otherPhones(account).some((k) => kept.has(k.handle));
  return (
    <Sheet title="Devices" onClose={onBack}>
      <div className="zf-enter sec-dev">
        {/* Design review §2 (change 4): one idea, "add a second phone, so big payments need two yeses". A picture, one
            headline, one line, rows for facts, one button. No box around a sentence, no laptop promise, no footer. */}
        <TwoPhones second={hasSecond} />
        <h1 className="zf-title sec-dev__head">{hasSecond ? "Two devices can say yes" : `Only ${thisDevice()} can say yes`}</h1>
        <p className="zf-body sec-dev__line">{hasSecond ? "Big payments can need both." : "Add a second phone. Then big payments need both."}</p>
        {/* R2 (§4.9; the test list: no grey pills): one card of rows: where the key is, the second device, then the ways to
            add one and the guardian's side; its date line the card's footer; the one button on the floor. */}
        <div className="sec-dev__rows">
          {/* The key card is one row (change 5): where the key is, its proof one tap down. */}
          <KeyProofCard bridge={actions.bridge} seq={ended} row />
          {hasSecond && devices && <div className="sec-fact-row"><span>Second device</span><span className="v">{devicesLine(devices)}</span></div>}
          {addWaiting && <button className="sec-fact-row sec-fact-row--btn" onClick={() => actions.onWaiting(addWaiting)}><span>Your new device</span><span className="v">Waiting to be added ›</span></button>}
          {!hasSecond && !addWaiting && <button className="sec-fact-row sec-fact-row--btn" onClick={() => setFlow("guardian")}><span>Ask a person instead</span><span className="v">›</span></button>}
          {!hasSecond && !addWaiting && !noLaptopPage && <button className="sec-fact-row sec-fact-row--btn" onClick={() => setFlow("laptop")}><span>Add my laptop</span><span className="v">›</span></button>}
          {/* The last row (§2.9): the other side of a guardian. */}
          <button className="sec-fact-row sec-fact-row--btn" onClick={() => (markGuardianUsed(), setFlow("guard"))}>
            <span>Approve for someone else</span><span className="v">{facts.guardWaiting > 0 ? `${facts.guardWaiting} waiting ›` : "›"}</span>
          </button>
        </div>
        {devices && countsFullyLine(devices) && <p className="zf-small sec-dev__fn">{countsFullyLine(devices)}</p>}
        {!hasSecond && !addWaiting && devices && devices.length === 0 && setupWindowLine(facts.setupUntil, account.recovery?.delaySeconds ?? 0) && <p className="zf-small sec-dev__fn">{setupWindowLine(facts.setupUntil, account.recovery?.delaySeconds ?? 0)}</p>}
        {!hasSecond && !addWaiting && <div className="sec-dev__floor"><button className="zf-btn" onClick={() => setFlow("phone")}>Add a second phone</button></div>}
        {lost.length > 0 && <button className="zf-link sec-act sec-dev__lost" onClick={() => setFlow("lost")}>I lost my {lost.length === 1 ? lostName(lost[0]!) : "second device"}</button>}
        {devices?.some((d) => d.needsReAdd) && (
          <div className="zf-note sec-laptop-card zf-enter-2">
            <div className="t">Add your second device again</div>
            <p className="zf-small" style={{ marginTop: 6 }}>It can't answer a move to a new device yet.</p>
            <More label="Why" lines={["Its last update didn't go through.", "Adding it again is one Approve. It changes nothing else."]} />
            <div className="sec-other__actions"><button className="zf-link sec-act" onClick={() => void refill()}>Add it again</button></div>
          </div>
        )}
        {devices && !devices.some((d) => d.needsReAdd) && refillName(devices) && (
          <div className="zf-note sec-laptop-card zf-enter-2">
            <div className="t">Refill your {refillName(devices)}</div>
            <p className="zf-small" style={{ marginTop: 6 }}>It needs network fees to say yes or no.</p>
            <More label="How refilling works" lines={["Each yes or no pays a small network fee from your Safe.", "Refill tops it up to 1 NEAR. Nothing else changes."]} />
            <div className="sec-other__actions"><button className="zf-link sec-act" onClick={() => void refill()}>Refill</button></div>
          </div>
        )}
        {askNext && (
          <div className="zf-note sec-laptop-card zf-enter-2">
            <div className="t">Ask your {askNext} for big payments</div>
            <p className="zf-small" style={{ marginTop: 6 }}>Then a thief needs both.</p>
            <div className="sec-other__actions"><button className="zf-link sec-act" onClick={() => setFlow(askNext === "laptop" ? "laptop-limit" : "guardian-limit")}>Turn it on</button></div>
          </div>
        )}
        {otherPhones(account).filter((k) => !kept.has(k.handle)).map((k) => (
          <div key={k.handle} className="zf-note sec-other">
            <div>Another device can still approve here <span className="sec-handle">({shortHandle(k.handle)})</span>. Is it yours?</div>
            {/* the audit (rule 1): on a Safe with rules the contract can't remove a classical key: its honest line, no dead Remove */}
            {otherKeyLine(k, account.rules === true) && <p className={`zf-small sec-other__line${account.rules === true && k.access === "full" ? " sec-q__bypass-line" : ""}`}>{otherKeyLine(k, account.rules === true)}</p>}
            <div className="sec-other__actions">
              {canRemoveKey(k, account.rules === true) && <button className="zf-link sec-act" onClick={() => actions.onRemoveKey(k.handle)}>Remove it</button>}
              <button className="zf-link sec-act" onClick={() => { keepPhone(k.handle); bump((n) => n + 1); }}>Keep as my second device</button>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

interface HeldRow extends Held { title: string; lines: string[]; ready: boolean; change?: boolean; warning?: string; secondDeviceSaidYes?: boolean }
const WAITING_POLL_MS = 15_000;

/**
 * What the account's rules are holding, so a held request whose Waiting screen was closed (Done, a reload) still has
 * somewhere to be sent or cancelled from. Read on open and every 15 s while this app is on screen; nothing is drawn
 * when nothing is held. Tapping one opens the shell's Waiting screen for it.
 */
function WaitingForYou({ bridge, onOpen, seq = 0 }: { bridge: Bridge; onOpen: (held: Held) => void; seq?: number }) {
  const { active } = useShell();
  const [items, setItems] = useState<HeldRow[]>([]);
  useEffect(() => {
    if (!active) return;
    let gone = false;
    const look = async () => {
      const res = await bridge.call<HeldRow[]>("account.waiting");
      // one row for each different change: two saved with the very same rules are one (UX walk 2 Nov)
      if (!gone && "ok" in res) setItems(oneRowEach(res.ok));
    };
    void look();
    const t = setInterval(() => void look(), WAITING_POLL_MS);
    return () => {
      gone = true;
      clearInterval(t);
    };
  }, [bridge, active, seq]);
  if (items.length === 0) return null;
  return (
    <div className="sec-list zf-enter-2">
      <div className="zf-label">Waiting for you</div>
      {items.map((w) => <HeldRowView key={String(w.id)} held={w} onOpen={() => onOpen({ id: String(w.id), readyAtIso: w.readyAtIso, needsSecondDevice: w.needsSecondDevice })} />)}
    </div>
  );
}

function HeldRowView({ held, onOpen }: { held: HeldRow; onOpen: () => void }) {
  const { left, alone } = useCountdown(held.readyAtIso);
  const ready = held.ready || left === 0;
  return (
    // Something to fear (code ZeroFee doesn't know, say): the row is red and says why.
    <button className={`zf-row sec-rowbtn sec-held-row${held.warning ? " sec-row--alert" : ""}`} onClick={onOpen}>
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style={{ justifySelf: "center" }}><circle className="zf-hl" cx="12" cy="12" r="8" /><path className="zf-hl" d="M12 7.5V12l3 2" /></svg>
      <div>
        <div className="t">{held.title}</div>
        {/* D4: a change that isn't finished says so until the account has it, never a silent "Ready" */}
        <div className="d">{held.warning ?? (held.needsSecondDevice ? "Waiting for your second device's yes" : ready && held.change ? "Not finished: tap to finish it" : held.secondDeviceSaidYes ? (ready ? "Your second device said yes. Ready to send" : "Your second device said yes") : ready ? "Ready to send" : held.change ? "You, or your backup words, can stop it" : "This device can cancel it until then")}</div>
      </div>
      <span className="v">{ready ? (held.change && !held.needsSecondDevice ? "Finish" : held.needsSecondDevice ? "Waiting" : "Ready") : alone}</span>
    </button>
  );
}

/** Where the second device stands for a move to a new phone (release 7): none, not yet of age, needs re-adding, or ready. */
const deviceForRecovery = (devices: readonly SecondDevice[] | null): "none" | "young" | "ready" | "re-add" =>
  !devices || devices.length === 0 ? "none"
    : devices.some((d) => !d.needsReAdd && !d.countsFullyFromIso && !d.waitsForMove) ? "ready"
      : devices.some((d) => d.needsReAdd) ? "re-add" : "young";

function RecoveryTab({ account, actions, checkDue = false, devices, bandWait, changeFloor }: { account: AccountInfo; actions: SecurityActions; checkDue?: boolean; devices: SecondDevice[] | null; bandWait: number | null; changeFloor?: number }) {
  const [emailOn, setEmailOn] = useState(false);
  useEffect(() => {
    if (actions.noEmail) return;
    let live = true;
    void actions.bridge.call<{ on: boolean }>("account.alertsEmail.available").then((r) => live && setEmailOn("ok" in r && r.ok.on === true));
    return () => { live = false; };
  }, [actions.bridge, actions.noEmail]);
  const delay = account.recovery?.delaySeconds ?? 0;
  const pending = account.recovery?.pending;
  const wait = waitName(delay);
  const device = deviceForRecovery(devices);
  // One name for the second device on every line here: "laptop" when it is one (grade 1 Nov, item 7).
  const named = devices?.length && devices.every((d) => d.kind === "laptop") ? "laptop" : "second device";
  const [sheet, setSheet] = useState<null | "wait" | "new">(null);
  // Design review §4 (change 5): one idea, "if I lose this phone, my 24 words bring my money back". A picture, one
  // headline, one line, two fact rows, one button; each other action says what it does in its own sheet.
  // the sheets sit beside the animated page, not inside it: its transform made them cover only the area under the header
  return (
    <>
    <div className="zf-enter sec-dev">
      {pending && (
        <div className="sec-alert-row" role="alert">
          <div className="t">A new phone is asking for your account.</div>
          <p className="zf-small"><PendingCount pending={pending} device={`your ${named}`} /> {whoCanStop(pending, undefined, `your ${named}`)}</p>
          {phoneCanStop(pending) && <button className="zf-btn alert" onClick={actions.onStopRecovery}>Stop it</button>}
        </div>
      )}
      <PaperPicture />
      <h1 className="zf-title sec-dev__head">Your 24 words bring your money back</h1>
      <p className="zf-body sec-dev__line">{device === "ready" ? `Lose this phone? Type your words on a new one. Your ${named} says yes, then it takes ${wait}.` : `Lose this phone? Type your words on a new one. It takes ${wait}.`}</p>
      <div className="sec-dev__rows">
        <div className="sec-fact-row"><span>Backup words</span><span className="v">{checkDue ? "Check them" : <>{QUANTUM_WORDS.wordsDown} <span className="zf-tick on sec-key-row__tick" aria-hidden="true"><Check /></span></>}</span></div>
        <button className="sec-fact-row sec-fact-row--btn" onClick={() => setSheet("wait")}><span>The wait</span><span className="v">{wait} ›</span></button>
        {/* One pill per screen, on the floor: while a new phone is waiting, Stop it is the one and checking the words is a
            row. R2 (§4.9; the test list: no grey pills): the other actions are rows in this one card, never stacked text
            buttons or single-row cards. */}
        {pending && <button className="sec-fact-row sec-fact-row--btn" onClick={actions.onCheckWords}><span>Check my words</span><span className="v">›</span></button>}
        {actions.onNewWords && <button className="sec-fact-row sec-fact-row--btn" onClick={() => setSheet("new")}><span>Get new words</span><span className="v">›</span></button>}
        {actions.onSampleRecovery && !pending && <button className="sec-fact-row sec-fact-row--btn" onClick={actions.onSampleRecovery}><span>See a move to a new phone</span><span className="v">›</span></button>}
        {/* Only once the relay says its email door works end to end (account.alertsEmail.available, its /v0/health): never
            an email typed and a proof signed for a 503 (the relay hunt's B1, 5 Nov). */}
        {!actions.noEmail && emailOn && <More label="Email alerts" className="sec-lose"><EmailAlerts bridge={actions.bridge} onProblem={actions.onProblem} /></More>}
      </div>
      {!pending && <div className="sec-dev__floor"><button className="zf-btn" onClick={actions.onCheckWords}>Check my words</button></div>}
      {actions.rearm && !pending && <Rearm bridge={actions.bridge} onProblem={actions.onProblem} onMoving={actions.rearm.onMoving} delaySeconds={delay} secondDevice={device === "ready"} />}
    </div>
      {sheet === "wait" && (
        <Sheet title="The wait" onClose={() => setSheet(null)}>
          <div className="zf-sheet__mid">
            <p className="zf-body">You chose {wait} when you set up. It can't change.</p>
            {device !== "ready" && <p className="zf-small" style={{ marginTop: 10 }}>{device === "none" ? "If someone else tries your words, this phone can stop them in that time." : SECOND_DEVICE_MOVE_WORDS[device]}</p>}
            {/* H49: the one case nobody can undo, said in Recovery (one tap down, as before) */}
            <p className="zf-small" style={{ marginTop: 10 }}>{ALL_LOST_WORDS}</p>
            <button className="zf-btn" style={{ marginTop: 18 }} onClick={() => setSheet(null)}>OK</button>
          </div>
        </Sheet>
      )}
      {sheet === "new" && actions.onNewWords && (
        <Sheet title="Get new words" onClose={() => setSheet(null)}>
          <p className="zf-body">Someone saw your paper? Get new words. The old ones stop working when the new ones take over.</p>
          <button className="zf-btn" style={{ marginTop: 18 }} onClick={() => { setSheet(null); actions.onNewWords?.({ id: "security", tab: "recovery" }); }}>Get new words</button>
        </Sheet>
      )}
    </>
  );
}

/** Recovery's picture (§4.2): a sheet of paper with short lines, a pencil beside it. */
function PaperPicture() {
  return (
    <svg className="sec-dev__pic" width="132" height="104" viewBox="0 0 132 104" aria-hidden="true">
      <rect className="zf-hl" x="22" y="2" width="72" height="98" rx="5" />
      {[16, 26, 36, 46, 56, 66, 76, 86].map((y) => <path key={y} className="zf-hl" d={`M32 ${y}h${y % 20 === 6 ? 40 : 52}`} />)}
      <path className="zf-hl" d="m104 84 18-58 6 2-18 58-7 4z" />
    </svg>
  );
}

/** The pending move's countdown, said as the old phone says it (recovery-words.ts). */
function PendingCount({ pending, device }: { pending: NonNullable<NonNullable<AccountInfo["recovery"]>["pending"]>; device?: string }) {
  const c = oldPhoneCount(pending, device);
  const { left, text } = useCountdown(c.untilIso);
  if (left === 0) return <>{c.atZero}</>;
  return <>{c.before}<b>{text}</b>{c.after}</>;
}

/** What the account did may have changed: a move or a payment signed, ended or came back. */
export const ACCOUNT_CHANGED = ["spending.changed", "ledger.balancesChanged"] as const;

type ActivityRow = { atIso: string; title: string; lines?: string[]; by?: string; ok?: boolean; partly?: boolean; explorerUrl?: string };

/** `bare`: under Activity's own title (Home's Activity, Job 1): no second heading. */
function ActivityTab({ bridge, bare = false }: { bridge: Bridge; bare?: boolean }) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [onlyHere, setOnlyHere] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setProblem(null);
    // `quiet`: a read again after something was approved (the Activity walk, 6 Nov, item 9: read once on opening, it said
    // "Nothing yet." after a Send, a Move and a top-up were approved); a failed quiet read keeps the rows shown
    const read = (quiet = false) => void bridge.call<ActivityRow[]>("account.activity", { limit: 50 }).then((res) => {
      if (!live) return;
      if ("ok" in res) return setRows(res.ok);
      if (res.problem.code === "security.method.unknown") {
        setOnlyHere(true);
        return setRows(localEvents());
      }
      if (!quiet) setProblem(res.problem);
    });
    read();
    const offs = ACCOUNT_CHANGED.map((ev) => bridge.on(ev, () => read(true)));
    return () => { live = false; offs.forEach((off) => off()); };
  }, [bridge, attempt]);
  if (problem) return (
    <div className="sec-center-text zf-enter" style={{ marginTop: 60 }}>
      <p className="zf-body">{problem.whatHappened}</p>
      <button className="zf-link sec-act" style={{ justifySelf: "center" }} onClick={() => setAttempt((n) => n + 1)}>{problem.next.label}</button>
    </div>
  );
  const head = bare ? <p className="zf-small sec-act-head">{onlyHere ? "What happened on this device." : "What your account did, and what approved each one."}</p> : <div className="sec-tab-head"><h2 className="zf-title">Activity</h2><p className="zf-small">{onlyHere ? "What happened on this device." : "Everything your account did, and what approved each one."}</p></div>;
  // Reading: the page's own shape at once, with words, never a bare spinner for seconds (grade 02f, F9).
  if (!rows) return (
    <div className="zf-enter" aria-busy="true">
      {head}
      <p className="zf-small" role="status" style={{ marginBottom: 6 }}>Reading your account's history…</p>
      {[0, 1, 2, 3].map((i) => <div key={i} className="sec-act-row sec-act-skel" aria-hidden="true"><div className="t" /><div className="d" /></div>)}
    </div>
  );
  return (
    <div className="zf-enter">
      {head}
      {rows.length === 0 && <p className="zf-small" style={{ textAlign: "center", marginTop: 40 }}>Nothing yet.</p>}
      {rows.map((r, i) => {
        const inside = (
          <>
            <div className="t">{r.title}</div>
            <div className="d">
              {/* the set-up row's title says it all: no "by set-up" (the Copywriter, 5 Nov), as Home's Activity (format.ts) */}
              {showsBy(r) && <span className="sec-by">by {(r.by === "This phone" ? ThisDevice() : r.by!).replace(/^./, (c) => c.toLowerCase())}</span>}
              {showsBy(r) && " · "}{ago(r.atIso)}
              {r.ok === false ? " · didn't go through (it cost only the network fee)" : r.partly ? " · went through, but a later step didn't" : ""}
              {r.explorerUrl && r.lines && r.lines.length > 1 && ` · ${r.lines.length} steps`}
              {r.explorerUrl && <> · <span className="sec-see">See it</span></>}
            </div>
            {/* A row's steps are one tap down (UI-SIMPLICITY-RULES 2), under its who and when (round 3, Black walk: the fold
                sat between the title and its own "by … · 2 h ago"); on a row that opens the record, the count only. */}
            {r.lines && r.lines.length > 1 && !r.explorerUrl && <More label={`${r.lines.length} steps`} className="sec-act-more" lines={r.lines} />}
          </>
        );
        // The whole row is the target (grade 02f, F4: nine 33×15 "See it" links on one screen).
        const cls = `sec-act-row${r.ok === false ? " failed" : ""}`;
        return r.explorerUrl
          ? <a key={i} className={`${cls} sec-act-link`} href={r.explorerUrl} target="_blank" rel="noopener" aria-label={`${r.title}. See it`}>{inside}</a>
          : <div key={i} className={cls}>{inside}</div>;
      })}
    </div>
  );
}

/** A row's signer, said under it: none for the set-up request (its title says it). */
const showsBy = (r: ActivityRow): boolean => !!r.by && r.by !== "Set-up";

function ago(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Laptop approval: explain → scan the code the LAPTOP shows (the phone is the authority: it approves adding the
 * laptop on the sheet and never displays anything for another device to trust) → pick the amount → approve.
 */
/** Where the laptop's code is found: a real deployment's own /laptop page, or (the public demo, a local address) the
 *  app's own instruction, never an address a person can't open (laptop-words.ts). */
// the Sim (sample money, ?demo too): the app's own instruction, never an address (its /laptop opens the Sim itself)
const LAPTOP = laptopWords(PUBLIC_RELEASE || ("page" in MODE && MODE.page === "demo"), typeof location === "undefined" ? undefined : location.origin, MAINNET);
/** The words of pairing a second device: the person's own laptop, their other phone, or a guardian (a trusted person's
 *  ZeroFee). The other phone pairs the way a guardian's does today (it shows its code under Approve for someone else; D64), so the
 *  core is asked for a "guardian" device for both. Design review §5 (change 6): the step is one sentence, "All" not
 *  "Always", the amount row before the scan, with air under it. */
const PAIR_WORDS = {
  laptop: {
    top: "Second device", title: "Add your laptop", body: "Big payments then need your laptop's yes too. A thief would need both.",
    steps: LAPTOP.later ? [] : [LAPTOP.open, "Copy the code it shows, and paste it here"],
    scanButton: "Scan my laptop's code", scanTitle: "Scan the code on your laptop", scanWhere: LAPTOP.where,
    match: "Check the code on your laptop matches the next screen.", add: "Add this laptop", ask: "Ask my laptop for payments", askRow: "Ask my laptop for payments over",
  },
  phone: {
    top: "Second phone", title: "Add your other phone", body: "Big payments then need its yes too. A thief would need both phones.",
    // Dead ends row 16: the other phone needs no account of its own. Welcome offers the same step (Onboarding.tsx).
    // the copy review's S5 (7 Nov): the run-on as two numbered lines. Step 1 names the tap the other phone really has (Welcome's
    // "Approve for someone else", Onboarding.tsx; the copy review ruled it stands); step 2 is its own button's (pair-steps.ts)
    step1: "On your other phone, open ZeroFee and tap Approve for someone else.",
    scanButton: PAIR_STEP_TWO.iphone.button, scanTitle: "Scan the code on your other phone", scanWhere: "It shows it under Approve for someone else.",
    match: "Check the letters on your other phone match the next screen.", add: "Add this phone", ask: "Ask your other phone for payments", askRow: "Ask it for payments over",
  },
  guardian: {
    top: "Guardian", title: "Pick a person you trust", body: "They say yes to your big payments too. They never see your money.",
    // the copy review (7 Nov, B11): the heading says where ("On their phone"), so step 1 starts with them
    stepsHead: "On their phone",
    step1: "They open ZeroFee and tap Approve for someone else.",
    scanButton: "Scan their code", scanTitle: "Scan the code on their phone", scanWhere: "Their phone shows it under Approve for someone else.",
    match: "Check their phone's letters match the next screen.", add: "Add my guardian", ask: "Ask your guardian for payments", askRow: "Ask them for payments over",
  },
} as const;

/** The guardian's picture (§5.2): two people, one holding a phone that shows a tick. A person, never a laptop. */
function TwoPeople() {
  return (
    <svg width="168" height="112" viewBox="0 0 168 112" aria-hidden="true">
      <circle className="zf-hl" cx="50" cy="26" r="14" /><path className="zf-hl" d="M22 108c0-22 12-38 28-38s28 16 28 38" />
      <circle className="zf-hl" cx="118" cy="26" r="14" /><path className="zf-hl" d="M90 108c0-22 12-38 28-38s28 16 28 38" />
      <rect className="zf-hl" x="146" y="56" width="20" height="34" rx="4" /><path className="zf-hl" d="m150 73 4 4 8-9" />
    </svg>
  );
}

/** Devices' picture (§2.2): two phones; this one filled with a tick, the second outlined until it is added. */
export function TwoPhones({ second = false }: { second?: boolean }) {
  const phone = (x: number, filled: boolean) => (
    <g>
      <rect x={x} y="2" width="52" height="92" rx="11" className={filled ? "sec-phone--on" : "zf-hl"} />
      {filled && <path d={`m${x + 17} 48 7 7 12-14`} className="sec-phone__tick" />}
    </g>
  );
  return (
    <svg className="sec-dev__pic" width="140" height="98" viewBox="0 0 140 98" aria-hidden="true">
      {phone(10, true)}
      {second ? phone(78, true) : <rect x="78" y="2" width="52" height="92" rx="11" className="zf-hl" strokeDasharray="3 5" />}
    </svg>
  );
}

/** `onHeld`: the account holds the change (the Waiting screen opens): this flow closes, so Done there returns to Security. */
/** `start: "amount"`: straight to its yes for payments (after it was added, the Overview's next step). */
export function LaptopFlow({ actions, onDone, onHeld, kind = "laptop", start }: { actions: SecurityActions; onDone: () => void; onHeld?: () => void; kind?: "laptop" | "guardian" | "phone"; start?: "amount" }) {
  const held = (h: Held) => {
    actions.onWaiting(h);
    onHeld?.();
  };
  const t = PAIR_WORDS[kind];
  const phone = onPhone();
  const [step, setStep] = useState<"explain" | "laptop" | "scan" | "amount">(start ?? "explain");
  // the web demo: the laptop is shown on its own screen, with the code it shows and a Copy (the real laptop's page)
  const sample = kind === "laptop" ? actions.sampleLaptop : undefined;
  const [code, setCode] = useState("");
  /** A code that didn't match: said under the field, where it can be fixed (grade 1 Nov c, P14), never a full screen. */
  const [codeWrong, setCodeWrong] = useState<string | null>(null);
  const [limit, setLimit] = useState<number | "always">(DEFAULT_PROTECTION.faceIdUpToUsd);
  // The code is about 3,100 letters: pasted, never typed. The clipboard is read only on a Paste tap (D33). A whole code
  // goes straight on to the approval sheet (grade 1 Nov, D10: Paste used to open an empty field); anything else, or no
  // permission, opens the field, with its own Paste.
  const [asking, setAsking] = useState(false);
  const readCode = async (): Promise<string | null> => {
    try {
      const text = (await navigator.clipboard?.readText())?.trim();
      return text && isPairingCode(text) ? text : null;
    } catch {
      return null;
    }
  };
  const pasteCode = async () => {
    const text = await readCode();
    if (text) {
      setCode(text);
      return void pair(text);
    }
    setStep("scan");
  };
  const pasteHere = async () => {
    const text = await readCode();
    if (text) setCode(text);
  };
  // Grade 1 Nov, D11: one goal ("my laptop protects me"), so the amount is chosen first, on the first screen, and its
  // yes is asked for right after the device is added: Paste, Approve, Approve.
  const pair = async (qr = code.trim()) => {
    // Finding 54: a code that isn't a whole pairing code opens nothing; it's said under the field, where it can be fixed.
    if (!isPairingCode(qr)) {
      setCode(qr);
      setCodeWrong(securityProblems.pairingCodeWrong(kind === "laptop" ? "your laptop" : "their ZeroFee").whatHappened);
      return setStep("scan");
    }
    setAsking(true);
    setCodeWrong(null);
    const res = await actions.bridge.call<TxOutcome>("account.secondDevice.pair", { qr, kind: kind === "laptop" ? "laptop" : "guardian" }).finally(() => setAsking(false));
    if ("problem" in res && res.problem.code === "security.pairing.code-wrong") {
      setCode(qr);
      setCodeWrong(res.problem.whatHappened);
      return setStep("scan");
    }
    if ("problem" in res) return actions.onProblem(res.problem);
    // After the account's first day a new second device waits a change's wait: the amount comes once it's added.
    if (res.ok.status === "waiting") return held({ id: res.ok.id, readyAtIso: res.ok.readyAtIso, needsSecondDevice: res.ok.needsSecondDevice });
    if (res.ok.status === "problem") return actions.onProblem(res.ok.problem);
    if (res.ok.status === "declined") return setStep("scan");
    setStep("amount");
    await finish();
  };
  // Setting the limit rewrites the protection bands, so it takes the strictest level and may come back held (D17).
  const finish = async () => {
    setAsking(true);
    const res = await actions.bridge.call<TxOutcome>("account.secondDevice.setLimit", { usd: limit }).finally(() => setAsking(false));
    if ("problem" in res) return actions.onProblem(res.problem);
    const out = res.ok;
    if (out.status === "problem") return actions.onProblem(out.problem);
    if (out.status === "waiting") return held({ id: out.id, readyAtIso: out.readyAtIso, needsSecondDevice: out.needsSecondDevice });
    if (out.status === "done") onDone();
  };
  // The arrow, Escape and browser Back are one way back, a step at a time (grade 01d, Q4: only the arrow left).
  const back = step === "explain" || (start === "amount" && step === "amount") ? onDone : () => setStep(step === "amount" ? "scan" : step === "scan" && sample ? "laptop" : "explain");
  const el = useRef<HTMLDivElement>(null);
  useBack(back, el);
  return (
    <div className="zf-screen zf-pad sec-flow" ref={el}>
      <div className="zf-top">
        <button className="zf-icon-btn" onClick={back} aria-label="Back"><Back /></button>
        <span className="zf-label">{step === "laptop" ? "Your laptop" : t.top}</span>
        <span style={{ width: 28 }} />
      </div>
      {step === "explain" && (
        <>
          <div className="sec-devices zf-enter" aria-hidden="true">
            {kind === "guardian" ? <TwoPeople /> : kind === "phone" ? <TwoPhones /> : <>
              <svg width="60" height="96" viewBox="0 0 60 96"><rect className="zf-hl" x="1" y="1" width="58" height="94" rx="12" /><path className="zf-hl" d="M24 7h12" /></svg>
              <svg width="40" height="2" viewBox="0 0 40 2" style={{ marginBottom: 46 }}><path d="M0 1h40" stroke="currentColor" strokeWidth="1.25" strokeDasharray="2 5" strokeLinecap="round" /></svg>
              <svg width="132" height="92" viewBox="0 0 132 92"><rect className="zf-hl" x="14" y="1" width="104" height="70" rx="6" /><path className="zf-hl" d="M1 82h130l-6 9H7z" /></svg>
            </>}
          </div>
          <div className="sec-center-text zf-enter-2">
            <h1 className="zf-title">{t.title}</h1>
            <p className="zf-body" style={{ marginTop: 12 }}>{t.body}</p>
          </div>
          {/* D11: the amount first, so adding it and turning on its yes is one goal (default already picked: no tap); a
              plain row, not a caps label, with 24 pt of air so the floor button never reaches it (review §5.5) */}
          {!(kind === "laptop" && LAPTOP.later && !sample) && <div className="sec-ask-row zf-enter-3">
            <p className="zf-body sec-ask-row__label">{t.askRow}</p>
            <div className="sec-presets">
              {([500, 1000, 5000, "always"] as const).map((v) => (
                <button key={v} aria-pressed={limit === v} onClick={() => setLimit(v)}>{v === "always" ? "All" : `$${v.toLocaleString()}`}</button>
              ))}
            </div>
          </div>}
          {kind === "laptop" && LAPTOP.later && !sample ? <p className="zf-note zf-enter-3" role="note" style={{ marginTop: 18 }}>{LAPTOP.open}</p> : <>{"stepsHead" in t && <p className="zf-label sec-steps__head zf-enter-3">{t.stepsHead}</p>}<ol className="sec-steps zf-enter-3">{("step1" in t ? [t.step1, pairStepTwo(phone).step] : t.steps).map((s) => <li key={s}>{s}</li>)}</ol></>}
          {/* H13: the laptop page's one fixed address, to copy (and send to the laptop) instead of typing it */}
          {kind === "laptop" && !sample && LAPTOP.address && <CopyAddress address={LAPTOP.address} />}
          <div className="zf-fill" />
          {/* A browser has no scanner here (Permissions-Policy camera=()): Paste only, no frame that looks like one. */}
          <div className="zf-floor">{kind === "laptop" && LAPTOP.later && !sample ? <button className="zf-btn" onClick={onDone}>Done</button> : sample ? <button className="zf-btn" onClick={() => setStep("laptop")}>Open ZeroFee on my laptop</button> : phone ? <><button className="zf-btn" onClick={() => setStep("scan")}>{t.scanButton}</button><button className="zf-link" onClick={() => void pasteCode()}>Paste the code</button></> : <button className="zf-btn" disabled={asking} onClick={() => void pasteCode()}>{asking ? "Asking your account…" : PAIR_STEP_TWO.web.button}</button>}</div>
        </>
      )}
      {step === "laptop" && sample && (
        <>
          <div className="sec-center-text zf-enter" style={{ marginTop: 24 }}>
            <h1 className="zf-title">On your laptop</h1>
            <p className="zf-small" style={{ marginTop: 8 }}>You opened ZeroFee there and chose Second device. Your laptop shows this:</p>
          </div>
          <div className="zf-fill" />
          <LaptopWindow>
            {/* sd-security (h): never the code's own text ("ZFL1:LAPT…", machine text that read unlike its letters): its letters and Copy */}
            <div className="zf-label">Letters to check</div>
            <p className="sec-laptop-letters sec-lw-letters">{sample.letters}</p>
            <button className="zf-btn sec-lw-btn" onClick={() => { setCode(sample.code); void navigator.clipboard?.writeText(sample.code).catch(() => undefined); setStep("scan"); }}>Copy the code</button>
          </LaptopWindow>
          <div className="zf-fill" />
          <div className="zf-floor"><p className="zf-small">Copy it on the laptop. Then you're back on {thisDevice()} to paste it.</p></div>
        </>
      )}
      {step === "scan" && (
        <>
          <div className="sec-center-text zf-enter" style={{ marginTop: 30 }}>
            <h1 className="zf-title">{phone ? t.scanTitle : "Paste the code"}</h1>
            <p className="zf-small" style={{ marginTop: 8 }}>{t.scanWhere}</p>
          </div>
          {phone && <div className="sec-scan zf-enter-2" aria-hidden="true"><span /><span /><span /><span /></div>}
          <div className="sec-code zf-enter-3">
            <label className="zf-label" htmlFor="laptop-code">{phone ? "Or paste the code" : "The code"}</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input id="laptop-code" style={{ flex: 1 }} value={code} onChange={(e) => { setCode(e.target.value); setCodeWrong(null); }} aria-invalid={codeWrong ? true : undefined} aria-describedby={codeWrong ? "laptop-code-wrong" : undefined} autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="ZFL1:…" />
              <button className="zf-link sec-act" style={{ minHeight: 44 }} onClick={() => void pasteHere()}>Paste</button>
            </div>
            {codeWrong && <p id="laptop-code-wrong" className="zf-small" role="alert" style={{ marginTop: 10, color: "var(--alert)" }}>{codeWrong}</p>}
            <p className="zf-small" style={{ marginTop: 10 }}>{sample && code.trim() === sample.code ? `Your laptop shows the letters ${sample.letters}. They match.` : t.match}</p>
          </div>
          <div className="zf-fill" />
          <div className="zf-floor"><button className="zf-btn" disabled={!code.trim() || asking} onClick={() => void pair()}>{asking ? "Asking your account…" : t.add}</button><p className="zf-small">You'll approve adding it on the next screen.</p></div>
        </>
      )}
      {step === "amount" && (
        <>
          <div className="sec-center-text zf-enter" style={{ marginTop: 30 }}><h1 className="zf-title">{t.ask}</h1></div>
          <div className="sec-center-text zf-enter-2" style={{ marginTop: 40 }}>
            <div className="zf-label">{limit === "always" ? "every payment" : "above"}</div>
            <div className="sec-amount">{limit === "always" ? "All" : `$${limit.toLocaleString()}`}</div>
          </div>
          <div className="sec-presets">
            {([500, 1000, 5000, "always"] as const).map((v) => (
              <button key={v} aria-pressed={limit === v} onClick={() => setLimit(v)}>{v === "always" ? "All" : `$${v.toLocaleString()}`}</button>
            ))}
          </div>
          <p className="zf-small" style={{ textAlign: "center", marginTop: 16 }}>Payments under this stay one tap.</p>
          <div className="zf-fill" />
          <div className="zf-floor"><button className="zf-btn" disabled={asking} onClick={() => void finish()}>{asking ? "Asking your account…" : `Turn on ${kind === "laptop" ? "your laptop's" : kind === "phone" ? "your other phone's" : "your guardian's"} yes`}</button><p className="zf-small">You'll approve it on the next screen.</p></div>
        </>
      )}
    </div>
  );
}

/** H13: the second device's address, with a Copy (the person's own tap writes it; nothing is read). */
function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`https://${address}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="sec-copy-address zf-enter-3">
      <span className="sec-copy-address__a">{address}</span>
      <button className="zf-link sec-act" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

/**
 * H09, "I lost my laptop": Remove it from this phone alone. The contract allows it without the lost device's yes (it
 * can't give one, audit F3), after a wait (for one that counts fully, the words-only fallback, R7-1), so someone with
 * only this phone can't quietly remove it. Then the approval sheet, then the Waiting screen with the date.
 */
export function LostDevice({ devices, delaySeconds, onBack, onRemove }: { devices: readonly SecondDevice[]; delaySeconds: number; onBack: () => void; onRemove: (d: SecondDevice) => void }) {
  const [pick, setPick] = useState<SecondDevice | null>(devices.length === 1 ? devices[0]! : null);
  const name = pick ? lostName(pick) : "second device";
  const back = pick && devices.length > 1 ? () => setPick(null) : onBack;
  const el = useRef<HTMLDivElement>(null);
  useBack(back, el);
  return (
    <div className="zf-screen zf-pad sec-flow" ref={el}>
      <div className="zf-top">
        <button className="zf-icon-btn" onClick={back} aria-label="Back"><Back /></button>
        <span className="zf-label">Second device</span>
        <span style={{ width: 28 }} />
      </div>
      {!pick ? (
        <div className="zf-enter">
          <h1 className="zf-title">Which one did you lose?</h1>
          {devices.map((d) => (
            <button key={d.handle} className="zf-row sec-rowbtn" onClick={() => setPick(d)}>
              <span />
              <div><div className="t">Your {lostName(d)}</div><div className="d sec-handle">{d.handle.slice(-8)}</div></div>
              <span className="v" />
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="sec-center-text zf-enter">
            <h1 className="zf-title">Remove your lost {name}</h1>
            <p className="zf-body" style={{ marginTop: 12 }}>{LOST_WORDS.what(name)}</p>
            <p className="zf-body" style={{ marginTop: 12 }}>{LOST_WORDS.wait(name, waitPlain(fallbackSeconds(delaySeconds)))}</p>
            <p className="zf-small" style={{ marginTop: 12 }}>{LOST_WORDS.after(name)}</p>
          </div>
          <div className="zf-fill" />
          <div className="zf-floor">
            <button className="zf-btn" onClick={() => onRemove(pick)}>Remove my {name}</button>
            <p className="zf-small">You'll approve this on this device.</p>
          </div>
        </>
      )}
    </div>
  );
}

/** The lost-device screen's words (H09), kept apart so a test reads exactly what the person reads. */
export const LOST_WORDS = {
  what: (name: string) => `Your ${name} doesn't need to say yes. ${ThisDevice()} removes it alone.`,
  wait: (name: string, fallback: string) => `It waits about ${fallback}, so a thief can't remove your ${name} quietly. You can cancel it.`,
  after: (name: string) => `Then big payments wait instead of asking it. Add a new one.`,
};
