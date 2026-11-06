// Home's Add (D123, D127, D128, D138; product decision, 3 Nov): one quiet list, one row per wallet.
// - A row is the wallet's logo, its name ("SOL wallet") and a QR icon at its end; nothing else. A tap on the row copies
//   its ONE-TIME address (the core's subwallet.add.quote: 1Click's address on the chain, the money through the NEAR
//   wallet's private balance, then on to this wallet) and a small "Copied" tick says so.
// - The QR icon opens a full-screen sheet (D135): the wallet's name, a large QR, the whole address in grouped type with
//   Copy, the one coin it takes, and its end in one quiet line.
// - The Safe is one row like the others (its SOL address, landing in the Safe as USDC: E2).
// - Each address works once: the core is asked about it every ADD_RECHECK_MS and at its end, and a used or ran-out one
//   is swapped for a new one by itself (review H1); one unpaid address per row is kept on this phone (review L4).
// - No public address, ever: never a wallet's own address, the Safe's account or a bridge's deposit address (D127).
// - "Ask someone to pay you" (Request) is one quiet line at the bottom, its code loaded with that tap.
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { ADD_USED, type AddAddress, type AddChain, type AddTo } from "@zerofee/core/add-outside";
import { QrCode } from "@zerofee/design/QrCode.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { useWallet } from "../runtime.tsx";
import { later } from "../later.tsx";
import { ADD_RECHECK_MS, ADD_WORDS as W, addFits, addressEnds, addressShort, addKey, addOpensOn, addOrder, addRows, cardKey, changeCardKey, keepCardKey, type CardSlot, groupAddress, leastWords, problemLine, swapDue, untilWords, type AddRow, type AddWallet } from "./add-coins.ts";
import { addCardStore, addCardsSealed, sealAddCards } from "./add-keep.ts";
import { addressQr } from "./request-money.ts";
import { CoinMark } from "./CoinMark.tsx";
import { HOME_PROOF_OFF, homeProof } from "./home-proof.ts";
// the web wallet's own Add: loaded only on the web build's first Add (Home's JS budget, speed-budget.test.ts)
const WebAddSheet = lazy(() => import("./WebAddSheet.tsx").then((m) => ({ default: m.WebAddSheet })));
import { webWallet } from "@zerofee/shell-api/release.ts";
import type { RequestStart } from "./RequestSheet.tsx";

/** Request's code: asked for as Add opens, drawn the moment it is here (later.tsx: never Suspense's 300 ms hold). */
const RequestSheet = later<{ onClose: () => void; onBack: () => void; start?: RequestStart }>(
  () => import("./RequestSheet.tsx").then((m) => m.RequestSheet),
  (p) => <Sheet title="Request money" onClose={p.onClose}><p className="zf-small wl-sheet-lead" role="status">Opening…</p></Sheet>,
  (p) => <Sheet title="Request money" onClose={p.onClose}><p className="zf-small wl-sheet-lead" role="status">Request didn't load. Close it and open it again.</p></Sheet>,
);

import { copyText } from "../copy-text.ts";
const copy = copyText;
// row 16: the card keys live in Home's sealed store (add-keep.ts), plain localStorage only until it is read
const store = addCardStore;
type Bridge = ReturnType<typeof useWallet>["bridge"];

/** `wallet`: Home's tab Add was opened from (onAdd(wallet)): its row comes first (addOrder). `coin`, `request`: filled in
 *  by the app that opened it (MoneyAsk prefill), read once: Add opens straight on that coin's address page (its wallet's,
 *  or the Safe's in that coin: addOpensOn), its ✕ back to where it was opened from; or straight on Request with its
 *  dollars, coin and note. With no coin (Home's own Add), the list (D138). */
export function AddSheet({ onClose, wallet, coin, request, proof = homeProof(), web = webWallet() }: { onClose: () => void; wallet?: AddWallet; coin?: AddChain; request?: RequestStart; proof?: boolean; web?: boolean }) {
  // the web wallet (product decision, 4 Nov): no Safe, no 1Click; each wallet's own address, as any wallet shows it
  if (web) return <Suspense fallback={null}><WebAddSheet onClose={onClose} {...(wallet ? { wallet } : coin ? { wallet: coin } : {})} /></Suspense>;
  // D125: off until the $1 proof passes (a release build): one honest line and Close, never an old public address
  if (!proof) return <Sheet title={W.title} onClose={onClose}><p className="zf-body wl-sheet-lead" role="status" data-testid="add-off">{HOME_PROOF_OFF}</p></Sheet>; // the corner's Close is the way out (product decision, 3 Nov: no second Close)
  return <AddOn onClose={onClose} {...(wallet ? { wallet } : {})} {...(coin ? { coin } : {})} {...(request ? { request } : {})} />;
}

