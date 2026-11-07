// Top up, Put away and the cap (D52): the only money choices in ZeroFee. Each is the one money sheet (Job 1, MoneySheet):
// how much is where at its top (B12), the amount in dollars, one button; while the core's Approve sheet is up this one
// steps aside (`onAway`), and after a yes it closes with one line saying it went (`onDone(line)`), over whichever app the
// person was in (MoneyHost).
// - Top up: the Safe → Spending. The amount starts at what fits the cap (and what the Safe holds); one tap on "Top up $X"
//   and the core's own Approve sheet and Face ID follow (spending.topUp). Its checks run before the sheet (H44); a Problem
//   whose next step is "Top up $X" puts that amount in and keeps the sheet up.
// - Put away: Spending's cash → the Safe, everything by default; no Face ID, money only goes home. Coins stay.
// - The cap: $100, $500 or $2,000, or any whole amount up to $5,000 (spending.setCap).
import { useEffect, useRef, useState } from "react";
import type { NextStep, Problem } from "@zerofee/core/problem";
import type { SpendingActivity, SpendingStatus } from "@zerofee/core/spending";
import { SPENDING_CAP, faceIdBandUsd } from "@zerofee/core/spending";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { MoneyAmount, MoneySheet, SheetLine, type Pot } from "@zerofee/design/MoneySheet.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { approvalWords } from "@zerofee/shell-api/approval-words.ts";
import { runJob } from "@zerofee/shell-api/job-run.ts";
import { topUpAsk, topUpEnded } from "@zerofee/shell-api/topup-ask.ts";
import { dollars } from "../format.ts";
import { ActMove } from "../icons.tsx";
import { JobMade } from "../money/JobMade.tsx";
import { LEG_SEC } from "./move-split.ts";
import { amountIn, capNeeds, topUpStart, trimCents, typedUsd, validUsd, wholeDollars } from "../hub.ts";
import { SHEET_NEEDS, sheetLineOf, useServices } from "../services.ts";
import { potsOf } from "../money/pots.ts";
import { sendEndsHere } from "../money/swap-refused.ts";

type Held = NonNullable<SpendingActivity["held"]>;

/** `onLine` (B28): a service that failed is said as one line on the sheet itself, never the shell's Problem screen. */
export function useMoveProblem(onOpen: (next: NextStep) => void, onLine?: (line: string) => void) {
  const shell = useShell();
  return async (p: Problem, setUsd: (s: string) => void) => {
    const line = onLine ? sheetLineOf(p) : null;
    if (line) return onLine!(line);
    const next = await shell.showProblem(p);
    // money that may have gone: its sheet goes (MoneyHost's open: Activity) even on the screen's Close, never its lit button
    if (sendEndsHere(p)) return onOpen(p.next);
    if (next.kind === "fix-input") {
      const usd = amountIn(next.label);
      if (usd) setUsd(usd);
      return;
    }
    // "held/<id>" (finish rules already saved): the shell opened it over Wallet, and this sheet waits under it.
    if (next.kind === "open" && !next.screen.startsWith("held/")) onOpen(next);
  };
}

const Amount = ({ usd, onUsd, label }: { usd: string; onUsd: (s: string) => void; label: string }) => <MoneyAmount usd={usd} onUsd={onUsd} label={label} />;

/** How much is where (B12): money/pots.ts, re-exported for the sheets that read it from here. */
export { potsOf };

/** `onAdd`: a Safe with nothing to move says why and offers Add money (grade 1 Nov b, N4), never a grey $0 button. */
/** `testAccount`: the Safe holds test NEAR only. Top up moves real money through NEAR Intents, which has no test network:
 *  said once, plainly, never "your Safe has $0" and an Add money that can't satisfy it (grade 02f, F3: a loop). */
/** `askedUsd`: the amount another app asked for (Apps' "Make $10 ready" with no cash): the sheet starts there whenever
 *  that can go now (under the cap, the Safe and its Face ID rule), else at what can. */
/** `safeUsd`: null while the Safe isn't read yet (or couldn't be): never "your Safe has $0" then (UX walk 2 Nov: under
 *  a slow network the sheet said "Add money to your Safe first … your Safe has $0" over a Safe of $30.92). */
