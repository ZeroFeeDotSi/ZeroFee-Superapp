// AgentZero pays a Chat request (AZ2 job 3, "Pay my list in Chat"; D91, D98). Only a request for USDC on NEAR, to a NEAR
// account, in whole cents, asked of no one else (or of this person), is offered to AgentZero; anything else is the plain
// chip.
// - The shell's payer answers (shell-api agentzero-pay.ts); Chat never pays by itself. AgentZero pays only on a real tap
//   on this very chip (data-agentzero-pay=<request id>, the click's native event passed through: review M2).
// - AgentZero pays privately or not at all (D91): while its private route is off (AGENT_PRIVATE_ROUTE, until the
//   route A proof), the chip stays the plain Send (Private only, D85) and says "AgentZero can't pay this privately yet."
// - Its check on who gets paid (`offer.warn`, "First time paying kim.near.") shows under the chip, before the tap.
// - Paid, or not sure it went: Pay is never offered again for that request. "Not sure" is kept in Chat's own store too,
//   so after a reload (offline, say) the plain Send can't come back for it (security review of this chip, M2).
import { useEffect, useRef, useState } from "react";
import { AGENT_PRIVATE_ROUTE } from "@zerofee/core/agent-route";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { agentZeroPayer, type AgentZeroOffer, type AgentZeroPaid } from "@zerofee/shell-api/agentzero-pay.ts";
import { PRIVATE_OFF_LINE, UNKNOWN_LINE } from "@zerofee/agent/zero/engine";
import type { PayRequest } from "../messages.ts";
import { AZ_OFF_LINE, agentZeroAsk, azReceipt } from "../agentzero.ts";

export { AZ_OFF_LINE, agentZeroAsk, azReceipt };

/** Requests AgentZero answered "not sure it went" for, on this device (Chat's store): never Pay again. */
const UNKNOWN_KEY = "az-unknown";
const UNKNOWN_KEEP = 200;

export interface AgentZeroChip {
  /** Pay with AgentZero: the chip's words (offer.line), when AgentZero can pay it privately now. */
  label: string | null;
  /** AgentZero's check on who gets paid, shown before the tap. */
  warn: string | null;
  /** One line under the chip: why AgentZero won't pay it (the route off, a refusal), or what happened after the tap. */
  line: string | null;
  /** Pay is never offered again for this request (paid by AgentZero, or not sure it went). */
  closed: boolean;
  /** AgentZero hasn't answered yet for a request it may pay: no Pay of any kind until it does. */
  waiting: boolean;
  busy: boolean;
  pay: (tap: Event) => void;
}

/** Tests only: the route as if the test proof had passed. Nothing in the app sets it; the engine and the core read
 *  AGENT_PRIVATE_ROUTE themselves and refuse, so this can change only what the chip draws (review L6). */
export const azTestRoute: { on?: boolean } = {};

