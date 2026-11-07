// Bringing a bank back from its 24 words, and the screens around the wait (release 7):
// - at set-up: the person's recovery wait (WaitLine, on Make your key), fixed after;
// - on the NEW phone: enter the words → waiting for the second device's yes (or the wait alone) → finish when it can;
// - on the OLD phone: "Someone is adding a new device to your account" → Stop it / It's me.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { Mark } from "@zerofee/design/Mark.tsx";
import { Back } from "@zerofee/design/icons.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { More } from "@zerofee/design/More.tsx";
import { useBack } from "@zerofee/design/back.ts";
import { RECOVERY_HOLD_YOCTO } from "@zerofee/core/known-contracts";
import { formatNearShort } from "@zerofee/core/format";
import type { RecoveryPending } from "@zerofee/core/signer";
import { NOT_A_WORD, enteredWord, closeWords } from "./word-entry.ts";
import { CHOICE_WORDS, choiceLine, newPhoneWait, oldPhoneCount, phoneCanStop, waitName, whoCanStop, type DelayChoice } from "./recovery-words.ts";
import { endsShort, leftWords, useCountdown } from "./countdown.ts";
import { thisDevice } from "@zerofee/shell-api/approval-words.ts";
import { DEFAULT_PROTECTION } from "@zerofee/core/protection-bands";
import { MAINNET } from "../mode.ts";
import "./recovery.css";

/** A new account's strictest default band wait (demo-core defaultBands): set-up's rules-change line counts it (F2). */
const NEW_BAND_WAIT = DEFAULT_PROTECTION.waitSeconds[MAINNET ? "mainnet" : "testnet"];

const KNOWN = new Set(wordlist);


/** The wait's money line: everything stays in the account; only the move's own record keeps a little NEAR, given back
 *  at the finish (known-contracts RECOVERY_HOLD_YOCTO, the sheet's "About 0.0197 NEAR is held"). Grade 02g, F14. */
export const HOLD_LINE = `Your money stays in your Safe. ${formatNearShort(RECOVERY_HOLD_YOCTO, "up")} NEAR is held until you finish.`;

/** 24 slots; type or paste. Each word is checked against the backup-word list as it's typed. */
/**
 * `initial`: the words as typed before a Problem (the user robot's walk: a checksum error wiped all 24). They stay, the
 * word the core named (`badWord`) is marked and picked, and only when the core said one is wrong but can't name it
 * (`wrong`: a checksum, every word real but one wrong or out of place) does the screen say so above the words.
 * `sample` (the web demo only): its account's words, on a button, so the walk needs no paper.
 */
/** `web`: the web wallet's import, said "wallet" (the phone's "account" is its NEAR account). */
/** `sheetLead` (the web wallet's "Check your backup words", WebWalletRows): drawn inside a full-screen Sheet, which has
 *  the title, Close and Back, so no top bar of its own and not a screen of its own; this line under "Your 24 words". */
