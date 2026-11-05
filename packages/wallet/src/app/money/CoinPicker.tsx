// The shared coin picker (bug report, 5 Nov; the design session's spec): Swap's "You pay" and "You get", and
// Send's coin. A full-screen sheet (D135); the chain as a segmented control (NEAR · SOL · Robinhood); Trade's one search
// pill (name or address; Paste reads the clipboard only on its tap, D33); then LiveRows: a 40 pt coin, the symbol, its
// name, the dollars held. A coin that can't be picked today keeps its row with its reason as the row's line, quiet, never
// greyed. Nothing is lit: a row's tap is the choice. Built only from packages/design's pieces, so it can move there as is.
import { useEffect, useMemo, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { LiveRow } from "@zerofee/design/LiveRow.tsx";
import { Segmented } from "@zerofee/design/Segmented.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { PICK_CHAINS, foldLine, heldRows, pickKey, pickRows, splitRows, type FoundCoin, type HeldCoin, type PickChain, type PickCoin } from "./coin-pick.ts";
import { dollars } from "../format.ts";
import "@zerofee/trade/app/discover.css";

/** The words of the picker (copywriter). */
export const PICK_WORDS = {
  search: "Name or address",
  paste: "Paste",
  nothingCopied: "Nothing to paste yet.",
  looking: "Looking…",
  none: "No coin by that name or address.",
  slow: "GeckoTerminal isn't answering.",
  again: "Try again",
  chains: "Network",
} as const;

/** Trade's market, through Spending's door (spending.swap.find, trade/src/swap-door.ts): a search, or the chain's
 *  trending list when nothing is typed. The market itself never loads with Home. */
export type FindCoins = (chain: PickChain, q: string) => Promise<readonly FoundCoin[]>;
const findOn = (bridge: Bridge): FindCoins => async (chain, q) => {
  const r = await bridge.call<FoundCoin[]>("spending.swap.find", { chain, q });
  if ("problem" in r) throw new Error(r.problem.code);
  return r.ok;
};

/** The clipboard, read only on Paste's tap (Trade's own reader). */
const readPaste = (bridge: Bridge): Promise<string | null> => import("@zerofee/trade/app/paste.ts").then((m) => m.readPasted(bridge), () => null);

/** The coins a chain's wallet holds (Trade's positions, through Spending's door), read once per chain per open. */
function useHeld(bridge: Bridge, chain: PickChain, nearHeld: readonly PickCoin[] = []): PickCoin[] | null {
  const [held, setHeld] = useState<Partial<Record<PickChain, PickCoin[]>>>({});
  useEffect(() => {
    if (chain === "near" || held[chain]) return;
    let live = true;
    void bridge.call<HeldCoin[]>("spending.swap.held", { chain }).then((r) => { if (live) setHeld((h) => ({ ...h, [chain]: "ok" in r ? heldRows(chain, r.ok) : [] })); }, () => live && setHeld((h) => ({ ...h, [chain]: [] })));
    return () => { live = false; };
  }, [bridge, chain]);
  return chain === "near" ? [...nearHeld] : held[chain] ?? null;
}

/** What the market finds for the text (a search) or, with none, the chain's trending list; 0.25 s after the last key. */
function useFound(chain: PickChain, q: string, on: boolean, find: FindCoins): { rows: readonly FoundCoin[] | null; failed: boolean; again: () => void } {
  const [rows, setRows] = useState<readonly FoundCoin[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    setRows(null); setFailed(false);
    if (!on) return;
    let live = true;
    const t = setTimeout(() => {
      void find(chain, q.trim()).then((r) => { if (live) setRows(r); }, () => { if (live) { setRows([]); setFailed(true); } });
    }, q.trim() ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [chain, q, on, tries]);
  return { rows, failed, again: () => setTries((n) => n + 1) };
}

export function CoinPicker({ bridge, title, start, places, nearHeld, search = true, why, foot, onPick, onClose, find }: {
  bridge: Bridge;
  /** The sheet's title ("You pay", "You get"). */
  title: string;
  /** The chain it opens on. */
  start: PickChain;
  /** Home's own places as rows (each wallet's coin, the Safe's), with what each holds. */
  places: readonly PickCoin[];
  /** The NEAR wallet's own coins (Swap in place: subwallet.float.balance, read by the sheet). */
  nearHeld?: readonly PickCoin[];
  /** "You get": the market's coins too. "You pay": only what is held. */
  search?: boolean;
  /** Why a coin can't be picked today, or null. */
  why: (c: PickCoin) => string | null;
  /** One line under the list (Swap's: what is held but can't be used, named, finding 48). */
  foot?: string | null;
  onPick: (c: PickCoin) => void;
  onClose: () => void;
  /** Tests: the market (Spending's door by default). */
  find?: FindCoins;
}) {
  const [chain, setChain] = useState<PickChain>(start);
  const [q, setQ] = useState("");
  const [nothing, setNothing] = useState(false);
  useEffect(() => { if (!nothing) return; const t = setTimeout(() => setNothing(false), 3_000); return () => clearTimeout(t); }, [nothing]);
  const paste = async () => { const t = await readPaste(bridge); if (t) setQ(t); else setNothing(true); };
  const held = useHeld(bridge, chain, nearHeld);
  const found = useFound(chain, q, search, useMemo(() => find ?? findOn(bridge), [find, bridge]));
  const rows = useMemo(() => pickRows(chain, q, { places: [...places], held: held ?? [], ...(search && found.rows ? { found: found.rows } : {}) }), [chain, q, places, held, search, found.rows]);
  const loading = (held === null || (search && found.rows === null)) && rows.length === 0;
  const { open, shut, none } = splitRows(rows, why);
  // the fold opens on a tap and closes again with a new chain or a new search
  const [unfold, setUnfold] = useState(false);
  useEffect(() => setUnfold(false), [chain, q]);
  const row = (c: PickCoin, no: string | null) => (
    <div key={pickKey(c)} role="listitem" className={no ? "wl-pick-quiet" : undefined} data-testid={no ? "pick-hidden" : "pick-row"}>
      <LiveRow mark={<CoinIcon symbol={c.symbol} {...(c.icon ? { icon: c.icon } : {})} {...(c.logo ? { src: c.logo } : {})} size={40} />} title={c.symbol} line={no ?? c.name.replace(/^your /, "Your ")}
        {...(c.heldUsd !== undefined ? { usd: dollars(c.heldUsd.toFixed(2)) } : {})} state="past"
        label={`${c.symbol}, ${c.name}${c.heldUsd !== undefined ? `, ${dollars(c.heldUsd.toFixed(2))}` : ""}${no ? `. ${no}` : ""}`}
        {...(no ? {} : { onOpen: () => onPick(c) })} />
    </div>
  );
  return (
    <Sheet title={title} onClose={onClose}>
      <Segmented items={PICK_CHAINS} value={chain} onChange={(c) => setChain(c)} label={PICK_WORDS.chains} className="wl-pick-chains" />
      <label className="dc-field wl-pick-search">
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M13.5 13.5 17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={nothing ? PICK_WORDS.nothingCopied : PICK_WORDS.search} autoComplete="off" spellCheck={false} aria-label={PICK_WORDS.search} data-testid="pick-search" />
        {!q && <button type="button" className="dc-paste" onClick={() => void paste()}>{PICK_WORDS.paste}</button>}
      </label>
      <div className="wl-pick-list" role="list" data-testid="pick-list">
        {none !== null && !loading && <p className="zf-small wl-sheet-lead wl-pick-none" role="status" data-testid="pick-none">{none}</p>}
        {open.map((c) => row(c, null))}
        {open.length > 0 && shut.length > 0 && !unfold && <button type="button" className="zf-link wl-pick-fold" data-testid="pick-fold" onClick={() => setUnfold(true)}>{foldLine(shut.length)}</button>}
        {open.length > 0 && unfold && shut.map((s) => row(s.c, s.why))}
        {loading && <p className="zf-small wl-sheet-lead" role="status">{PICK_WORDS.looking}</p>}
        {search && found.failed && <p className="zf-small wl-sheet-lead" role="status">{PICK_WORDS.slow} <button type="button" className="zf-link" onClick={found.again}>{PICK_WORDS.again}</button></p>}
        {!loading && !found.failed && q.trim() && rows.length === 0 && (found.rows !== null || !search) && <p className="zf-small wl-sheet-lead" role="status">{PICK_WORDS.none}</p>}
        {foot && <p className="zf-small wl-sheet-lead" data-testid="swap-not-here">{foot}</p>}
      </div>
    </Sheet>
  );
}
