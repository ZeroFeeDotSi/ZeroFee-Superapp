// The one screen every problem uses: what happened, where the money is, and the one thing to do next.
// It renders a core Problem as-is; it never invents its own wording (docs/ARCHITECTURE.md, principle 2). Used by the
// shell and by any surface outside it (the extension panel), so the words are the same everywhere.
import { useEffect, useState } from "react";
import type { Problem } from "@zerofee/core/problem";
import { useBack } from "@zerofee/design/back.ts";
import { Back, Close } from "@zerofee/design/icons.tsx";
import { More } from "@zerofee/design/More.tsx";

const moneyWords = (m: Problem["money"]): string | null => {
  switch (m.state) {
    case "safe": return `Your money hasn't moved. It's ${m.where}.`;
    case "on-the-way": return `Your money is on its way: ${m.where}.`;
    case "coming-back": return `Your money is coming back: ${m.where}.`;
    case "needs-you": return `Your money is waiting for you: ${m.where}.`;
    case "not-involved": return null;
  }
};

/** Any web address in the words becomes a quiet link ("Follow it here: <url>" reads "See the record of it", grade 02g E16: never "explorer"); the raw address is never shown. */
export function moreParts(more: string): { text: string; url: string | null } {
  const m = more.match(/https?:\/\/[^\s]+/);
  if (!m) return { text: more, url: null };
  const text = (more.slice(0, m.index).replace(/Follow it here:?\s*$/, "") + more.slice((m.index ?? 0) + m[0].length)).trim();
  return { text, url: m[0] };
}

/** Machine text (UI-SIMPLICITY-RULES rule 3): a coin id, raw units, a 0x… id, a 64-hex hash, a number over 12 digits. A
 *  Problem's extra line holding any of it is never on the screen itself: it sits behind "Details for ZeroFee" (VOICE §1.6:
 *  the one place a code may go, for a bug report). J3 C1: "near on near" reached the judges' demo. */
const MACHINE = [/\bnep\d{3}:/, /\.omft\.near/, /units of/, /0x[0-9a-fA-F]{40,}/, /\b[0-9a-fA-F]{64}\b/, /\d{13,}/];
export const machineText = (s: string): boolean => MACHINE.some((re) => re.test(s));

/** The only address next2 may navigate to: a path on this same app ("/?demo"). No scheme, no host, no "//", no backslash or control characters. */
export function safeNext2Url(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(url)) return null;
  return url;
}

/**
 * `onNext`: the one next-step pill was tapped. `onOpen`: given by a host that can take the person to a screen
 * ("<app>/<tab>", see Problem.next in core/problem.ts); when the next step is `open` the pill calls it with the screen.
 * A surface that doesn't pass it (the extension panel) gets `onNext` for every step.
 * `problem.next2` is a quiet text link under the pill: `open` calls `onNext2` (not shown without it); `url` navigates the page
 * to a same-app relative address only (safeNext2Url), else the link is not shown.
 * `onBack`: a way out that isn't the next step (grade 01d, Q8: the busy set-up screen had none): the arrow, Escape and
 * browser Back all run it. `close`: it is a popup over an app (D135): the way out is Close (✕) in the top corner, no title.
 */
export function ProblemView({ problem, onNext, onOpen, onNext2, onBack, close = false }: { problem: Problem; onNext: () => void; onOpen?: (screen: string) => void; onNext2?: () => void; onBack?: () => void; close?: boolean }) {
  const money = moneyWords(problem.money);
  const more = problem.more ? moreParts(problem.more) : null;
  const next = problem.next;
  const n2 = problem.next2;
  const n2Url = n2?.kind === "url" ? safeNext2Url(n2.url) : null;
  const tap2 = n2?.kind === "url" ? (n2Url ? () => window.location.assign(n2Url) : null) : n2?.kind === "open" ? onNext2 ?? null : null;
  const tap = () => (next.kind === "open" && onOpen ? onOpen(next.screen) : onNext());
  return (
    <div className="zf-screen zf-pad">
      {onBack && <BackArrow onBack={onBack} close={close} />}
      <div className="zf-fill" />
      <div className="zf-enter" style={{ display: "grid", gap: 14, textAlign: "center" }}>
        <h1 className="zf-title">{problem.whatHappened}</h1>
        {money && <p className="zf-body">{money}</p>}
        {more?.text && !machineText(more.text) && <p className="zf-small">{more.text}</p>}
        {more?.text && machineText(more.text) && <More label="Details for ZeroFee" lines={[more.text]} />}
        {more?.url && <p className="zf-small"><a className="zf-link" href={more.url} target="_blank" rel="noopener noreferrer">See the record of it</a></p>}
      </div>
      <div className="zf-fill" />
      <div className="zf-floor">
        {next.kind === "wait" && next.disabledUntil ? <WaitPill label={next.label} until={next.disabledUntil} onTap={tap} /> : <button className="zf-btn" onClick={tap}>{next.label}</button>}
        {n2 && tap2 && <button className="zf-link" type="button" onClick={tap2}>{n2.label}</button>}
      </div>
    </div>
  );
}

/** A pill that would only fail before its time ("Try again after 4:14 AM"): off, showing the time, until then. */
export function WaitPill({ label, until, onTap }: { label: string; until: string; onTap: () => void }) {
  const at = Date.parse(until);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!(at > now)) return;
    const t = setTimeout(() => setNow(Date.now()), Math.min(at - now + 500, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [at, now]);
  const off = at > now;
  return <button className="zf-btn" onClick={onTap} disabled={off} aria-disabled={off}>{off ? label : "Try again"}</button>;
}

/** The way out: the arrow, and while it's on screen Escape and browser Back (its own component, so ProblemView has no hooks). */
function BackArrow({ onBack, close }: { onBack: () => void; close: boolean }) {
  useBack(onBack);
  if (close) return <div className="zf-top"><span aria-hidden="true" /><button className="zf-sheet__close" onClick={onBack} aria-label="Close"><Close /></button></div>;
  return <div className="zf-top"><button className="zf-icon-btn" onClick={onBack} aria-label="Back"><Back /></button></div>;
}