export function TopUpSheet({ status, safeUsd: safeRead, onClose, onDone, onHeld, onCap, onOpen, onAdd, testAccount = false, askedUsd }: { status: SpendingStatus; safeUsd: string | null; onClose: () => void; onDone: (line: string) => void; onHeld: (h: Held) => void; onCap: () => void; onOpen: (next: NextStep) => void; onAdd?: () => void; testAccount?: boolean; askedUsd?: string }) {
  const { bridge, tasks } = useShell();
  // unread: what fits is Spending's room alone; the engine checks the Safe when Top up is tapped
  const safeUsd = safeRead ?? status.roomUsd;
  const startAt = (fits: string) => (askedUsd && Number(askedUsd) >= 2 && Number(askedUsd) <= Number(fits) ? askedUsd : fits);
  const [usd, setUsd] = useState(() => startAt(topUpStart(status.roomUsd, safeUsd)));
  // Never starts over what the Safe lets go with Face ID alone (its first band): a top up's price can't wait (UX walk
  // 2 Nov: $30 over the test account's $21 band, then a Problem). Only while the person hasn't typed.
  const typed = useRef(false);
  const [band, setBand] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void bridge.call<{ usd?: { upToUsd: number | null; level: string }[] | null }>("account.protection.get", {}).then((r) => {
      const b = "ok" in r ? faceIdBandUsd(r.ok.usd ?? undefined) : null;
      if (live && typeof b === "number" && b >= 2) setBand(b);
    });
    return () => { live = false; };
  }, [bridge]);
  // Until the person types, the amount follows what can go now: opened before Spending or the Safe were read (UX walk
  // 2 Nov: Apps' "Top up Spending" opened this sheet at $0), it fills in once they are.
  useEffect(() => {
    if (typed.current) return;
    const start = topUpStart(status.roomUsd, safeUsd);
    setUsd(startAt(band !== null && Number(start) > band ? topUpStart(String(band), String(band)) : start));
  }, [status.roomUsd, safeUsd, band, askedUsd]);
  const [busy, setBusy] = useState(false);
  /** The job is made at the tap (rule 2: "Job created." and its time left, never "Moving…"): its dollars. */
  const [made, setMade] = useState<string | null>(null);
  /** The job its receipt follows (runJob's made): its own rows, never another job's (the audit's finding, 7 Nov). */
  const [madeJob, setMadeJob] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const services = useServices(bridge, SHEET_NEEDS.move, "Move");
  const problem = useMoveProblem((next) => (next.kind === "open" && next.screen === "spending-cap" ? onCap() : onOpen(next)), setLine);
  const full = Number(status.roomUsd) < 2;
  const emptySafe = safeRead !== null && !(Number(safeRead) >= 0.01);
  // the job's own key per amount (the audit's SHOULD, 7 Nov: topUpAsk): the core's approval.asked and job.signed name it
  const keys = useRef(new Map<string, string>());
  const go = async () => {
    // cents always: the line and Home's row spell the moving amount one way ("$3.00", audit 2 Nov)
    const amount = `$${Number(typedUsd(usd)).toFixed(2)}`;
    const ask = topUpAsk(keys.current, typedUsd(usd), "home-topup");
    setBusy(true);
    setLine(null);
    // rule 2 (5 Nov): the job is made at the tap, "Job created." and its time left here, its row on
    // Home; the Safe still asks Face ID for its signature (the phone's own sheet), and a No, or a refusal before the yes,
    // takes the job away again and this sheet is as it was (runJob)
    const end = await runJob<SpendingActivity | { declined: true }>({
      tasks, title: `Move ${amount} to your NEAR wallet`, usd: amount, etaSec: LEG_SEC.nearOut, safe: true, money: ["safe"],
      call: () => bridge.call<SpendingActivity | { declined: true }>("spending.topUp", ask.params), key: ask.key,
      declined: (r) => "ok" in r && "declined" in r.ok,
      made: (j) => { setMadeJob(j.id); setMade(amount); setBusy(false); },
    });
    setBusy(false);
    topUpEnded(keys.current, ask.params.usd, end);
    if ("declined" in end) return void setMade(null);
    if ("refused" in end) {
      setMade(null);
      return void problem(end.refused, setUsd);
    }
    // refused after the yes: the job's row says why; the receipt stays until Done
    if ("problem" in end) return;
    const ok = end.ok as SpendingActivity;
    end.job.made([`move:${ok.id}`]);
    if (ok.held) {
      setMade(null);
      onHeld(ok.held);
      return onDone("");
    }
  };
  if (made !== null) return <JobMade title="Move to your NEAR wallet" amount={made} icon={<ActMove />} testid="topup-made" etaSec={LEG_SEC.nearOut} through={null} job={madeJob} onDone={() => onDone("")} />;
  return (
    <MoneySheet title="Move to your NEAR wallet" pots={potsOf(safeRead, status)} away={busy} onClose={onClose}>
      {testAccount ? (
        <>
          <p className="zf-body wl-sheet-lead">Moving to your NEAR wallet uses real money only. Your test NEAR ({dollars(safeUsd)}) stays in your Safe.</p>
          <button className="zf-btn zf-btn--quiet wl-sheet-go" onClick={onClose}>Close</button>
        </>
      ) : full ? (
        <p className="zf-body wl-sheet-lead">Your NEAR wallet is full. It holds up to {wholeDollars(status.capUsd)}.</p>
      ) : emptySafe ? (
        <>
          <p className="zf-body wl-sheet-lead">Your Safe is empty. Add money to it first, then top up.</p>
          {onAdd && <button className="zf-btn wl-sheet-go" onClick={onAdd}>Add money</button>}
        </>
      ) : (
        <>
          <p className="zf-small wl-sheet-lead">From your Safe to your NEAR wallet</p>
          <Amount usd={usd} onUsd={(v) => { typed.current = true; setUsd(v); }} label="Dollars to top up" />
          {/* Say it once (UI-SIMPLICITY-RULES 8; round 3): with the field at all the room left, the amount is already in
              the field and on the button, so the line says what it does instead of a third "$327.46". */}
          <p className="zf-small wl-sheet-lead">{status.firstTopUp ? "Ready to trade everywhere in about 30 seconds." : validUsd(usd) && Math.abs(Number(typedUsd(usd)) - Number(status.roomUsd)) < 0.005 ? "That fills your NEAR wallet." : `You can add ${dollars(status.roomUsd)} more.`}</p>
          <SheetLine text={line ?? services.line} />
          <button className="zf-btn wl-sheet-go" disabled={busy || !validUsd(usd) || services.down} onClick={() => void go()}>{`Move ${validUsd(usd) ? `$${trimCents(Number(typedUsd(usd)).toFixed(2))}` : ""}`.trim()}</button>
        </>
      )}
      {!testAccount && <button className="zf-link wl-sheet-more" onClick={onCap}>Your NEAR wallet holds up to {wholeDollars(status.capUsd)} · Change</button>}
    </MoneySheet>
  );
}

