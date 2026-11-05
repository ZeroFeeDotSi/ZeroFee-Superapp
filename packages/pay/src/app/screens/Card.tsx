// Card: bring your own. No card yet → get one in the issuer's own app (ID checks there), come back, one tap to use the
// address copied there. With a card → top it up from the balance: the last amount is already there, so a repeat top-up
// is one tap and the approval sheet: exactly the card's coin, on the card's chain, to the card's address.
import { useEffect, useState } from "react";
import type { Problem } from "@zerofee/core/problem";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { isPositive } from "@zerofee/design/keypad.ts";
import { Mark } from "@zerofee/design/Mark.tsx";
import { Check } from "@zerofee/design/icons.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { chain, shortAddress } from "../../chains.ts";
import type { PayTarget } from "../../plan.ts";
import { CARDS, FIRST_TOPUP_MAX, cardEndingSoon, cardStopped, endsWords, loadCard, nextTopUpAmount, removeCard, saveCard, topUpTarget, type CardProduct, type SavedCard } from "../../partners/cards.ts";
import { cardCoinName, cardMoney, shown } from "../format.ts";
import { CardMark } from "../icons.tsx";
import { usePay } from "../runtime.tsx";
import { forgetSent } from "../../receipts.ts";
import { CardAddressStep } from "./CardAddress.tsx";
import { RemoveSheet } from "./RemoveSheet.tsx";

/** `start`: the card picked in "What's available" (D36); else the one a new person gets. */
/**
 * `onWithdraw`: money back (D38): Pay's Receive on the card's network, with its own page one tap away. `onMove`: a card
 * with a closing notice moves to another one ("What's available").
 */
