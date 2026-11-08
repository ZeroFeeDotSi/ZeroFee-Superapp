// The web app's lock (audit K-1): nothing behind it runs until the person opens it with their passkey or passcode.
// One plain screen per step. The first time, it asks once how to lock (and moves vaults from before the unlock under
// it); after that, each visit opens with one action. 15 minutes without a touch, or 5 minutes with the tab out of
// sight, and it locks again: the page reloads, so nothing it had opened stays in memory.
//
// Wording (D20): on the web, keys are in this browser, locked, and the person's iPhone unlocks them (its passkey, over
// the QR code: passkey.ts), or a passcode. Never "chip".
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IdleLock, PASSCODE_MIN, WEB_PASSWORD_MIN, WrongSecretError, passcodeRefusal, passcodeWaitMs, passwordRefusal, vaultSession, type UnlockRecord } from "@zerofee/core/unlock";
import { Mark } from "@zerofee/design/Mark.tsx";
import { AlreadyLockedError, TooSoonError, browserDevice, lockWithPasscode, lockWithPasskey, openWithPasscode, openWithPasskey, start, type UnlockDevice } from "./device.ts";
import { IPHONE_KEY, IPHONE_LOCKED, IPHONE_UNLOCKS, NO_IPHONE_HERE, NO_IPHONE_KEY, PASSCODE_CANT_SEND, createPasskey, isCancelled, passkeyAvailable, passkeyName, passkeyPrf } from "./passkey.ts";
import type { LAPTOP_LOCK as LaptopLock } from "./laptop-lock-words.ts";
import { clearedOnStartAgain } from "./clear-keys.ts";
import { WIPE_WAIT_MS, wipeCopiedNow } from "../shell/copied-secret.ts";
import { MAINNET } from "../mode.ts";
import "./unlock.css";

type Step =
  | { k: "checking" }
  | { k: "setup"; legacy: boolean }
  | { k: "new-code"; legacy: boolean; note?: string }
  /** Real money (mainnet) in a browser that can't use the person's iPhone as its key: no passcode, one line (product decision, 3 Nov). */
  | { k: "no-iphone"; legacy: boolean }
  | { k: "again"; legacy: boolean; first: string }
  | { k: "locked"; record: UnlockRecord }
  | { k: "lost"; orphan: boolean; from?: UnlockRecord }
  | { k: "working"; text: string }
  /** The browser didn't open ZeroFee's storage in time (another tab holding it, a stuck browser): never a blank page. */
  | { k: "stuck" }
  | { k: "open" };

/**
 * The web wallet's words (product decision, 4 Nov: a normal wallet like Phantom, NO Safe): it locks with a password only (no
 * passkey, no iPhone), and every line says "password" and "wallet", never "passcode" or "Safe".
 */
export const WEB_LOCK = {
  choose: "Choose a password",
  chooseBody: "It locks your wallet in this browser. Don't use your 24 words.",
  againBody: "So you remember it.",
  again: "Lock with this password",
  locked: "Your wallet is locked",
  lockedBody: "Your password opens it in this browser.",
  placeholder: "Enter your password",
  forgot: "Forgot your password?",
  wrong: "That password isn't right. Try again",
  /** The password box's own name (a web test, 4 Nov: the box said "Passcode" under "Choose a password"). */
  field: "Password",
  // One Argon2id stretch per try (64 MiB, 3 passes, never weakened): 3 s on a fast laptop, 20-30 s measured in a busy
  // browser (a web test, 4 Nov), so the line says the longest, not "a few seconds".
  opening: "Opening ZeroFee… This can take up to 30 seconds.",
  locking: "Setting your password… This can take up to 30 seconds.",
  lostBody: "Your 24 words bring your wallet back. Tap “Clear and start again”, then “I already have one”.",
  lostMore: "Your money stays in your wallet. Clear only if you have your words.",
  stuckMore: "Your money hasn't moved.",
  /** Another tab made the wallet and its lock first (QA): this tab's password is refused, nothing is changed. */
  elsewhere: "Your wallet was already made in another tab. Reload, then use the password you set there.",
} as const;
/** The same, in the app with the Safe (its lock is a passkey or a passcode). */
export const LOCKED_ELSEWHERE = "ZeroFee was already set up in another tab. Reload this page to unlock it.";
const elsewhere = (web: boolean) => (web ? WEB_LOCK.elsewhere : LOCKED_ELSEWHERE);

