// The web wallet's Add (product decision, 4 Nov: superapp.zerofee.si as a normal wallet, no Safe). Unlike the phone's Add
// (D127: a one-time 1Click address through the NEAR wallet's private balance), the web wallet has no Safe and no private
// balance to route through: each row is the wallet's OWN address, as Phantom shows it. A tap copies exactly the address
// shown; the QR icon opens it full screen (D135) with its QR, the whole address and Copy. The addresses come from the
// core's own list (subwallet.list: the current wallet of each chain, made from the 24 words), never typed or cached here.
import { useEffect, useState } from "react";
import { QrCode } from "@zerofee/design/QrCode.tsx";
import { receivePaid } from "@zerofee/core/zero-fee";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { useWallet } from "../runtime.tsx";
import { ADD_WORDS as W, groupAddress } from "./add-coins.ts";
import { WEB_ADD_WORDS, webAddRows, type ListedWallet, type WebAddRow } from "./web-add.ts";
import { addressQr } from "./request-money.ts";
import { CoinMark } from "./CoinMark.tsx";

import { copyText } from "@zerofee/shell-api/copy-text.ts";

export function WebAddSheet({ onClose, wallet }: { onClose: () => void; wallet?: string }) {
  const { bridge } = useWallet();
  const [rows, setRows] = useState<WebAddRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [qr, setQr] = useState<WebAddRow | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  // asked in the tap itself (the clipboard needs the person's gesture: QA's crawl, 4 Nov), "Copied" only once
  // copied; a row's copy that the browser refused opens its QR page, where the whole address is there to select
  const copy = (text: string, row?: WebAddRow) => void copyText(text).then((ok) => { if (ok) setCopied(text); else if (row) setQr(row); });
  useEffect(() => {
    let live = true;
    setFailed(false);
    void bridge.call<ListedWallet[]>("subwallet.list").then(
      (r) => { if (!live) return; if ("ok" in r && Array.isArray(r.ok)) setRows(webAddRows(r.ok)); else setFailed(true); },
      () => live && setFailed(true),
    );
    return () => { live = false; };
  }, [bridge, tries]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  // the wallet Add was opened from comes first
  const ordered = rows ? [...rows].sort((a, b) => Number(b.row.chain === wallet) - Number(a.row.chain === wallet)) : null;
  if (qr) {
    return (
      <Sheet title={W.title} onClose={() => setQr(null)}>
        <div className="wl-qrfull" data-testid="qr-sheet">
          <div className="wl-qrfull__who"><CoinMark row={qr.row} size={40} /><h2 className="wl-qrfull__name">{W.rowName(qr.row.name, "wallet")}</h2></div>
          <div className="wl-qrfull__code"><QrCode value={addressQr(qr.address, qr.row.chain)} size={256} label={`QR code of your ${W.rowName(qr.row.name, "wallet")} address`} /></div>
          <p className="wl-qrfull__addr" data-testid="qr-address">{groupAddress(qr.address)}</p>
          <button className="zf-btn wl-qrfull__copy" onClick={() => copy(qr.address)}>{copied === qr.address ? W.copied : W.copy}</button>
          <p className="wl-qrfull__only">{WEB_ADD_WORDS.only(qr.row.symbol, qr.row.network)}</p>
          {/* who gets the fee (product decision, 5 Nov: we are zero fee): the wallet's own address, so only the sender's network fee */}
          <p className="zf-small wl-zerofee" data-testid="web-add-paid">{receivePaid(qr.row.network)}</p>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title={W.title} onClose={onClose}>
      <div className="wl-addpage">
        <div className="wl-addlist" data-testid="add-rows">
          {failed ? <button className="zf-btn zf-btn--quiet" onClick={() => setTries((n) => n + 1)} role="alert">{WEB_ADD_WORDS.unread}</button>
            : !ordered ? <p className="zf-small wl-sheet-lead" role="status">{WEB_ADD_WORDS.reading}</p>
              : ordered.map((x) => {
                const name = W.rowName(x.row.name, "wallet");
                return (
                  <div key={x.row.chain} className="wl-addline" data-chain={x.row.chain} data-to="wallet">
                    <button className="wl-addline__tap" onClick={() => copy(x.address, x)} aria-label={`${W.copy} your ${name} address`} data-testid="add-row" data-address={x.address}>
                      <CoinMark row={x.row} size={40} />
                      <span className="wl-addline__text">
                        <span className="wl-addline__name">{name}</span>
                        <span className={`wl-addline__sub${copied === x.address ? " is-copied" : ""}`} aria-live="polite">{copied === x.address ? W.copied : `${x.address.slice(0, 6)}…${x.address.slice(-4)}`}</span>
                      </span>
                    </button>
                    <button className="wl-addline__qr" onClick={() => setQr(x)} aria-label={`${W.qr}: your ${name}`} data-testid="add-qr">QR</button>
                  </div>
                );
              })}
        </div>
      </div>
    </Sheet>
  );
}
