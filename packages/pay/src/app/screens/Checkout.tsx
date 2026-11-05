// A shop's own checkout, paid from the balance (D38 kind "voucher": Bitrefill's gift cards and top-ups), under
// Security's MUSTs (a–e): its page opens in Pay's window; the person picks USDC there and pastes the address and the
// exact amount it shows (Pay never reads the page or the code); one of the shop's networks; a cap per purchase and
// week; a short window from the paste; its own refund words, and that ZeroFee can't undo a payment.
import { useEffect, useState } from "react";
import type { Problem } from "@zerofee/core/problem";
import { Check } from "@zerofee/design/icons.tsx";
import { chainName } from "../../chains.ts";
import { PAY_WITHIN_MIN, capFor, checkoutTarget, ledgerFor, networksFor, type CheckoutLedger } from "../../checkout.ts";
import type { PayTarget } from "../../plan.ts";
import { REGISTRY } from "../../registry.ts";
import { forgetSent } from "../../receipts.ts";
import { usePay } from "../runtime.tsx";
import { Address } from "./Address.tsx";
import { PasteField, usePaste } from "./PasteField.tsx";
import { ProviderFacts } from "./ProviderFacts.tsx";
import { RemoveSheet } from "./RemoveSheet.tsx";

/** Security's refund words (MUST d): the shop's own, and never a promise from ZeroFee. */
export const NO_UNDO = "ZeroFee can't get the money back: payments can't be undone.";

/**
 * `onAnswer`: the person's answer to "did it arrive?" when the $25 test is used up (Security's MUST on a7ca3c5).
 * `added`: it's on Home (something was bought there), so it can be removed; never before.
 */