function AddOn(p: { onClose: () => void; wallet?: AddWallet; coin?: AddChain; request?: RequestStart }) {
  const { bridge } = useWallet();
  // row 16: no key is picked before Home's sealed copy is read (Home reads it at boot, LiveTrack.tsx, so it is here at the
  // tap), else a reload could show a new address; a store that won't answer falls back to the plain copy. Rule 2 (the copy review's
  // pair walk): the sheet's whole frame (title, every row, Ask) is drawn at once either way; only the rows' addresses wait
  const [ready, setReady] = useState(addCardsSealed);
  useEffect(() => { if (!ready) void sealAddCards(bridge).finally(() => setReady(true)); }, []);
  return <AddList {...p} ready={ready} />;
}

function AddList({ onClose, wallet, coin, request, ready }: { onClose: () => void; wallet?: AddWallet; coin?: AddChain; request?: RequestStart; ready: boolean }) {
  const { bridge } = useWallet();
  const [asking, setAsking] = useState(!!request);
  const [qr, setQr] = useState<{ row: AddRow; to: AddTo; a: AddAddress; change: () => void } | null>(null);
  // an address a row stopped showing (used or ran out) never stays on its QR sheet
  const closeQr = (gone: string) => setQr((q) => (q?.a.depositAddress === gone ? null : q));
  // review L4: one unpaid address per row, kept on this phone (the card shares the wallet's): opening Add again copies the
  // same one, never a new real address each time; the core refuses it once money reached it or it ran out (H1)
  const kept = (slot: CardSlot) => ({ slot, initialKey: cardKey(store(), slot, new Set()), onAddress: (k: string, a: AddAddress) => keepCardKey(store(), slot, k, Date.parse(a.untilIso), a.depositAddress) });
  const order = addOrder(wallet, addRows());
  useEffect(() => RequestSheet.preload(), []);
  // a coin filled in (AgentZero's "receive SOL"): that coin's address page at once, never the list; ✕ goes back
  const direct = addOpensOn(coin, wallet, !!request, addRows());
  if (direct && !asking && !ready) return <Sheet title={W.title} onClose={onClose}><div className="wl-qrfull" data-testid="qr-asking"><div className="wl-qrfull__who"><Mark row={direct.row} to={direct.to} size={40} /><h2 className="wl-qrfull__name">{W.rowName(direct.row.name, direct.to)}</h2></div><div className="wl-qrfull__code wl-qrfull__code--blank" aria-hidden="true" /></div></Sheet>;
  if (direct && !asking) return <CoinPage bridge={bridge} row={direct.row} to={direct.to} {...kept(direct.to === "safe" ? `safe-${direct.row.chain}` : direct.row.chain)} onClose={onClose} />;
  if (asking) return <RequestSheet onClose={onClose} onBack={() => setAsking(false)} {...(request ? { start: request } : {})} />;
  // before the sealed copy is here (rarely: Home reads it at boot): the row itself, its name and "Getting it…", no key yet
  const line = (r: AddRow, to: AddTo) => !ready ? <RowWaits key={`${to}-${r.chain}`} row={r} to={to} /> : <AddressRow key={`${to}-${r.chain}`} bridge={bridge} row={r} to={to} {...kept(to === "safe" ? `safe-${r.chain}` : r.chain)} onQr={(a, change) => setQr({ row: r, to, a, change })} onGone={closeQr} />;
  // the Safe's row: the coin it was opened with (MoneyAsk prefill), else the first open coin (SOL); it lands as USDC (E2)
  const safeRow = (wallet === "safe" && coin ? addRows().find((r) => r.chain === coin) : undefined) ?? order.safe;
  const safe = safeRow && line(safeRow, "safe");
  return (
    <>
      <Sheet title={W.title} onClose={onClose}>
        {/* plain rows on the page (HOME-VISUAL §3.8: no card), then one outline pill at the bottom */}
        <div className="wl-addpage">
          <div className="wl-addlist" data-testid="add-rows">
            {order.safeFirst && safe}
            {order.rows.map((r) => line(r, "wallet"))}
            {!order.safeFirst && safe}
          </div>
        </div>
        <button className="zf-btn zf-btn--quiet wl-sheet-go wl-addpage__ask" onClick={() => setAsking(true)} data-testid="add-request-money">{W.ask}</button>
      </Sheet>
      {qr && <QrSheet row={qr.row} to={qr.to} a={qr.a} onClose={() => setQr(null)} onChange={() => { qr.change(); setQr(null); }} />}
    </>
  );
}

