// The "Your key" proof card (L6, Z21): the first row of Security and the end of set-up. It asks the core
// (account.keyProof) where this device's key is and whether it is the key on the account, read from two nodes, and shows a
// tick only when it is. "How we know" opens the proof. A key that doesn't match, or can't be read, is a plain Problem.
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { KeyProof } from "@zerofee/core/demo-core";
import type { Problem } from "@zerofee/core/problem";
import { Check } from "@zerofee/design/icons.tsx";
import { More } from "@zerofee/design/More.tsx";
import { ThisDevice } from "@zerofee/shell-api/approval-words.ts";
import { isProblem, keyProofWords, type KeyProofWords } from "./key-proof-words.ts";

/** The money line of a Problem shown inside the card (the Problem screen's own words). */
const moneyLine = (p: Problem): string | null =>
  p.money.state === "safe" ? `Your money hasn't moved. It's ${p.money.where}.` : p.money.state === "not-involved" ? null : `Your money is ${p.money.where}.`;

/** The last answer that matched, kept on this device: the line paints at once, ticked, while it is checked again. */
const KEPT = "zf.key.line";
const keptLine = (): string | null => {
  try {
    return globalThis.localStorage?.getItem(KEPT) ?? null;
  } catch {
    return null;
  }
};
const keepLine = (line: string | null) => {
  try {
    if (line) globalThis.localStorage?.setItem(KEPT, line);
    else globalThis.localStorage?.removeItem(KEPT);
  } catch {
    // storage blocked: it is checked each time instead
  }
};

/** Job 1, criterion 7: one line, "Your key is in this phone ✓"; where it was made and how we know, under Details. It
 *  paints at once (the last match kept on this device, else the plain line with no tick yet) and never blocks (B13). */
/** `row` (Devices, design review §2.5 and change 5): one fact row, "This phone · Your key is here ✓"; a tap shows its
 *  proof (it matches the account, where it was made), with no server names. */
export function KeyProofCard({ bridge, seq = 0, row = false }: { bridge: Bridge; seq?: number; row?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ k: "reading"; kept: string | null } | { k: "shown"; words: KeyProofWords } | { k: "problem"; problem: Problem }>(() => ({ k: "reading", kept: keptLine() }));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void bridge.call<KeyProof>("account.keyProof").then((r) => {
      if (!live) return;
      if ("problem" in r) {
        keepLine(null);
        return setState({ k: "problem", problem: r.problem });
      }
      const w = keyProofWords(r.ok);
      keepLine(isProblem(w) ? null : w.line);
      setState(isProblem(w) ? { k: "problem", problem: w } : { k: "shown", words: w });
    });
    return () => { live = false; };
  }, [bridge, seq, attempt]);

  if (row && state.k !== "problem") {
    const ticked = state.k === "shown" || Boolean(state.kept);
    return (
      <div className="sec-key-row" aria-busy={state.k === "reading" ? true : undefined}>
        <button className="sec-fact-row sec-fact-row--btn" aria-expanded={open} disabled={state.k !== "shown"} onClick={() => setOpen((o) => !o)}>
          <span>{ThisDevice()}</span>
          <span className="v">{ticked ? <>Your key is here <span className="zf-tick on sec-key-row__tick" aria-hidden="true"><Check /></span></> : "Your key"}</span>
        </button>
        {open && state.k === "shown" && <div className="sec-key-row__more">{[state.words.match, state.words.where].map((l) => <p key={l} className="zf-small">{l}</p>)}</div>}
      </div>
    );
  }
  if (state.k === "reading") {
    // the kept line has its tick (it matched last time); a first look shows the plain line, ticked once it matches
    return (
      <div className="sec-key sec-key--row" aria-busy="true">
        <div className="sec-key__line"><span className={`zf-tick ${state.kept ? "on" : "off"}`} aria-hidden="true">{state.kept && <Check />}</span><span className="t">{state.kept ?? "Your key"}</span></div>
      </div>
    );
  }
  if (state.k === "problem") {
    const p = state.problem;
    const money = moneyLine(p);
    return (
      <div className="zf-note sec-key sec-key--problem" role="alert">
        <div className="t">{p.whatHappened}</div>
        {money && <p className="zf-small" style={{ marginTop: 6 }}>{money}</p>}
        {p.more && <p className="zf-small" style={{ marginTop: 6 }}>{p.more}</p>}
        <button className="zf-link sec-act sec-key__btn" onClick={() => setAttempt((n) => n + 1)}>{p.next.label}</button>
      </div>
    );
  }
  const w = state.words;
  return (
    <div className="sec-key sec-key--row">
      <div className="sec-key__line"><span className="zf-tick on" aria-hidden="true"><Check /></span><span className="t">{w.line}</span></div>
      <More label="Details" className="sec-key__more" lines={[w.match, w.where, ...w.how]} />
    </div>
  );
}
