// Protection by amount: the person picks what each size of payment needs. Each band is one of:
// approve · approve + a wait (this phone is alerted and can cancel; needs no other device) · approve + a second device ·
// all of it. Any change to the rules, or a key, takes the strictest level and waits at least a change's wait (the recovery
// wait plus up to a day more), a stricter rule too: the account contract enforces this on chain (lib.rs place, floor_ns),
// so the note says the real wait. The wait is the default upgrade: it needs only one phone.
//
// The screen opens on the ACCOUNT'S rules, read from the contract through the core (account.protection.get's `usd`):
// for a new account that is what set-up wrote (DEFAULT_PROTECTION). Nothing here has a default of its own, and Save
// sends only what is on screen, only after the person changed something.
import { useEffect, useState, type ReactNode } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import type { TxOutcome } from "@zerofee/core/signer";
import { More } from "@zerofee/design/More.tsx";
import { approvalWords } from "@zerofee/shell-api/approval-words.ts";
import type { Held } from "../../shell/WaitingView.tsx";
import { Chevron } from "@zerofee/design/icons.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { ReadLine } from "@zerofee/design/ReadLine.tsx";
import { endsWords } from "../../screens/countdown.ts";
import { FEW_COINS_LINE, LIMITS, SAVED_STATUS, SAVING_STATUS, saveLabel, changeRuleLine, changed, keepOrder, rowWords, strictestWait, rangeWords, toCore, usd, waitChoices, waitLabel, type Band, type Loaded } from "./rules.ts";
import { onApprovalAnswered } from "../../shell/approval-answered.ts";
import { CHECKING_RULES, QUIET_RETRIES, QUIET_RETRY_MS, freshView, keepRules, keptRules, type RulesRead } from "./protection-cache.ts";
import { INTRO, pendingRow } from "./protection-words.ts";
import "./protection.css";
import { SafeUpdateRow } from "../../shell/SafeUpdateCard.tsx";

import { openOn } from "./rules-now.ts";
import { ruleChangeFoot } from "./rules-lines.ts";
export type { Band, Level } from "./rules.ts";