export function useAgentZeroChip(r: PayRequest, requestId: string, me: string | null | undefined, onPaid: (id: string, mark: { atIso: string }) => void): AgentZeroChip {
  const { bridge } = useShell();
  const route = azTestRoute.on ?? AGENT_PRIVATE_ROUTE;
  const ask = agentZeroAsk(r, me);
  const [offer, setOffer] = useState<AgentZeroOffer | null>(null);
  const [settled, setSettled] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);
  const paying = useRef(false);
  const key = ask ? `${requestId} ${ask.to} ${ask.usd}` : "";
  // "Not sure it went" kept on this device: closed before anything else is asked.
  useEffect(() => {
    if (!ask) return;
    let live = true;
    void bridge.call<{ value: string | null }>("device.store.get", { key: UNKNOWN_KEY }).then((v) => {
      const ids = "ok" in v && v.ok ? readIds(v.ok.value) : [];
      if (live && ids.includes(requestId)) {
        setLine(UNKNOWN_LINE);
        setClosed(true);
      }
    });
    return () => { live = false; };
  }, [key]);
  useEffect(() => {
    if (!ask) return setSettled(true);
    const p = agentZeroPayer();
    // the payer is set just after the first screen: look again shortly rather than offer nothing for good (review M2)
    if (!p) {
      if (tries >= 3) return setSettled(true);
      const t = setTimeout(() => setTries((n) => n + 1), 700);
      return () => clearTimeout(t);
    }
    let live = true;
    setSettled(false);
    void p.offer({ requestId, to: ask.to, usd: ask.usd }).then(
      (o) => { if (live) { setOffer(o); setSettled(true); } },
      () => { if (live) { setOffer(null); setSettled(true); } },
    );
    return () => { live = false; };
  }, [key, tries]);
  const keepUnknown = () => {
    void bridge.call<{ value: string | null }>("device.store.get", { key: UNKNOWN_KEY }).then((v) => {
      const ids = "ok" in v && v.ok ? readIds(v.ok.value) : [];
      if (!ids.includes(requestId)) void bridge.call("device.store.set", { key: UNKNOWN_KEY, value: JSON.stringify([requestId, ...ids].slice(0, UNKNOWN_KEEP)) });
    });
  };
  const unknown = (said: string) => {
    setLine(said);
    setClosed(true);
    keepUnknown();
  };
  // Paid by AgentZero before, or not sure it went: no Pay for it, ever (the engine keeps both, across reloads).
  const done = !!offer && !offer.ok && (offer.line === UNKNOWN_LINE || offer.line.startsWith("Paid by AgentZero"));
  const pay = (tap: Event) => {
    const p = agentZeroPayer();
    if (!p || !ask || !route || paying.current) return;
    paying.current = true;
    setBusy(true);
    void p.payRequest({ requestId, to: ask.to, usd: ask.usd }, tap).then((d: AgentZeroPaid) => {
      if (d.kind === "paid" || d.kind === "already") {
        onPaid(requestId, { atIso: new Date().toISOString() });
        setLine(d.kind === "paid" ? azReceipt(ask.usd, ask.to) : d.line);
        setClosed(true);
      } else if (d.kind === "unknown") {
        unknown(d.line);
      } else {
        // not here, refused: the line says why; the plain Send stays (from Private only)
        setLine(d.line);
        setOffer({ ok: false, line: d.line });
      }
    }, () => {
      // No answer after the tap (the phone went offline mid-pay): it may have gone, so never "nothing was sent" and never
      // Pay again; Activity says.
      unknown(UNKNOWN_LINE);
    }).finally(() => {
      paying.current = false;
      setBusy(false);
    });
  };
  const base = { closed, busy, pay, waiting: false };
  if (closed) return { ...base, label: null, warn: null, line };
  if (!ask) return { ...base, label: null, warn: null, line };
  // AgentZero may pay this and hasn't answered: no Pay yet (the plain Send could pay a request AgentZero paid).
  if (!settled) return { ...base, waiting: true, label: null, warn: null, line };
  if (!offer) return { ...base, label: null, warn: null, line };
  if (done) return { ...base, closed: true, label: null, warn: null, line: line ?? offer.line };
  // The route off: the engine says so itself on a real account; on sample money it offers, and the chip says it (review M1).
  // On a real account the chip says nothing of AgentZero (3 Nov, after 0ce3ff96 "AgentZero can't pay people yet. Use
  // Send in Chat."): no dead AgentZero offer in Chat; the plain Pay is the way.
  if (!offer.ok && offer.line === PRIVATE_OFF_LINE) return { ...base, label: null, warn: null, line };
  if (offer.ok && !route) return { ...base, label: null, warn: null, line: line ?? AZ_OFF_LINE };
  if (offer.ok) return { ...base, label: offer.line, warn: offer.warn ?? null, line };
  return { ...base, label: null, warn: null, line };
}

function readIds(raw: string | null): string[] {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, UNKNOWN_KEEP) : [];
  } catch {
    return [];
  }
}