export function PutAwaySheet({ status, safeUsd = null, onClose, onDone, onOpen }: { status: SpendingStatus; safeUsd?: string | null; onClose: () => void; onDone: (line: string) => void; onOpen: (next: NextStep) => void }) {
  const { bridge, tasks } = useShell();
  const [some, setSome] = useState(false);
  const [usd, setUsd] = useState("");
  const [busy, setBusy] = useState(false);
  /** The job is made at the tap (rule 2): its dollars, and the sheet says "Job created." with its time left. */
  const [made, setMade] = useState<string | null>(null);
  /** The job its receipt follows (runJob's made): its own rows, never another job's (the audit's finding, 7 Nov). */
  const [madeJob, setMadeJob] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const services = useServices(bridge, SHEET_NEEDS.putaway, "Move to your Safe");
  const problem = useMoveProblem(onOpen, setLine);
  const go = async (amount: string) => {
    const shown = amount === "all" ? dollars(status.cashUsd) : `$${Number(amount).toFixed(2)}`;
    setBusy(true);
    setLine(null);
    // no Face ID (money only goes home): made at the tap; a refusal takes it away again with the sheet's own line
    const end = await runJob<SpendingActivity>({
      tasks, title: `Move ${shown} to your Safe`, usd: shown, etaSec: LEG_SEC.nearToSafe, safe: false, money: ["row:near"],
      call: () => bridge.call<SpendingActivity>("spending.putAway", { usd: amount }),
      declined: () => false,
      made: (j) => { setMadeJob(j.id); setMade(shown); setBusy(false); },
    });
    setBusy(false);
    if ("refused" in end) {
      setMade(null);
      return void problem(end.refused, (s) => { setSome(true); setUsd(s); });
    }
    // refused once the job existed: its row says why (said once); the receipt stays until Done
    if ("problem" in end || "declined" in end) return;
    end.job.made([`move:${end.ok.id}`]);
  };
  const cash = Number(status.cashUsd);
  if (made !== null) return <JobMade title="Move to your Safe" amount={made} icon={<ActMove />} testid="putaway-made" etaSec={LEG_SEC.nearToSafe} through={null} job={madeJob} onDone={() => onDone("")} />;
  // Nothing to put away: say so, never a grey button (grade 1 Nov c, P10; Top up's N4 fix the same way).
  if (!(cash >= 0.01) && !some) {
    return (
      <MoneySheet title="Move to your Safe" pots={potsOf(safeUsd, status)} onClose={onClose}>
        <p className="zf-body wl-sheet-lead">Your NEAR wallet has no cash to move.</p>
        {Number(status.coinsUsd) > 0 && <p className="zf-small wl-sheet-lead">Your coins ({dollars(status.coinsUsd)}) stay until you sell them.</p>}
        <button className="zf-btn zf-btn--quiet wl-sheet-go" onClick={onClose}>Close</button>
      </MoneySheet>
    );
  }
  return (
    <MoneySheet title="Move to your Safe" pots={potsOf(safeUsd, status)} onClose={onClose}>
      <p className="zf-small wl-sheet-lead">Back to your Safe. {approvalWords().none}: money only goes home.</p>
      <SheetLine text={line ?? services.line} />
      {some ? (
        <>
          <Amount usd={usd} onUsd={setUsd} label="Dollars to put away" />
          <button className="zf-btn wl-sheet-go" disabled={busy || !validUsd(usd) || services.down} onClick={() => void go(typedUsd(usd)!)}>{`Move ${validUsd(usd) ? `$${trimCents(Number(typedUsd(usd)).toFixed(2))}` : ""}`.trim()}</button>
        </>
      ) : (
        <>
          <p className="wl-display wl-sheet-big">{dollars(status.cashUsd)}</p>
          <p className="zf-small wl-sheet-lead">Your NEAR wallet's cash</p>
          <button className="zf-btn wl-sheet-go" disabled={busy || services.down} onClick={() => void go("all")}>Move it all</button>
          <button className="zf-link wl-sheet-more" onClick={() => setSome(true)}>Move some</button>
        </>
      )}
      {Number(status.coinsUsd) > 0 && <p className="zf-small wl-sheet-lead">Your coins ({dollars(status.coinsUsd)}) stay until you sell them.</p>}
    </MoneySheet>
  );
}