/** A row whose key isn't read yet: the same frame as AddressRow (logo, name, its sub-line), nothing to tap. */
function RowWaits({ row, to }: { row: AddRow; to: AddTo }) {
  return (
    <div className="wl-addline" data-chain={row.chain} data-to={to} data-testid="add-row-wait">
      <button className="wl-addline__tap" disabled aria-label={`${W.rowName(row.name, to)}. ${W.asking}`}>
        <Mark row={row} to={to} size={40} />
        <span className="wl-addline__text"><span className="wl-addline__name">{W.rowName(row.name, to)}</span><span className="wl-addline__sub" aria-hidden="true">{"\u00a0"}</span></span>
      </button>
      <button className="wl-addline__qr" disabled aria-label={W.qr}><QrGlyph /></button>
    </div>
  );
}

/** The QR icon at a row's end: three finder squares, each with its dot, and four bits in the last corner. */
const QrGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3.25" y="3.25" width="7" height="7" rx="1.8" /><rect x="13.75" y="3.25" width="7" height="7" rx="1.8" /><rect x="3.25" y="13.75" width="7" height="7" rx="1.8" /></g>
    <g fill="currentColor"><rect x="5.5" y="5.5" width="2.5" height="2.5" rx=".6" /><rect x="16" y="5.5" width="2.5" height="2.5" rx=".6" /><rect x="5.5" y="16" width="2.5" height="2.5" rx=".6" /><rect x="13.5" y="13.5" width="3" height="3" rx=".7" /><rect x="18" y="18" width="3" height="3" rx=".7" /><rect x="18" y="13.5" width="3" height="3" rx=".7" opacity=".45" /><rect x="13.5" y="18" width="3" height="3" rx=".7" opacity=".45" /></g>
  </svg>
);
const Tick = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
/** The Safe's mark (Home's Safe tab shield, icons.tsx TabSafe) in a round tile, the size of a coin's logo. */
const SafeMark = ({ size }: { size: number }) => (
  <span className="wl-safemark" style={{ width: size, height: size }} aria-hidden="true">
    <svg width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 3.5 5 6.2v5.3c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6.2L12 3.5Z" /></svg>
  </span>
);
const Mark = ({ row, to, size }: { row: AddRow; to: AddTo; size: number }) => (to === "safe" ? <SafeMark size={size} /> : <CoinMark row={row} size={size} />);

/** One wallet's row: its logo, its name, a tap that copies its one-time address, and a QR icon. The address is asked on
 *  open, checked with the core every ADD_RECHECK_MS and at its end, and swapped for a new one the moment money reached it
 *  or it ran out (the core refuses its key then, ADD_USED: review H1). A failed ask says so under the name, and a tap asks
 *  again. `initialKey` / `onAddress`: a key kept on this phone (add-coins.ts cardKey). `onGone`: an address the row
 *  stopped showing (its QR sheet closes). */
