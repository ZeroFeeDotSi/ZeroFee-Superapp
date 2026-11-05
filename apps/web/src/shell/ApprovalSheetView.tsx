// The web demo's approval sheet. On the iPhone the sheet is native and drawn by the security layer; here the shell draws
// it, and it must show PlainWords verbatim: the title, every line, every warning, every effect, in order, with the asking
// app's hint smaller and last. It is the only place that hears `approval.needed` and answers `approval.answer`.
//
// One sheet at a time: a request that arrives while one is showing lines up behind it and never replaces the words on
// screen (a swap under the thumb). Each sheet is a fresh component (keyed by the request's id), Approve is off for the
// first moments after it appears, and when the words are longer than the screen Approve stays off until they have been
// scrolled to the end: nobody approves what they haven't seen. Off is visible (Approve fills in as it arms), and a tap
// while it is off is answered on screen, never lost into what's behind and never a yes.
//
// The sheet's view alone (ApprovalSheetView and its words), apart from the shell's ApprovalSheet that asks the iPhone's
// Face ID: the second device's site (second-device.tsx) draws this and needs nothing of the phone's host.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PlainWords } from "@zerofee/core/signer";
import { amountLine } from "@zerofee/core/sheet-amount";
import { Close, Face } from "@zerofee/design/icons.tsx";
import { More } from "@zerofee/design/More.tsx";
import { useBack } from "@zerofee/design/back.ts";
import { onPhone } from "@zerofee/shell-api/approval-words.ts";
import { simPage } from "@zerofee/shell-api/release.ts";
import { markTap, personTapped } from "../unlock/activation.ts";
import { APPROVAL_PASSWORD_WORDS } from "./approval-password.ts";
import { groupAddress, isLandsLine, isLeadLine, toAddress, ungroup } from "./sheet-address.ts";
import "./approval.css";

/** Inside the iPhone app every approval is Face ID (device.confirm); in a browser it is the Approve tap alone. The public
 *  site's Sim simulates the phone: its Approve still needs a person's own tap, then shows the Face ID moment. Real is a
 *  browser: the Approve tap alone, never a Face ID it doesn't have. */
const phone = onPhone();
const simulated = !phone && simPage();
/** How long the simulated Face ID moment lasts: the glyph, then the tick. As long as a real one, about 0.6 s (grade 1 Nov,
 *  item 11: every money move waited a full second on it). */
export const FACE_ID_MS = 600;

/** How long Approve stays off after a sheet appears, so a tap meant for the app can't land on it. */
export const ARM_MS = 700;

/** "120" → "2 minutes", "3600" → "1 hour", "172800" → "2 days". */
export function waitWords(seconds: number): string {
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (seconds >= 86400) return unit(Math.round(seconds / 86400), "day");
  if (seconds >= 3600) return unit(Math.round(seconds / 3600), "hour");
  if (seconds >= 60) return unit(Math.round(seconds / 60), "minute");
  return unit(Math.max(1, Math.round(seconds)), "second");
}

/**
 * The clock line under the words, from the protection's structured fields only (the core's `lines` already carry its
 * own sentence about the wait, verbatim, so the sheet never says it twice). Nothing for Face ID alone.
 */
export function protectionWords(protection: PlainWords["protection"]): string | null {
  if (!protection) return null;
  const wait = `Waits ${waitWords(protection.waitSeconds)} · this device can cancel`;
  const device = "Needs your second device";
  switch (protection.level) {
    case "wait": return wait;
    case "device": return device;
    case "both": return `${wait} · ${device.toLowerCase()}`;
    default: return null;
  }
}

/** The sheet itself, for the live listener above and for the screens gallery. */
/**
 * `id`: the approval this sheet answers. In a browser its Approve says yes only for a person's own click, judged here in
 * the DOM handler from the browser's event itself (personTapped), which then marks `id` for the bridge (activation.ts,
 * audits K-6, K2-2). On the phone, Approve passes Face ID instead.
 */
