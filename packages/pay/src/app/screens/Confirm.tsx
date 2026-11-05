// Confirm: who gets what, which coin pays, what leaves the balance, when it arrives. From the Safe: one pill, and the
// approval (Face ID) comes next. From Private (review M4, D143): no Face ID follows, so paying is Home's Send's own Hold.
import { useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { HoldButton } from "@zerofee/wallet/app/money/HoldButton.tsx";
import "@zerofee/wallet/app/money/send.css"; // the Hold's ring (HoldButton's own styles)
import { shortAddress, chainName } from "../../chains.ts";
import type { Confirm } from "../../pay.ts";
import { More } from "@zerofee/design/More.tsx";
import { confirmFloor, moneyWords, paymentDollars, reviewDollars, shownFor, totalDollarsFirst, totalWithFee, youPay } from "../format.ts";
import { Address } from "./Address.tsx";

export function ConfirmView({ c, verb, changed, onPay, onChange, onPrivate, bridge }: { c: Confirm; verb: string; changed?: boolean; onPay: () => void; onChange: () => void; onPrivate?: () => void; bridge?: Pick<Bridge, "call"> }) {
  const pay = youPay(c);
  const total = totalWithFee(c);
  const amount = `${shownFor(c.target.amount, c.target.token)} ${c.target.token.symbol}`;
  // Dollars first (J6; audit 2 Nov, B7): the dollars large, the exact coin small under them; the total and the button in
  // dollars too. No dollar figure: the coin leads, as before.
  const usd = reviewDollars(c);
  const floor = confirmFloor(c, verb);
  const [copied, setCopied] = useState(false);
  // An address someone pasted or saved (a card, a partner's, a friend's) shows in full, start and end in bold, to compare.
  const pasted = verb === "Top up" || (c.target.to.kind === "chain" && c.target.to.chain !== "near" && Boolean(c.target.name) && c.payee !== c.payeeFull);
  const where = c.target.to.kind === "ledger" ? c.payeeFull : `${c.target.to.chain === "near" ? c.payeeFull : shortAddress(c.payeeFull)} · ${c.network}`;
  return (
    <div className="py py-col">
      <div className="py-center zf-enter" style={{ paddingTop: 36 }}>
        <div className="zf-label">{c.labelFromCode ? "The code says it's" : "To"}</div>
        {/* every address is tap-to-copy: the whole address goes to the clipboard, "Copied" for a moment */}
        <h1 className="zf-title" style={{ marginTop: 10, wordBreak: "break-word" }}>
          <button type="button" style={{ all: "unset", cursor: "pointer" }} aria-label={`Copy ${c.payeeFull}`} data-testid="confirm-copy-to" onClick={() => void navigator.clipboard?.writeText(c.payeeFull).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {})}>{c.payee}</button>
        </h1>
        {copied && <p className="zf-small" role="status">Copied</p>}
        {pasted
          ? <div style={{ marginTop: 8 }}><Address value={c.payeeFull} /><div className="zf-small">{c.network}</div></div>
          : c.payee !== c.payeeFull && c.payee !== shortAddress(c.payeeFull) ? <div className="py-mono" style={{ marginTop: 6 }}>{where}</div>
            // The name is already the title: only where it is, never the name twice (grade 02g, E16).
            // NEAR, the account's own network, goes unsaid on this step (grade 02h, H10); any other network is said.
            : c.target.to.kind !== "ledger" && c.network !== "NEAR" ? <div className="zf-small" style={{ marginTop: 6 }}>On {c.network}</div> : null}
        {usd ? (
          <>
            <div className="py-big" style={{ marginTop: 32 }}><small>$</small>{usd.slice(1)}</div>
            <p className="zf-body" style={{ marginTop: 4 }}>{amount}</p>
          </>
        ) : (
          <>
            <div className="py-big" style={{ marginTop: 32 }}>{shownFor(c.target.amount, c.target.token)} <small>{c.target.token.symbol}</small></div>
            {paymentDollars(c) && <p className="zf-body" style={{ marginTop: 4 }}>{paymentDollars(c)}</p>}
          </>
        )}
        {c.target.message && <p className="zf-small" style={{ marginTop: 8 }}>{c.target.message}</p>}
      </div>
      {changed && <div className="zf-note" style={{ marginTop: 18 }}>The price changed. These are the new numbers.</div>}
      <div className="py-rows zf-enter-2" style={{ marginTop: 34 }}>
        <div className="py-row">
          {/* The paying coin's logo, by the ledger's own key: never a symbol a code or payee supplied. */}
          <CoinIcon symbol={c.inSymbol} icon={c.source.balance.icon} size={26} />
          <div><div className="t">{verb === "Send" ? "Send" : "Pay"} with {c.inSymbol}</div><div className="d">{c.source.balance.chain === "near" ? "" : `On ${chainName(c.source.balance.chain)}, `}{c.source.balance.chain === "near" ? (c.privacy?.on ? "From Private" : "From your Safe") : c.privacy?.on ? "from Private" : "from your Safe"}</div></div>
          {c.alternatives.length > 0 ? <button className="py-change" onClick={onChange}>Change</button> : <span />}
        </div>
        {/* D27: only when Wallet's Private pocket can pay this. Wallet's own screen says what Private does and doesn't hide. */}
        {c.privacy && onPrivate && (
          <div className="py-row">
            <span />
            <div><div className="t">Pay from Private</div><div className="d">{c.privacy.on ? "Paid from Private" : "Off: paid from your Safe"}</div></div>
            <button role="switch" aria-checked={c.privacy.on} aria-label="Pay from Private" className={`py-switch${c.privacy.on ? " on" : ""}`} onClick={onPrivate}><span /></button>
          </div>
        )}
        {/* One total, the fee one tap down (UI-SIMPLICITY-RULES 1, 2; the UX walk, 2 Nov: "You pay 7.2073 NEAR" beside a
            separate fee line read as two answers). */}
        <div className="py-row">
          <span />
          <div><div className="t">Total</div></div>
          <span className="v">{totalDollarsFirst(c)}</span>
        </div>
        <More label="The fee" className="py-fee" lines={total ? [`${moneyWords(c, c.target.token)} to ${c.payee}`, pay.detail] : [pay.detail]} />
        {c.etaSeconds !== undefined ? (
          <div className="py-row"><span /><div><div className="t">Arrives</div></div><span className="v">in about {c.etaSeconds} s (estimate)</span></div>
        ) : c.source.route === "transfer" && (
          <div className="py-row"><span /><div><div className="t">Arrives</div></div><span className="v">usually in seconds</span></div>
        )}
      </div>
      {c.hold && <div className="zf-note" style={{ marginTop: 14 }}>{c.hold.text}</div>}
      {c.target.notes.includes("shop-may-not-see-it") && <p className="zf-small" style={{ marginTop: 14 }}>This shop's till may not spot the payment by itself. Show it the Paid screen.</p>}
      {c.target.notes.includes("slow-network") && <p className="zf-small" style={{ marginTop: 14 }}>This network takes minutes to confirm.</p>}
      <div className="zf-fill" />
      <div className="py-floor">
        {floor.hold
          ? <HoldButton label={floor.label} disabled={false} onDone={onPay} bridge={bridge} testId="pay-hold" />
          : <button className="zf-btn" onClick={onPay}>{floor.label}</button>}
        {floor.line && <p className="zf-small">{floor.line}</p>}
      </div>
    </div>
  );
}