export function Protection({ bridge, network, accountId = "", hasSecondDevice, recoveryDelaySeconds = 0, onBack, onProblem, onPairDevice, onWaiting, onSafeUpdate }: {
  bridge: Bridge; network: string;
  /** Keys the rules kept on this device (protection-cache.ts). */ accountId?: string;
  hasSecondDevice: boolean; /** The account's recovery wait: a change waits that plus up to a day more. */ recoveryDelaySeconds?: number; onBack: () => void; onProblem: (p: Problem) => void; onPairDevice: () => void; onWaiting: (held: Held) => void; /** The Safe's update held screen: always findable here. */ onSafeUpdate?: () => void;
}) {
  const w = approvalWords();
  // k-security crawl (4 Nov): the last rules this device read show at once; NEAR is read quietly behind them
  const [view, setView] = useState<Loaded>(() => {
    const kept = keptRules(network, accountId);
    const v = kept ? openOn(kept, network) : null;
    return v?.k === "bands" ? v : { k: "loading" };
  });
  /** NEAR answered with the rules on this open: until then a kept copy shows, and Save waits for NEAR. */
  const [fresh, setFresh] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    let again: ReturnType<typeof setTimeout> | undefined;
    const read = (left: number) => void bridge.call<RulesRead>("account.protection.get").then((res) => {
      if (!live) return;
      const got = "ok" in res ? res.ok : null;
      const next = openOn(got, network);
      if (next.k === "bands") {
        keepRules(network, accountId, got);
        setFresh(true);
        return setView((v) => freshView(v, next));
      }
      // no rules from NEAR: a kept copy stays on screen and is asked again quietly; with none, the line and Retry
      setView((v) => (v.k === "bands" ? v : next));
      if (left > 0) again = setTimeout(() => read(left - 1), QUIET_RETRY_MS);
    });
    read(QUIET_RETRIES);
    return () => {
      live = false;
      if (again) clearTimeout(again);
    };
  }, [bridge, network, accountId, tries]);
  // A change to these rules the account is already holding (grade 01c, P7: Protection said "Nothing changed" while one
  // waited): said at the top, with when its wait ends, and it opens the Waiting screen to finish or cancel it.
  const [pending, setPending] = useState<(Held & { title: string; ready: boolean; countsEveryCoin: boolean }) | null>(null);
  // Until the account has said what it holds, rules that count few coins offer no save: the person may already have
  // saved new ones (mainnet 2 Nov: a test account saved twice, each waiting, and was offered a third).
  const [pendingRead, setPendingRead] = useState(false);
  useEffect(() => {
    let live = true;
    void bridge.call<(Held & { title?: unknown; ready?: unknown; countsEveryCoin?: unknown })[]>("account.waiting").then((res) => {
      if (!live) return;
      setPendingRead(true);
      if (!("ok" in res) || !Array.isArray(res.ok)) return;
      // the newest held change to these rules (a later save is the one that counts)
      const w = res.ok.filter((x) => /protection/i.test(String(x.title ?? ""))).sort((x, y) => Number(y.id) - Number(x.id))[0];
      setPending(w ? { id: String(w.id), readyAtIso: w.readyAtIso, needsSecondDevice: w.needsSecondDevice === true, title: String(w.title), ready: w.ready === true, countsEveryCoin: w.countsEveryCoin === true } : null);
    });
    return () => {
      live = false;
    };
  }, [bridge, tries]);
  // A held change that ended (it ran, or was cancelled) is read again at once (sd-security (g): after "Your new protection
  // is on" the page still offered a lit "Save my rules" for the rules the account now holds).
  useEffect(() => bridge.on("account.waiting.ended", () => setTries((t) => t + 1)), [bridge]);
  const [editing, setEditing] = useState<{ i: number; what: "level" | "limit" } | null>(null);
  // Save says what it's doing from the tap (grade 1 Nov b, N3: two taps, minutes, no status): reading the account and
  // today's price, then the approval sheet; from Approve, that it's saving (grade 01d, Q10). One save at a time.
  const [saving, setSaving] = useState(false);
  const [approved, setApproved] = useState(false);

  // Rule 12 (A shell 3, 5 Nov): a full-screen Sheet with Close, never a pushed page under the tab bar. Its pickers are
  // siblings of it, so one opening over it hides it whole (a sheet inside a sheet would hide itself).
  const page = (body: ReactNode) => <Sheet title="Protection" onClose={onBack}><div className="pr-page">{body}</div></Sheet>;
  // Never "Reading your rules…" alone (design review §3.8, change 7): the screen's one line, and a line while it reads;
  // a read that fails names NEAR, with Retry.
  if (view.k !== "bands") {
    return page(
      <>
        {onSafeUpdate && <SafeUpdateRow bridge={bridge} onOpen={onSafeUpdate} />}
        <div className="pr-head zf-enter">
          <p className="zf-body pr-intro">{INTRO}</p>
          {view.k === "unread" && view.now.length > 0 && <p className="zf-small pr-now">Now: {view.now.join(" · ")}</p>}
          {view.k === "loading"
            ? <p className="zf-small pr-now" role="status">Reading your rules from NEAR…</p>
            : <ReadLine text="NEAR didn't give your rules just now. Your money is in your Safe." onRetry={() => (setView({ k: "loading" }), setFresh(false), setTries((t) => t + 1))} />}
        </div>
      </>
    );
  }

  const { bands, from, first, now, fewCoins } = view;
  const edited = changed(bands, from);
  // H01: rules that count only NEAR, USDC and USDT can be saved as they are, to count every coin
  const dirty = first || edited || !!fewCoins;
  // Rules that count every coin already saved and held: finishing them is the step, never a second save of the same.
  const finishSaved = !!fewCoins && !edited && pending?.countsEveryCoin === true ? pending : null;
  // Every wait the account held when the screen opened stays a choice after another is picked (N8).
  const heldWaits = from.filter((f) => f.level === "wait" || f.level === "both").map((f) => f.waitSeconds);
  const update = (i: number, patch: Partial<Band>) => setView((v) => (v.k === "bands" ? { ...v, bands: keepOrder(v.bands.map((b, j) => (j === i ? { ...b, ...patch } : b))) } : v));
  const save = async () => {
    if (!fresh || !dirty || saving) return;
    setApproved(false);
    const stop = onApprovalAnswered((yes) => yes && setApproved(true));
    setSaving(true);
    const res = await bridge.call<TxOutcome>("account.protection.set", { bands: toCore(bands) }).finally(() => (stop(), setSaving(false)));
    const out: TxOutcome = "problem" in res ? { status: "problem", problem: res.problem } : res.ok;
    if (out.status === "problem") return onProblem(out.problem);
    if (out.status === "declined") return;
    // Changing the rules takes the CURRENT strictest level, so the change itself may wait.
    if (out.status === "waiting") return onWaiting({ id: out.id, readyAtIso: out.readyAtIso, needsSecondDevice: out.needsSecondDevice });
    onBack();
  };
  const rule = changeRuleLine(from, recoveryDelaySeconds, w);
  return (
    <>
    {page(<>
      {/* The Safe's update, always findable here, first: unknown code waiting is red above everything (MUST 1). */}
      {onSafeUpdate && <SafeUpdateRow bridge={bridge} onOpen={onSafeUpdate} />}
      {/* Design review §3 (change 5): one idea, "what a payment needs, by its size". One line introducing the word Home
          uses, then the rules as rows; no question, no essay, no button that does nothing. */}
      <div className="pr-head zf-enter">
        <p className="zf-body pr-intro">{INTRO}</p>
        {/* what the account has now, only once it differs from what is on screen (never the same rules twice) */}
        {now.length > 0 && edited && <More label="Now on your account" lines={now} className="pr-now" />}
        {fewCoins && !finishSaved && <p className="zf-small pr-now" role="note">{FEW_COINS_LINE}</p>}
        {pending && (
          <button className="pr-row pr-row--pending" onClick={() => onWaiting(pending)}>
            <span>{pendingRow(pending)}</span><span className="pr-row__v"><Chevron /></span>
          </button>
        )}
      </div>
      <div className="pr-rows zf-enter-2">
        {bands.map((b, i) => (
          <button key={i} className="pr-row" onClick={() => setEditing({ i, what: "level" })}>
            <span>{rangeWords(bands, i)}</span><span className="pr-row__v">{rowWords(b, w)} <span className="pr-row__chev" aria-hidden="true">›</span></span>
          </button>
        ))}
      </div>
      {!first && <p className="zf-small pr-rule__line zf-enter-3">{rule.waits ? ruleChangeFoot(strictestWait(from), recoveryDelaySeconds) : rule.line}</p>}
      <div className="zf-fill" />
      {/* No floor button until something changed (§3.6). */}
      {(dirty || finishSaved || saving) && <div className="zf-floor">
        {saving && <p className="zf-small pr-saving" role="status">{approved ? SAVED_STATUS : SAVING_STATUS}</p>}
        {finishSaved
          ? <button className="zf-btn" onClick={() => onWaiting(finishSaved)}>{finishSaved.ready ? "Finish my new rules" : "See my new rules"}</button>
          : <>
            {/* a kept copy on screen: Save waits for NEAR's own answer (a change elsewhere may be newer) */}
            {!fresh && !saving && <p className="zf-small pr-saving" role="status">{CHECKING_RULES}</p>}
            <button className="zf-btn" onClick={save} disabled={!fresh || !dirty || saving || (!!fewCoins && !edited && !pendingRead)} aria-busy={saving}>{saveLabel({ first, edited, fewCoins: !!fewCoins, saving })}</button>
          </>}
      </div>}
    </>)}
      {editing?.what === "level" && (
        <Sheet title={`${rangeWords(bands, editing.i)} needs`} onClose={() => setEditing(null)}>
          {(["faceid", "wait", "device", "both"] as const).map((lv) => {
            const needsDevice = (lv === "device" || lv === "both") && !hasSecondDevice;
            const b = bands[editing.i];
            return (
              <div key={lv} className={`pr-opt${b.level === lv ? " on" : ""}${needsDevice ? " off" : ""}`}>
                <button className="pr-opt__main" disabled={needsDevice} onClick={() => update(editing.i, { level: lv })}>
                  <span className="pr-radio" aria-hidden="true" />
                  <span>
                    <span className="t">{rowWords({ ...b, level: lv }, w).replace(/, then a [\w-]+ wait$/, ", then a wait").replace(/, a wait and/, ", a wait and")}</span>
                  </span>
                </button>
                {needsDevice && <button className="zf-link pr-pair" onClick={onPairDevice}>Add a second device first</button>}
                {(lv === "wait" || lv === "both") && b.level === lv && (
                  <div className="pr-wait" role="group" aria-label="How long to wait">
                    {waitChoices(b.waitSeconds, heldWaits).map((s) => <button key={s} aria-pressed={b.waitSeconds === s} onClick={() => update(editing.i, { waitSeconds: s })}>{waitLabel(s)}</button>)}
                  </div>
                )}
              </div>
            );
          })}
          {bands[editing.i].upToUsd !== null && <button className="zf-link pr-pair" onClick={() => setEditing({ i: editing.i, what: "limit" })}>Change the amount</button>}
          <button className="zf-btn" style={{ marginTop: 18 }} onClick={() => setEditing(null)}>Done</button>
        </Sheet>
      )}
      {editing?.what === "limit" && (
        <Sheet title="Up to how much?" onClose={() => setEditing(null)}>
          <div className="pr-limits">
            {[...new Set([...LIMITS, bands[editing.i].upToUsd ?? 0])].sort((a, b) => a - b).filter((v) => {
              const lo = editing.i === 0 ? 0 : bands[editing.i - 1].upToUsd ?? 0;
              const next = bands[editing.i + 1]?.upToUsd;
              return v > lo && (next === null || next === undefined || v < next);
            }).map((v) => (
              <button key={v} aria-pressed={bands[editing.i].upToUsd === v} onClick={() => { update(editing.i, { upToUsd: v }); setEditing(null); }}>{usd(v)}</button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

/** The held change's one line: when its wait ends, or that it is ready to finish. */
export function pendingWords(p: { readyAtIso: string; ready: boolean; needsSecondDevice: boolean }, now = new Date()): string {
  if (p.needsSecondDevice) return "Your second device has to say yes. Tap to see it.";
  if (p.ready || Date.parse(p.readyAtIso) <= now.getTime()) return "Tap to finish it.";
  const ends = endsWords(p.readyAtIso, now);
  return ends ? `Its wait ends ${ends}. Tap to see it, or cancel it.` : "Tap to see it, or cancel it.";
}

/** The held change's word beside its title: "ready to finish" once its wait is over, never "waiting" above "the wait is
 *  over" (UX walk 2 Nov: it read as a contradiction). */
export function pendingState(p: { readyAtIso: string; ready: boolean; needsSecondDevice: boolean }, now = new Date()): string {
  if (p.needsSecondDevice) return "needs your second device";
  return p.ready || Date.parse(p.readyAtIso) <= now.getTime() ? "ready to finish" : "waiting";
}
