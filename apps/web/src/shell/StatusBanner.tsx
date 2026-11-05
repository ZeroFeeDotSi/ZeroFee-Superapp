// B30 (product decision, 2 Nov): when a service ZeroFee leans on stops working, one line says so by name and since when; a tap
// on it says what it holds up and what still works, with "See their status" (that service's own page, from the app's
// allow-list, never a link from outside) and "Tell ZeroFee" (a prefilled report, only when ZeroFee has a support address).
// Product decision, 3 Nov: at the bottom with an ×, never a popup on top (NoticeBar.tsx: one notice at a time, above the app row).
// × hides it until that service's state changes (its key: the service, its state, since when). It reads the status table
// (ledger.status: the relay's minute check and what the ledger saw fail) every 30 s, so it shows within a minute of a
// service dying, and when the service is back it says so once for a few seconds and leaves by itself.
// A service's own words (their note) are plain text, already cleaned and capped (core services.ts cleanNote).
import { useEffect, useRef, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { SERVICE_EFFECTS, SERVICE_NAMES, STATUS_LINKS, SUPPORT_EMAIL, backLine, downLine, reportText, type Service, type ServiceStatus } from "@zerofee/core/services";
import { CLEAR_MS, FIRST, nextSpell, type Spell } from "./status-spell.ts";
import { NoticeBar, RANK, type NoticeItem } from "./NoticeBar.tsx";

/** Market data with every door down (rule 9a): what is down, what ZeroFee shows instead, what still works. Never "busy since". */
export const MARKET_DOWN_LINE = "GeckoTerminal is down. Trade shows the last prices. Money still moves.";
/** How often the table is read: a service dying shows within a minute, its return too. */
export const STATUS_EVERY_MS = 30_000;
/** How long "X is back." stays before it leaves. */
export const BACK_MS = 8_000;
/** The timers; a test passes its own and fires them by hand (no wall-clock waits). */
export type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
const REAL_TIMERS: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export interface ServiceNoticeOptions { everyMs?: number; backMs?: number; clearMs?: number; now?: () => number; tapped?: () => string; timers?: Timers }

/** The service notice for the shell's one notice at the bottom (null: every service works, or the phone is offline). */
export function useServiceNotice(bridge: Bridge | null, { everyMs = STATUS_EVERY_MS, backMs = BACK_MS, clearMs = CLEAR_MS, now = Date.now, tapped = () => "", timers = REAL_TIMERS }: ServiceNoticeOptions = {}): NoticeItem | null {
  const [spell, setSpell] = useState<Spell | null>(null);
  const [back, setBack] = useState<Service | null>(null);
  const shown = useRef<Spell | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    let timer: unknown;
    let backTimer: unknown;
    const look = () =>
      void bridge.call<ServiceStatus[]>("ledger.status").then((r) => {
        if (!live) return;
        // bug 8: "down" only when this phone and the relay's check agree ("both"); one source alone is the sheet's
        // own quiet line, never this notice. Product decision, 4 Nov ("NEAR is busy since <a time>" was unacceptable): busy or slow
        // seen by this phone alone is a free node's 429 or our own limit, not the service: the relay's check of the PAID
        // door must say so too (seen "relay" or "both"), else the sheet's own line and its retries handle it
        // Phone test, 5 Nov ("GeckoTerminal is busy since …"): market data is never said busy or slow. The relay's
        // check says it down only when every door it has failed (marketSays: the paid key and the public API), and a
        // first failure the other door covers says nothing; the phone keeps its last answer with its time meanwhile
        // Rule 9a (product decision, 5 Nov; QA's test, "NEAR is slow since <a time>"): busy or slow is never said, by
        // anyone's check: a slow or busy door is the failover's to cover, silently. Only down is, as above
        const shows = (x: ServiceStatus) => x.state === "down" && (x.service === "gecko" ? x.seen !== "device" : x.seen === "both" || !x.seen);
        const list = "ok" in r && Array.isArray(r.ok) ? r.ok.filter((x) => x && x.state !== "up" && FIRST.includes(x.service) && shows(x)) : [];
        // one notice, one clock (nextSpell): a re-read never moves "since", never shows two states
        const { spell: next, back: gone } = nextSpell(shown.current, list, now(), clearMs);
        shown.current = next;
        // the one it was showing has been fine a while: say so once, then leave
        if (gone) {
          setBack(gone);
          timers.clear(backTimer);
          backTimer = timers.set(() => live && setBack(null), backMs);
        }
        if (next) setBack(null);
        setSpell(next);
        timer = timers.set(look, everyMs);
      }, () => live && (timer = timers.set(look, everyMs)));
    look();
    return () => {
      live = false;
      timers.clear(timer);
      timers.clear(backTimer);
    };
  }, [bridge, everyMs, backMs, clearMs]);

  // the phone going offline or back is a render of its own, not a wait for the next read
  const [, onlineChanged] = useState(0);
  useEffect(() => { const f = () => onlineChanged((n) => n + 1); const w = globalThis as unknown as Partial<Window>; w.addEventListener?.("online", f); w.addEventListener?.("offline", f); return () => { w.removeEventListener?.("online", f); w.removeEventListener?.("offline", f); }; }, []);
  // the spell's one row, said with the spell's state and its first time (never the table's newest "since")
  const top: ServiceStatus | null = spell && { ...spell.row, state: spell.state, since: new Date(spell.start).toISOString() };
  if (!top && back) return { key: `back:${back}`, rank: RANK.back, line: backLine(back) };
  // a phone that is itself offline: no service is "down" (join walk 3 Nov: "NEAR is down" under Home's "You're offline")
  if (!top || (typeof navigator !== "undefined" && navigator.onLine === false)) return null;
  const link = STATUS_LINKS[top.service];
  const report = SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("ZeroFee: a service stopped")}&body=${encodeURIComponent(reportText(top, tapped(), now()))}` : null;
  // rule 9a: one calm line, what is down and whether money can move (market data: what ZeroFee shows instead), never
  // "since"; a tap: their own words and the links
  const line = top.service === "gecko" ? MARKET_DOWN_LINE : downLine(top.service);
  return {
    key: `service:${top.service}:${top.state}:${top.since ?? ""}`,
    rank: RANK.service,
    alert: true,
    line: line || `${SERVICE_NAMES[top.service]} isn't working.`,
    more: (
      <>
        {/* the line already says what waits and what works (said once); market data's says what it shows instead */}
        {top.service === "gecko" && <p>{`${SERVICE_EFFECTS.gecko.blocks} ${SERVICE_EFFECTS.gecko.works}`}</p>}
        {top.note && <p className="zf-small">{`They say: ${top.note}`}</p>}
        {(link || report) && (
          <span className="zf-notice__links">
            {link && <a className="zf-link" href={link} target="_blank" rel="noopener noreferrer">See their status</a>}
            {report && <a className="zf-link" href={report}>Tell ZeroFee</a>}
          </span>
        )}
      </>
    ),
  };
}

/** The service notice on its own (a screen with no other notices; the tests): one line at the bottom with its ×. */
export function StatusBanner({ bridge, ...o }: { bridge: Bridge } & ServiceNoticeOptions) {
  return <NoticeBar items={[useServiceNotice(bridge, o)]} />;
}
