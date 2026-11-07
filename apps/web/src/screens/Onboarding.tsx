// Creating an account: Welcome → your key (the terms and the recovery wait on the same screen) → backup words → quick
// check → approve → open. Eight taps (PAR), about a minute.
import { IPHONE_KEY, IPHONE_UNLOCKS } from "../unlock/passkey.ts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { later } from "../later.tsx";
import { Mark } from "@zerofee/design/Mark.tsx";
import { Back, Copy, Face } from "@zerofee/design/icons.tsx";
import { useBack } from "@zerofee/design/back.ts";
import { RENEW_WORDS_COPY, WEB_WORDS_COPY, WORDS_COPY, WORDS_MORE } from "../words-copy.ts";
import { More } from "@zerofee/design/More.tsx";
import { waitPlain, whenWords } from "../apps/security/rules.ts";
import { onPhone } from "@zerofee/shell-api/approval-words.ts";
import { WaitLine } from "./Recovery.tsx";
import type { DelayChoice } from "./recovery-words.ts";
import { TermsBlock } from "./Terms.tsx";
import { acceptTerms } from "../terms.ts";
import { BRAND_LINE, BRAND_SUB } from "../brand.ts";
import { SETUP_TIME } from "./fund.ts";
import type { Bridge } from "@zerofee/core/bridge";
import { useBalanceTotal } from "@zerofee/wallet/app/BalanceTotal.ts";
import { dollars } from "@zerofee/wallet/app/format.ts";
import { ThreadBar } from "@zerofee/design/Thread.tsx";
import { threadOf } from "../shell/thread.ts";
import "./onboarding.css";

/** The phone makes the key in its secure chip behind Face ID; a browser keeps it on the device, encrypted (D20). */
const phone = onPhone();

/** The check's one warning (J2, B2): true for every words check, since the words leave this device once checked. */
export const CANT_SHOW_AGAIN = "After this check, your words never show again.";
/** The web wallet's line instead: Settings shows the words again, behind the password. */
export const WEB_SHOW_AGAIN = "Your password can show them again later.";

/** `onSample`: a quiet way to look around first, with sample money (?demo), on the real app's welcome. */
/** `onRestore`: bring back an account with its 24 words (the sample page too: its account's words, finding 42). */
/** `onMoving`: an account's move to this device is waiting (Back from its wait): the one step is back to it. */
/** `money`: set-up asks for money (mainnet); the sample demo and the test network don't, and their time says so. */
/** `other`: the public web build's other mode, one quiet link (Real's "Try it with pretend money first", Sim's "Use real
 *  money instead"; mode.ts switchWebMode). */
export function Welcome({ onCreate, onRestore, onSample, onMoving, onGuard, other, money = true }: { onCreate: () => void; onRestore?: () => void; onSample?: () => void; onMoving?: () => void; onGuard?: () => void; other?: { label: string; go: () => void }; money?: boolean }) {
  if (onMoving) {
    return (
      <div className="zf-screen zf-pad">
        <div className="zf-fill" />
        <div className="ob-center zf-enter">
          <Mark size={64} mode="still" />
          <div className="zf-label" style={{ marginTop: 34 }}>ZeroFee</div>
          <h1 className="zf-display" style={{ marginTop: 16 }}>{BRAND_LINE}</h1>
          <p className="zf-body" style={{ marginTop: 16 }}>Your account is on its way here, even while you're away.</p>
        </div>
        <div className="zf-fill" />
        <div className="zf-floor zf-enter-2">
          <button className="zf-btn" onClick={onMoving}>See the wait</button>
        </div>
      </div>
    );
  }
  return (
    <div className="zf-screen zf-pad">
      <div className="zf-fill" />
      <div className="ob-center zf-enter">
        <Mark size={64} mode="still" />
        <div className="zf-label" style={{ marginTop: 34 }}>ZeroFee</div>
        <h1 className="zf-display" style={{ marginTop: 16 }}>{BRAND_LINE}</h1>
        <p className="zf-body" style={{ marginTop: 12 }}>{BRAND_SUB}</p>
      </div>
      <div className="zf-fill" />
      <div className="zf-floor zf-enter-2">
        <button className="zf-btn" onClick={onCreate}>Create my account</button>
        {onRestore && <button className="zf-link" onClick={onRestore}>I already have one</button>}
        {/* J2 (O4): the honest time, said before anything starts. */}
        <p className="zf-small">{SETUP_TIME}</p>
        {/* Dead ends row 16: a spare phone, or a guardian's, says yes for an account with no account of its own. */}
        {onGuard && <button className="zf-link" style={{ fontSize: 13 }} onClick={onGuard} data-testid="welcome-guard">Approve for someone else</button>}
        {onSample &&<button className="zf-link" style={{ fontSize: 13 }} onClick={onSample}>Look around with sample money</button>}
        {other && <button className="zf-link" style={{ fontSize: 13 }} onClick={other.go}>{other.label}</button>}
      </div>
    </div>
  );
}

