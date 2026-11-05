// Activity: only what the person did, what waits on them, and what went wrong (D52), newest first, built on the account's
// record from the chain, the same rows Security lists (grade 02f, item 4: ledger.activity merges it). The Safe's own
// movements come from the ledger; Spending adds its own: Top up, Put away, the move after a key export, a paused step
// and any move that failed (hub.ts activityRows: one row per move; Spending's row wins, as it follows spending.changed).
// Quiet moves (refills, gas, rotation, the cap) stay out: Details lists them
// under "Behind the scenes". A hold opens the Waiting screen; every other row opens its full page (product decision, 3 Nov:
// ActivityDetail, loaded on the tap): its steps, times and amounts, and its proof (the transaction that set it off and
// the one that landed it, each with Copy and View; a private step says it has no public record), with its Problem and
// who a Hidden payment went to there. A label from another app is shown as text, never as a name we've checked.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Problem } from "@zerofee/core/problem";
import type { SpendingActivity } from "@zerofee/core/spending";
import { EarlierHistory } from "@zerofee/shell-api/EarlierHistory.tsx";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import { webWallet } from "@zerofee/shell-api/release.ts";
import { Waiting } from "../Waiting.tsx";
import { ago, describe, movementDollars, ownRowOf, ownRows, payeeOf } from "../format.ts";
import { Bang, SmallCheck } from "../icons.tsx";
import type { Movement } from "../../types.ts";
import { useWallet } from "../runtime.tsx";
import { activityRows, lineOf, nameOf, onScreen, rowTicked, stoppedWays, usdOf } from "../activity-rows.ts";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { NavRow } from "./NavRow.tsx";
import { ownSlot } from "../overlay-slot.ts";
import type * as LiveModule from "../money/LiveTrack.tsx";
import type * as DetailModule from "./ActivityDetail.tsx";
import { addPage, movementPage, spendingPage, withTrackSteps } from "../proof.ts";
import { movementFacts, spendingFacts } from "../statement.ts";
import type { AddOnWay } from "../money/adds-on-way.ts";
import type { SiteBack } from "../money/site-back.ts";

/** A site wallet's Take out (the Activity centre's "back:<move id>" task, site-back.ts): its steps, proof and both 1Click
 *  deposits, from the core's own record; never the Browser (QA, 5 Nov: its row opened the Browser tab). */
async function openBack(bridge: ReturnType<typeof useWallet>["bridge"], id: string): Promise<Omit<DetailModule.DetailProps, "onClose"> | null> {
  const r = await bridge.call<SiteBack[]>("subwallet.site.moveBacks");
  const { BACK_ID, backPage, backTrack } = await import("../money/site-back.ts");
  const b = "ok" in r && Array.isArray(r.ok) ? r.ok.find((x) => `${BACK_ID}${x.back?.id}` === id) : undefined;
  if (!b) return null;
  const { endLine, stepsLine } = await import("../money/live-steps.ts");
  const t = backTrack(b);
  return { title: t.title, line: endLine(t) || stepsLine(t), ...(b.back.usd ? { usd: `$${b.back.usd.toFixed(2)}` } : {}), atIso: new Date(t.startMs).toISOString(), page: backPage(b) };
}

type Row = { at: string; ledger: Movement } | { at: string; spending: SpendingActivity };

/** `openId`: a task the Activity centre opened (live-steps.ts taskOf: "move:<id>", "send:<id>"): its page opens at once. */
/** An Add's page (Activity centre's "add:<key>" task): its words and proof, read from the core's job (subwallet.add.onWay). */
async function openAdd(bridge: ReturnType<typeof useWallet>["bridge"], id: string): Promise<Omit<DetailModule.DetailProps, "onClose"> | null> {
  const r = await bridge.call<AddOnWay[]>("subwallet.add.onWay");
  const a = "ok" in r && Array.isArray(r.ok) ? r.ok.find((x) => `add:${x.key}` === id) : undefined;
  if (!a) return null;
  const { addTrack, endLine, stepsLine } = await import("../money/live-steps.ts");
  const t = addTrack(a);
  if (!t) return null;
  const labels = [t.steps[0]!.label, t.steps[1]!.label, t.steps[2]!.label] as const;
  const at = a.at?.landed ?? a.at?.private ?? a.at?.received;
  return { title: t.title, line: endLine(t) || stepsLine(t), ...(a.usd ? { usd: `$${Number(a.usd).toFixed(2)}` } : {}), atIso: new Date(at ?? Date.now()).toISOString(), page: addPage(a, labels) };
}

