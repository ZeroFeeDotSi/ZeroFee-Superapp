// Top up and Put away (D52): Trade's own way into Spending's two actions, through the one engine (`spending.topUp`,
// `spending.putAway`, docs/interfaces.md "Spending"). Top up: the Safe → Spending, one Approve sheet and one Face ID; the
// cap, the $2 floor, the Safe's Face ID band and the coin that pays are the engine's, checked before the sheet. Put away:
// Spending's cash → the Safe, no sheet; coins stay until sold. Both say an honest time.
import { useState } from "react";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { runJob } from "@zerofee/shell-api/job-run.ts";
import { JobReceipt } from "@zerofee/wallet/app/money/JobMade.tsx";
import { ActMove } from "@zerofee/wallet/app/icons.tsx";
import { LEG_SEC } from "@zerofee/wallet/app/screens/move-split.ts";
import { Face } from "@zerofee/design/icons.tsx";
import { More } from "@zerofee/design/More.tsx";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { isPositive } from "@zerofee/design/keypad.ts";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import type { NextStep, Problem } from "@zerofee/core/problem";
import { faceIdBandUsd, pickSafeCoin, type SafeCoin, type SpendingActivity, type SpendingStatus } from "@zerofee/core/spending";
import { DECLINED_WORDS, about, floatProblems } from "../boards.ts";
import { usd } from "../format.ts";
import { useFloat, useLive } from "../runtime.tsx";
import { approvalWords, spentLine } from "../approval.ts";
import { UNREAD_WORDS } from "../../float-view.ts";

const PRESETS = [5, 10, 25, 50, 100, 250];
/** The quick amounts: only ones that can go now (under the cap, the Safe's coin and its Face ID band), at most four. */
export const presetsUnder = (fits: number): string[] => PRESETS.filter((v) => !(v > fits)).slice(-4).map(String);

export function AddSheet({ onClose, onProblem }: { onClose: () => void; onProblem: (p: Problem) => Promise<NextStep> }) {
  const { bridge, showWaiting, tasks } = useShell();
  const status = useLive(() => bridge.call<SpendingStatus>("spending.status", {}).then((r) => ("ok" in r ? r.ok : undefined)), []).value;
  const room = status ? Number(status.roomUsd) : undefined;
  // What one coin of the Safe can pay (one coin pays a Top up, the engine's own pick): the amount never starts above it
  // (grade 02h, H4: $500 offered over a Safe of $31).
  const safe = useLive(() => bridge.call<SafeCoin[]>("ledger.balances", {}).then((r) => ("ok" in r && Array.isArray(r.ok) ? pickSafeCoin(r.ok, Infinity)?.coversUsd ?? 0 : undefined)), []).value;
  // What the Safe's protection lets go with Face ID alone (its first band): a Top up over it would wait, and a top up's
  // price can't (UX walk 2 Nov: the sheet started at $30 over the test account's $21 band, then sent the tester to a Problem).
  const band = useLive(() => bridge.call<{ usd?: { upToUsd: number | null; level: string }[] | null }>("account.protection.get", {}).then((r) => ("ok" in r ? faceIdBandUsd(r.ok.usd ?? undefined) : undefined)), []).value;
  const [value, setValue] = useState<string | null>(null);
  // the amount starts at what fits under the cap (D52 §2.4: pre-filled), what the Safe can pay and what goes with Face
  // ID alone, never more
  const fits = Math.min(room ?? Infinity, safe ?? Infinity, typeof band === "number" && band > 0 ? band : Infinity);
  const shown = value ?? (Number.isFinite(fits) && fits >= 2 ? String(Math.floor(fits)) : "25");
  const [keypad, setKeypad] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);
  /** The job is made at the tap (rule 2: "Job created." and its time left, never "Moving…"): its dollars. */
  const [made, setMade] = useState<string | null>(null);
  const topUp = async () => {
    const amount = `$${Number(shown).toFixed(2)}`;
    setBusy(true); setDeclined(false);
    try {
      // made at the tap; the Safe still asks Face ID for its signature, and a No or a refusal before the yes takes the
      // job away again (runJob)
      const end = await runJob<SpendingActivity | { declined: true }>({
        tasks, title: `Move ${amount} to your NEAR wallet`, usd: amount, etaSec: LEG_SEC.nearOut, safe: true, money: ["safe"],
        call: () => bridge.call<SpendingActivity | { declined: true }>("spending.topUp", { usd: shown }),
        declined: (r) => "ok" in r && "declined" in r.ok,
        made: () => { setMade(amount); setBusy(false); },
      });
      if ("declined" in end) { setMade(null); setDeclined(true); return; }
      if ("refused" in end) {
        setMade(null);
        const next = await onProblem(end.refused);
        // "Top up $180": the amount that fits, offered on the same sheet
        const fit = next.kind === "fix-input" ? /\$([\d,.]+)/.exec(next.label)?.[1]?.replace(/,/g, "") : undefined;
        if (fit) setValue(String(Math.floor(Number(fit))));
        return;
      }
      // refused after the yes: the job's row says why; the receipt stays until Done
      if ("problem" in end) return;
      const ok = end.ok as SpendingActivity;
      end.job.made([`move:${ok.id}`]);
      // the Safe's protection holds it (D17): the shell's Waiting screen, never "topped up"
      if (ok.held) { onClose(); showWaiting(ok.held); }
    } catch {
      setMade(null);
      await onProblem(floatProblems.addFailed());
    } finally { setBusy(false); }
  };
  if (made !== null) {
    return (
      <Sheet title="Move to your NEAR wallet" onClose={onClose}>
        <JobReceipt amount={made} icon={<ActMove />} testid="trade-add-made" etaSec={LEG_SEC.nearOut} through={null} onDone={onClose} />
      </Sheet>
    );
  }
  return (
    <Sheet title="Move to your NEAR wallet" onClose={onClose}>
      <button className="tr-big" onClick={() => setKeypad((k) => { if (!k) setFresh(true); return !k; })} aria-label="Change the amount">
        <span className="tr-big-n">${shown}</span>
        <span className="zf-small">{declined ? DECLINED_WORDS : status ? `from your Safe · your NEAR wallet ${usd(Number(status.totalUsd))} of ${usd(Number(status.capUsd))}` : "from your Safe"}</span>
      </button>
      {keypad ? <Keypad value={fresh ? "" : shown} decimals={2} onChange={(v) => { setFresh(false); setValue(v); }} /> : (
        <div className="tr-presets">{presetsUnder(fits).map((v) => <button key={v} className={v === shown ? "on" : ""} onClick={() => setValue(v)}>${v}</button>)}</div>
      )}
      <div className="tr-sheet-floor">
        <button className="zf-btn" disabled={!isPositive(shown) || busy} onClick={topUp}><Face />{`Move $${shown}`}</button>
        <p className="zf-small">{status?.firstTopUp ? "Ready to trade everywhere in about 30 seconds." : "Lands in your NEAR wallet in about a minute."}</p>
        <More label="How your wallets pay" lines={[spentLine()]} />
      </div>
    </Sheet>
  );
}

