// Settings' web-wallet section (product decision, 4 Nov): the recovery phrase and each wallet's private key, each behind
// the password on its own full-screen sheet (D135), Lock, and the phone app (where the Safe lives). The words and keys
// come from the core (account.web.showWords / account.web.exportKey, the shell's bridge only) only after the password,
// live only in this sheet's state, and go when it closes. The words are never copied: a clipboard is readable by other
// apps; a key has Copy, as every wallet's export does.
// "Check your backup words" (product decision, 5 Nov) is the phone's practice: the password first, then the 24 words typed on
// RestoreWords; the core compares them (account.web.checkWords) and answers only yes or no. The typed words live only in
// RestoreWords' own state, which goes when its step does; they are never copied, logged or put in an address.
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import type { Bridge } from "@zerofee/core/bridge";
import { PHONE_APP_URL, WEB_WALLETS, WEB_WORDS as W } from "@zerofee/shell-api/web-wallet-words.ts";
import { SECRET_SHOWN_MS, checkBackupWords, copyStamp, forgetCopied, readIfAllowed, readSecret, type Ask, type Secret } from "./web-secret.ts";
import { lockNow } from "../unlock/UnlockGate.tsx";

// the typing screen and its 2,048 words load on the check's first use, never with Settings
const RestoreWords = lazy(() => import("../screens/Recovery.tsx").then((m) => ({ default: m.RestoreWords })));

export function WebWalletRows({ bridge }: { bridge: Bridge }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [checking, setChecking] = useState(false);
  // any copy in the page after a key's Copy is the person's own: the key's wipe then leaves the clipboard alone
  useEffect(() => {
    const seen = () => void copyStamp.next();
    document.addEventListener("copy", seen);
    return () => document.removeEventListener("copy", seen);
  }, []);
  return (
    <section className="set__sec" data-testid="web-wallet-rows">
      <h2 className="zf-label set__h">{W.section}</h2>
      <div className="zf-group">
        <button className="set__row set__row--btn" onClick={() => setAsk({ k: "words" })}><span>{W.showWords}</span><span /></button>
        <button className="set__row set__row--btn set__row--two" data-testid="web-check-words" onClick={() => setChecking(true)}><span><span>{W.checkWords}</span><small>{W.checkWordsSub}</small></span></button>
        {WEB_WALLETS.map((w) => (
          <button key={w.wallet} className="set__row set__row--btn" onClick={() => setAsk({ k: "key", wallet: w.wallet, name: w.name })}><span>{W.exportKey(w.name)}</span><span /></button>
        ))}
        <button className="set__row set__row--btn set__row--two" onClick={lockNow}><span><span>{W.lock}</span><small>{W.lockSub}</small></span></button>
        <a className="set__row set__row--btn set__row--two" href={PHONE_APP_URL} target="_blank" rel="noopener noreferrer"><span><span>{W.phoneApp}</span><small>{W.phoneAppSub}</small></span></a>
      </div>
      {ask && <SecretSheet bridge={bridge} ask={ask} onClose={() => setAsk(null)} />}
      {checking && <CheckSheet bridge={bridge} onClose={() => setChecking(false)} onShowWords={() => { setChecking(false); setAsk({ k: "words" }); }} />}
    </section>
  );
}

