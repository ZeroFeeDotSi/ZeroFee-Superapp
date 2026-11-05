// The Bank tile's page (D29): your own personal IBAN at Mt Pelerin. Not set up: one pill opens Mt Pelerin's own page
// (sign up, ID check, "Get your own IBAN"), then one tap keeps the IBAN you copied there. Set up: Add money is the one
// pill; Cash out, Pay a bank bill and Open Mt Pelerin are rows ("Fill login" joins them on a phone with the ZeroFee
// Keychain, Security E; never a greyed row where there's none, the robot's pass 4). Mt Pelerin keeps the balance in its own app.
import { useState } from "react";
import type { Problem } from "@zerofee/core/problem";
import { groupIban } from "../../codes/iban.ts";
import { BANK_SIGNUP, removeBank, saveBankFrom, type SavedBank } from "../../partners/banks.ts";
import { usePay } from "../runtime.tsx";
import { PasteField, usePaste } from "./PasteField.tsx";
import { ProviderFacts } from "./ProviderFacts.tsx";
import { RemoveSheet } from "./RemoveSheet.tsx";

interface Props {
  bank: SavedBank | null;
  onBank: (b: SavedBank | null) => void;
  onOpen: (url: string) => void;
  onCash: (kind: "buy" | "sell") => void;
  onScan: () => void;
  /** "Skip for now": back to Home, never round to the intro (UI's robot walk). */
  onHome: () => void;
  onProblem: (p: Problem) => void;
}

export function BankTile({ bank, onBank, onOpen, onCash, onScan, onHome, onProblem }: Props) {
  const { bridge } = usePay();
  const [opened, setOpened] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [typed, setTyped] = useState("");
  const { paste, none } = usePaste(setTyped);

  const keep = async (text: string | null) => {
    const saved = await saveBankFrom(bridge, text);
    if ("problem" in saved) return onProblem(saved.problem);
    onBank(saved.ok);
  };

  if (!bank) {
    return (
      <div className="py py-col">
        <h1 className="zf-title py-center" style={{ marginTop: 30 }}>Add your bank</h1>
        {/* Like Before you start (the robot's pass 3): three lines before the first button: what it is with its domain,
            its costs, whose customer; the rest behind "What Mt Pelerin says". */}
        <p className="zf-body py-center" style={{ marginTop: 10 }}>
          {opened ? "Copy your account number (IBAN) from Mt Pelerin, come back and paste it." : <>Get your own bank account number (IBAN) from Mt Pelerin.<br /><span className="zf-small py-mono">app.mtpelerin.com</span></>}
        </p>
        {!opened && <ProviderFacts id="mt-pelerin" name="Mt Pelerin" />}
        {opened && (
          <PasteField autoFocus value={typed} onChange={setTyped} none={none} label="Your account number (IBAN)" />
        )}
        <div className="zf-fill" />
        <div className="py-floor">
          {opened
            ? typed.trim()
              ? <button className="zf-btn" onClick={() => void keep(typed)}>Save</button>
              : <button className="zf-btn" onClick={() => void paste()}>Paste the account number you copied</button>
            : <button className="zf-btn" onClick={() => { onOpen(BANK_SIGNUP); setOpened(true); }}>Open Mt Pelerin</button>}
          {!opened && <button className="zf-link" onClick={() => setOpened(true)}>I already have one</button>}
          <button className="zf-link" onClick={onHome}>Skip for now</button>
        </div>
      </div>
    );
  }

  const groups = groupIban(bank.iban).split(" ");
  return (
    <div className="py py-col">
      <div className="py-card" style={{ gap: 14 }}>
        <span className="zf-label" style={{ color: "var(--ink)" }}>Mt Pelerin</span>
        <div>
          <div className="zf-small">Your account number (IBAN)</div>
          <div className="py-mono" style={{ marginTop: 4 }}><b>{groups[0]}</b> {groups.slice(1, -1).join(" ")} <b>{groups[groups.length - 1]}</b></div>
          <div className="zf-small" style={{ marginTop: 6 }}>Mt Pelerin keeps the balance in its own app.</div>
        </div>
      </div>
      <div className="py-rows" style={{ marginTop: 16 }}>
        <button className="py-row py-pick" onClick={() => onCash("sell")}><span /><span><span className="t" style={{ display: "block" }}>Cash out</span><span className="d" style={{ display: "block" }}>To your bank, through Mt Pelerin</span></span><span /></button>
        <button className="py-row py-pick" onClick={onScan}><span /><span><span className="t" style={{ display: "block" }}>Pay a bank bill</span><span className="d" style={{ display: "block" }}>Scan a bank bill</span></span><span /></button>
        <button className="py-row py-pick" onClick={() => onOpen(BANK_SIGNUP)}><span /><span><span className="t" style={{ display: "block" }}>Open Mt Pelerin</span></span><span /></button>
      </div>
      <div className="zf-fill" />
      <div className="py-floor">
        <button className="zf-btn" onClick={() => onCash("buy")}>Add money</button>
        <p className="zf-small">Send money to this account from your bank; it comes into your Safe.</p>
        <button className="zf-link" onClick={() => setRemoving(true)}>Remove this bank</button>
      </div>
      {removing && <RemoveSheet name="this bank" line="Pay forgets this account number. Money already there stays with Mt Pelerin." onClose={() => setRemoving(false)} onRemove={async () => { setRemoving(false); await removeBank(bridge); onBank(null); }} />}
    </div>
  );
}