/** How long the first look at this device's lock may take before the page says so, with Try again (grade 1 Nov b, N2). */
export const OPEN_DEADLINE_MS = 10_000;
/** Let the browser paint the status line before heavy work (a passcode's key stretching) starts (grade 1 Nov b, N7). */
const painted = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** How this device was locked, once open (for wording elsewhere, e.g. "encrypted with your passkey"). */
let openedWith: "passkey" | "passcode" | null = null;
export const lockedWith = () => openedWith;
/** Lock now (Settings' Lock row, grade 02f; the idle lock too): the vault forgets its key and the page reloads, so every key
 *  in memory goes with it. The next open asks for the passkey or passcode again. */
export function lockNow(): void {
  vaultSession.lock();
  // a key copied in Settings leaves the clipboard first, if it is still there (QA); the reload waits at most WIPE_WAIT_MS
  let late: ReturnType<typeof setTimeout> | undefined;
  void Promise.race([wipeCopiedNow(), new Promise<void>((r) => (late = setTimeout(r, WIPE_WAIT_MS)))]).finally(() => {
    clearTimeout(late);
    location.reload();
  });
}

/** Clear ZeroFee from this browser (the lock screen's "Clear and start again"; set-up's Start over, J1): the vaults and
 *  the lock go, this browser's ZeroFee keys too (the terms, Activity, the last total; the theme stays), and the page
 *  reloads on its first screen. The money stays on chain; the 24 words bring an account back. */
export async function clearThisBrowser(device: UnlockDevice = browserDevice()): Promise<void> {
  vaultSession.lock();
  await device.clear().catch(() => undefined);
  for (const k of Object.keys(localStorage)) if (clearedOnStartAgain(k)) localStorage.removeItem(k);
  location.reload();
}

/**
 * `intro`: on a device with nothing on it yet (no lock, no vault), shown before the lock is set (the app's Welcome, the
 * terms and Make your key: screens/FirstRun.tsx), so the first screen is never the lock. Nothing is read or written
 * while it shows; the lock is set when it calls `done`.
 * `unfinished`: the lock is set but set-up never made an account (grade 01d, Q8): the intro shows again instead of
 * "ZeroFee is locked", and its passkey tap opens the lock already made.
 */
/** `iphoneOnly` (mainnet, by default): the product's one option, the iPhone (3 Nov). Money leaves the Safe only after the
 *  iPhone's fresh check (D143, the core's safeStepUp), which a passcode can't give, so a passcode isn't offered. */
/** `web`: the web wallet (WEB_WALLET): a password is its one lock, made after the words; the same 15-minute idle lock. */
/** `laptopWords`: the laptop page (LaptopGate.tsx, product decision, 5 Nov): its own Touch ID / Windows Hello passkey (passkey.ts reads
 *  the page's mode) and these words in place of the iPhone's. `laptopStart`: its first screen's heading (what the page
 *  is) and next step (LAPTOP_START), passed in so they load with the laptop page only. */
