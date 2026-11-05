// Paying a bank code through Mt Pelerin (M3, board row 4): Confirm → Mt Pelerin's own sheet, with what to copy → back in
// Pay, pay Mt Pelerin in USDC (Confirm and Face ID next) → On its way → Paid only when the person says Mt Pelerin told
// them. Pay never sees the bank transfer itself, and the screens never say it did.
import { useState, type ReactNode } from "react";
import { Mark } from "@zerofee/design/Mark.tsx";
import { BANK_PARTNER, RATE_SOURCE, type BankBill } from "../../bank.ts";
import { groupIban, shortIban } from "../../codes/iban.ts";
import { readPayCode } from "../../codes/parse.ts";
import { fromUnits } from "../../amount.ts";
import type { TokenDirectory } from "../../tokens.ts";
import { shown } from "../format.ts";
import { Tick } from "../icons.tsx";
import { Address, CHECK_LINE } from "./Address.tsx";

/** An IBAN in groups of four, its first and last group in bold, to compare with the bill. */
function Iban({ value }: { value: string }) {
  const groups = groupIban(value).split(" ");
  return (
    <span className="py-mono" style={{ fontSize: 13, color: "var(--ink-2)" }}>
      <b style={{ color: "var(--ink)" }}>{groups[0]}</b> {groups.slice(1, -1).join(" ")} <b style={{ color: "var(--ink)" }}>{groups[groups.length - 1]}</b>
    </span>
  );
}

export function BankConfirm({ bill, onPay }: { bill: BankBill; onPay: () => void }) {
  return (
    <div className="py py-col">
      <div className="py-center zf-enter" style={{ paddingTop: 36 }}>
        <div className="zf-label">{bill.label ? "The code says it's" : "To"}</div>
        <h1 className="zf-title" style={{ marginTop: 10, wordBreak: "break-word" }}>{bill.label ?? groupIban(bill.iban)}</h1>
        {bill.label && <div style={{ marginTop: 8 }}><Iban value={bill.iban} /></div>}
        <div className="zf-small" style={{ marginTop: 4 }}>{bill.scheme === "QR-bill" ? "Bank transfer" : "SEPA bank transfer"}</div>
        <div className="py-big" style={{ marginTop: 28 }}>{bill.amount} <small>EUR</small></div>
        {bill.reference && <p className="zf-small" style={{ marginTop: 8 }}>Reference: {bill.reference}</p>}
      </div>
      <div className="py-rows zf-enter-2" style={{ marginTop: 30 }}>
        <div className="py-row"><span /><div><div className="t">Through {BANK_PARTNER.name}</div><div className="d">A bank transfer from your own bank account (IBAN)</div></div><span /></div>
        <div className="py-row"><span /><div><div className="t">You pay</div><div className="d">In USDC from your Safe · today's rate from {RATE_SOURCE}</div></div><span className="v">about {bill.estimate} USDC</span></div>
        <div className="py-row"><span /><div><div className="t">Arrives</div></div><span className="v">1–2 business days · {BANK_PARTNER.name}'s figure</span></div>
      </div>
      <div className="zf-fill" />
      <div className="py-floor">
        <button className="zf-btn" onClick={onPay}>Pay {bill.amount} EUR</button>
        <p className="zf-small">{BANK_PARTNER.name} opens next. Nothing leaves your Safe until you send it.</p>
      </div>
    </div>
  );
}

function CopyRow({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="py-row">
      <span />
      <div><div className="zf-label">{label}</div><div style={{ marginTop: 5 }}>{children ?? value}</div></div>
      <button className="py-change" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); } catch { /* it's on screen to copy by hand */ } }}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

export function BankHandoff({ bill, opened, onOpen, onNext }: { bill: BankBill; opened: boolean; onOpen: () => void; onNext: () => void }) {
  return (
    <div className="py py-col">
      <p className="zf-body py-center" style={{ marginTop: 24 }}>In {BANK_PARTNER.name}, send a bank transfer with these.</p>
      <div className="py-rows" style={{ marginTop: 14 }}>
        {bill.label && <CopyRow label="Who the code pays" value={bill.label} />}
        <CopyRow label="Account number (IBAN)" value={bill.iban}><Iban value={bill.iban} /></CopyRow>
        <CopyRow label="Amount" value={bill.amount}>{bill.amount} EUR</CopyRow>
        {bill.reference && <CopyRow label="Reference" value={bill.reference} />}
      </div>
      <p className="zf-small" style={{ marginTop: 8 }}>Your money is still in your Safe.</p>
      <div className="zf-fill" />
      <div className="py-floor">
        {opened
          ? <><button className="zf-btn" onClick={onNext}>Next: pay {BANK_PARTNER.name}</button><button className="zf-link" onClick={onOpen}>Open {BANK_PARTNER.name} again</button></>
          : <><button className="zf-btn" onClick={onOpen}>Open {BANK_PARTNER.name}</button><p className="zf-small">You sign in with your own {BANK_PARTNER.name} account and account number (IBAN). It checks your ID in its own screens.</p></>}
      </div>
    </div>
  );
}

/** What Mt Pelerin's page shows, pasted: its payment link (address and amount at once), or its address. */
function readPasted(text: string, tokens: TokenDirectory | undefined): { address?: string; amount?: string } {
  const code = readPayCode(text.trim());
  if (code.kind !== "crypto") return {};
  const token = code.chain ? tokens?.find(code.chain, code.token) : undefined;
  const amount = !code.amount ? undefined : "decimal" in code.amount ? code.amount.decimal : token ? fromUnits(BigInt(code.amount.units), token.decimals) : undefined;
  return { address: code.address, amount };
}

