// The card's address (D31's MVP path): the person orders the card in the issuer's own app, copies the card's address
// there and comes back. One field (Paste fills it from what they copied), one check (card.check proves it's a card
// account), then it's saved and its balance shows. A new card starts here too (the robot's walk: one start, not two):
// the pill opens the issuer's sign-up until the person comes back, then it's Paste; "I already have one" skips ahead.
import { useEffect, useState } from "react";
import type { Problem } from "@zerofee/core/problem";
import { chainName } from "../../chains.ts";
import { checkAndSaveCard, endsWords, readCardAddress, wasForgotten, type CardProduct, type SavedCard } from "../../partners/cards.ts";
import { payProblems } from "../../pay-problems.ts";
import { usePay } from "../runtime.tsx";
import { Address } from "./Address.tsx";
import { PasteField, usePaste } from "./PasteField.tsx";

interface Props {
  product: CardProduct;
  coin: string;
  onSaved: (card: SavedCard) => void;
  onProblem: (p: Problem) => void;
  onSkip?: () => void;
  /** No card yet: the issuer's sign-up, opened by the pill until the person comes back. */
  signup?: { url: string; onOpen: (url: string) => void };
  /** A quiet link under the pill (a card still topped up until it stops). */
  also?: { label: string; onClick: () => void };
  /** A Problem's "Copy it again": the field comes back empty and the pill pastes. */
  fix?: { field: string; n: number };
}

export function CardAddressStep({ product, coin, onSaved, onProblem, onSkip, signup, also, fix }: Props) {
  const { bridge } = usePay();
  const [typed, setTyped] = useState("");
  const network = chainName(product.chain);
  const wrong = () => onProblem(payProblems.cardAddressWrong(product.name, network));
  // Like the exchange (robot pass 5): what's pasted is checked on the paste; not an address on the card's network is
  // the Problem screen at once, and its "Copy it again" brings back an empty field.
  useEffect(() => {
    if (fix?.field === "card-address" && fix.n > 0) setTyped("");
  }, [fix?.n]);
  const [opened, setOpened] = useState(!signup);
  // Back from the issuer's own window: the next step is the paste.
  useEffect(() => bridge.on("device.returned", () => setOpened(true)), [bridge]);
  // The address the person's money didn't show at before, pasted again: said before it's saved (Security's SHOULD).
  const [again, setAgain] = useState(false);
  useEffect(() => {
    let live = true;
    const a = typed.trim();
    if (a.length > 10) void wasForgotten(bridge, product.id, a).then((x) => live && setAgain(x));
    else setAgain(false);
    return () => {
      live = false;
    };
  }, [bridge, product.id, typed]);
  const { paste, none } = usePaste((t) => {
    const address = readCardAddress(t, product);
    if (!address) return wrong();
    setTyped(address);
  });
  const [busy, setBusy] = useState(false);

  const save = async (text: string | null) => {
    const address = readCardAddress(text, product);
    if (!address) return wrong();
    setBusy(true);
    const saved = await checkAndSaveCard(bridge, product, address, coin);
    setBusy(false);
    if ("problem" in saved) return onProblem(saved.problem);
    onSaved(saved.ok);
  };

  return (
    <div className="py py-col">
      <h1 className="zf-title py-center" style={{ marginTop: 34 }}>Your card's address</h1>
      <p className="zf-body py-center" style={{ marginTop: 10 }}>{!opened ? `Get a card in the ${product.name} app, then copy its address and paste it here.` : product.handOff ? `${product.addressHint} Then paste it here.` : `Paste your card's address from the ${product.name} app.`}</p>
      {!opened && <p className="zf-small py-center" style={{ marginTop: 8 }}>{product.signupNote}</p>}
      {product.endsOn && <p className="zf-small py-center" style={{ marginTop: 8 }}>{product.name} cards stop working on {endsWords(product)}. Your money stays in your {product.name} account.</p>}
      <PasteField autoFocus={!signup} value={typed} onChange={setTyped} none={none} label={`Your ${product.name} card's address`} />
      {/* In full with bold ends, and its network in words: a paste is when a clipboard hijacker swaps an address, and with
          no card.check the person's look at the ends is the only check (Security). */}
      {readCardAddress(typed, product) && <div style={{ marginTop: 10 }}><Address value={typed.trim()} /><p className="zf-small" style={{ marginTop: 6 }}>On {chainName(product.chain)}. Check the start and end match the {product.name} app.</p>{again && <p className="zf-small" role="status" style={{ marginTop: 6, color: "var(--ink)" }}>This is the address your money didn't show at.</p>}</div>}
      <div className="zf-fill" />
      <div className="py-floor">
        {typed.trim()
          ? <button className="zf-btn" disabled={busy} onClick={() => void save(typed)}>{busy ? "Checking…" : product.handOff ? "Save" : "Check and save"}</button>
          : !opened && signup
            // Opened right on the tap, the plain partner window (D28): a browser blocks a window opened after a wait.
            ? <button className="zf-btn" onClick={() => { signup.onOpen(signup.url); setOpened(true); }}>Open {product.name}</button>
            : <button className="zf-btn" onClick={() => void paste()}>Paste the address you copied</button>}
        {/* A hand-off card can't be proven on chain: its first, small top-up is the check (the person says it arrived). */}
        {typed.trim() && product.handOff && <p className="zf-small">We'll check it with your first top-up.</p>}
        {!opened && <button className="zf-link" onClick={() => setOpened(true)}>I already have one</button>}
        {!typed.trim() && also && <button className="zf-link" onClick={also.onClick}>{also.label}</button>}
        {onSkip && <button className="zf-link" onClick={onSkip}>Skip for now</button>}
      </div>
    </div>
  );
}