export function AddressRow({ bridge, row, to, slot, onQr, initialKey, onAddress, onGone }: { bridge: Bridge; row: AddRow; to: AddTo; slot?: CardSlot; onQr: (a: AddAddress, change: () => void) => void; initialKey?: string; onAddress?: (key: string, a: AddAddress) => void; onGone?: (address: string) => void }) {
  const [copied, setCopied] = useState(false);
  const { a, why, retry, done, change } = useOneTimeAddress(bridge, row, to, { ...(slot ? { slot } : {}), ...(initialKey ? { initialKey } : {}), ...(onAddress ? { onAddress } : {}), onGone: (gone) => onGone?.(gone), onNew: () => setCopied(false) });
  const name = W.rowName(row.name, to);
  const [sure, setSure] = useState(false);
  useCopiedFades(copied, setCopied);
  // a tap copies the address; after a failed ask it asks again; a used-up address is never copied: Change wallet asks
  const tap = () => {
    if (done) return setSure(true);
    if (why) return retry();
    if (!a) return;
    setCopied(true);
    void copy(a.depositAddress);
  };
  return (
    <div className={`wl-addline${done ? " is-done" : ""}`} data-chain={row.chain} data-to={to}>
      <button className="wl-addline__tap" onClick={tap} disabled={!a && !why && !done} aria-label={why ? `${name}. ${why} ${W.retry}.` : a ? `${W.copy} your ${name} address` : `${name}. ${W.asking}`} data-testid="add-row">
        <Mark row={row} to={to} size={40} />
        <span className="wl-addline__text">
          <span className="wl-addline__name">{name}</span>
          {/* one sub-line: what a tap does; "Copied" (a drawn tick) for a moment; while its address is made; why it failed */}
          {done ? <span className="wl-addline__why" role="status" data-testid="add-done">{W.done}</span>
            : why ? <span className="wl-addline__why" role="alert">{`${why} ${W.retry}.`}</span>
            : <span className={`wl-addline__sub${copied ? " is-copied" : ""}`} aria-live="polite">{copied && a ? <><Tick />{W.copiedEnds(addressEnds(a.depositAddress))}</> : a ? (a.sample ? W.sampleRow : W.tapCopy) : "\u00a0"}</span>}
          {/* it's a one-time address made for this Add, not the wallet's own, and the QR says its least: said once, under the row */}
          {a && !why && !done && !a.sample && <span className="wl-addline__note">{W.oneTime(name)}</span>}
        </span>
      </button>
      {done
        ? <button className="zf-btn zf-btn--quiet wl-capsule wl-addline__change" onClick={() => setSure(true)} data-testid="add-change">{W.change}</button>
        : <button className="wl-addline__qr" onClick={() => a && onQr(a, change)} disabled={!a} aria-label={`${W.qr}: your ${name}`} data-testid="add-qr"><QrGlyph /></button>}
      {sure && <ChangeSure name={name} onYes={() => { setSure(false); change(); }} onNo={() => setSure(false)} />}
    </div>
  );
}

/** One one-time address (a row's, or the coin page's): asked on open, checked with the core every ADD_RECHECK_MS and at
 *  its end, and swapped for a new one the moment money reached it or it ran out (the core refuses its key then, ADD_USED:
 *  review H1). `why`: a failed ask, in words; `retry` asks again. `onGone`: an address it stopped showing; `onNew`: a new
 *  one is being asked for it. */
