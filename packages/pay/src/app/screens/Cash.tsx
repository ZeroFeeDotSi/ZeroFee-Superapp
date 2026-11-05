// Cash: add money with a card or bank, or cash out to a bank, through one partner. The partner
// does everything in its own screens, ID checks included. ZeroFee builds the link and, for cash out, the one payment.
import { useEffect, useState } from "react";
import type { Problem } from "@zerofee/core/problem";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { isPositive } from "@zerofee/design/keypad.ts";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { Check } from "@zerofee/design/icons.tsx";
import { chainsForAddress } from "../../chains.ts";
import { payProblems } from "../../pay-problems.ts";
import type { PayTarget } from "../../plan.ts";
import { buyLink, rampsFor, sellLink, type PartnerConfig, type RampId, type RampKind, type SellOrderLookup } from "../../partners/ramps.ts";
import { copyFor, readCopied } from "../clipboard.ts";
import { usePay } from "../runtime.tsx";
import { Address, CHECK_LINE } from "./Address.tsx";

/** A sale a partner will hand back (Banxa, MoonPay): matched against the link it returns with. */
export interface SellExpected {
  partner: RampId;
  order: string;
  chain: string;
  amount: string;
}

/** D5: plain-link partners only until the operator signs up with others. Their public ids go here when they exist. */
export const PARTNERS: PartnerConfig = {};
/**
 * iOS audit finding 2: the partner's own record of a sale, by its order id, so the deposit address never comes from the
 * return link alone. None yet (Banxa's order API needs a server-held secret; MoonPay's to confirm at sign-up): until one
 * is set, a hand-back partner is used like Mt Pelerin, the person copying the address from the partner's own screen.
 */
export const SELL_ORDERS: SellOrderLookup | undefined = undefined;
const CHAIN = "base";
/** The last amount for each way, kept on this phone, so a repeat cash-in or cash-out starts from it (ALPHA). */
const LAST_KEY = "cash.v1";