export function ApprovalSheetView({ id, words, onAnswer: answer, password }: { id?: string; words: PlainWords; onAnswer: (approve: boolean, password?: string) => void | Promise<void | string | null>; /** the web wallet: Approve takes the password */ password?: boolean }) {
  const [typed, setTyped] = useState("");
  const [why, setWhy] = useState<string | null>(null);
  /** A password sheet's yes: the core checks it; a wrong one or a wait keeps the sheet, with its line, to type again. */
  const yes = async () => {
    if (!password) return void answer(true);
    const said = await answer(true, typed);
    setTyped("");
    setWhy(typeof said === "string" ? said : null);
  };
  const body = useRef<HTMLDivElement>(null);
  const approveButton = useRef<HTMLButtonElement>(null);
  const [armed, setArmed] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [atEnd, setAtEnd] = useState(true);
  const [nudged, setNudged] = useState(false);
  const [faceId, setFaceId] = useState<null | "scan" | "done">(null);
  // Once the end has been seen it stays seen: scrolling back up to re-read doesn't take Approve away again.
  const reached = useRef(false);
  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), ARM_MS);
    return () => window.clearTimeout(t);
  }, []);
  // Does the body scroll, and has it been scrolled to the end? Re-measured as it scrolls and whenever its size changes
  // (the keyboard, a rotation, fonts arriving).
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => {
      const more = el.scrollHeight - el.clientHeight > 1;
      if (more && el.scrollHeight - el.scrollTop - el.clientHeight <= 2) reached.current = true;
      setOverflows(more);
      setAtEnd(!more || reached.current);
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, []);
  // Escape and the browser's Back are "Not now": never a yes, never a way out of the app (D15, D16).
  useBack(() => void answer(false));
  // The core's lines usually carry the protection's own sentence ("It waits 1 hour. You, or your backup words, can stop
  // it."): then the clock line would only say the wait again (grade 02g, E15: "waits 1 hour" three times).
  const protection = words.protection && words.lines.includes(words.protection.text) ? null : protectionWords(words.protection);
  const canApprove = armed && atEnd && (!password || typed.length > 0);
  return (
    <div className="approval" role="dialog" aria-modal="true" aria-labelledby="approval-title">
      {faceId && (
        <div className={`approval__faceid ${faceId}`} role="status" aria-label="Face ID">
          {faceId === "scan" ? <Face size={72} /> : (
            <svg width="72" height="72" viewBox="0 0 24 24" aria-hidden="true"><circle className="zf-hl" cx="12" cy="12" r="10" /><path className="zf-hl" d="m7.5 12.5 3 3 6-6.5" /></svg>
          )}
          <span>Face ID</span>
        </div>
      )}
      <div className="approval__scrim" onClick={() => answer(false)} />
      <div className="approval__sheet">
        <div className="approval__grab" />
        {/* D135: every full-screen sheet has Close (a web test, 4 Nov: "Trade from this browser" had only Not now); the same as Not now */}
        <button type="button" className="zf-sheet__close approval__close" onClick={() => answer(false)} aria-label="Close" data-testid="approval-close"><Close /></button>
        <div className="approval__body" ref={body}>
          <div className="zf-label">Check this{words.testNetwork && <span className="approval__test"> · Test network</span>}</div>
          <h2 id="approval-title" className="approval__title">{words.title}</h2>
          {/* The payment in dollars, the coin amount after it (grade 02g, G11), before every other line. */}
          {amountLine(words) && <p className="approval__amount">Amount: {amountLine(words)}</p>}
          {words.lines.map((line, i) => {
            // every outside sheet's full address (the copy review's rules, 5 Nov): "To" a caption, the address in groups of 4 under
            // it; the line saying where it lands, quiet
            const to = toAddress(line);
            if (to) return <div key={i} className="approval__to"><span className="approval__to-cap">To</span><FullAddress label="The address" address={to} /></div>;
            if (isLandsLine(line)) return <p key={i} className="approval__line approval__lands">{line}</p>;
            if (isLeadLine(line)) return <p key={i} className="approval__line approval__lead">{line}</p>;
            // an open detail (a payee's full address) sits right under its line, never folded
            const full = words.details?.find((d) => d.open?.after === line);
            return [<p key={i} className="approval__line">{line}</p>, ...(full ? [<FullAddress key={`${i}-full`} label={full.label} address={full.lines[0] ?? ""} />] : [])];
          })}
          {/* Long parts of what is approved (a rule's every coin), one tap open, on the sheet itself (UI-SIMPLICITY-RULES 6). */}
          {words.details?.filter((d) => !d.open).map((d, i) => <More key={i} label={d.label} lines={d.lines} />)}
          {words.warnings.map((w, i) => (
            <p key={i} className="approval__warn"><span aria-hidden="true" />{w.text}</p>
          ))}
          {words.effect.length > 0 && (
            <div className="approval__effects">
              {words.effect.map((e, i) => (
                <div key={i} className="approval__kv"><span>{e.token}</span><span>{e.before} → {e.after}</span></div>
              ))}
            </div>
          )}
          {protection && (
            // What the account's protection does with it, from its level and wait. Above the button, so it's read
            // before approving.
            <p className="approval__protect">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle className="zf-hl" cx="12" cy="12" r="8" /><path className="zf-hl" d="M12 7.5V12l3 2" /></svg>
              {protection}
            </p>
          )}
          {words.hint && <p className="approval__hint">{words.hint}</p>}
        </div>
        <div className={`approval__foot${overflows ? " scrolls" : ""}`}>
          {overflows && !atEnd && <p className="approval__more">Read to the end to approve.</p>}
          {password && (
            <div className="approval__password">
              <p className="approval__line">{APPROVAL_PASSWORD_WORDS.ask}</p>
              <input className="approval__pw" type="password" autoComplete="current-password" aria-label={APPROVAL_PASSWORD_WORDS.password} placeholder={APPROVAL_PASSWORD_WORDS.password} value={typed} onChange={(e) => setTyped(e.currentTarget.value)} data-testid="approval-password" />
              {why && <p className="approval__warn" role="alert">{why}</p>}
            </div>
          )}
          <div className="approval__actions">
            <div className="approval__approve">
              <button
                className={`zf-btn${armed ? "" : " approval__arming"}${nudged ? " approval__nudge" : ""}`}
                style={{ ["--arm-ms" as string]: `${ARM_MS}ms` }}
                disabled={!canApprove}
                ref={approveButton}
                onClick={(e) => {
                  if (!canApprove) return;
                  // A browser: only a click the browser itself made on this button (never a script's el.click(), nor
                  // this handler called with a made-up event) is a yes. Anything else does nothing.
                  if (!phone) {
                    if (!personTapped(e.nativeEvent, approveButton.current)) return;
                    if (id) markTap(id);
                  }
                  // D143: a hot key's sheet (the core's `tap`) is one tap, with no Face ID moment
                  if (simulated && words.tap !== true) {
                    // the phone's Face ID moment: the glyph, a tick, then the yes (inside the tap's 2 s, activation.ts)
                    if (faceId) return;
                    setFaceId("scan");
                    window.setTimeout(() => setFaceId("done"), FACE_ID_MS * 0.55);
                    window.setTimeout(() => void answer(true), FACE_ID_MS);
                    return;
                  }
                  void yes();
                }}
                onAnimationEnd={(e) => e.animationName === "appr-nudge" && setNudged(false)}
              >{(phone || simulated) && words.tap !== true && <Face />}Approve</button>
              {/* A disabled button hears nothing: this takes a tap that comes too soon, so it shows instead of vanishing. */}
              {!canApprove && <span className="approval__guard" aria-hidden="true" onClick={() => setNudged(true)} />}
            </div>
            <button className="zf-link" onClick={() => answer(false)}>Not now</button>
          </div>
          {/* What Approve is here, said plainly (D20): in a browser it is the tap itself, with the key kept on this device,
              encrypted. On the phone the sheet asks Face ID and says nothing more. */}
          {!phone && !simulated && !password && <p className="approval__demo">Approve is your yes. Your key stays here, encrypted.</p>}
        </div>
      </div>
    </div>
  );
}

/** The payee's full address on the sheet, open (the audit and the copy review, 5 Nov): mono, in groups of 4 with thin spaces, wrapping,
 *  never shortened. A tap copies the address itself; selecting and copying gives it without the spaces too. */
function FullAddress({ label, address }: { label: string; address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="approval__addr" data-testid="approval-full-address" aria-label={`${label}: ${address}. Copy`} translate="no"
      onCopy={(e) => { e.preventDefault(); e.clipboardData.setData("text/plain", ungroup(window.getSelection()?.toString() || address)); }}
      onClick={() => { void navigator.clipboard?.writeText(address).then(() => setCopied(true), () => undefined); }}>
      {groupAddress(address)}{copied && <span className="approval__addr-copied"> · Copied</span>}
    </button>
  );
}