function useOneTimeAddress(bridge: Bridge, row: AddRow, to: AddTo, o: { slot?: CardSlot; initialKey?: string; onAddress?: (key: string, a: AddAddress) => void; onGone?: (address: string) => void; onNew?: () => void }) {
  const { onAddress } = o;
  const [key, setKey] = useState(() => o.initialKey ?? addKey(row.chain, to));
  const [a, setA] = useState<AddAddress | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  // row 16 (product decision, 4 Nov): the address is NEVER swapped by itself. Money reached it, or its time ran out: it is "done",
  // said under it, and only Change wallet (after "Are you sure?") gives a new one
  const [done, setDone] = useState(false);
  // a failed ask is asked again with the SAME key: a retry never makes a new address (row 16)
  const [tries, setTries] = useState(0);
  /** Change wallet, after the person's yes: a new key, kept at once in the sealed store, then its address. */
  const change = () => {
    if (a) o.onGone?.(a.depositAddress);
    o.onNew?.();
    setDone(false);
    setKey(o.slot ? changeCardKey(store(), o.slot) : addKey(row.chain, to));
  };
  useEffect(() => {
    let live = true;
    setA(null);
    setWhy(null);
    void bridge.call<AddAddress>("subwallet.add.quote", { chain: row.chain, to, key }).then((r) => {
      if (!live) return;
      if ("ok" in r) {
        const ok = addFits(r.ok, row.chain, to, Date.now());
        if (!ok) return setWhy(W.noAddress);
        setA(ok);
        onAddress?.(key, ok);
        return;
      }
      // a kept key whose address was used or ran out: said, never a new address by itself (row 16)
      if (r.problem.code === ADD_USED) return setDone(true);
      setWhy(problemLine(r.problem) ?? W.noAddress);
    }, () => live && setWhy(W.noAddress));
    return () => { live = false; };
  }, [key, tries]);
  // while it shows: at its end it is done; and every ADD_RECHECK_MS the core is asked about this very key, so the moment
  // money reaches it (1Click has seen it) it says so and stops being copied
  useEffect(() => {
    if (!a || done) return;
    let live = true;
    const ended = () => swapDue(a.untilIso, Date.now()).due && setDone(true);
    const t = setTimeout(ended, swapDue(a.untilIso, Date.now()).inMs + 250);
    const check = setInterval(() => {
      void bridge.call<AddAddress>("subwallet.add.quote", { chain: row.chain, to, key }).then((r) => {
        if (live && "problem" in r && r.problem.code === ADD_USED) setDone(true);
      }, () => undefined);
    }, ADD_RECHECK_MS);
    // no page (the shell's own test renderer, the phone's core): the timers alone
    const doc = typeof document === "undefined" ? null : document;
    const back = () => doc?.visibilityState === "visible" && ended();
    doc?.addEventListener("visibilitychange", back);
    ended();
    return () => { live = false; clearTimeout(t); clearInterval(check); doc?.removeEventListener("visibilitychange", back); };
  }, [a, done]);
  return { a, why, done, change, retry: () => setTries((n) => n + 1) };
}

/** "Are you sure?" before Change wallet (row 16): one line and two buttons; a no keeps the address as it is. The look is
 *  the copy review's (full-screen sheet per D135 when it restyles); this is the data and the two answers. */
function ChangeSure({ name, onYes, onNo }: { name: string; onYes: () => void; onNo: () => void }) {
  return (
    <Sheet title={W.changeTitle} onClose={onNo}>
      <div className="wl-changesure" data-testid="add-change-sure">
        {W.changeLines(name).map((l, i) => <p key={i} className="zf-body">{l}</p>)}
      </div>
      <div className="wl-sheet-go wl-changesure__foot">
        <button className="zf-btn" onClick={onYes} data-testid="add-change-yes">{W.changeYes}</button>
        <button className="zf-btn zf-btn--quiet wl-changesure__keep" onClick={onNo} data-testid="add-change-no">{W.changeNo}</button>
      </div>
    </Sheet>
  );
}