/** `start`: the way the person picked on the Bank tile (Add money, or Cash out). */
export function Cash({ start = "buy", onSendTo, onProblem, onOpen, onAwaitReturn }: { start?: RampKind; onSendTo: (t: PayTarget) => void; onProblem: (p: Problem) => void; onOpen: (url: string) => void; onAwaitReturn: (e: SellExpected) => void }) {
  const { bridge, flow } = usePay();
  const [kind, setKind] = useState<RampKind>(start);
  const [amount, setAmount] = useState("0");
  const [pick, setPick] = useState<RampId | null>(null);
  const [others, setOthers] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [awaiting, setAwaiting] = useState(false);
  const [handoff, setHandoff] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [typing, setTyping] = useState(false);
  const [last, setLast] = useState<Partial<Record<RampKind, string>>>({});
  const usdc = flow.tokens?.find(CHAIN, { symbol: "USDC" });
  const partners = rampsFor(kind, PARTNERS);
  const partner = partners.find((p) => p.id === pick) ?? partners[0];
  const clean = amount.replace(/\.$/, "");
  const order = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

  useEffect(() => {
    let live = true;
    void bridge.call<{ value: string | null }>("device.store.get", { key: LAST_KEY }).then((r) => {
      if (!live || "problem" in r || !r.ok.value) return;
      try {
        const saved = JSON.parse(r.ok.value) as Partial<Record<RampKind, string>>;
        setLast(saved);
        if (saved[start]) setAmount(saved[start]!);
      } catch {
        // Nothing remembered: start from zero.
      }
    });
    return () => {
      live = false;
    };
  }, [bridge]);
  const remember = (k: RampKind, value: string) => {
    const next = { ...last, [k]: value };
    setLast(next);
    void bridge.call("device.store.set", { key: LAST_KEY, value: JSON.stringify(next) });
  };
  const switchTo = (k: RampKind) => {
    setKind(k);
    setAmount(last[k] ?? "0");
    setAwaiting(false);
    setHandoff(null);
    setTyping(false);
  };

  useEffect(() => {
    if (kind !== "buy" || !usdc) return;
    let live = true;
    void bridge.call<{ address: string }>("ledger.depositAddress", { chain: CHAIN, token: usdc.assetId }).then((r) => {
      if (!live) return;
      if ("ok" in r) setAddress(r.ok.address);
      else onProblem(r.problem);
    });
    return () => {
      live = false;
    };
  }, [bridge, kind, usdc, onProblem]);

  const go = () => {
    if (!partner) return;
    const id = order();
    const url = kind === "buy"
      ? address && buyLink(partner.id, { address, chain: CHAIN, usdcAmount: clean, order: id }, PARTNERS)
      : sellLink(partner.id, { chain: CHAIN, amount: clean, order: id }, PARTNERS);
    if (!url) return onProblem(payProblems.partnerNone(kind === "buy" ? "sell you crypto" : "buy your crypto"));
    remember(kind, clean);
    const handsBack = partner.returnsDeposit && Boolean(SELL_ORDERS);
    if (kind === "sell" && handsBack) onAwaitReturn({ partner: partner.id, order: id, chain: CHAIN, amount: clean });
    // A partner that can't take the address in its link asks for it in its own screen: hand it over first, one Copy.
    if (kind === "buy" && !partner.prefillsAddress) return setHandoff(url);
    onOpen(url);
    if (kind === "sell" && !handsBack) setAwaiting(true);
  };
  const sendToPartner = (text: string | null) => {
    const to = text?.trim() ?? "";
    if (!partner || !usdc) return;
    if (!to) {
      setTyping(true);
      return onProblem(payProblems.copiedNone("an address on Base", partner.name));
    }
    if (!chainsForAddress(to).includes(CHAIN)) return onProblem(payProblems.cashOutMismatch(partner.name));
    // Named for what it is, an address the person pasted: nothing checked that it is the partner's (Security).
    onSendTo({ to: { kind: "chain", chain: CHAIN, address: to }, token: usdc, amount: clean, name: `The address you pasted for ${partner.name}`, notes: [] });
  };

  if (!partner) return <p className="zf-small py-center" style={{ marginTop: 40 }}>{payProblems.partnerNone(kind === "buy" ? "sell you crypto" : "buy your crypto").whatHappened}</p>;

  return (
    <div className="py py-col">
      <div className="py-tabs" role="tablist" aria-label="Cash">
        <button role="tab" aria-selected={kind === "buy"} className={kind === "buy" ? "on" : ""} onClick={() => switchTo("buy")}>Add money</button>
        <button role="tab" aria-selected={kind === "sell"} className={kind === "sell" ? "on" : ""} onClick={() => switchTo("sell")}>Cash out</button>
      </div>

      {handoff && address ? (
        <>
          <p className="zf-body py-center" style={{ marginTop: 30 }}>{partner.name} will ask where to send your USDC. Pay copies your address for you: paste it there.</p>
          <div className="py-rows" style={{ marginTop: 18 }}>
            <div className="py-row">
              <span />
              <Address value={address} />
              <span />
            </div>
          </div>
          <p className="zf-small" style={{ marginTop: 8 }}>{CHECK_LINE}</p>
          <div className="zf-fill" />
          <div className="py-floor">
            <button className="zf-btn" onClick={async () => { await copyFor(address); onOpen(handoff); setHandoff(null); }}>Copy address and open {partner.name}</button>
            <p className="zf-small">{partner.name} checks your ID in its own screens. ZeroFee never sees it.</p>
          </div>
        </>
      ) : awaiting ? (
        <>
          <p className="zf-body py-center" style={{ marginTop: 30 }}>{partner.name} shows an address to send your USDC to. Tap Copy there, then come back.</p>
          {typing && (
            <>
              <label className="py-field"><input autoFocus value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={`${partner.name}'s address on Base`} aria-label={`${partner.name}'s address`} /></label>
              {paste.trim().length > 10 && (
                <div style={{ marginTop: 10 }}>
                  <Address value={paste.trim()} />
                  <p className="zf-small" style={{ marginTop: 6 }}>Check the start and end match what {partner.name} shows.</p>
                </div>
              )}
            </>
          )}
          <div className="zf-fill" />
          <div className="py-floor">
            {typing
              ? <button className="zf-btn" disabled={!paste.trim()} onClick={() => sendToPartner(paste)}>Send {clean} USDC to {partner.name}</button>
              : <button className="zf-btn" onClick={async () => sendToPartner(await readCopied(bridge))}>Use the address you copied</button>}
            {!typing && <button className="zf-link" onClick={() => setTyping(true)}>Paste it instead</button>}
          </div>
        </>
      ) : (
        <>
          <div className="py-center" style={{ paddingTop: 20 }}>
            <div className="py-big">{amount} <small>USDC</small></div>
            <p className="zf-small" style={{ marginTop: 6 }}>{kind === "buy" ? "Arrives in your Safe as USDC" : "Paid out to your bank"}</p>
          </div>
          <div className="py-rows" style={{ marginTop: 16 }}>
            <div className="py-row">
              <span className="zf-tick on"><Check /></span>
              <div><div className="t">{partner.name}</div><div className="d">{partner.feeNote}</div></div>
              <span />
            </div>
          </div>
          {partners.length > 1 && <button className="zf-link" style={{ alignSelf: "center" }} onClick={() => setOthers(true)}>Other ways</button>}
          <div className="zf-fill" />
          <Keypad value={amount} decimals={2} onChange={setAmount} />
          <div className="py-floor">
            <button className="zf-btn" disabled={!isPositive(amount) || (kind === "buy" && !address)} onClick={go}>Continue with {partner.name}</button>
            <p className="zf-small">{partner.name} checks your ID in its own screens. ZeroFee never sees it.</p>
          </div>
        </>
      )}

      {others && (
        <Sheet title="Other ways" onClose={() => setOthers(false)}>
          <div className="py-rows">
            {partners.map((p) => (
              <button key={p.id} className="py-row py-pick" onClick={() => { setPick(p.id); setOthers(false); }}>
                <span className={`zf-tick ${p.id === partner.id ? "on" : ""}`}>{p.id === partner.id && <Check />}</span>
                <span><span className="t" style={{ display: "block" }}>{p.name}</span><span className="d" style={{ display: "block" }}>{p.feeNote}</span></span>
                <span />
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