export function TakeOutSheet({ onClose, onProblem }: { onClose: () => void; onProblem: (p: Problem) => Promise<NextStep> }) {
  const { bridge, tasks } = useShell();
  const { snap } = useFloat();
  const [all, setAll] = useState(true);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  /** The job is made at the tap (rule 2): its dollars, and the sheet says "Job created." with its time left. */
  const [made, setMade] = useState<string | null>(null);
  // what can go home now: Spending's cash (coins stay until sold, and a wallet holding coins keeps its fee)
  const total = snap.takeableUsd;
  const want = all ? total : Math.min(total, Number(value) || 0);
  const coins = snap.chains.reduce((n, c) => n + c.coinsUsd, 0);
  const putAway = async () => {
    const amount = usd(want);
    setBusy(true);
    try {
      // no Face ID (money only goes home): made at the tap; a refusal before it went says so on this sheet
      const end = await runJob<SpendingActivity>({
        tasks, title: `Move ${amount} to your Safe`, usd: amount, etaSec: LEG_SEC.nearToSafe, safe: false, money: ["row:near"],
        call: () => bridge.call<SpendingActivity>("spending.putAway", { usd: all ? "all" : want.toFixed(2) }),
        declined: () => false,
        made: () => { setMade(amount); setBusy(false); },
      });
      if ("refused" in end) { setMade(null); await onProblem(end.refused); return; }
      // refused once the job existed: its row says why (said once); the receipt stays until Done
      if ("ok" in end) end.job.made([`move:${end.ok.id}`]);
    } catch {
      setMade(null);
      await onProblem(floatProblems.takeOutFailed());
    } finally { setBusy(false); }
  };
  if (made !== null) {
    return (
      <Sheet title="Move to your Safe" onClose={onClose}>
        <JobReceipt amount={made} icon={<ActMove />} testid="trade-takeout-made" etaSec={LEG_SEC.nearToSafe} through={null} onDone={onClose} />
      </Sheet>
    );
  }
  return (
    <Sheet title="Move to your Safe" onClose={onClose}>
      <button className="tr-big" onClick={() => setAll(false)} aria-label="Change the amount">
        <span className="tr-big-n">{usd(want)}</span>
        <span className="zf-small">{all ? "all your NEAR wallet's cash · back to your Safe" : `of ${usd(total)} · tap to change`}</span>
      </button>
      {all ? (
        <div className="tr-presets tr-presets--2">
          <button className="on" onClick={() => setAll(true)}>Everything</button>
          <button onClick={() => setAll(false)}>Some</button>
        </div>
      ) : <Keypad value={value} decimals={2} onChange={setValue} />}
      <div className="tr-sheet-floor">
        <button className="zf-btn" disabled={busy || !snap.loaded || want <= 0} onClick={putAway}>{snap.unread ? UNREAD_WORDS : !snap.loaded ? "Checking your NEAR wallet…" : `Move ${usd(want)}`}</button>
        {coins > 0.01 && <p className="zf-small">Your coins ({usd(coins)}) stay until you sell them.</p>}
        <p className="zf-small">Back in your Safe in {about(LEG_SEC.nearToSafe)}. {approvalWords().none} needed.</p>
      </div>
    </Sheet>
  );
}