/** "Copied" goes after a moment. */
function useCopiedFades(copied: boolean, set: (on: boolean) => void) {
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => set(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
}

/** The QR, full screen (D135): the wallet's name above, a large QR, the whole address in grouped type with Copy, the one
 *  coin it takes, and its end in one quiet line. It closes at the address's end (review L5). */
export function QrSheet({ row, to, a, onClose, onChange }: { row: AddRow; to: AddTo; a: AddAddress; onClose: () => void; onChange?: () => void }) {
  const [sure, setSure] = useState(false);
  return (
    <>
      <Sheet title={W.title} onClose={onClose}><QrPage row={row} to={to} a={a} onEnd={onClose} {...(onChange ? { onChange: () => setSure(true) } : {})} /></Sheet>
      {sure && onChange && <ChangeSure name={W.rowName(row.name, to)} onYes={() => { setSure(false); onChange(); }} onNo={() => setSure(false)} />}
    </>
  );
}

/** Add opened on one coin (MoneyAsk prefill: AgentZero's "receive SOL"): that coin's one-time address page, full screen
 *  (D135), at once; its ✕ goes back to where Add was opened from, never to the list. Its address is asked, checked and
 *  swapped as a row's is; at its end the page shows the new one, never the old. */
function CoinPage({ bridge, row, to, slot, initialKey, onAddress, onClose }: { bridge: Bridge; row: AddRow; to: AddTo; slot?: CardSlot; initialKey?: string; onAddress?: (key: string, a: AddAddress) => void; onClose: () => void }) {
  const { a, why, retry, done, change } = useOneTimeAddress(bridge, row, to, { ...(slot ? { slot } : {}), ...(initialKey ? { initialKey } : {}), ...(onAddress ? { onAddress } : {}) });
  const [sure, setSure] = useState(false);
  const name = W.rowName(row.name, to);
  return (
    <Sheet title={W.title} onClose={onClose}>
      {sure && <ChangeSure name={name} onYes={() => { setSure(false); change(); }} onNo={() => setSure(false)} />}
      {a && !done ? <QrPage key={a.depositAddress} row={row} to={to} a={a} onEnd={() => undefined} onChange={() => setSure(true)} /> : (
        <div className="wl-qrfull" data-testid="qr-asking">
          <div className="wl-qrfull__who"><Mark row={row} to={to} size={40} /><h2 className="wl-qrfull__name">{name}</h2></div>
          {!why && <div className="wl-qrfull__code wl-qrfull__code--blank" aria-hidden="true" />}
          {done ? <><p className="zf-small wl-addline__why wl-qrfull__done" role="status" data-testid="add-done">{W.done}</p><button className="zf-btn zf-btn--quiet wl-capsule" onClick={() => setSure(true)} data-testid="add-change">{W.change}</button></>
            : why ? <><p className="zf-body wl-sheet-lead" role="alert">{why}</p><button className="zf-btn wl-qrfull__copy" onClick={retry}>{W.retry}</button></> : <span role="status" aria-busy="true" />}
        </div>
      )}
    </Sheet>
  );
}

/** The QR page's inside: `onEnd` at the address's end, so an expired address is never left on screen to scan (L5). */
function QrPage({ row, to, a, onEnd, onChange }: { row: AddRow; to: AddTo; a: AddAddress; onEnd: () => void; onChange?: () => void }) {
  const [copied, setCopied] = useState(false);
  // the whole address only on a tap (desktop audit, 5 Nov: eleven groups read as a blob); one line of six and six first
  const [full, setFull] = useState(false);
  // its address's end (review L5): an expired address is never left on screen to scan
  useEffect(() => {
    const t = setTimeout(onEnd, Math.max(0, swapDue(a.untilIso, Date.now()).inMs));
    return () => clearTimeout(t);
  }, [a.depositAddress]);
  useCopiedFades(copied, setCopied);
  const name = W.rowName(row.name, to);
  return (
    <div className="wl-qrfull" data-testid="qr-sheet">
      <div className="wl-qrfull__who"><Mark row={row} to={to} size={40} /><h2 className="wl-qrfull__name">{name}</h2></div>
      <div className="wl-qrfull__code"><QrCode value={addressQr(a.depositAddress, row.chain)} size={256} label={`QR code of your one-time ${name} address`} /></div>
      {a.sample && <p className="zf-small wl-qrfull__sample" data-testid="qr-sample">{W.sample}</p>}
      <p className="zf-small wl-qrfull__label">{W.yourAddress}</p>
      <div className="wl-qrfull__line">
        <span className="wl-qrfull__addr wl-qrfull__addr--short" data-testid="qr-address">{addressShort(a.depositAddress)}</span>
        <button className={`zf-btn wl-qrfull__copy${copied ? " is-copied" : ""}`} onClick={() => { void copy(a.depositAddress); setCopied(true); }}>{copied ? <><Tick />{W.copied}</> : W.copy}</button>
      </div>
      <button type="button" className="zf-link wl-qrfull__full-tap" aria-expanded={full} onClick={() => setFull((f) => !f)} data-testid="qr-full-toggle">{full ? W.hideFull : W.showFull}</button>
      {full && <p className="wl-qrfull__addr wl-qrfull__addr--full" data-testid="qr-address-full">{groupAddress(a.depositAddress)}</p>}
      {/* row 16: the one way to a new address, right under Copy so it is never below the fold; it asks "Are you sure?" first */}
      {onChange && <button className="zf-btn zf-btn--quiet wl-capsule" onClick={onChange} data-testid="add-change">{W.change}</button>}
      <p className="wl-qrfull__only">{W.only(row.symbol, row.network, leastWords(a.minAmountIn, a.decimals))}</p>
      <p className="zf-small wl-qrfull__until">{W.until(untilWords(a.untilIso), to)}</p>
      <p className="zf-small wl-qrfull__foryou" data-testid="qr-for-you">{W.forYou}</p>
    </div>
  );
}
