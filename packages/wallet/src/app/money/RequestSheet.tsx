// Request money, inside Add's sheet (D123, D127; the Home plan §1.2), loaded with its tap, never in Home's first load.
// Dollars, an optional note, then "They pay in": a chain's own coin (Add's rows). The core's own subwallet.add.quote
// gives a ONE-TIME address on that coin's chain for those dollars (1Click's; it lands in the NEAR wallet's private
// balance, then goes on to the chain's wallet). Two ways to pay it: (a) a ZeroFee link + QR, which a ZeroFee friend's Send
// opens filled in (shown, editable, through Send's own guard); (b) the address + QR with the amount, for any outside
// wallet. No Plain: a person's own address is never handed out. Every address and link is tap-to-copy; the clipboard is
// only ever written, never read (D33).
import { useEffect, useState } from "react";
import type { PayRequest } from "@zerofee/pay/request";
import type { AddAddress, AddChain } from "@zerofee/core/add-outside";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { MoneyAmount, SheetLine } from "@zerofee/design/MoneySheet.tsx";
import { QrCode } from "@zerofee/design/QrCode.tsx";
import { Segmented } from "@zerofee/design/Segmented.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { useWallet } from "../runtime.tsx";
import { ADD_WORDS, addKey, formatUnits, groupAddress, problemLine, type AddRow } from "./add-coins.ts";
import { rememberRequest } from "./adds-on-way.ts";
import { REQUEST_WORDS as W, addressQr, askLine, askedUsd, requestHint, checkAsk, expiryWords, requestLinkFor, requestRows, shareTextFor } from "./request-money.ts";
import { CoinMark } from "./CoinMark.tsx";

import { copyText } from "../copy-text.ts";
const copy = copyText;
const store = () => (typeof localStorage === "undefined" ? undefined : localStorage);

function Copyable({ text, label, button, shown = text, qr = text }: { text: string; label: string; button: string; shown?: string; qr?: string }) {
  const [copied, setCopied] = useState(false);
  const did = () => { void copy(text); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <>
      <div className="wl-qr-big"><QrCode value={qr} size={260} label={label} /></div>
      <button className="wl-add-address zf-small" onClick={did} aria-label={`${button}: ${shown}`} data-testid="request-copy-text" data-copy={text}>{shown}</button>
      <button className="zf-btn wl-req-copy" onClick={did}>{copied ? W.copied : button}</button>
    </>
  );
}

/** A request made: its words are worked out when shown, from its own end (review L5: never "Good for 24 h" kept on screen). */
type Made = { link: string; request: PayRequest; address: string; sample?: true; qr: string; amount: string; symbol: string; untilMs: number; row: AddRow; usd: string; note?: string };

/** What a Request opens filled in with (MoneyAsk "request": the dollars, the coin it's paid in, the note); read once. */
export interface RequestStart { usd?: string; coin?: AddChain; note?: string }