export function Activity({ onProblem, onHeld, onStatement, statementFailed, overlay, openId, onDone }: { /** In the Activity centre: ✕ on a row's page closes the centre too (its ‹ goes back to the list). */ onDone?: () => void;  onProblem: (p: Problem) => void; onHeld: (held: NonNullable<Movement["held"]>) => void; onStatement: () => void; statementFailed: boolean; overlay?: (node: ReactNode) => void; openId?: string }) {
  const { bridge, activity, tokens, chains, spending, wallets } = useWallet();
  const shell = useShell();
  const [all, setMoves] = useState<SpendingActivity[]>([]);
  useEffect(() => {
    let live = true;
    if (!spending) return () => { live = false; };
    // its rows follow spending.changed, as Home's do: one source, never "On its way" here while Home says Done
    // (QA's UX hunt, 5 Nov)
    const read = () => void bridge.call<SpendingActivity[]>("spending.activity").then((r) => live && "ok" in r && setMoves(r.ok), () => undefined);
    read();
    const off = bridge.on("spending.changed", read);
    return () => { live = false; off(); };
  }, [bridge, spending]);
  // D137: what is in flight on top, its steps live (the same cards as Home's); the rows below are the record
  const [Live, setLive] = useState<typeof LiveModule.LiveHome | null>(null);
  const feed = useRef({ movements: activity ?? [] });
  feed.current = { movements: activity ?? [] };
  useEffect(() => { let on = true; void import("../money/LiveTrack.tsx").then((m) => on && setLive(() => m.LiveHome), () => undefined); return () => { on = false; }; }, []);
  const liveTop = Live ? <Live bridge={bridge} feed={feed} overlay={overlay} /> : null;
  // a job's steps, the same as its Jobs row (live-steps.ts, in the cards' own chunk): its page lists them all
  const [Steps, setSteps] = useState<typeof import("../money/live-steps.ts") | null>(null);
  useEffect(() => { let on = true; void import("../money/live-steps.ts").then((m) => on && setSteps(m), () => undefined); return () => { on = false; }; }, []);
  // a row's full page (product decision, 3 Nov): its code loads on the first tap
  const [Detail, setDetail] = useState<typeof DetailModule.ActivityDetail | null>(null);
  const [shown, setShown] = useState<Omit<DetailModule.DetailProps, "onClose"> | null>(null);
  const show = (p: Omit<DetailModule.DetailProps, "onClose">) => {
    setShown(p);
    if (!Detail) void import("./ActivityDetail.tsx").then((m) => setDetail(() => m.ActivityDetail), () => undefined);
  };
  const detail = shown && Detail ? <Detail {...shown} onClose={onDone ? () => { setShown(null); onDone(); } : () => setShown(null)} {...(onDone ? { onBack: () => setShown(null) } : {})} /> : null;
  // the page is a full-screen sheet over everything (D135), drawn where `overlay` draws (Home's page, or over the Activity
  // centre); never inside the list, where the centre's own sheet stack hid it or squeezed it (phone test, 4 Nov)
  // S10b: the same overlay holds the live tracker's page; this draws or clears only the row's own page
  const slot = useMemo(() => (overlay ? ownSlot(overlay) : null), [overlay]);
  useEffect(() => { slot?.draw(detail); }, [shown, Detail]);
  useEffect(() => () => slot?.release(), [slot]);
  // an Add from another chain (live-steps.ts addTrack, "add:<last 6 of its address>"): its page from the core's own job,
  // whatever the list below holds (an empty Activity opens it too)
  useEffect(() => {
    const open = openId?.startsWith("add:") ? openAdd : openId?.startsWith("back:") ? openBack : null;
    if (!open || !openId) return;
    let live = true;
    void open(bridge, openId).then((p) => live && p && show(p), () => undefined);
    return () => { live = false; };
  }, [openId]);
  const asked = useRef<string | undefined>(undefined);
  // Reading: the list's own shape at once with one quiet line, never a spinner alone (Job 1, criterion 5).
  if (!activity) return (
    <div className="wl zf-enter" aria-busy="true">
      <p className="zf-small" role="status">Reading your activity…</p>
      <div className="wl-rows">{[0, 1, 2].map((i) => <div key={i} className="wl-row wl-row-skel" aria-hidden="true"><span /><div /><div /></div>)}</div>
    </div>
  );
  // one action, one row: a job still going is its live card above (Now), never a row here too (onScreen)
  const record = activityRows(activity, all);
  const { ledger, spending: moves } = onScreen(record);
  const rows: Row[] = [...ledger.map((m) => ({ at: m.updatedAtIso, ledger: m })), ...moves.map((s) => ({ at: s.atIso, spending: s }))].sort((a, b) => b.at.localeCompare(a.at));
  // a web wallet's Send is its own card above this list (task-earlier.ts OWN_RECORD, "web-send:"): never "Nothing yet" under it
  const ownSends = rows.length === 0 && taskStore().list().some((t) => t.app === "home" && t.id.startsWith("web-send:"));
  if (record.ledger.length + record.spending.length === 0) return <div className="wl wl-empty">{liveTop}{!ownSends && <p className="zf-small wl-none">{webWallet() ? "Nothing yet. Money you add or send shows here." : <><span className="wl-none__solo">Nothing yet. Money you add, send or move shows here.</span><span className="wl-none__all">Nothing yet. Money you add, send, move or trade shows here.</span></>}</p>}<EarlierHistory bridge={bridge} /></div>;
  const now = Date.now();
  const own = ownRows(wallets);
  /** A ledger item's page: its words, its proof, its Problem and who a Hidden payment went to. */
  const ledgerPage = (m: Movement) => {
    const { title, detail: line } = describe(m, tokens, chains, own);
    const payee = m.private && m.kind === "pay" && !ownRowOf(m, own) ? payeeOf(m) : "";
    return { title, line, ...(movementDollars(m, tokens) ? { usd: movementDollars(m, tokens)! } : {}), atIso: m.updatedAtIso, page: movementPage(m), ...(m.problem ? { onProblem: () => onProblem(m.problem!) } : {}), ...(payee ? { payee } : {}), facts: movementFacts(m, tokens, chains, own) };
  };
  // finding 61: a site's Add that stopped in the NEAR wallet: its page offers the one tap that ends it
  const waysOf = (s: (typeof moves)[number]) => stoppedWays(s, wallets).map((w) => ({
    label: w.label,
    run: () => {
      setShown(null);
      if (w.kind === "home" && w.parked) return void bridge.call("spending.putAway", { parked: w.parked }).then((r) => { if ("problem" in r) onProblem(r.problem); });
      if (w.kind === "home") return void shell.openMoney({ kind: "putaway" });
      void bridge.call("spending.makeReady", { network: w.network, usd: w.usd, ...(w.wallet ? { wallet: w.wallet } : {}) }).then((r) => { if ("problem" in r) onProblem(r.problem); });
    },
  }));
  const spendingOf = (s: (typeof moves)[number]) => ({ title: nameOf(s), line: lineOf(s), ...(usdOf(s) ? { usd: usdOf(s)! } : {}), atIso: s.atIso, page: withTrackSteps(spendingPage(s, activity), Steps?.moveTrack(s)), facts: spendingFacts(s), ...(s.stoppedShort ? { ways: waysOf(s) } : {}) });
  // the Activity centre's task, once: "move:<row id>" or "send:<movement id>"
  if (openId && asked.current !== openId) {
    asked.current = openId;
    const id = openId.replace(/^(move|send):/, "");
    // from the whole record: a job still going (its card above, no row below) opens its page too
    const s = record.spending.find((x) => x.id === id), m = record.ledger.find((x) => x.id === id) ?? activity.find((x) => x.id === id);
    if (s) queueMicrotask(() => show(spendingOf(s)));
    else if (m) queueMicrotask(() => show(ledgerPage(m)));
  }
  return (
    <div className="wl zf-enter">
      {liveTop}
      <div className="wl-rows wl-top">
        {rows.map((row) => {
          if ("spending" in row) {
            const s = row.spending;
            // finding 61: an Add that stopped in the NEAR wallet is marked as stopped, never ticked as done
            const bad = s.status === "failed" || s.status === "refused" || s.stoppedShort === true;
            const inside = (
              <>
                <span className={`zf-tick${bad ? " wl-tick-alert" : rowTicked(s) ? " on" : " off"}`} aria-hidden="true">{bad ? <Bang /> : rowTicked(s) ? <SmallCheck /> : null}</span>
                <div><div className="t">{nameOf(s)}</div><div className="d">{lineOf(s)}</div></div>
                <div className="r"><div className="vd">{ago(s.atIso, now)}</div></div>
              </>
            );
            return <button className="wl-row wl-pick" key={s.id} onClick={() => (s.held ? onHeld(s.held) : show(spendingOf(s)))} data-testid="activity-row">{inside}</button>;
          }
          const m = row.ledger;
          const { title, detail } = describe(m, tokens, chains, own);
          const usd = movementDollars(m, tokens);
          // every row opens: a hold its Waiting screen, any other its full page (its proof, its Problem, who a Hidden
          // payment went to, from this phone's record: no explorer shows that)
          const open = m.status === "waiting" && m.held ? () => onHeld(m.held!) : () => show(ledgerPage(m));
          const inside = (
            <>
              <span className={`zf-tick${m.status === "moving" || m.status === "waiting" ? " off" : m.problem || m.status === "problem" ? " wl-tick-alert" : " on"}`} aria-hidden="true">
                {m.status === "done" || m.status === "refunded" ? <SmallCheck /> : m.problem || m.status === "problem" ? <Bang /> : null}
              </span>
              <div><div className="t">{title}</div><div className="d">{detail}</div></div>
              <div className="r">{usd && <div className="v">{usd}</div>}<div className="vd">{ago(m.updatedAtIso, now)}</div></div>
            </>
          );
          return <button className="wl-row wl-pick" key={m.id} onClick={open} data-testid="activity-row">{inside}</button>;
        })}
      </div>
      {/* H-3: every move in a month, as a file the person keeps */}
      <div className="wl-rows wl-st-row"><NavRow title="Statement" line={statementFailed ? "Didn't open. Tap to try again." : "Every move in a month, as a file"} onClick={onStatement} /></div>
      {overlay ? null : detail}
    </div>
  );
}