export function RestoreWords({ onBack, onSubmit, badWord, wrong, purpose = "restore", initial, sample, web = false, sheetLead }: { onBack: () => void; onSubmit: (words: string[]) => void; badWord?: number; wrong?: boolean; purpose?: "restore" | "check"; initial?: string[]; sample?: string[]; web?: boolean; sheetLead?: string }) {
  const bringBack = web ? "Bring back my wallet" : "Bring back my account";
  const [words, setWords] = useState<string[]>(() => (initial?.length === 24 ? [...initial] : Array(24).fill("")));
  const kept = initial?.length === 24 && !badWord && wrong;
  const [at, setAt] = useState(badWord ? badWord - 1 : 0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), [at]);

  const current = words[at];
  // Words starting with what's typed; none, and it isn't a word on the list: the closest ones (F21).
  const suggestions = useMemo(() => {
    const starts = current.length >= 1 ? wordlist.filter((w) => w.startsWith(current)).slice(0, 3) : [];
    return starts.length ? starts : closeWords(current);
  }, [current]);
  // Enter (or space) on what isn't a word says so (a web test, 4 Nov: "zzzz" + Enter silently became "buzz")
  const [notWord, setNotWord] = useState(false);
  const firstBad = words.findIndex((w) => w && !KNOWN.has(w));
  // the count is of backup words only (restore crawl, 4 Nov: "2 of 24" with "zzzz" in slot 2); a slot with anything in it
  // still counts as typed, so 24 typed with one wrong says "Check the words in red"
  const filled = words.filter((w) => KNOWN.has(w)).length;
  const typedAll = words.every(Boolean);
  const allKnown = words.every((w) => KNOWN.has(w));

  const setWord = (i: number, w: string) => setWords((ws) => ws.map((x, j) => (j === i ? w : x)));
  const accept = (w: string) => {
    setWord(at, w);
    if (at < 23) setAt(at + 1);
  };
  const onChange = (raw: string) => {
    setNotWord(false);
    const parts = raw.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      // A pasted phrase: fill from here on, then go to the first word that isn't on the list, so its fix is in front.
      const next = words.map((x, j) => (j >= at && j - at < parts.length ? parts[j - at] : x));
      setWords(next);
      const bad = next.findIndex((x) => x && !KNOWN.has(x));
      setAt(bad >= 0 ? bad : Math.min(23, at + parts.length));
      return;
    }
    const w = raw.toLowerCase().replace(/[^a-z]/g, "");
    setWord(at, w);
    // Four letters always pin one word on the list: move on as soon as the word is complete and unambiguous.
    const matches = wordlist.filter((x) => x.startsWith(w));
    if (w.length >= 4 && matches.length === 1 && at < 23) {
      setWord(at, matches[0]);
      setAt(at + 1);
    }
  };

  return (
    <div className={sheetLead === undefined ? "zf-screen zf-pad" : "zf-pad rc-in-sheet"}>
      {sheetLead === undefined && <div className="zf-top">
        <button className="zf-icon-btn" onClick={onBack} aria-label="Back"><Back /></button>
        <span className="zf-label">{purpose === "check" ? "Check my words" : bringBack}</span>
        <span style={{ width: 28 }} />
      </div>}
      <div className="rc-head">
        <h1 className="zf-title">Your 24 words</h1>
        <p className="zf-small" style={{ marginTop: 6 }}>{sheetLead ?? (purpose === "check" ? "Type them from your paper. Nothing leaves this device. Never type them anywhere else." : "Type them in order, or paste them all at once.")}</p>
        {badWord ? <p className="zf-small" role="status" style={{ marginTop: 6 }}>Word {badWord} needs a look: it's marked below.</p>
          : firstBad >= 0 && filled === 24 ? <p className="zf-small" role="status" style={{ marginTop: 6 }}>Word {firstBad + 1}, "{words[firstBad]}", isn't a backup word. Tap it to change it.</p>
          : kept && <p className="zf-small" role="status" style={{ marginTop: 6 }}>One word is wrong or out of place. Tap it to change it.</p>}
      </div>
      <ol className="rc-grid" translate="no">
        {words.map((w, i) => {
          const bad = (w && !KNOWN.has(w)) || badWord === i + 1;
          // Each word is a button (grade 02g, G9): VoiceOver and the keyboard reach a word in red, the only way to fix it.
          return (
            <li key={i} className={`${i === at ? "at" : ""} ${bad ? "bad" : ""}`}>
              <button type="button" className="rc-cell" onClick={() => setAt(i)} aria-current={i === at ? "true" : undefined}
                aria-label={`Word ${i + 1}${w ? `, ${w}` : ", empty"}${bad ? ", not a backup word. Change it" : ""}`}>
                <i aria-hidden="true">{i + 1}</i>{w || " "}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="rc-entry">
        <label className="zf-label" htmlFor="rc-word">Word {at + 1}</label>
        <input id="rc-word" ref={input} value={current} onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              const w = enteredWord(current);
              if (w) accept(w); else setNotWord(!!current);
            }
            if (e.key === "Backspace" && !current && at > 0) setAt(at - 1);
          }}
          autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} translate="no" />
        {notWord && <p className="zf-small" role="alert">{NOT_A_WORD}</p>}
        <div className="rc-suggest">{suggestions.map((s) => <button key={s} onClick={() => accept(s)}>{s}</button>)}</div>
      </div>
      {sample && <button className="zf-link" style={{ marginTop: 12 }} onClick={() => { setWords(sample.slice(0, 24)); setAt(23); }}>Fill in this account's words</button>}
      <div className="zf-fill" />
      <div className="zf-floor">
        <button className="zf-btn" disabled={filled < 24 || !allKnown} onClick={() => onSubmit(words)}>
          {!typedAll ? `${filled} of 24` : !allKnown ? "Check the words in red" : purpose === "check" ? "Check them" : bringBack}
        </button>
      </div>
    </div>
  );
}