/** The password, then the words or the key (Settings, and the web account sheet's Recovery: WebAccountRows.tsx). */
export function SecretSheet({ bridge, ask, onClose }: { bridge: Bridge; ask: Ask; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState<Secret | null>(null);
  const [copied, setCopied] = useState(false);
  const title = ask.k === "words" ? W.showWords : W.exportKey(ask.name);
  const show = async () => {
    if (!password || busy) return;
    setBusy(true);
    const s = await readSecret(bridge, ask, password);
    setBusy(false);
    setPassword("");
    setGot(s);
  };
  const shown = got && !("why" in got) ? got : null;
  // the words or the key hide by themselves after a minute (QA): a screen left open never keeps showing them
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setGot(null), SECRET_SHOWN_MS);
    return () => clearTimeout(t);
  }, [shown]);
  return (
    <Sheet title={title} onClose={onClose}>
      {shown ? (
        <div className="set__secret" data-testid="web-secret">
          <p className="zf-body set__fn" role="alert">{"words" in shown ? W.wordsLead : W.keyLead(ask.k === "key" ? ask.name : "")}</p>
          {"words" in shown ? (
            <ol className="set__words" translate="no" data-testid="web-words">{shown.words.map((w, i) => <li key={i}>{w}</li>)}</ol>
          ) : (
            <>
              <p className="set__key" translate="no" data-testid="web-key">{shown.key}</p>
              <button className="zf-btn" onClick={() => {
                const c = navigator.clipboard;
                if (c) {
                  const key = shown.key;
                  void c.writeText(key).catch(() => {});
                  const mine = copyStamp.next();
                  forgetCopied(key, (run, ms) => setTimeout(() => void run(), ms), (t) => c.writeText(t), readIfAllowed, () => copyStamp.now() === mine);
                }
                setCopied(true);
              }}>{copied ? W.copied : W.copy}</button>
              <p className="zf-small set__fn" data-testid="web-key-clear">{W.copyAfter}</p>
            </>
          )}
          <button className="zf-btn zf-btn--quiet" onClick={onClose}>{W.sheetClose}</button>
        </div>
      ) : (
        <form className="set__secret" onSubmit={(e) => { e.preventDefault(); void show(); }}>
          <p className="zf-body set__fn">{W.passwordAsk}</p>
          <input className="set__name" type="password" autoComplete="current-password" autoFocus aria-label={W.password} placeholder={W.password} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          {got && "why" in got && <p className="zf-small set__fn" role="alert">{got.why}</p>}
          <button className="zf-btn" type="submit" disabled={!password || busy}>{W.show}</button>
        </form>
      )}
    </Sheet>
  );
}

/** The words check's steps: the password, the typing, the core's answer. */
export type CheckStep = { k: "password"; why?: string } | { k: "type" } | { k: "checking" } | { k: "answer"; matches: boolean };

/** `start`: the step it opens on (always the password; a test draws the others). */
export function CheckSheet({ bridge, onClose, onShowWords, start = { k: "password" } }: { bridge: Bridge; onClose: () => void; onShowWords: () => void; start?: CheckStep }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<CheckStep>(start);
  // the right password, held only while this sheet is open (for the words' own call and Try again), then dropped
  const kept = useRef("");
  useEffect(() => () => { kept.current = ""; }, []);
  const next = async () => {
    if (!password || busy) return;
    setBusy(true);
    const r = await checkBackupWords(bridge, password);
    setBusy(false);
    if ("ready" in r) kept.current = password;
    setPassword("");
    setStep("ready" in r ? { k: "type" } : { k: "password", why: "why" in r ? r.why : W.failed });
  };
  const check = async (words: string[]) => {
    setStep({ k: "checking" });
    const r = await checkBackupWords(bridge, kept.current, words);
    if ("matches" in r) {
      if (r.matches) kept.current = "";
      return setStep({ k: "answer", matches: r.matches });
    }
    kept.current = "";
    setStep({ k: "password", why: "why" in r ? r.why : W.failed });
  };
  return (
    <Sheet title={W.checkWords} onClose={onClose}>
      {step.k === "password" ? (
        <form className="set__secret" onSubmit={(e) => { e.preventDefault(); void next(); }}>
          <p className="zf-body set__fn">{W.checkAsk}</p>
          <input className="set__name" type="password" autoComplete="current-password" autoFocus aria-label={W.password} placeholder={W.password} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          {step.why && <p className="zf-small set__fn" role="alert">{step.why}</p>}
          <button className="zf-btn" type="submit" disabled={!password || busy}>{W.checkNext}</button>
        </form>
      ) : step.k === "type" ? (
        <Suspense fallback={null}>
          <RestoreWords purpose="check" sheetLead={W.checkLead} onBack={onClose} onSubmit={(w) => void check(w)} />
        </Suspense>
      ) : step.k === "checking" ? (
        <div className="set__secret"><p className="zf-body set__fn" role="status">{W.checking}</p></div>
      ) : (
        <div className="set__secret" data-testid="web-check-answer">
          <p className="zf-body set__fn" role="alert"><strong>{step.matches ? W.checkRight : W.checkWrong}</strong></p>
          <p className="zf-small set__fn">{step.matches ? W.checkRightSub : W.checkWrongSub}</p>
          {step.matches ? (
            <button className="zf-btn" onClick={onClose}>{W.checkDone}</button>
          ) : (
            <>
              <button className="zf-btn" onClick={() => setStep({ k: "type" })}>{W.checkAgain}</button>
              <button className="zf-btn zf-btn--quiet" onClick={onShowWords}>{W.checkShow}</button>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