/** `retry`: after "No, it didn't": straight to the paste step, nothing else on it. */
export function CardTab({ onTopUp, onProblem, onOpen, onRemoved, onWithdraw, onMove, start, retry, fix }: { onTopUp: (t: PayTarget, productId: CardProduct["id"]) => void; onProblem: (p: Problem) => void; onOpen: (url: string) => void; onRemoved?: () => void; onWithdraw: (from: { name: string; url: string; chain: string; coin: string; cardId: CardProduct["id"] }) => void; onMove: () => void; start?: CardProduct["id"]; retry?: boolean; fix?: { field: string; n: number } }) {
  const { bridge, flow, balances } = usePay();
  const [card, setCard] = useState<SavedCard | null | undefined>(undefined);
  const [mode, setMode] = useState<"view" | "none" | "address">("view");
  const [product, setProduct] = useState<CardProduct>(CARDS[0]);
  /** The card a new person gets (no end date), and the one still topped up until it stops. */
  const fresh = CARDS.find((c) => c.id === start && !c.endsOn) ?? CARDS.find((c) => !c.endsOn)!;
  const ending = CARDS.find((c) => c.endsOn && !cardStopped(c));
  const [amount, setAmount] = useState("0");
  const [coins, setCoins] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [managing, setManaging] = useState(false);
  // D31 (Security 1c): in the MVP the card is ordered in Gnosis Pay's own app with the person's own means: no robot, no
  // wallet mode, no card wallet (ensureCardWallet stays on main for later, unreachable here). Pay keeps the address.
  const [balance, setBalance] = useState<string | null>(null);
  // The card's own balance, read on its chain by the core (card.balance, Security: a Gnosis Pay Safe); a hand-off card's
  // balance is in its own app.
  useEffect(() => {
    if (!card || CARDS.find((c) => c.id === card.productId)?.handOff) return;
    let live = true;
    void bridge.call<{ amount: string; symbol: string }>("card.balance", { address: card.address }).then((r) => {
      if (live && "ok" in r) setBalance(`${cardMoney(shown(r.ok.amount, 2), r.ok.symbol)} on your card`);
    });
    return () => {
      live = false;
    };
  }, [bridge, card]);

  useEffect(() => {
    let live = true;
    // The card picked on Home or in What's available (D38: several side by side); none named, the first.
    void loadCard(bridge, start).then((c) => {
      if (!live) return;
      setCard(c);
      if (c) setAmount(nextTopUpAmount(c));
    });
    return () => {
      live = false;
    };
  }, [bridge, start]);

  /** The card's coin the person already holds on its chain, so a top-up needs no conversion. */
  const heldCoin = (p: CardProduct) => p.coins.find((s) => balances.some((b) => b.chain === p.chain && b.symbol === s)) ?? p.coins[0];
  const topUp = () => {
    if (!card || !flow.tokens) return;
    const t = topUpTarget(card, amount.replace(/\.$/, ""), flow.tokens);
    if ("problem" in t) return onProblem(t.problem);
    onTopUp(t.ok, card.productId);
  };
  const setCoin = async (coin: string) => {
    if (!card) return;
    const next = { ...card, coin };
    const problem = await saveCard(bridge, next);
    if (problem) return onProblem(problem);
    setCard(next);
  };

  if (card === undefined) return <div className="py-wait"><Mark size={56} mode="loading" label="Opening your card" /></div>;

  if (mode === "address") {
    return (
      <CardAddressStep
        fix={fix}
        product={product}
        coin={heldCoin(product)}
        onSaved={(c) => { setCard(c); setAmount(nextTopUpAmount(c)); setMode("view"); }}
        onProblem={onProblem}
        onSkip={() => (card ? setMode("view") : onRemoved?.())}
      />
    );
  }

  // No card yet: straight to its address, the issuer's sign-up one tap away (the robot's walk: one start, not two). A
  // Gnosis Pay card someone already has is still topped up until it stops (20 Dec 2026).
  if (!card || mode === "none") {
    const picked = (retry && CARDS.find((c) => c.id === start)) || (ending && product.id === ending.id ? ending : fresh);
    return (
      <CardAddressStep
        fix={fix}
        key={picked.id}
        product={picked}
        coin={heldCoin(picked)}
        signup={picked === fresh && !retry ? { url: fresh.signupUrl, onOpen } : undefined}
        also={ending && picked !== ending && !retry ? { label: `Top up a ${ending.name} card`, onClick: () => setProduct(ending) } : undefined}
        onSaved={(c) => { setCard(c); setAmount(nextTopUpAmount(c)); setMode("view"); }}
        onProblem={onProblem}
      />
    );
  }

  const p = CARDS.find((c) => c.id === card.productId)!;
  // Past its end, no top-up (Security's MUST 1); a hand-off card's first top-up is a test (no stated minimum, MUST 2).
  const stopped = cardStopped(p);
  const firstLine = p.handOff ? `First top-up: a test, up to ${cardMoney(FIRST_TOPUP_MAX, card.coin)}.` : `First top-up: up to ${cardMoney(FIRST_TOPUP_MAX, card.coin)}, to be sure it lands.`;
  const row = (t: string, d: string, onClick: () => void, v?: string) => (
    <button className="py-row py-pick" onClick={onClick}><span /><span><span className="t" style={{ display: "block" }}>{t}</span><span className="d" style={{ display: "block" }}>{d}</span></span><span className="v">{v ?? ""}</span></button>
  );
  return (
    <div className="py py-col">
      <div className="py-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="zf-label" style={{ color: "var(--ink)" }}>{p.name}</span><CardMark /></div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <span className="zf-body" style={{ color: "var(--ink)" }}>{balance ?? `Open ${p.name} to see the balance`}</span>
            <span className="zf-small">Your {p.name} card</span>
          </div>
        </div>
      </div>
      {editing ? (
        <>
          <div className="py-center" style={{ paddingTop: 18 }}>
            <div className="py-big">{cardMoney(amount, card.coin)}</div>
            {!card.confirmed && <p className="zf-small" style={{ marginTop: 6 }}>{firstLine}</p>}
          </div>
          <div className="zf-fill" />
          <Keypad value={amount} decimals={2} onChange={setAmount} />
          <div className="py-floor"><button className="zf-btn" disabled={!isPositive(amount)} onClick={() => setEditing(false)}>Done</button></div>
        </>
      ) : (
        <>
          <div className="py-rows" style={{ marginTop: 14 }}>
            {row(`Open ${p.name}`, "Your card, limits, PIN", () => onOpen(p.signupUrl))}
            {!stopped && row("Take money out", `Back to your Safe, from ${p.name}`, () => onWithdraw({ name: p.name, url: p.signupUrl, chain: p.chain, coin: card.coin, cardId: p.id }))}
            {p.endsOn && row("Move to another card", "Pick another one from the list", onMove)}
            {p.endsOn && <p className="zf-small" style={{ padding: "10px 0" }}>{stopped ? `${p.name}'s card stopped on ${endsWords(p, true)}. ${p.endsOn.withdraw}` : cardEndingSoon(p) ? `Your card stops on ${endsWords(p, true)}.` : `${p.name} cards stop working on ${endsWords(p)}. Your money stays in your ${p.name} account.`}</p>}
            {p.coins.length > 1 && row(`In ${cardCoinName(card.coin)}`, "What a top-up sends", () => setCoins(true), "Change")}
            {!stopped && row("Amount", card.confirmed ? "Starts at your last top-up" : p.handOff ? "A test first, until you say it arrived" : "Small until you say the first one arrived", () => setEditing(true), cardMoney(amount, card.coin))}
          </div>
          <div className="zf-fill" />
          <div className="py-floor">
            {stopped ? (
              <button className="zf-btn" onClick={() => onOpen(p.signupUrl)}>Open {p.name} to withdraw</button>
            ) : (
              <>
                <button className="zf-btn" disabled={!isPositive(amount)} onClick={topUp}>Top up {cardMoney(amount.replace(/\.$/, ""), card.coin)}</button>
                <p className="zf-small">{card.confirmed ? "You check it before it goes." : firstLine}</p>
              </>
            )}
            {/* One pill, Top up; changing or removing the card sits behind one quiet link (UI's closing check). */}
            <button className="zf-link" onClick={() => setManaging(true)}>Manage this card</button>
          </div>
        </>
      )}
      {managing && (
        <Sheet title={`Your ${p.name} card`} onClose={() => setManaging(false)}>
          <div className="py-rows">
            <button className="py-row py-pick" onClick={() => { setManaging(false); setProduct(p); setMode("address"); }}><span /><span className="t">Change its address</span><span /></button>
            <button className="py-row py-pick" onClick={() => { setManaging(false); setRemoving(true); }}><span /><span className="t">Remove this card</span><span /></button>
          </div>
        </Sheet>
      )}
      {removing && <RemoveSheet name={`your ${p.name} card`} line={`Pay forgets its address and what it sent there. Money already on the card stays with ${p.name}.`} onClose={() => setRemoving(false)} onRemove={async () => { setRemoving(false); await removeCard(bridge, card.productId); await forgetSent(bridge, card.productId); onRemoved?.(); }} />}
      {coins && (
        <Sheet title="Top up in" onClose={() => setCoins(false)}>
          <div className="py-rows">
            {p.coins.map((s) => (
              <button key={s} className="py-row py-pick" onClick={() => { void setCoin(s); setCoins(false); }}>
                <span className={`zf-tick ${card.coin === s ? "on" : ""}`}>{card.coin === s && <Check />}</span>
                <span className="t">{cardCoinName(s)}</span>
                <span />
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
