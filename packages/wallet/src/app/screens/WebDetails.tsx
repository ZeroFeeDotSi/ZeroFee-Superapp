// The web wallet's Details (bug report, 5 Nov late: the web had no Details): one row per network, its wallet's OWN address
// (the core's list, subwallet.list, as the web's Add reads it: web-add.ts webAddRows, never a made-up or cached one),
// shown six and six with Copy, the whole address one tap down. Nothing about a Safe (the web wallet has none) and no key
// export: that stays in Settings, behind the password. Copy copies the whole address, and says "Copied" only once it did.
import { useEffect, useState } from "react";
import { WEB_DETAILS as W } from "@zerofee/shell-api/web-account-words.ts";
import { copyText } from "@zerofee/shell-api/copy-text.ts";
import { addressShort, groupAddress } from "@zerofee/core/address-group";
import { PushedFrame } from "@zerofee/shell-api/AppFrame.tsx";
import { useWallet } from "../runtime.tsx";
import { webAddRows, type ListedWallet, type WebAddRow } from "../money/web-add.ts";
import "./web-details.css";

/** The page itself, its title in its own frame (so Home's first load carries none of its words); Back where it came from. */
export function WebDetailsPage({ onBack }: { onBack: () => void }) {
  return <PushedFrame name={W.title} onBack={onBack}><WebDetails /></PushedFrame>;
}

export function WebDetails() {
  const { bridge } = useWallet();
  const [rows, setRows] = useState<WebAddRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
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
  // asked in the tap itself (the clipboard takes a write only inside the person's gesture)
  const copy = (address: string) => void copyText(address).then((ok) => { if (ok) setCopied(address); else setOpen(address); });
  return (
    <div className="wl wl-wdt zf-enter" data-testid="web-details">
      <p className="zf-small wl-wdt__lead">{W.lead}</p>
      {failed ? <button className="zf-btn zf-btn--quiet" onClick={() => setTries((n) => n + 1)} role="alert">{W.unread}</button>
        : !rows ? <p className="zf-small" role="status">{W.reading}</p>
          : <WebDetailsList rows={rows} open={open} copied={copied} onOpen={(a) => setOpen(open === a ? null : a)} onCopy={copy} />}
    </div>
  );
}

/** The rows themselves (drawn alone by a test): each network's name and short address (a tap unfolds the whole one), and
 *  its Copy. */
export function WebDetailsList({ rows, open, copied, onOpen, onCopy }: { rows: readonly WebAddRow[]; open: string | null; copied: string | null; onOpen: (address: string) => void; onCopy: (address: string) => void }) {
  return (
    <div className="wl-wdt__rows">
      {rows.map(({ row, address }) => (
        <div key={row.chain} className="wl-wdt__row" data-chain={row.chain} data-testid="web-details-row">
          <div className="wl-wdt__line">
            <button className="wl-wdt__tap" aria-expanded={open === address} onClick={() => onOpen(address)}>
              <span className="wl-wdt__name">{row.network}</span>
              <span className="zf-small wl-wdt__short" translate="no">{addressShort(address)}</span>
            </button>
            <button className="zf-chip wl-wdt__copy" onClick={() => onCopy(address)} aria-label={`${W.copy} your ${row.network} address`} data-address={address}>{copied === address ? W.copied : W.copy}</button>
          </div>
          {open === address && <p className="wl-wdt__full" translate="no" data-testid="web-details-full">{groupAddress(address)}</p>}
        </div>
      ))}
    </div>
  );
}
