// O-2 "first win" (master plan row 16): after "Your account is open", one screen offers to move $2 of the Safe into
// Hidden. One tap: Hidden's wallet is made if needed, the core's own price is asked, and the core's one Approve shows
// (Face ID on the phone). Every way out leads into ZeroFee: Later, done, slow, or failed (the money stays in the Safe).
// Loaded only when offered (FundStart's lazy import), never in the first load.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { Mark } from "@zerofee/design/Mark.tsx";
import { PrivateMark } from "@zerofee/wallet/app/icons.tsx";
import { PRIVATE_SEEN } from "@zerofee/wallet/app/format.ts";
import { markWinSeen, winFailLine, winMoneyLine, winStateOf, WIN_WORDS, type WinOffer, type WinState } from "./first-win.ts";
import "./onboarding.css";

export { readWin } from "./first-win.ts";

/** How often the move is read again while it goes, and when the screen says it keeps going on its own. */
export const WIN_POLL_MS = 4000;
export const WIN_SLOW_MS = 20_000;
/** The move's reads stop here (the screen has said it keeps going since WIN_SLOW_MS). */
export const WIN_GIVE_UP_MS = 120_000;

export function FirstWin({ wallet, offer, onDone, pollMs = WIN_POLL_MS }: { wallet: Bridge; offer: WinOffer; onDone: () => void; pollMs?: number }) {
  const [state, setState] = useState<WinState>("offer");
  const [problem, setProblem] = useState<Problem | null>(null);
  /** What the failure screen may say about the money (review M2), and whether it came back into Hidden. */
  const [money, setMoney] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  /** Hidden's wallet made in this visit (review M1: a "no" then a second tap must not make it again). */
  const made = useRef(false);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);
  // Set again on every mount (React's dev double mount runs the cleanup once first; FundFlow does the same).
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (slowTimer.current) clearTimeout(slowTimer.current);
    };
  }, []);
  const fail = (p: Problem | null, signed: boolean, line?: string) => {
    if (!live.current) return;
    setProblem(p);
    setMoney(line ?? winMoneyLine(p, signed));
    setState("failed");
  };

  // Shown once: from the first look, it never asks again on this device.
  useEffect(() => markWinSeen(), []);

  async function go() {
    if (state !== "offer") return;
    setState("asking");
    // Review M4: a set-up, price or Approve that hangs still gets the way in after a while.
    setSlow(false);
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => live.current && setSlow(true), WIN_SLOW_MS);
    if (offer.setUp && !made.current) {
      const r = await wallet.call("ledger.privateSetup");
      if ("problem" in r) return fail(r.problem, false);
      made.current = true;
    }
    const quote = await wallet.call<{ id: string }>("ledger.quoteToPrivate", { tokenId: "near", amount: offer.near });
    if ("problem" in quote) return fail(quote.problem, false);
    // The core's own Approve shows here (Face ID on the phone); a "no" goes back to the offer, nothing moved.
    const moved = await wallet.call<{ id: string; status: string; held?: unknown; problem?: Problem }>("ledger.toPrivate", { quoteId: quote.ok.id });
    if (!live.current) return;
    if ("problem" in moved) {
      if (moved.problem.code === "ledger.signature.declined") return void (setSlow(false), setState("offer"));
      return fail(moved.problem, true);
    }
    // Review M3: held by the account's rules: nothing moved yet; it waits for a yes, said plainly.
    if (moved.ok.status === "waiting" && moved.ok.held) return setState("held");
    const now = winStateOf(moved.ok.status);
    if (now === "done") return setState("done");
    if (now === "failed") return moved.ok.status === "refunded" ? fail(null, true, WIN_WORDS.cameBack) : fail(moved.ok.problem ?? null, true);
    setState("moving");
    void follow(moved.ok.id);
  }

  /** Wallet's Activity reads the move until it lands, comes back, or the reads stop (the screen already says it goes on). */
  async function follow(id: string) {
    const started = Date.now();
    while (live.current && Date.now() - started < WIN_GIVE_UP_MS) {
      await new Promise((r) => setTimeout(r, pollMs));
      if (!live.current) return;
      if (Date.now() - started >= WIN_SLOW_MS) setSlow(true);
      const r = await wallet.call<{ id: string; status: string; problem?: Problem }[]>("ledger.activity", {});
      const m = "ok" in r ? r.ok.find((x) => x.id === id) : undefined;
      if (!m) continue;
      const now = winStateOf(m.status);
      if (now === "done") return live.current && setState("done");
      if (now === "failed") return m.status === "refunded" ? fail(null, true, WIN_WORDS.cameBack) : fail(m.problem ?? null, true);
    }
  }

  const later = () => onDone();
  const amount = offer.usd;
  if (state === "done") {
    return (
      <Shell icon={<PrivateMark size={56} />} title={WIN_WORDS.doneTitle} line={WIN_WORDS.doneLine} button={WIN_WORDS.open} onButton={onDone} />
    );
  }
  if (state === "failed") {
    return (
      <Shell icon={<Mark size={56} mode="still" />} title={WIN_WORDS.failTitle} line={problem && winFailLine(problem) !== WIN_WORDS.failTitle ? winFailLine(problem) : null} note={money ?? undefined} button={WIN_WORDS.open} onButton={onDone} alert />
    );
  }
  if (state === "held") {
    return (
      <Shell icon={<Mark size={56} mode="still" />} title={WIN_WORDS.heldTitle} line={WIN_WORDS.heldLine} button={WIN_WORDS.open} onButton={onDone} />
    );
  }
  if (state === "asking" || state === "moving") {
    return (
      <Shell icon={<Mark size={56} mode="loading" />} title={state === "asking" ? WIN_WORDS.getting : WIN_WORDS.moving(amount)} line={slow ? WIN_WORDS.slow : null} button={slow ? WIN_WORDS.open : null} onButton={onDone} busy />
    );
  }
  return (
    <Shell
      icon={<PrivateMark size={56} />}
      title={WIN_WORDS.title}
      line={WIN_WORDS.line(amount)}
      note={PRIVATE_SEEN}
      button={WIN_WORDS.go(amount)}
      onButton={() => void go()}
      link={WIN_WORDS.later}
      onLink={later}
    />
  );
}

/** One screen of the win: a mark, a title, at most two lines, and one button (plus Later on the offer). */
function Shell({ icon, title, line, note, more, button, onButton, link, onLink, busy, alert }: { icon: ReactNode; title: string; line?: string | null; note?: string; more?: ReactNode; button: string | null; onButton: () => void; link?: string; onLink?: () => void; busy?: boolean; alert?: boolean }) {
  return (
    <div className="zf-screen zf-pad" data-testid="first-win">
      <div className="zf-fill" />
      <div className="ob-center zf-enter" role={busy ? "status" : undefined} aria-live={busy ? "polite" : undefined}>
        {icon}
        <h1 className="zf-title" style={{ marginTop: 30 }}>{title}</h1>
        {line && <p className="zf-body" style={{ marginTop: 10 }}>{line}</p>}
        {note && <p className={`zf-small${alert ? " fs-line--alert" : ""}`} style={{ marginTop: 8 }}>{note}</p>}
        {more}
      </div>
      <div className="zf-fill" />
      <div className="zf-floor zf-enter-2">
        {button && <button className="zf-btn" onClick={onButton}>{button}</button>}
        {link && onLink && <button className="zf-link" onClick={onLink}>{link}</button>}
      </div>
    </div>
  );
}