export function Checkout({ id, added, fix, onOpen, onPay, onProblem, onAnswer, onRemoved }: { id: string; added: boolean; fix?: { field: string; n: number }; onOpen: (url: string) => void; onPay: (t: PayTarget) => void; onProblem: (p: Problem) => void; onAnswer: (yes: boolean) => void; onRemoved: () => void }) {
  const { bridge, flow } = usePay();
  const recipe = REGISTRY.find((r) => r.id === id && r.kind === "voucher")!;
  const [ledger, setLedger] = useState<CheckoutLedger>({ confirmed: false, buys: [] });
  useEffect(() => {
    let live = true;
    void ledgerFor(bridge, id).then((l) => live && setLedger(l));
    return () => {
      live = false;
    };
  }, [bridge, id]);
  const [opened, setOpened] = useState(false);
  const [address, setAddress] = useState("");
  const [copiedAt, setCopiedAt] = useState(0);
  const [amount, setAmount] = useState("");
  const [picked, setPicked] = useState<string | undefined>();
  /** The network row tapped, until Continue makes it the pick. */
  const [choice, setChoice] = useState<string | undefined>();
  const [removing, setRemoving] = useState(false);
  const addr = usePaste((t) => { setAddress(t.trim()); setCopiedAt(Date.now()); });
  // The exact amount as shown: digits and a point only (no thousands separators, no coin name).
  const amt = usePaste((t) => setAmount(t.replace(/[^\d.]/g, "")));
  // Back from "Pick something smaller": the amount is empty and its pill pastes again (never "Pay 40.00 USDC" again).
  useEffect(() => {
    if (fix?.field === "checkout-amount" && fix.n > 0) {
      setAmount("");
      amt.clear();
    }
  }, [fix?.n]);
  const nets = address ? networksFor(recipe, address) : [];
  const network = nets.length === 1 ? nets[0] : picked && nets.includes(picked) ? picked : undefined;
  const cap = capFor(ledger);
  const name = recipe.name;

  const pay = () => {
    if (!flow.tokens || !network) return;
    const t = checkoutTarget(recipe, { address, amount, network, copiedAt }, flow.tokens, ledger);
    if ("problem" in t) return onProblem(t.problem);
    onPay(t.ok);
  };

  // The test is used up: nothing more until the person says whether it arrived.
  if (cap.first && cap.max === "0") {
    return (
      <div className="py py-col">
        <div className="zf-fill" />
        <h1 className="zf-title py-center">Did your test purchase arrive?</h1>
        <p className="zf-body py-center" style={{ marginTop: 10 }}>Did your {name} code arrive by email, and does it work?</p>
        <div className="zf-fill" />
        <div className="py-floor">
          <button className="zf-btn" onClick={() => onAnswer(true)}>Yes, it works</button>
          <button className="zf-link" onClick={() => onAnswer(false)}>No, it didn't arrive</button>
        </div>
      </div>
    );
  }

  let pill;
  if (!opened && !address) pill = <button className="zf-btn" onClick={() => { onOpen(recipe.signup.url); setOpened(true); }}>Open {name}</button>;
  else if (!address) pill = <button className="zf-btn" onClick={() => void addr.paste()}>Paste the address you copied</button>;
  // The pick shows twice before Continue (the robot's pass 3): its row ticked, and the pill names it.
  else if (!network) pill = <button className="zf-btn" disabled={!choice} onClick={() => setPicked(choice)}>{choice ? `Pay on ${chainName(choice)}` : "Pick a network"}</button>;
  else if (!amount) pill = <button className="zf-btn" onClick={() => void amt.paste()}>Paste the amount you copied</button>;
  else pill = <button className="zf-btn" onClick={pay}>Pay {amount} USDC</button>;

  return (
    <div className="py py-col">
      <h1 className="zf-title py-center" style={{ marginTop: 20 }}>{name}</h1>
      <p className="zf-small py-center py-mono" style={{ marginTop: 4 }}>{recipe.domain}</p>
      <p className="zf-body py-center" style={{ marginTop: 6 }}>{recipe.line}</p>
      {!address && <p className="zf-small" style={{ marginTop: 14 }}>{cap.first ? (cap.max === "25" ? `Your first ${name} purchase: a test, up to $25.` : `Your test purchases: $${cap.max} left, until you say one arrived.`) : `Up to $${cap.max} a purchase now, and $250 a week.`}</p>}
      {!address && <p className="zf-small" style={{ marginTop: 6 }}>{opened ? `Pick what to buy, choose USDC at its checkout, then copy the address it shows.` : `Pick what to buy at ${name}, and choose USDC at its checkout.`}</p>}
      {(opened || address) && <PasteField value={address} onChange={(t) => { setAddress(t.trim()); setCopiedAt(Date.now()); }} none={addr.none} label={`${name}'s checkout address`} placeholder="Its checkout address" />}
      {address && nets.length === 0 && <p className="zf-small" role="status" style={{ marginTop: 8 }}>That isn't an address on a network {name} takes USDC on. Copy it again.</p>}
      {/* One line, a picked state, one Continue (the robot's walk): not equal buttons that each pay on a network. */}
      {address && nets.length > 1 && !network && (
        <div style={{ marginTop: 10 }}>
          <p className="zf-body">Which did you pick at its checkout? (its page shows it)</p>
          <div className="py-rows" role="radiogroup" aria-label="Network" style={{ marginTop: 6 }}>
            {nets.map((n) => (
              <button key={n} role="radio" aria-checked={choice === n} className="py-row py-pick" onClick={() => setChoice(n)}>
                <span className={`zf-tick ${choice === n ? "on" : ""}`}>{choice === n && <Check />}</span>
                <span className="t" style={choice === n ? { fontWeight: 600 } : undefined}>{chainName(n)}</span>
                <span />
              </button>
            ))}
          </div>
        </div>
      )}
      {address && network && (
        <div style={{ marginTop: 8 }}>
          <Address value={address} />
          <p className="zf-small" style={{ marginTop: 6 }}>On {chainName(network)}. Check the start and end match {name}'s checkout.</p>
          <PasteField value={amount} onChange={(t) => setAmount(t.replace(/[^\d.]/g, ""))} none={amt.none} label={`${name}'s exact amount`} placeholder="Its exact amount, in USDC" />
          <p className="zf-small" style={{ marginTop: 8 }}>Pay within {PAY_WITHIN_MIN} minutes of copying it, or {name} may not count it.</p>
        </div>
      )}
      {/* Step 2 (pasted): at most three lines, no disclaimer said twice (the robot's final round); its costs and whose
          customer the person is were said on step 1 and on Before you start. */}
      {!address && <ProviderFacts id={id} name={name} />}
      <p className="zf-small" style={address ? { marginTop: 8 } : undefined}>{NO_UNDO}</p>
      {recipe.refund && <button className="zf-link" style={{ marginTop: 4 }} onClick={() => onOpen(recipe.refund!)}>{name}'s refund page</button>}
      {/* Off Home: Pay forgets its receipts; its caps stay (they're about money already sent). */}
      {added && <button className="zf-link" style={{ marginTop: 4 }} onClick={() => setRemoving(true)}>Remove {name} from Pay</button>}
      {removing && <RemoveSheet name={name} line={`Pay forgets what it sent there. Its limits for test purchases stay. Codes you bought stay with ${name}.`} onClose={() => setRemoving(false)} onRemove={async () => { setRemoving(false); await forgetSent(bridge, id); onRemoved(); }} />}
      <div className="zf-fill" />
      <div className="py-floor">{pill}</div>
    </div>
  );
}