export function RequestSheet({ onClose, onBack, start }: { onClose: () => void; onBack: () => void; start?: RequestStart }) {
  const { bridge } = useWallet();
  // finding 12: no made-up $20; the person's own dollars, on the keypad (an app that opened it filled in keeps its own)
  const [usd, setUsd] = useState(start?.usd ?? "");
  const [note, setNote] = useState(start?.note ?? "");
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState<AddChain | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  // the request's own end, said as it nears and once it ran out (review L5)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!made) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [made]);
  const [show, setShow] = useState<"link" | "address">("link");
  // a coin it was opened with: that coin's row alone (when Request takes it), the others otherwise
  const rows = requestRows().filter((r, _, all) => !start?.coin || !all.some((x) => x.chain === start.coin) || r.chain === start.coin);
  const asked = askedUsd(usd);
  const typeUsd = (v: string) => { setUsd(v); setLine(null); };
  // why the coins can't be tapped yet, said under them (every disabled control says why)
  const off = askLine(asked);
  // nothing typed yet: the keypad is the one thing to do, so no line nags (a web test); dollars typed: a
  // coin is the next tap, and the line says so (request-money.ts requestHint)

  const make = async (row: AddRow) => {
    if (busy || !asked || off) return;
    const now = Date.now();
    setLine(null);
    setBusy(row.chain);
    try {
      const r = await bridge.call<AddAddress>("subwallet.add.quote", { chain: row.chain, to: "wallet", key: addKey(row.chain, "wallet"), usd: asked });
      if ("problem" in r) return setLine(problemLine(r.problem) ?? W.noAddress);
      const q = checkAsk(r.ok, row.chain, asked, now);
      if (!q) return setLine(W.noAddress);
      const until = Date.parse(q.untilIso);
      const l = requestLinkFor({ target: q.depositAddress, coin: { chain: row.chain, assetId: q.tokenId, decimals: q.decimals }, units: q.amountIn, usd: asked, note, hidden: true, untilMs: until, nowMs: now, ...(q.sample ? { sample: true } : {}) });
      if ("problem" in l) return setLine(l.problem.whatHappened);
      rememberRequest(store(), q.depositAddress, until, now);
      setMade({ link: l.link, request: l.request, address: q.depositAddress, ...(q.sample ? { sample: true as const } : {}), qr: addressQr(q.depositAddress, row.chain, q.amountIn), row, usd: asked, ...(l.request.note ? { note: l.request.note } : {}), amount: formatUnits(q.amountIn, q.decimals), symbol: q.symbol, untilMs: until });
      setShow("link");
    } catch {
      setLine(W.noAnswer);
    } finally {
      setBusy(null);
    }
  };

  // ran out: never its link or its address left on screen to pay; one line and a way to ask again
  if (made && now >= made.untilMs) {
    return (
      <Sheet title={W.title} onClose={onClose}>
        <p className="zf-body wl-sheet-lead" role="status" data-testid="request-ran-out">{W.ranOut}</p>
        <button className="zf-btn wl-sheet-go" onClick={() => setMade(null)}>{W.again}</button>
        <button className="zf-btn zf-btn--quiet" onClick={onBack}>{W.back}</button>
      </Sheet>
    );
  }
  if (made) {
    return (
      <Sheet title={W.title} onClose={onClose}>
        <p className="zf-body wl-sheet-lead" data-testid="request-asked">{`$${made.usd}${made.note ? ` · ${made.note}` : ""}`}</p>
        <Segmented items={[{ id: "link", label: W.zerofee }, { id: "address", label: W.outside(made.row.network) }]} value={show} onChange={setShow} label="How they pay" />
        {show === "link" ? (
          <>
            <p className="zf-small wl-sheet-lead">{W.linkLine}</p>
            <Copyable text={made.link} shown={W.linkShown(made.row.name)} label="QR code of your ZeroFee request link" button={W.copyLink} />
            {typeof navigator !== "undefined" && typeof navigator.share === "function" && <button className="zf-btn zf-btn--quiet wl-req-share" data-testid="request-share" onClick={() => void navigator.share({ text: shareTextFor(made.usd, made.request) }).catch(() => undefined)}>{W.share}</button>}
          </>
        ) : (
          <>
            <p className="zf-body wl-sheet-lead" data-testid="request-words">{W.ask(made.amount, made.symbol, made.row.name, expiryWords(made.untilMs, now))}</p>
            {made.sample && <p className="zf-small wl-sheet-lead" data-testid="request-sample">{ADD_WORDS.sample}</p>}
            <Copyable text={made.address} shown={groupAddress(made.address)} qr={made.qr} label={`QR code of your one-time ${made.row.network} address`} button={W.copyAddress} />
            <p className="zf-small wl-sheet-lead">{W.onlyThis(made.row.symbol, made.row.network)}</p>
          </>
        )}
        <button className="zf-btn zf-btn--quiet wl-req-share wl-req-again" onClick={() => setMade(null)}>{W.again}</button>
        <button className="zf-btn zf-btn--quiet" onClick={onBack}>{W.back}</button>
      </Sheet>
    );
  }
  return (
    <Sheet title={W.title} onClose={onClose}>
      <p className="zf-small wl-sheet-lead">{W.lead}</p>
      <MoneyAmount usd={usd} onUsd={typeUsd} label={W.howMuch} />
      <Keypad value={usd} decimals={2} onChange={typeUsd} />
      <input className="wl-request-note" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} placeholder={W.note} aria-label={W.note} autoComplete="off" data-testid="request-note" />
      <p className="zf-body wl-sheet-lead">{W.payIn}</p>
      <div className="wl-add-chips wl-request-chips" role="group" aria-label={W.payIn}>
        {rows.map((r) => (
          <button key={r.chain} className="wl-cap wl-add-chip" disabled={!!busy || !!off} onClick={() => void make(r)} data-chain={r.chain}>
            <CoinMark row={r} size={18} />{busy === r.chain ? W.asking : r.name}
          </button>
        ))}
      </div>
      <SheetLine text={requestHint(usd, line, !!busy)} />
      <p className="zf-small wl-sheet-lead">{W.once}</p>
      <button className="zf-btn zf-btn--quiet wl-sheet-go" onClick={onBack}>{W.back}</button>
    </Sheet>
  );
}
