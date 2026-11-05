// The one money sheet's design (Job 1, the spine): every way money moves (Send, Top up, Put away, Buy, Sell, pay in
// Chat, a site's "Make ready") is this sheet. Its top says how much is where (B12: "Safe $5,698.52 · Spending
// $172.54"), then the amount, dollars first with the coin under it, then one button that says what happens. The core's
// Approve sheet comes up over it (z-index 50 over 45). After a yes it closes, and the screen underneath says in one line
// that it went (WentLine).
//
// Close ALWAYS closes (phone test, 3 Nov sat on a slow quote while the sheet was set
// aside and its ✕ did nothing, so the tester force-quit). `away` (the move getting ready) no longer hides the sheet or its Close;
// after AWAY_SLOW_MS it says so in one line. Whoever hosts the sheet makes closing safe: nothing it asked for answers it
// after that, and nothing unsigned is signed (MoneyHost, core money-closed.ts).
import { useEffect, useState, type ReactNode } from "react";
import { SERVICES, SERVICE_NAMES, STATUS_LINKS } from "@zerofee/core/services";
import { Sheet } from "./Sheet.tsx";
import "./moneysheet.css";

export interface Pot {
  name: string;
  /** "$5,698.52", or null while it isn't read yet (never "$0.00" for a pot that couldn't be read). */
  usd: string | null;
}

/** A move getting ready this long says so, and that Close still works (a quote or read behind it may never answer). */
export const AWAY_SLOW_MS = 5_000;
export const AWAY_SLOW_LINE = "Still getting it ready. You can close this.";

/**
 * How long a sheet waits for 1Click's price: as long as the relay itself does (apps/quotes relay.mjs TIMEOUT_MS, and the
 * core's own fetch, 20 s). A real quote often takes 3 to 10 s (its solvers answer), so a sheet never says "didn't answer"
 * before this; only the relay's own "unreachable" answer, or this, does. Until then it counts the seconds (D137).
 */
export const QUOTE_WAIT_MS = 20_000;
/** "0:07": the seconds a price has been asked for. */
export const waitClock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** The line while a price is on its way: "Getting a price… 0:07". */
export const quoteWaitLine = (ms: number): string => `Getting a price… ${waitClock(ms)}`;
/** The ms since `on` began, ticking once a second while it holds (0 while off). */
export function useElapsed(on: boolean): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    setMs(0);
    if (!on) return;
    // counted by its own ticks (a test's clock moves them; a page that slept catches up on its next tick)
    let n = 0;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => { setMs(++n * 1_000); t = setTimeout(tick, 1_000); };
    t = setTimeout(tick, 1_000);
    return () => clearTimeout(t);
  }, [on]);
  return ms;
}

export function MoneySheet({ title, pots, away = false, closable = true, onClose, children }: { title: string; pots?: readonly Pot[]; away?: boolean; closable?: boolean; onClose: () => void; children: ReactNode }) {
  const slow = useSlow(away);
  return (
    <div className="zf-money" aria-busy={away ? true : undefined}>
      {/* `closable` false is Trade's sending moment only (its own sheet); every Home money sheet closes, always */}
      <Sheet title={title} closable={closable} onClose={closable ? onClose : () => {}}>
        {pots && pots.length > 0 && (
          <p className="zf-money__where" aria-label="How much is where">
            {pots.map((p, i) => <span key={p.name}>{i > 0 && <span aria-hidden="true"> · </span>}{p.name} <b>{p.usd ?? "…"}</b></span>)}
          </p>
        )}
        {children}
        {slow && <p className="zf-small zf-money__line" role="status" data-testid="money-slow">{AWAY_SLOW_LINE}</p>}
      </Sheet>
    </div>
  );
}

/** True once `on` has held for AWAY_SLOW_MS, false again the moment it ends. */
function useSlow(on: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!on) return;
    const t = setTimeout(() => setSlow(true), AWAY_SLOW_MS);
    return () => clearTimeout(t);
  }, [on]);
  return slow;
}

/** A pasted amount's reading (read-amount.ts), loaded when an amount opens, never in Home's first load. */
let reader: typeof import("./read-amount.ts") | undefined;
const loadReader = () => import("./read-amount.ts").then((m) => (reader = m));

/** The amount: the dollars large (typed), the coin figure under them (`coin`, e.g. "1.1765 NEAR"). */
export function MoneyAmount({ usd, onUsd, label, coin }: { usd: string; onUsd: (s: string) => void; label: string; coin?: string }) {
  // a paste is read as the keypad would have it, never guessed ("1,5" is 1.5; "1e5" and "1,500" are refused, said here)
  const [no, setNo] = useState<string | null>(null);
  useEffect(() => { void loadReader().catch(() => undefined); }, []);
  // at once once it is here (a controlled field must answer in its own event); a paste before that waits for it
  const read = (v: string) => {
    const go = ({ readAmount, refusedLine }: NonNullable<typeof reader>) => { const r = readAmount(v, 9, 2); if ("no" in r) return setNo(refusedLine(r.no, v)); setNo(null); onUsd(r.ok); };
    if (reader) go(reader); else void loadReader().then(go, () => undefined);
  };
  useEffect(() => setNo(null), [usd]);                                        // the keypad or a chip moved it: the line goes
  return (
    <div className="zf-money__amount">
      <label className="zf-money__field">
        <span className="zf-money__sign" aria-hidden="true">$</span>
        <input aria-label={label} inputMode="decimal" autoComplete="off" value={usd} placeholder="0" onChange={(e) => read(e.target.value)} />
      </label>
      {no && <p className="zf-small zf-money__coin" role="status" data-testid="amount-refused">{no}</p>}
      {coin && <p className="zf-small zf-money__coin">{coin}</p>}
    </div>
  );
}

/** The one line on the screen the person came from: "Getting it ready…", then "Sent $5.00 to alex.near". */
/** One quiet line on a sheet (B28): a service that failed or is down, by name, with where the money is. Never a screen
 *  and never a button: the app reads again by itself. */
export function SheetLine({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  // B30: the service the line names gets its own status page, from the app's allow-list only (never a link from outside)
  // the longest name first: "NEAR AI Cloud" before "NEAR" (review, Low)
  const named = [...SERVICES].sort((a, b) => SERVICE_NAMES[b].length - SERVICE_NAMES[a].length).find((s) => text.startsWith(SERVICE_NAMES[s]));
  const link = named ? STATUS_LINKS[named] : undefined;
  return (
    <p className="zf-small zf-money__line" role="status">
      <span className="zf-money__line-text">{text}</span>
      {link && <a className="zf-link zf-money__line-link" href={link} target="_blank" rel="noopener noreferrer">See their status</a>}
    </p>
  );
}

export function WentLine({ text, state }: { text: string; state: "busy" | "went" | "quiet" }) {
  return (
    <div className={`zf-went zf-went--${state}`} role="status" aria-live="polite">
      {state === "went" && !/\bon its way\b|\bon the way\b/i.test(text) ? <span className="zf-went__tick" aria-hidden="true">✓</span> : <span className="zf-live zf-went__dot" aria-hidden="true" />}
      <span>{text}</span>
    </div>
  );
}