// The countdown lives in its own module, so the second device's site (second-device.tsx) needs none of this screen.
export { useCountdown };

/**
 * The new device, during the wait (release 7): waiting for the second device's yes with the countdown to the delay, the
 * account's own words-only fallback (recovery.status's fallbackAtIso), then Finish once it can. An older account, or one
 * with no second device of age: the wait alone. `onSee` (the web demo only): look at it from the laptop.
 */
export function RecoveryWaiting({ pending, delaySeconds, onFinish, onSee, onBack, onSkip, device }: { pending: RecoveryPending; delaySeconds: number; onFinish: () => void; onSee?: () => void; onBack?: () => void; onSkip?: () => void; device?: string }) {
  const w = newPhoneWait(pending, delaySeconds, undefined, undefined, device);
  const { left } = useCountdown(w.untilIso);
  // Escape and the browser's Back leave the wait too (grade 02g, G10); it keeps waiting.
  useBack(onBack);
  const ready = w.ready || (left === 0 && w.untilIso === (pending.canFinishAtIso ?? pending.readyAtIso));
  return (
    <div className="zf-screen zf-pad">
      {onBack && (
        <div className="zf-top">
          <button className="zf-icon-btn" onClick={onBack} aria-label="Back"><Back /></button>
          <span className="zf-label">Your new device</span>
          <span style={{ width: 28 }} />
        </div>
      )}
      <div className="zf-fill" />
      <div className="rc-center zf-enter">
        {/* A wait of days isn't a spinner: the mark stays whole (grade 30 Oct, item 16: mid-redraw it read as a dash). */}
        <Mark size={120} mode="still" />
        {/* One "Ready", never a label and a figure saying the same (grade 1 Nov b, N6); while it counts, when it ends. */}
        {!ready && <div className="zf-label" style={{ marginTop: 36 }}>{w.label}</div>}
        <div className="zf-display rc-count rc-count--words" style={ready ? { marginTop: 36 } : undefined}>{ready ? "Ready" : leftWords(left)}</div>
        {!ready && endsShort(w.untilIso) && <p className="zf-small rc-ends">Ends {endsShort(w.untilIso)}</p>}
        <p className="zf-body" style={{ marginTop: 14 }}>{ready ? `The wait is over. Bring your account to ${thisDevice()}.` : w.body}</p>
        {/* Rule 9 (UI-SIMPLICITY-RULES): the time left and its end, one sentence, the step. The fallback and the NEAR held
            for the wait (true to the account, grade 02g, F14) are one tap down, never a second and third paragraph. */}
        {!ready && <More label="More about this wait" className="rc-more" lines={[...(w.fallback ? [w.fallback] : []), HOLD_LINE]} />}
      </div>
      <div className="zf-fill" />
      <div className="zf-floor">
        {/* No grey "Waiting…" button: the count says it waits; Finish comes when it can be tapped. */}
        {ready && <button className="zf-btn" onClick={onFinish}>Finish</button>}
        {onSee && !ready && <button className="zf-link" onClick={onSee}>Open your laptop</button>}
        {onSkip && !ready && <button className="zf-link" onClick={onSkip}>Skip ahead (sample only)</button>}
        {ready && <p className="zf-small">{HOLD_LINE}</p>}
      </div>
    </div>
  );
}