export function BankPayIn({ bill, tokens, onSend }: { bill: BankBill; tokens: TokenDirectory | undefined; onSend: (pasted: string, amount: string) => void }) {
  const [pasted, setPasted] = useState("");
  const [amount, setAmount] = useState("");
  const read = readPasted(pasted, tokens);
  return (
    <div className="py py-col">
      <div className="py-center" style={{ paddingTop: 30 }}>
        <h1 className="zf-title">Pay {BANK_PARTNER.name}</h1>
        <p className="zf-body" style={{ marginTop: 10 }}>Paste what {BANK_PARTNER.name} shows for this transfer: its payment link, or its address and the USDC it asks for.</p>
      </div>
      <label className="py-field" style={{ marginTop: 22 }}><input autoFocus value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={`${BANK_PARTNER.name}'s address or link`} aria-label={`${BANK_PARTNER.name}'s address or payment link`} /></label>
      {read.address && <div style={{ marginTop: 10 }}><Address value={read.address} /></div>}
      {read.amount
        ? <p className="zf-small" style={{ marginTop: 10 }}>{read.amount} USDC, from {BANK_PARTNER.name}'s link</p>
        : <label className="py-field" style={{ marginTop: 10 }}><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="USDC it asks for" aria-label={`USDC ${BANK_PARTNER.name} asks for`} /></label>}
      <p className="zf-small" style={{ marginTop: 8 }}>{CHECK_LINE} Pay sends at most {shown(bill.ceiling, 2, "down")} USDC for this bill.</p>
      <div className="zf-fill" />
      <div className="py-floor">
        <button className="zf-btn" disabled={!pasted.trim()} onClick={() => onSend(pasted, amount)}>Review the payment</button>
        <p className="zf-small">You check it once more before it goes.</p>
      </div>
    </div>
  );
}

export function BankSent({ bill, usdc, onDone, onPaid }: { bill: BankBill; usdc: string; onDone: () => void; onPaid: () => void }) {
  return (
    <div className="py py-col">
      <div className="zf-fill" />
      <div className="py-center zf-enter" style={{ display: "grid", justifyItems: "center" }}>
        <Mark size={96} mode="still" />
        <div className="zf-label" style={{ marginTop: 26 }}>On its way</div>
        <div className="py-big" style={{ marginTop: 10 }}>{bill.amount} <small>EUR</small></div>
        <p className="zf-body" style={{ marginTop: 6 }}>to {shortIban(bill.iban)}, by bank transfer</p>
        <p className="zf-small" style={{ marginTop: 14, maxWidth: 310 }}>
          Your {usdc} USDC is with {BANK_PARTNER.name}. It pays this from your account number (IBAN). It tells you in its own app and by email when done. {BANK_PARTNER.name} says that usually takes 1–2 business days.
        </p>
      </div>
      <div className="zf-fill" />
      <div className="py-floor">
        <button className="zf-btn" onClick={onDone}>Done</button>
        <button className="zf-link" onClick={onPaid}>{BANK_PARTNER.name} says it's paid</button>
      </div>
    </div>
  );
}

export function BankPaid({ bill, usdc, relabelled, onDone }: { bill: BankBill; usdc: string; relabelled: boolean; onDone: () => void }) {
  return (
    <div className="py py-col">
      <div className="zf-fill" />
      <div className="py-center zf-enter" style={{ display: "grid", justifyItems: "center" }}>
        <Tick />
        <div className="zf-label" style={{ marginTop: 26 }}>Paid</div>
        <div className="py-big" style={{ marginTop: 10 }}>{bill.amount} <small>EUR</small></div>
        <p className="zf-body" style={{ marginTop: 6 }}>to {shortIban(bill.iban)}, by bank transfer</p>
        {bill.label && <p className="zf-small" style={{ marginTop: 4 }}>The code says it's {bill.label}</p>}
      </div>
      <div className="zf-fill" />
      <div className="py-rows zf-enter-2">
        <div className="py-split"><span>Paid with</span><span>{usdc} USDC</span></div>
        <div className="py-split"><span>Paid by</span><span>{BANK_PARTNER.name}, as it told you</span></div>
      </div>
      {!relabelled && <p className="zf-small" style={{ marginTop: 10 }}>Activity still shows it as sent to {BANK_PARTNER.name}.</p>}
      <div className="py-floor"><button className="zf-btn" onClick={onDone}>Done</button></div>
    </div>
  );
}

/**
 * A bank code Pay can't pay itself (PromptPay, PIX, UPI and other proxy codes; francs): the product choice is two ways,
 * both in the person's own name. Your exchange sells USDC into your own bank, then you pay the code from your bank
 * app; or your card. Nothing has moved.
 */
export function BankOnly({ title, detail, hasExchange, cardLive, onExchange, onCard }: { title: string; detail?: string; hasExchange: boolean; cardLive: boolean; onExchange: () => void; onCard: () => void }) {
  return (
    <div className="py py-col">
      <div className="zf-fill" />
      <div className="py-center" style={{ display: "grid", gap: 12 }}>
        <h1 className="zf-title">{title}</h1>
        <p className="zf-body">Your money hasn't moved. It's in your Safe.</p>
        <p className="zf-small">Pay it from your bank app. First send USDC to your exchange. It sells it into your bank account.{detail ? ` ${detail}` : ""}</p>
      </div>
      <div className="zf-fill" />
      <div className="py-floor">
        <button className="zf-btn" onClick={onExchange}>{hasExchange ? "Send to my exchange" : "Add your exchange"}</button>
        {cardLive && <button className="zf-link" onClick={onCard}>Pay with my card</button>}
      </div>
    </div>
  );
}