export function UnlockGate({ children, device = browserDevice(), intro, unfinished, iphoneOnly = MAINNET, web = false, laptopWords, laptopStart }: { children: ReactNode; device?: UnlockDevice; intro?: (done: (lockNow?: boolean) => void) => ReactNode; unfinished?: () => boolean; iphoneOnly?: boolean; web?: boolean; laptopWords?: typeof LaptopLock; laptopStart?: { heading: string; next: string; soon?: string } }) {
  const [step, setStep] = useState<Step>({ k: "checking" });
  const [introDone, setIntroDone] = useState(false);
  const [say, setSay] = useState<{ text: string; bad?: boolean } | null>(null);
  const name = passkeyName();
  const laptop = laptopWords;
  /** The laptop's own line for a prompt that didn't finish or didn't open the keys. */
  const laptopSaid = (e: unknown) => (isCancelled(e) ? laptop!.didntFinish : laptop!.didntOpen);

  const begin = async () => {
    try {
      let late: ReturnType<typeof setTimeout> | undefined;
      const s = await Promise.race([start(device, passkeyAvailable), new Promise<"late">((r) => (late = setTimeout(() => r("late"), OPEN_DEADLINE_MS)))]).finally(() => clearTimeout(late));
      if (s === "late") return setStep({ k: "stuck" });
      setSay(null);
      if (s.k === "locked") return setStep({ k: "locked", record: s.record });
      if (s.k === "lost") return setStep({ k: "lost", orphan: true });
      if (web) return setStep({ k: "new-code", legacy: s.legacy });
      setStep(s.passkey ? { k: "setup", legacy: s.legacy } : iphoneOnly ? { k: "no-iphone", legacy: s.legacy } : { k: "new-code", legacy: s.legacy });
    } catch {
      setStep({ k: "lost", orphan: true });
    }
  };
  useEffect(() => {
    void begin();
  }, []);

  const opened = (how: "passkey" | "passcode") => {
    openedWith = how;
    setSay(null);
    setStep({ k: "open" });
  };

  // Open: lock after 15 idle minutes, or 5 out of sight. Locking reloads the page, so every key in memory goes with it.
  useEffect(() => {
    if (step.k !== "open") return;
    const idle = new IdleLock(Date.now());
    const onActivity = () => idle.activity(Date.now()) && lockNow();
    const onVisibility = () => (document.visibilityState === "hidden" ? idle.hidden(Date.now()) : idle.visible(Date.now()) && lockNow());
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    for (const e of events) window.addEventListener(e, onActivity, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => idle.due(Date.now()) && lockNow(), 10_000);
    return () => {
      for (const e of events) window.removeEventListener(e, onActivity, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [step.k]);

  const usePasskey = async (legacy: boolean) => {
    setSay(null);
    try {
      const out = await lockWithPasskey(device, vaultSession, createPasskey);
      if (out === "done") return opened("passkey");
      setStep(iphoneOnly ? { k: "no-iphone", legacy } : { k: "new-code", legacy, note: NO_IPHONE_KEY });
    } catch (e) {
      if (e instanceof AlreadyLockedError) return setSay({ text: elsewhere(web), bad: true });
      setSay({ text: laptop ? laptopSaid(e) : isCancelled(e) ? `${cap(name)} didn't finish. Try again.` : iphoneOnly ? `${cap(name)} didn't open it. Try again.` : `${cap(name)} didn't open it. Try again, or use a passcode.`, bad: true });
    }
  };

  const unlockPasskey = async (record: UnlockRecord) => {
    if (record.method !== "passkey") return;
    setSay(null);
    try {
      await openWithPasskey(device, vaultSession, record, passkeyPrf);
      opened("passkey");
    } catch (e) {
      setSay({ text: laptop ? laptopSaid(e) : isCancelled(e) ? `${cap(name)} didn't finish. Try again.` : "Your iPhone didn't open it. Try again.", bad: true });
    }
  };

  const unlockPasscode = async (record: UnlockRecord, code: string) => {
    setStep({ k: "working", text: web ? WEB_LOCK.opening : "Opening… A passcode takes a few seconds." });
    await painted();
    try {
      await openWithPasscode(device, vaultSession, code);
      opened("passcode");
    } catch (e) {
      // The record now counts the wrong try (and when the next may be made): read it again.
      const fresh = (await device.readRecord().catch(() => null)) ?? record;
      const wait = passcodeWaitMs(fresh, Date.now());
      setStep({ k: "locked", record: fresh });
      const text =
        e instanceof TooSoonError ? `Too many wrong tries. Try again in ${waitWords(e.waitMs)}.`
        : e instanceof WrongSecretError ? `${web ? WEB_LOCK.wrong : "That passcode didn't open it. Try again"}${wait > 0 ? ` in ${waitWords(wait)}` : ""}.`
        : "That didn't work. Try again.";
      setSay({ text, bad: true });
    }
  };

  // A passcode that must wait (wrong tries): Unlock stays off, and comes back by itself when the wait is over.
  const [, tick] = useState(0);
  const waitLeft = step.k === "locked" ? passcodeWaitMs(step.record, Date.now()) : 0;
  useEffect(() => {
    if (waitLeft <= 0) return;
    const t = window.setTimeout(() => tick((n) => n + 1), Math.min(waitLeft, 1_000));
    return () => window.clearTimeout(t);
  });

  const lockPasscode = async (legacy: boolean, code: string) => {
    setStep({ k: "working", text: web ? WEB_LOCK.locking : "Locking ZeroFee… A passcode takes a few seconds." });
    await painted();
    try {
      await lockWithPasscode(device, vaultSession, code, web ? passwordRefusal : undefined);
      opened("passcode");
    } catch (e) {
      setStep({ k: "new-code", legacy });
      setSay({ text: e instanceof AlreadyLockedError ? elsewhere(web) : "That didn't work. Try again.", bad: true });
    }
  };

  const clearDevice = async () => {
    setStep({ k: "working", text: "Clearing ZeroFee from this browser…" });
    // This browser's ZeroFee keys go too (grade 01d Q12: the terms, Activity, the last total); the theme stays.
    await clearThisBrowser(device);
  };

  if (step.k === "open") return <>{children}</>;
  // The laptop page (product decision, 5 Nov): its first paint says what the page is and the next step, before this
  // browser's storage is read; Use this laptop turns on once it is (a stuck read still ends on "stuck" at OPEN_DEADLINE_MS).
  if (step.k === "checking" && laptop) {
    return (
      <Screen title={laptopStart?.heading ?? laptop.setupTitle} body={laptopStart ? laptop.setupHow : laptop.setupBody} {...(laptopStart ? { more: laptopStart.next } : {})} {...(laptopStart?.soon ? { soon: laptopStart.soon } : {})} say={null}>
        <button className="zf-btn" disabled>{laptop.use}</button>
      </Screen>
    );
  }
  if (step.k === "checking") return <Plain title="Opening ZeroFee…" />;
  if (step.k === "stuck") {
    return (
      <Screen title="ZeroFee is taking too long to open" body="This browser didn't open ZeroFee's storage in time. If ZeroFee is open in another tab, close it, then try again." more={web ? WEB_LOCK.stuckMore : "Your money hasn't moved. It's in your Safe."} say={null}>
        <button className="zf-btn" onClick={() => location.reload()}>Try again</button>
      </Screen>
    );
  }
  if (step.k === "working") return <Plain title={step.text} />;
  // A fresh device: the welcome, the terms and Make your key come first; the lock is the last step before the app.
  // `lockNow` (Make my key, grade 1 Nov D13): the passkey is made on that same tap, so there is no separate "Lock ZeroFee
  // on this device" screen; it shows only if the passkey doesn't finish (with why), or a passcode is needed.
  const resume = step.k === "locked" && unfinished?.() === true;
  if (intro && !introDone && (((step.k === "setup" || step.k === "new-code" || step.k === "no-iphone") && !step.legacy) || resume)) {
    const now = step;
    return <>{intro((lockNow) => {
      setIntroDone(true);
      if (!lockNow) return;
      if (now.k === "locked") void unlockPasskey(now.record);
      else if (now.k === "setup") void usePasskey(now.legacy);
    })}</>;
  }

  if (step.k === "setup") {
    return (
      <Screen
        title={laptop ? (!step.legacy && laptopStart ? laptopStart.heading : laptop.setupTitle) : step.legacy ? "Lock your account" : "Lock ZeroFee on this device"}
        body={laptop ? (step.legacy ? laptop.setupBodyLegacy : laptopStart ? laptop.setupHow : laptop.setupBody) : step.legacy ? `Your account is here. ${IPHONE_UNLOCKS}` : IPHONE_KEY}
        {...(laptop && !step.legacy && laptopStart ? { more: laptopStart.next } : {})}
        {...(laptop && laptopStart?.soon ? { soon: laptopStart.soon } : {})}
        say={say}
      >
        <button className="zf-btn" onClick={() => void usePasskey(step.legacy)}>{laptop ? laptop.use : `Use ${name}`}</button>
        {!iphoneOnly && <button className="zf-link" onClick={() => { setSay(null); setStep({ k: "new-code", legacy: step.legacy }); }}>Use a passcode instead</button>}
      </Screen>
    );
  }

  if (step.k === "no-iphone") {
    return (
      <Screen title={laptop ? laptop.noChipTitle : "Use your iPhone"} body={laptop ? laptop.noChipBody : NO_IPHONE_HERE} say={say}>
        <button className="zf-btn" onClick={() => void usePasskey(step.legacy)}>Try again</button>
      </Screen>
    );
  }

  if (step.k === "new-code") {
    return (
      <CodeScreen
        key="new"
        title={web ? WEB_LOCK.choose : "Choose a passcode"}
        body={web ? WEB_LOCK.chooseBody : step.note ?? `${step.legacy ? "From now on it opens with this passcode." : "Your keys stay here, encrypted with your passcode."} Make it long: four words work well.`}
        action="Next"
        {...(web ? { field: WEB_LOCK.field } : {})}
        hint={`At least ${web ? WEB_PASSWORD_MIN : PASSCODE_MIN} characters, not only numbers.`}
        say={say}
        onSubmit={(code) => {
          const refusal = web ? passwordRefusal(code) : passcodeRefusal(code);
          if (refusal) return setSay({ text: refusal, bad: true });
          setSay(null);
          setStep({ k: "again", legacy: step.legacy, first: code });
        }}
      />
    );
  }

  if (step.k === "again") {
    return (
      <CodeScreen
        key="again"
        title="Type it again"
        body={web ? WEB_LOCK.againBody : "So you know it by heart."}
        action={web ? WEB_LOCK.again : "Lock with this passcode"}
        {...(web ? { field: WEB_LOCK.field } : {})}
        say={say}
        onBack={() => { setSay(null); setStep({ k: "new-code", legacy: step.legacy }); }}
        onSubmit={(code) => {
          if (code !== step.first) {
            setSay({ text: "Those don't match. Choose it again.", bad: true });
            return setStep({ k: "new-code", legacy: step.legacy });
          }
          void lockPasscode(step.legacy, code);
        }}
      />
    );
  }

  if (step.k === "locked") {
    const record = step.record;
    if (record.method === "passkey") {
      return (
        <Screen title={resume ? "Finish setting up" : "ZeroFee is locked"} body={laptop ? laptop.lockedBody : IPHONE_LOCKED} say={say}>
          <button className="zf-btn" onClick={() => void unlockPasskey(record)}>{laptop ? laptop.unlock : `Unlock with ${name}`}</button>
          <button className="zf-link" onClick={() => { setSay(null); setStep({ k: "lost", orphan: false, from: record }); }}>{laptop ? laptop.lost : "Lost your iPhone?"}</button>
        </Screen>
      );
    }
    return (
      <CodeScreen
        key="unlock"
        title={web ? WEB_LOCK.locked : resume ? "Finish setting up" : "ZeroFee is locked"}
        body={web ? WEB_LOCK.lockedBody : iphoneOnly ? `Your keys are kept on this device, encrypted with your passcode. ${PASSCODE_CANT_SEND}` : "Your keys are kept on this device, encrypted with your passcode."}
        action="Unlock"
        placeholder={web ? WEB_LOCK.placeholder : "Enter your passcode"}
        {...(web ? { field: WEB_LOCK.field } : {})}
        say={say}
        disabled={waitLeft > 0}
        onSubmit={(code) => void unlockPasscode(record, code)}
        extra={<button className="zf-link" onClick={() => { setSay(null); setStep({ k: "lost", orphan: false, from: record }); }}>{web ? WEB_LOCK.forgot : "Forgot your passcode?"}</button>}
      />
    );
  }

  // Lost: the words bring everything back. Said plainly, with the one way there.
  const what = step.from?.method === "passcode" ? "passcode" : "iPhone";
  return (
    <Screen
      title={step.orphan ? "ZeroFee can't open here" : web ? WEB_LOCK.forgot : laptop && what === "iPhone" ? laptop.lost : `Lost your ${what}?`}
      body={web ? WEB_LOCK.lostBody : "Your 24 backup words bring everything back. Clear ZeroFee from this browser, then choose “I already have one” and type your words."}
      more={web ? WEB_LOCK.lostMore : "Your money stays in your Safe while you do."}
      say={null}
    >
      <button className="zf-btn" onClick={() => void clearDevice()}>Clear and start again</button>
      {step.from && <button className="zf-link" onClick={() => setStep({ k: "locked", record: step.from! })}>Go back</button>}
    </Screen>
  );
}

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

function Plain({ title }: { title: string }) {
  return (
    <div className="zf-screen zf-pad">
      <div className="zf-fill" />
      <div className="ul-center zf-enter">
        <Mark size={64} mode="still" />
        <p className="zf-small" style={{ marginTop: 34 }} role="status">{title}</p>
      </div>
      <div className="zf-fill" />
    </div>
  );
}

function Screen({ title, body, more, soon, say, children }: { title: string; body: string; more?: string; soon?: string; say: { text: string; bad?: boolean } | null; children: ReactNode }) {
  return (
    <div className="zf-screen zf-pad">
      <div className="zf-fill" />
      <div className="ul-center zf-enter">
        <Mark size={64} mode="still" />
        <h1 className="zf-title" style={{ marginTop: 32 }}>{title}</h1>
        <p className="zf-body" style={{ marginTop: 12 }}>{body}</p>
        {more && <p className="zf-small" style={{ marginTop: 10 }}>{more}</p>}
        {soon && <p className="zf-small" data-testid="laptop-soon" style={{ marginTop: 10 }}>{soon}</p>}
      </div>
      <div className="zf-fill" />
      <div className="zf-floor zf-enter-2">
        <p className={`zf-small ul-say${say?.bad ? " bad" : ""}`} role="status">{say?.text ?? ""}</p>
        {children}
      </div>
    </div>
  );
}

/** "30 seconds", "5 minutes", "1 hour". */
function waitWords(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  return "1 hour";
}

function CodeScreen(props: { title: string; body: string; action: string; hint?: string; placeholder?: string; field?: string; say: { text: string; bad?: boolean } | null; disabled?: boolean; onSubmit: (code: string) => void; onBack?: () => void; extra?: ReactNode }) {
  const [code, setCode] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const submit = () => {
    const c = code;
    setCode("");
    props.onSubmit(c);
  };
  return (
    <div className="zf-screen zf-pad">
      <div className="zf-fill" />
      <div className="ul-center zf-enter">
        <Mark size={64} mode="still" />
        <h1 className="zf-title" style={{ marginTop: 32 }}>{props.title}</h1>
        <p className="zf-body" style={{ marginTop: 12 }}>{props.body}</p>
      </div>
      <div className="zf-fill" />
      <form className="zf-floor zf-enter-2" onSubmit={(e) => { e.preventDefault(); if (code && !props.disabled) submit(); }}>
        <div className="ul-entry">
          <input ref={input} type="password" inputMode="text" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label={props.field ?? "Passcode"} placeholder={props.placeholder ?? props.field ?? "Passcode"} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <p className={`zf-small ul-say${props.say?.bad ? " bad" : ""}`} role="status">{props.say?.text ?? props.hint ?? ""}</p>
        <button className="zf-btn" type="submit" disabled={!code || props.disabled}>{props.action}</button>
        {props.onBack && <button className="zf-link" type="button" onClick={props.onBack}>Back</button>}
        {props.extra}
      </form>
    </div>
  );
}
