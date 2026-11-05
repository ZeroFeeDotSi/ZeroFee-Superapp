// "Your Safe has an update" (product decision, 5 Nov; the design review's spec U1 and SU8): on the Safe side of
// Home, and as a row in Security's Protection. It reads ONE thing, the core's account.safeUpdate: the update compiled
// into this app against the code the account runs on chain, and the contract's own waiting steps. No inbox, push,
// relay or server message reaches it (safe-update-ui.test.ts). The held screen (SafeUpdateHeld.tsx) loads only when
// opened.
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import type { SafeUpdate } from "@zerofee/core/safe-update";
import type { TxOutcome } from "@zerofee/core/signer";
import { SAFE_UPDATE_WORDS as W, cardLine, homeLine } from "./safe-update-words.ts";
import "./safe-update.css";

/** The core's answer, read again whenever a waiting request ends or the account changes. */
export function useSafeUpdate(bridge: Bridge): [SafeUpdate | null, () => void] {
  const [u, setU] = useState<SafeUpdate | null>(null);
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    const offs = ["account.waiting.ended", "recovery.changed"].map((e) => bridge.on(e, () => setSeq((n) => n + 1)));
    return () => offs.forEach((off) => off());
  }, [bridge]);
  useEffect(() => {
    let live = true;
    void bridge.call<SafeUpdate>("account.safeUpdate").then((r) => live && setU("ok" in r ? r.ok : null));
    return () => {
      live = false;
    };
  }, [bridge, seq]);
  return [u, () => setSeq((n) => n + 1)];
}

/** Update: one Face ID (the core's sheet, "Update your Safe") places both steps, then the held screen. */
export async function askUpdate(bridge: Bridge, onHeld: () => void, onProblem: (p: Problem) => void): Promise<void> {
  const res = await bridge.call<TxOutcome>("account.rules.update");
  if ("problem" in res) return onProblem(res.problem);
  if (res.ok.status === "problem") return onProblem(res.ok.problem);
  // Declined (Face ID cancelled): Home, the card stays, no message (U2).
  if (res.ok.status === "waiting" || res.ok.status === "done") onHeld();
}

/** Home's Safe side: the card (an update to ask for), one quiet line while it waits, or red for unknown code. */
export function SafeUpdateCard({ bridge, onOpen, onProblem }: { bridge: Bridge; onOpen: () => void; onProblem: (p: Problem) => void }) {
  const [u, reread] = useSafeUpdate(bridge);
  const [busy, setBusy] = useState(false);
  if (!u || u.state === "none") return null;
  if (u.state === "unknown") {
    return (
      <button type="button" className="su-line su-line--bad" data-testid="safe-update-unknown" onClick={onOpen}>
        <span className="su-dot su-dot--bad" aria-hidden />
        <span><b>{W.unknownTitle}</b> {W.unknownLine}</span>
      </button>
    );
  }
  if (u.state === "held" || u.state === "ready") {
    return (
      <button type="button" className="su-line" data-testid="safe-update-line" onClick={onOpen}>
        <span className="su-dot" aria-hidden />
        <span>{homeLine(Date.parse(u.readyAtIso), Date.now())}</span>
      </button>
    );
  }
  return (
    <section className="su-card" aria-label={W.cardTitle} data-testid="safe-update-card">
      <ShieldDown />
      <div className="su-card__text">
        <div className="su-card__title">{W.cardTitle}</div>
        <p className="su-card__line">{u.whatChanged}</p>
        <p className="su-card__line">{cardLine(u.phoneOnlySeconds, u.withSecondDeviceSeconds, u.hasSecondDevice)}</p>
      </div>
      <button type="button" className="su-chip" disabled={busy} onClick={() => { setBusy(true); void askUpdate(bridge, () => { reread(); onOpen(); }, onProblem).finally(() => setBusy(false)); }}>{W.update}</button>
    </section>
  );
}

/** Security's Protection: the same, as one row that always finds the held screen. */
export function SafeUpdateRow({ bridge, onOpen }: { bridge: Bridge; onOpen: () => void }) {
  const [u] = useSafeUpdate(bridge);
  if (!u || u.state === "none") return null;
  const text = u.state === "unknown" ? W.unknownTitle : u.state === "offer" ? W.cardTitle : homeLine(Date.parse(u.readyAtIso), Date.now());
  return (
    <button type="button" className={`su-line${u.state === "unknown" ? " su-line--bad" : ""}`} data-testid="safe-update-row" onClick={onOpen}>
      <span className={`su-dot${u.state === "unknown" ? " su-dot--bad" : ""}`} aria-hidden />
      <span>{text} ›</span>
    </button>
  );
}

export function ShieldDown({ size = 28, tick = false }: { size?: number; tick?: boolean }) {
  return (
    <svg className="su-glyph" width={size} height={size} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3.5 5.5 6.6v6.6c0 5.3 3.6 9.4 8.5 11.3 4.9-1.9 8.5-6 8.5-11.3V6.6L14 3.5Z" />
      {tick ? <path d="m10 14.2 2.8 2.8 5.2-5.6" /> : <path d="M14 9.5v8M10.8 14.6 14 17.8l3.2-3.2" />}
    </svg>
  );
}
