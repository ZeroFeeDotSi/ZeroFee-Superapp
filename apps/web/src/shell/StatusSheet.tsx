// Settings → Status (rule 9b, T13 phase 1): one row per service the app leans on, each one line at rest, Working /
// Slow / Down and when it was checked; under a row only what isn't the usual (the servers it is using instead of
// ZeroFee's, and, when Down, whether money can still move). The checks run in the page's status service
// (core status-probe.ts, read-only, kept 30 s) only while this sheet or Settings is open, and again every 30 s while
// the sheet stays up. Loaded when it opens (Settings is in Home's first load; this sheet isn't).
// Phase 2 (spec lines 6-8): "Your own server" under the rows: per chain, the host of the person's own server or
// "ZeroFee's server"; a tap opens its field, Test runs the chain's check against the typed address (status.own.test),
// Use it keeps it (status.own.set, sealed through device.store; only after a Test it passed), and "Use ZeroFee's
// server" clears it. The address is never shown back, only its host.
import { useEffect, useState } from "react";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import type { Bridge } from "@zerofee/core/bridge";
import type { OwnHosts, OwnTest, StatusReport, StatusRow } from "@zerofee/core/status-probe";
import { ownHostOf, type OwnChain } from "@zerofee/core/own-servers";
import { CHECKING, DOOR_NAMES, NOT_CHECKED_LINE, OWN_BACK, OWN_CHAIN_NAMES, OWN_FIELD, OWN_HIDE, OWN_INTRO, OWN_KEPT, OWN_NONE, OWN_PLACEHOLDER, OWN_SHOW, OWN_TEST, OWN_TESTING, OWN_TEST_FIRST, OWN_TITLE, OWN_USE, STATE_WORDS, STATUS_NAMES, STATUS_TITLE, checkedWords, ownTestWords, rowLines, shownDown, shownWord, usingDefault } from "@zerofee/core/status-words";
import "./status.css";

/** The sheet's own look again this often while it is up (spec line 3); the service's cache keeps it to one per 30 s. */
export const STATUS_LOOK_MS = 30_000;
export type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
const REAL_TIMERS: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** One row: the name, then its state, on one line (when it was checked is the sheet's one line, QA 16's SHOULD). */
function Row({ row, relay }: { row: StatusRow; relay: boolean }) {
  const lines = rowLines(row, relay);
  return (
    <div className="st__item" data-state={shownDown(row) ? "down" : row.state} data-id={row.id}>
      <div className="set__row st__row">
        <span className="st__name">{STATUS_NAMES[row.id]}</span>
        <span className="st__state"><span className="st__word">{shownWord(row)}</span></span>
      </div>
      {row.doors && (
        <div className="st__doors">
          <div className="st__door" data-state={row.doors.chains}><span>{DOOR_NAMES.chains}</span><span>{STATE_WORDS[row.doors.chains]}</span></div>
        </div>
      )}
      {lines.map((l) => <p key={l} className="zf-small st__line">{l}</p>)}
    </div>
  );
}

/** The rows of one look, or "Checking…" before the first answers. No hooks: a test renders it as it is. */
export function StatusList({ report, failed = false }: { report: StatusReport | null; failed?: boolean }) {
  if (failed && !report) return <p className="zf-small st__top" role="status">{NOT_CHECKED_LINE}</p>;
  if (!report) return <p className="zf-small st__top" role="status">{CHECKING}</p>;
  return (
    <>
      <p className="zf-small st__top">{usingDefault(report.relay)}</p>
      <p className="zf-small st__top st__checked">{checkedWords(report.at)}</p>
      <div className="zf-group st__list">
        {report.rows.map((r) => <Row key={r.id} row={r} relay={report.relay} />)}
      </div>
    </>
  );
}

const OWN_ORDER: OwnChain[] = ["near", "solana", "hood"];