export function CapSheet({ capUsd, onClose, onDone }: { capUsd: string; onClose: () => void; onDone: () => void }) {
  const shell = useShell();
  const [custom, setCustom] = useState("");
  const [other, setOther] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = async (usd: number) => {
    setBusy(true);
    const r = await shell.bridge.call("spending.setCap", { usd });
    setBusy(false);
    if ("problem" in r) return void shell.showProblem(r.problem);
    onDone();
  };
  const typed = Number(typedUsd(custom));
  const needs = capNeeds(custom, SPENDING_CAP.minUsd, SPENDING_CAP.maxUsd);
  return (
    <Sheet title="Your NEAR wallet holds up to" onClose={onClose}>
      <div className="wl-caps">
        {SPENDING_CAP.presetsUsd.map((c) => (
          <button key={c} className={`wl-cap${Number(capUsd) === c ? " on" : ""}`} aria-pressed={Number(capUsd) === c} disabled={busy} onClick={() => void set(c)}>{wholeDollars(String(c))}</button>
        ))}
      </div>
      {/* One idea: pick a size. Another amount is one tap down (UI-SIMPLICITY-RULES 1, 2): an empty "$0" field under a
          chosen $500 read as a second, different answer, and the range was said twice (hint and button). */}
      {other ? (
        <>
          <Amount usd={custom} onUsd={setCustom} label={`Another amount, $${SPENDING_CAP.minUsd} to $${SPENDING_CAP.maxUsd}`} />
          <button className="zf-btn wl-sheet-go" disabled={busy || needs !== null} onClick={() => void set(typed)}>{needs ?? `Use ${wholeDollars(String(typed))}`}</button>
        </>
      ) : (
        <button className="zf-link wl-sheet-more" onClick={() => setOther(true)}>Another amount</button>
      )}
      <p className="zf-small wl-sheet-lead">Keep your NEAR wallet small: your backup words open it at once.</p>
    </Sheet>
  );
}