/**
 * Set-up's recovery wait as one line, "Recovery wait: 48 hours · Change" (D49: 48 hours by default and at least; 3, 7, 14
 * or 30 days for more time; grade 1 Nov c, P9: never a forced screen, never "Recommended"). Change opens the choices on
 * a sheet; a tap picks one and closes it. Fixed after set-up.
 */
export function WaitLine({ choices, seconds, onChange }: { choices: readonly DelayChoice[]; seconds: number; onChange: (seconds: number) => void }) {
  const [open, setOpen] = useState(false);
  const line = useRef<HTMLDivElement>(null);
  // The sheet goes on the screen itself: the line sits in an entering (transformed) block, which would hold a fixed sheet.
  const host = line.current?.closest(".zf-screen") ?? (typeof document === "undefined" ? null : document.body);
  return (
    <div className="rc-waitline" ref={line}>
      <span>{CHOICE_WORDS.line}: <b>{waitName(seconds)}</b></span>
      <span aria-hidden="true">·</span>
      <button className="zf-link rc-change" onClick={() => setOpen(true)} aria-label={`Change the recovery wait, now ${waitName(seconds)}`}>Change</button>
      {open && host && createPortal(
        <Sheet title={CHOICE_WORDS.line} onClose={() => setOpen(false)}>
          <p className="zf-small">{CHOICE_WORDS.sub}</p>
          <div className="rc-choices" role="radiogroup" aria-label={CHOICE_WORDS.line}>
            {choices.map((c) => (
              <button key={c.seconds} role="radio" aria-checked={seconds === c.seconds} className={`rc-choice${seconds === c.seconds ? " on" : ""}`} onClick={() => { onChange(c.seconds); setOpen(false); }}>
                <span className="rc-radio" aria-hidden="true" />
                <span>
                  <span className="t">{waitName(c.seconds)}</span>
                  <span className="d">{choiceLine(c, choices, NEW_BAND_WAIT)}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="zf-small" style={{ marginTop: 14 }}>{CHOICE_WORDS.rules} {CHOICE_WORDS.later}</p>
          <p className="zf-small" style={{ marginTop: 8 }}>{CHOICE_WORDS.fixed}</p>
          {/* Finding 50: a plain way back that changes nothing, beside the sheet's Close */}
          <button className="zf-btn" style={{ marginTop: 18 }} onClick={() => setOpen(false)}>{CHOICE_WORDS.keep(waitName(seconds))}</button>
        </Sheet>,
        host,
      )}
    </div>
  );
}

/** The old phone, when someone used the words. The only screen with red on it. Release 7: who can stop it. */
export function WasThisYou({ pending, onStop, onItsMe }: { pending: RecoveryPending; onStop: () => void; onItsMe: () => void }) {
  const count = oldPhoneCount(pending);
  const { alone } = useCountdown(count.untilIso);
  return (
    <div className="zf-screen zf-pad" role="alertdialog" aria-labelledby="wty-title">
      <div style={{ height: 96 }} />
      <div className="rc-center zf-enter">
        <div className="zf-label" style={{ color: "var(--alert)" }}>Recovery started</div>
        <h1 id="wty-title" className="zf-title" style={{ marginTop: 18 }}>Someone is moving your account to a new device.</h1>
        <div className="zf-display rc-count rc-count--words" style={{ fontWeight: 200 }}>{alone}</div>
        {/* the copy review (7 Nov): the figure alone, never the figure and a sentence of the same time on one screen */}
        {pending.needsSecondDevice && !pending.approved && <p className="zf-small">Your second device has to say yes.</p>}
      </div>
      <div className="zf-note rc-alert-note zf-enter-2">{whoCanStop(pending)} If this is you, do nothing. If it isn't, stop it now. <b>Your money hasn't moved. It's in your Safe.</b></div>
      <div className="zf-fill" />
      <div className="zf-floor">
        {phoneCanStop(pending) ? <button className="zf-btn alert" onClick={onStop}>Stop it</button> : <button className="zf-btn" onClick={onItsMe}>Close</button>}
        {phoneCanStop(pending) && <button className="zf-link" onClick={onItsMe}>It's me</button>}
      </div>
    </div>
  );
}