/** The words' screens (Job 1): the one thread at the top, Words under way, never "Step 1 of 2". `moneyIn`: the money
 *  is already in (an account opened before its words: a browser, or an account from before J2); otherwise the words
 *  come first and the money is the next step. */
export function WordsTop({ moneyIn = false, onBack }: { moneyIn?: boolean; onBack?: () => void }) {
  const t = threadOf(moneyIn ? { stage: "needs-backup", wordsDone: false, moneyIn, protection: null, secondDevice: null } : { stage: "needs-funding", wordsFirst: true, wordsDone: false, moneyIn: null, protection: null, secondDevice: null });
  return (
    <div className="ob-top">
      <Top label="" onBack={onBack} />
      <ThreadBar steps={t.steps} line="" />
    </div>
  );
}

/** With `onBack`, the browser's Back and Escape go back too (D15, D16; grade 1 Nov c, P3). */
export function Top({ label, onBack }: { label: string; onBack?: () => void }) {
  useBack(onBack);
  return (
    <div className="zf-top">
      {onBack ? <button className="zf-icon-btn" onClick={onBack} aria-label="Back"><Back /></button> : <span style={{ width: 28 }} />}
      <span className="zf-label">{label}</span>
      <span style={{ width: 28 }} />
    </div>
  );
}

/**
 * New backup words, the last step (recovery.renew). `waitingUntilIso`: still waiting to take over; none: they have.
 * What the new words cover, and what still opens with the old ones, said plainly (UI's words).
 */
export function RenewDone({ waitingUntilIso, onDone, onMove, moved, stuck }: { waitingUntilIso?: string; onDone: () => void; onMove?: () => void; moved?: string; stuck?: boolean }) {
  return (
    <div className="zf-screen zf-pad">
      <Top label="New backup words" />
      <div className="zf-fill" />
      <div className="ob-center zf-enter">
        <h1 className="zf-title">{waitingUntilIso ? "Your new words are on their way" : "Your new words are in"}</h1>
        {/* Summary first (UI-SIMPLICITY-RULES 2, 10): when they take over and the one thing to do; the rest one tap down. */}
        {/* Once the move ran and nothing is stuck, its own line says what happened: never "move it now" over "nothing needed moving". */}
        {(waitingUntilIso || !moved || stuck) && <p className="zf-small" style={{ marginTop: 10 }}>
          {waitingUntilIso
            ? `Your new words take over in ${waitPlain((Date.parse(waitingUntilIso) - Date.now()) / 1000)} (${whenWords(waitingUntilIso)}). Keep your old paper until then.`
            : "Some wallets still open only with your old words. Move their money now."}
        </p>}
        {waitingUntilIso && <More label="What happens next" className="ob-more" lines={["When the wait is over, finish it in Waiting.", "If a move to a new device starts first, ask again when it ends."]} />}
        {moved && <p className="zf-small" role={stuck ? "alert" : "status"} style={{ marginTop: 10 }} data-testid="renew-moved">{moved}</p>}
      </div>
      <div className="zf-fill" />
      <div className="zf-floor zf-enter-2">
        {!waitingUntilIso && onMove && (!moved || stuck) ? (
          <>
            <button className="zf-btn" onClick={onMove}>{moved ? "Try again" : "Move it now"}</button>
            <button className="zf-link" style={{ marginTop: 6 }} onClick={onDone}>Later</button>
          </>
        ) : (
          <button className="zf-btn" onClick={onDone}>Done</button>
        )}
      </div>
    </div>
  );
}

/**
 * Set-up's one screen before the words (PAR 8, grade 1 Nov c): the key, the recovery wait as one line (`wait`, D49: 48 hours
 * unless changed), and, on a device that hasn't agreed yet, the terms (`terms`), so one tap agrees and makes the key.
 * `web`: in a browser, what it is locked with, the passkey or the passcode (D20: on the web, never "secure chip").
 */