/** One chain's field: type an address, Test it, Use it (only once a Test answered), or go back to ZeroFee's server. */
export function OwnField({ chain, host, bridge, onDone, initial = "", initialTest = null }: { chain: OwnChain; host: string | null; bridge: Bridge; onDone: (host: string | null) => void; initial?: string; initialTest?: OwnTest | null }) {
  const [typed, setTyped] = useState(initial);
  const [test, setTest] = useState<OwnTest | null>(initialTest);
  const [busy, setBusy] = useState<"test" | "use" | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  // QA 16's MUST: the address may carry a key, so it is dots unless the person taps Show; its host is said
  // under it, so they can still see where it points (a screenshot never carries the key)
  const [shown, setShown] = useState(false);
  const typedHost = ownHostOf(typed);
  const passed = !!test && (test.result === "working" || test.result === "slow");
  const run = async () => {
    setBusy("test"); setSaid(null);
    const r = await bridge.call<OwnTest>("status.own.test", { chain, address: typed });
    setBusy(null);
    if ("ok" in r) setTest(r.ok); else setSaid(r.problem.whatHappened);
  };
  const keep = async (address: string | null) => {
    setBusy("use"); setSaid(null);
    const r = await bridge.call<{ host: string | null }>("status.own.set", { chain, address });
    setBusy(null);
    if ("ok" in r) onDone(r.ok.host); else setSaid(r.problem.whatHappened);
  };
  const id = `st-own-${chain}`;
  return (
    <div className="st__own-field" data-chain={chain}>
      <label className="st__own-label" htmlFor={id}>{OWN_FIELD(chain)}</label>
      <div className="st__own-entry">
        <input id={id} className="st__own-input" inputMode="url" type={shown ? "url" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" data-1p-ignore="" data-lpignore="true" placeholder={OWN_PLACEHOLDER} value={typed} onChange={(e) => { setTyped(e.currentTarget.value); setTest(null); setSaid(null); }} />
        <button type="button" className="zf-link st__own-show" aria-pressed={shown} aria-controls={id} onClick={() => setShown((x) => !x)}>{shown ? OWN_HIDE : OWN_SHOW}</button>
      </div>
      {typedHost && <p className="zf-small st__own-host" data-testid={`${id}-host`}>{typedHost}</p>}
      <p className="zf-small st__line">{OWN_KEPT}</p>
      {test && <p className="zf-small st__own-result" role="status" data-result={test.result}>{ownTestWords(test)}</p>}
      {said && <p className="zf-small st__own-result" role="status" data-result="down">{said}</p>}
      <div className="st__own-actions">
        <button className="zf-btn zf-btn--quiet" disabled={busy !== null || !typed.trim()} onClick={() => void run()}>{busy === "test" ? OWN_TESTING : OWN_TEST}</button>
        <button className="zf-btn" disabled={busy !== null || !passed} aria-describedby={passed ? undefined : `${id}-first`} onClick={() => void keep(typed)}>{OWN_USE}</button>
        {!passed && <span id={`${id}-first`} className="st__sr">{OWN_TEST_FIRST}</span>}
        {host && <button className="zf-link" disabled={busy !== null} onClick={() => void keep(null)}>{OWN_BACK}</button>}
      </div>
    </div>
  );
}

/** "Your own server": each chain's host or "ZeroFee's server"; one field open at a time. */
export function OwnServers({ bridge, initialOpen = null, onChanged }: { bridge: Bridge; initialOpen?: OwnChain | null; onChanged?: () => void }) {
  const [hosts, setHosts] = useState<OwnHosts | null>(null);
  const [open, setOpen] = useState<OwnChain | null>(initialOpen);
  useEffect(() => {
    let live = true;
    void bridge.call<OwnHosts>("status.own.get").then((r) => { if (live && "ok" in r && r.ok && typeof r.ok === "object") setHosts(r.ok); });
    return () => { live = false; };
  }, [bridge]);
  return (
    <section className="st__own" aria-label={OWN_TITLE}>
      <h2 className="st__own-title">{OWN_TITLE}</h2>
      <p className="zf-small st__top st__own-intro">{OWN_INTRO}</p>
      <div className="zf-group st__list">
        {OWN_ORDER.map((c) => (
          <div key={c} className="st__item" data-own={c}>
            <button className="set__row set__row--btn st__row" aria-expanded={open === c} onClick={() => setOpen(open === c ? null : c)}>
              <span className="st__name">{OWN_CHAIN_NAMES[c]}</span>
              <span className="st__state">{hosts?.[c] ?? OWN_NONE}</span>
            </button>
            {open === c && <OwnField chain={c} host={hosts?.[c] ?? null} bridge={bridge} onDone={(h) => { setHosts((x) => ({ ...(x ?? { near: null, solana: null, hood: null }), [c]: h })); setOpen(null); onChanged?.(); }} />}
          </div>
        ))}
      </div>
    </section>
  );
}

/** The sheet: a look as it opens, then every STATUS_LOOK_MS while it is up; nothing once it closes. */
export function StatusSheet({ bridge, onClose, onBack, everyMs = STATUS_LOOK_MS, timers = REAL_TIMERS }: { bridge: Bridge; onClose: () => void; onBack?: () => void; everyMs?: number; timers?: Timers }) {
  const [report, setReport] = useState<StatusReport | null>(null);
  const [failed, setFailed] = useState(false);
  // a server set or cleared: a new look at once (the service forgot its kept one), so the rows say what is used now
  const [changed, setChanged] = useState(0);
  useEffect(() => {
    let live = true;
    let timer: unknown;
    const look = () =>
      void bridge.call<StatusReport>("status.probe").then((r) => {
        if (!live) return;
        if ("ok" in r && Array.isArray(r.ok?.rows)) { setReport(r.ok); setFailed(false); } else setFailed(true);
        timer = timers.set(look, everyMs);
      });
    look();
    return () => { live = false; timers.clear(timer); };
  }, [bridge, everyMs, timers, changed]);
  return (
    <Sheet title={STATUS_TITLE} onClose={onClose} {...(onBack ? { onBack } : {})}>
      <div className="st"><StatusList report={report} failed={failed} /><OwnServers bridge={bridge} onChanged={() => setChanged((n) => n + 1)} /></div>
    </Sheet>
  );
}