export function MakeKey({ onBack, onContinue, web, wait, terms = false }: { onBack: () => void; onContinue: () => void; web?: "passkey" | "passcode"; wait?: { choices: readonly DelayChoice[]; seconds: number; onChange: (seconds: number) => void }; terms?: boolean }) {
  const go = () => {
    if (terms) acceptTerms();
    onContinue();
  };
  const icon = terms ? 52 : 76;
  return (
    <div className="zf-screen zf-pad">
      <Top label="" onBack={onBack} />
      <div className={`ob-mk${terms ? " ob-mk--terms" : ""}`}>
        <div className="ob-center zf-enter">
          {/* A face means Face ID: only on the phone. A browser shows the mark. */}
          {phone ? <Face size={icon} /> : <Mark size={icon} mode="still" />}
          <h1 className="zf-title" style={{ marginTop: terms ? 18 : 34 }}>Make your key</h1>
          {/* Product decision, 2 Nov. Two keys, what each does, said once; the legal lines live in the terms. */}
          <p className="zf-body" style={{ marginTop: 12 }}>{phone ? "It stays in this iPhone. Only your face opens it." : web === "passcode" ? "It stays in this browser. Only your passcode opens it." : IPHONE_KEY}</p>
          <dl className="ob-keys">
            {/* The key that approves, by its real name (shell audit 01b: "This device" under "Your iPhone is your key"): on the web
                it is the iPhone (product decision, 3 Nov), or this browser when it is locked with a passcode. */}
            <div><dt>{phone ? "This iPhone" : web === "passcode" ? "This browser" : "Your iPhone"}</dt><dd>Approves your payments.</dd></div>
            {/* D43/D44: the words reach the Safe only after the wait (this device can stop it: said on the words screen, one tap down). */}
            <div><dt>Your 24 words</dt><dd>A spare key. Opens your Safe only after a wait.</dd></div>
          </dl>
          {wait && <WaitLine choices={wait.choices} seconds={wait.seconds} onChange={wait.onChange} />}
          {/* H15: the one warning before anything that changes Face ID. */}
          {phone && <p className="zf-small" style={{ marginTop: 12 }}>Changing Face ID stops this key.</p>}
        </div>
        {terms && <div className="zf-enter-2"><TermsBlock compact /></div>}
      </div>
      <div className="zf-floor zf-enter-2">
        {phone
          ? <button className="zf-btn" onClick={go}><Face />{terms ? "Agree and make my key" : "Make my key"}</button>
          : <button className="zf-btn" onClick={go}>{terms ? "Agree and make my key" : "Make my key"}</button>}
        {!terms && <p className="zf-small">{phone ? "Face ID unlocks your key. Nothing about your face leaves the phone." : web === "passcode" ? "Only your passcode opens it. It locks when you step away." : IPHONE_UNLOCKS}</p>}
      </div>
    </div>
  );
}

// The opening's one screen lives in Working.tsx (Home's first load draws it without the set-up screens: speed budget, 5 Nov).
export { OPENING_STEPS, Working } from "./Working.tsx";

/** `renew`: new words that replace the old ones (recovery.renew), outside the set-up steps. */
/** `moneyIn`: the money is already in (the one thread shows Money in done). */
/** `onBack` (new words, from Details): back where they came from, with Back and Escape too; nothing was signed (P3).
 *  `wait` (the web demo, which has no key screen): the recovery wait's one line, as Make your key shows it. */
/** `web`: the web wallet (no Safe): its own words and a plain top, never the Safe's set-up thread. */
/** The words never leave by copy, cut, the context menu or a drag (S2). */
const noCopy = (e: { preventDefault: () => void }) => e.preventDefault();
export function Words({ words, onDone, onBack, renew = false, moneyIn, wait, web = false }: { words: string[]; onDone: () => void; onBack?: () => void; renew?: boolean; moneyIn?: boolean; wait?: { choices: readonly DelayChoice[]; seconds: number; onChange: (seconds: number) => void }; web?: boolean }) {
  const t = web ? WEB_WORDS_COPY : renew ? RENEW_WORDS_COPY : WORDS_COPY;
  const notes = useRef<HTMLDivElement>(null);
  useEffect(() => revealWhenOpened(notes.current), []);
  useEffect(() => { void Check.preload(); }, []);
  return (
    <div className="zf-screen zf-pad">
      {web ? <Top label="" onBack={onBack} /> : renew ? <Top label="New backup words" onBack={onBack} /> : <WordsTop moneyIn={moneyIn} />}
      <div className="ob-center zf-enter" style={{ marginTop: 18 }}>
        <h1 className="zf-title">{t.title}</h1>
        <p className="zf-small" style={{ marginTop: 8 }}>{t.sub}</p>
        {wait && <WaitLine choices={wait.choices} seconds={wait.seconds} onChange={wait.onChange} />}
      </div>
      {/* translate="no": a browser's page translation would send the words to a translation service. Nothing here is copied,
          logged, put in the address or kept in storage as text; the core holds the words' seed encrypted until they're checked. */}
      {/* The words and the two notes scroll; the button stays on the floor, never below the screen (round 2 walk). */}
      <div className="ob-scroll">
        {/* S2 (QA's privsec hunt, 5 Nov): the words are read and written down by hand, never selected, copied,
            dragged or printed (onboarding.css too); the check after is typed, so this costs it nothing. */}
        <ol className="ob-words zf-enter-2" translate="no" onCopy={noCopy} onCut={noCopy} onContextMenu={noCopy} onDragStart={noCopy}>
          {words.map((w, i) => <li key={i}><i>{i + 1}</i>{w}</li>)}
        </ol>
        <div className="ob-notes zf-enter-3" ref={notes}>
          {/* Product decision, 2 Nov: two one-line notes; the full facts one tap down. */}
          {t.notes.map((n) => <div key={n} className="zf-note">{n}</div>)}
          <More label={WORDS_MORE} lines={t.more} />
        </div>
      </div>
      <div className="zf-floor zf-enter-3 ob-floor">
        <button className="zf-btn" onClick={onDone}>{t.done}</button>
      </div>
    </div>
  );
}

/** "What these words can do" opens under the 24 words, below the scroll's fold: opened, its text is scrolled into view, so
 *  the tap shows something (finding 50: "did nothing I could see"). `toggle` doesn't bubble: heard on the way down. */
export function revealWhenOpened(box: HTMLElement | null): (() => void) | undefined {
  if (!box) return;
  const on = (e: Event) => {
    const d = e.target as HTMLDetailsElement;
    if (!d.open) return;
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    (d.lastElementChild ?? d).scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  };
  box.addEventListener("toggle", on, true);
  return () => box.removeEventListener("toggle", on, true);
}

/** The word check (finding 36, WordCheck.tsx) loads when it is first drawn, or with the words before it (Words preloads
 *  it): never in Home's first load (speed budget). */
export const Check = later<Parameters<typeof import("./WordCheck.tsx").Check>[0]>(() => import("./WordCheck.tsx").then((m) => m.Check));

/**
 * `keyCard`: the "Your key" proof card (KeyProof.tsx), the set-up's last word on where the key is (L6).
 * `onLaptop`: the laptop as a second device, offered once and never required (the outside study's item 3; design review,
 * 28 Oct): one link here, not a screen of its own with Skip (PAR 8, grade 1 Nov c). It's always in Security later.
 */
/** `restored`: the account came back from its words: where its money is, never "add money" to an account that has it (02f, E17). */
/** No bridge (the gallery): no figure, never a made-up one. */
const NO_BRIDGE: Bridge = { call: () => new Promise(() => undefined), on: () => () => undefined };

export function BankOpen({ accountId, network = "testnet", onEnter, onLaptop, keyCard, restored, bridge }: { accountId: string; network?: "testnet" | "mainnet"; onEnter: () => void; onLaptop?: () => void; keyCard?: ReactNode; restored?: boolean; bridge?: Bridge }) {
  // What the account holds, in dollars first (grade 02h, H9: "Your account is open" said no $): Wallet's own total, the
  // same reads and the same NEAR price. Nothing while it's read.
  const total = useBalanceTotal(bridge ?? NO_BRIDGE, Boolean(bridge));
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(accountId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="zf-screen zf-pad">
      <div style={{ height: 70 }} />
      <div className="ob-center zf-enter">
        <Mark size={56} mode="still" />
        <h1 className="zf-title" style={{ marginTop: 30 }}>Your account is open.</h1>
        {total !== null && Number(total) > 0 && <p className="zf-body" style={{ marginTop: 8 }}>{dollars(total)} in your account</p>}
        <p className="zf-small" style={{ marginTop: 8 }}>{restored ? "Your Safe, Hot and Private are open on this device now." : "Add money from any wallet or exchange."}</p>
      </div>
      <div className="ob-receive zf-enter-2">
        <div className="zf-label">Your address</div>
        <div className="ob-chain"><span className="ob-chain__ico">N</span>NEAR{network !== "mainnet" && <span className="zf-small" style={{ marginLeft: "auto" }}>Test network</span>}</div>
        <button className="ob-addr" onClick={copy} aria-label="Copy your address">
          <span>{accountId}</span>
          <span className="ob-copy">{copied ? "Copied" : <Copy />}</span>
        </button>
        <p className="zf-small">Send to this address on the NEAR network only.</p>
      </div>
      {keyCard && <div className="ob-key zf-enter-3">{keyCard}</div>}
      <div className="zf-fill" />
      <div className="zf-floor zf-enter-3">
        <button className="zf-btn" onClick={onEnter}>Open ZeroFee</button>
        {onLaptop && <button className="zf-link" onClick={onLaptop}>Add my laptop as a second device</button>}
      </div>
    </div>
  );
}

