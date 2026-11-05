// Home (D29): one balance in the middle; under it a tile for every way to pay (Card, Bank). A tile with nothing set up
// yet IS the set-up: tapping it opens that partner's own page, no journey. Three recent payments. The tray is Send ·
// Receive · Scan.
import { useEffect, useState } from "react";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import type { Bridge } from "@zerofee/core/bridge";
import { useBalanceTotal } from "@zerofee/wallet/app/BalanceTotal.ts";
import type { Movement } from "@zerofee/wallet/types.ts";
import { chainName } from "../../chains.ts";
import { shortIban } from "../../codes/iban.ts";
import type { SavedBank } from "../../partners/banks.ts";
import { ACTIVITY, CARDS, type SavedCard } from "../../partners/cards.ts";
import { heldFor, loadSent, type Sent } from "../../receipts.ts";
import { loadLedgers } from "../../checkout.ts";
import { REGISTRY } from "../../registry.ts";
import { presetFor, type SavedExchange } from "../../partners/exchange.ts";
import { cardMoney, shown } from "../format.ts";
import { personOf, plainName, type RecentPerson } from "../recent.ts";
import { usePay } from "../runtime.tsx";

export type Tile = "card" | "bank" | "exchange";
/** The last total each bridge showed, painted at once when Home comes back. */
const lastTotals = new WeakMap<Bridge, string>();

function CardMarkIcon() {
  return <svg width="30" height="20" viewBox="0 0 30 20" aria-hidden="true" className="py-tile-mark"><circle cx="11" cy="10" r="8" /><circle cx="19" cy="10" r="8" /></svg>;
}
function ExchangeIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" className="py-tile-mark"><path d="M5 9h13l-3-3M19 15H6l3 3" /></svg>;
}
function BankIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" className="py-tile-mark"><path d="M4 10h16M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3.5 20h17M12 3.5 20 8H4z" /></svg>;
}

/** The card's own balance, read on its chain by the core (card.balance); null while unknown or unreadable. */
function useCardBalance(card: SavedCard | null): string | null {
  const { bridge } = usePay();
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    // A hand-off card's balance is in its own app (card.balance reads a Gnosis Pay Safe).
    if (!card || CARDS.find((c) => c.id === card.productId)?.handOff) return;
    let live = true;
    void bridge.call<{ amount: string; symbol: string }>("card.balance", { address: card.address }).then((r) => {
      if (live && "ok" in r) setLine(`${cardMoney(shown(r.ok.amount, 2), r.ok.symbol)} on your card`);
    });
    return () => {
      live = false;
    };
  }, [bridge, card]);
  return line;
}

/** `onPerson`: a send's row is the person; tapping it opens Send with them picked (the robot's pass 2). */
function Recent({ onPerson }: { onPerson: (p: RecentPerson) => void }) {
  const { bridge, flow, contacts } = usePay();
  const [rows, setRows] = useState<Movement[] | null>(null);
  useEffect(() => {
    let live = true;
    void bridge.call<Movement[]>("ledger.activity", {}).then((r) => live && setRows("ok" in r ? r.ok.slice(0, 5) : []));
    return () => {
      live = false;
    };
  }, [bridge]);
  if (!rows) return null;
  if (rows.length === 0) return <p className="zf-small" style={{ marginTop: 10 }}>Nothing yet. Receive from someone, or scan a code.</p>;
  return (
    <div className="py-rows">
      {rows.map((m) => {
        // The coin it moved: what left for a payment, what arrived for a deposit.
        const coin = [m.from, m.to].map((id) => (id ? flow.tokens?.byAsset(id)?.symbol : undefined)).find(Boolean) ?? "";
        const sign = m.kind === "deposit" ? "+" : "−";
        const when = new Date(m.startedAtIso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
        // A provider's row says what it was ("Card top-up · ether.fi"), never its address, and isn't a person to pay again.
        const provider = Object.values(ACTIVITY).some((k) => m.label?.startsWith(`${k} · `));
        const who = provider ? undefined : personOf(m, contacts?.list() ?? []);
        const r = who?.recipient;
        // An address says who, never its hex ("Sent · Someone on Base", as Send names it; the robot's pass 3): tapping it
        // still opens Send with that address, and the approval sheet shows it in full.
        const where = !r ? "" : r.kind === "address" ? ` · ${plainName(r)}` : ` · ${r.accountId}`;
        const inner = (
          <>
            <span />
            <div><div className="t">{who?.contactId ? who.name : m.label ?? (m.kind === "deposit" ? "Received" : "Sent")}</div><div className="d">{when}{m.status === "waiting" ? " · on hold" : m.status === "moving" ? " · on its way" : ""}{where}</div></div>
            <span className="v">{sign}{shown(m.amount, 2)} {coin}</span>
          </>
        );
        return who ? <button className="py-row py-row--tap" key={m.id} onClick={() => onPerson(who)} aria-label={`Send to ${who.name} again`}>{inner}</button> : <div className="py-row" key={m.id}>{inner}</div>;
      })}
    </div>
  );
}

/** `cardLive`: the card's address can be proven in this build (card.check); if not, no Card tile (D13). */
/** `onAdd` opens "What's available" for the person's bank country (D36). */
/** One card's tile: its balance where it can be read (card.balance), else what Pay sent it so far. */
function CardTile({ card, sent, state, onOpen }: { card: SavedCard; sent: string | null; state: string | null; onOpen: () => void }) {
  const line = useCardBalance(card);
  return (
    <button className="py-tile" onClick={onOpen}>
      <span className="py-tile-top"><span className="zf-label" style={{ color: "var(--ink)" }}>Card</span><CardMarkIcon /></span>
      <span className="py-tile-line">{CARDS.find((c) => c.id === card.productId)?.name ?? "Your card"}<br />{state ?? line ?? sent ?? "Open its app to see the balance"}</span>
    </button>
  );
}

/** A test that went out and waits for the person's answer, by provider: tapping its tile asks again. */
export interface Asking { kind: "card" | "voucher" | "exchange"; id: string; name: string; amount: string }

const ASK_LINE = "On its way · did it arrive?";
const HELD_LINE = "Waiting · on hold";

/** `cards`: several side by side (D38), one tile each; `onCard` opens that one. */
/**
 * `onAsk`: a tile whose test waits for "did it arrive?" (the robot's final round) reopens that question. `pending`: tests
 * just sent, shown at once (before Pay's own records catch up).
 */
export function Home({ cards, bank, exchange, vouchers, cardLive, onTile, onCard, onVoucher, onAdd, onPerson, onAsk, pending = [] }: { cards: SavedCard[]; bank: SavedBank | null; exchange: SavedExchange | null; vouchers: string[]; cardLive: boolean; onTile: (t: Tile) => void; onCard: (id: SavedCard["productId"]) => void; onVoucher: (id: string) => void; onAdd: () => void; onPerson: (p: RecentPerson) => void; onAsk: (a: Asking) => void; pending?: Asking[] }) {
  const { bridge, balances } = usePay();
  const { active } = useShell();
  const listed = balances.filter((b) => b.listed !== false);
  const coins = [...new Set(listed.map((b) => b.symbol))];
  // Wallet's own total (D12: one balance, the same figure in every app). What one payment can take is Send's to say
  // (one payment comes from one place), never a second total here. Back on Home, the last figure paints at once and the
  // fresh read replaces it: never "$0.00", never a roll up from zero (the product rule; the robot's pass 5).
  const fresh = useBalanceTotal(bridge, active);
  useEffect(() => {
    if (fresh !== null) lastTotals.set(bridge, fresh);
  }, [bridge, fresh]);
  const total = fresh ?? lastTotals.get(bridge) ?? null;
  // Pay's own receipts (D38): where a provider's balance can't be read, what this phone sent it so far.
  const [sent, setSent] = useState<Sent>({});
  useEffect(() => {
    let live = true;
    void loadSent(bridge).then((s) => live && setSent(s));
    return () => {
      live = false;
    };
  }, [bridge, cards, exchange]);
  // Until answered, a test's tile says so, and one on hold says it's waiting (D17): never a plain "Sent so far".
  const [held, setHeld] = useState<Set<string>>(new Set());
  const [shops, setShops] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    void Promise.all([heldFor(bridge), loadLedgers(bridge)]).then(([h, ledgers]) => {
      if (!live) return;
      setHeld(h);
      setShops(Object.fromEntries(Object.entries(ledgers).filter(([, l]) => !l.confirmed && l.buys.length > 0).map(([id, l]) => [id, l.buys.at(-1)!.amount])));
    });
    return () => {
      live = false;
    };
  }, [bridge, cards, exchange, vouchers]);
  // Amounts as the question says them right after a send ("5.00 USDC"): one format (the robot's pass 3).
  const said = (amount: string, coin: string) => `${shown(amount, 2)} ${coin}`;
  const waiting = (id: string) => pending.find((a) => a.id === id) ?? null;
  const cardAsk = (c: SavedCard): Asking | null => (c.confirmed ? null : waiting(c.productId) ?? (c.lastAmount ? { kind: "card", id: c.productId, name: CARDS.find((p) => p.id === c.productId)?.name ?? "your card", amount: said(c.lastAmount, c.coin) } : null));
  const exchangeAsk: Asking | null = !exchange || exchange.confirmed ? null : waiting(exchange.preset ?? "exchange") ?? (exchange.tested ? { kind: "exchange", id: exchange.preset ?? "exchange", name: exchange.name, amount: said(exchange.tested, "USDC") } : null);
  const shopAsk = (id: string): Asking | null => waiting(id) ?? (shops[id] ? { kind: "voucher", id, name: REGISTRY.find((r) => r.id === id)?.name ?? id, amount: said(shops[id], "USDC") } : null);
  const stateOf = (id: string, ask: Asking | null) => (held.has(id) ? HELD_LINE : ask ? ASK_LINE : null);
  const sentLine = (id: string) => {
    const coins = Object.entries(sent[id] ?? {});
    return coins.length ? `Sent so far: ${coins.map(([coin, amount]) => cardMoney(shown(amount, 2), coin)).join(" + ")}` : null;
  };
  return (
    <div className="py py-col">
      <div className="py-center" style={{ paddingTop: 18 }}>
        <div className="zf-label">Your Safe</div>
        <div className="py-big" style={{ marginTop: 10, minHeight: "1.1em" }}>{total !== null ? `$${shown(total, 2)}` : ""}</div>
        <p className="zf-small" style={{ marginTop: 6 }}>
          {coins.length === 0 ? "Receive or add money to start" : `${coins.slice(0, 2).join(", ")}${coins.length > 2 ? ` and ${coins.length - 2} more` : ""} · one total`}
        </p>
      </div>
      {/* Home is what's set up (the gate, D38: no Home before a provider); more come from "Add another". */}
      {(cards.length > 0 || bank || exchange || vouchers.length > 0) && (
        <div className="py-tiles">
          {cardLive && cards.map((c) => {
            const ask = cardAsk(c);
            return <CardTile key={c.productId} card={c} sent={sentLine(c.productId)} state={stateOf(c.productId, ask)} onOpen={() => (ask && !held.has(c.productId) ? onAsk(ask) : onCard(c.productId))} />;
          })}
          {bank && <button className="py-tile" onClick={() => onTile("bank")}>
            <span className="py-tile-top"><span className="zf-label" style={{ color: "var(--ink)" }}>Bank</span><BankIcon /></span>
            <span className="py-tile-line">Mt Pelerin<br /><span className="py-mono">{shortIban(bank.iban)}</span></span>
          </button>}
          {/* Your own exchange account: for bank codes Pay can't pay, it sells into your own bank (the product choice). */}
          {exchange && <button className="py-tile" onClick={() => (exchangeAsk && !held.has(exchangeAsk.id) ? onAsk(exchangeAsk) : onTile("exchange"))}>
            <span className="py-tile-top"><span className="zf-label" style={{ color: "var(--ink)" }}>Exchange</span><ExchangeIcon /></span>
            <span className="py-tile-line">{presetFor(exchange.preset)?.label ?? exchange.name}<br />{stateOf(exchange.preset ?? "exchange", exchangeAsk) ?? sentLine(exchange.preset ?? "exchange") ?? `USDC on ${chainName(exchange.chain)}`}</span>
          </button>}
          {vouchers.map((id) => (
            <button key={id} className="py-tile" onClick={() => { const ask = shopAsk(id); if (ask && !held.has(id)) onAsk(ask); else onVoucher(id); }}>
              <span className="py-tile-top"><span className="zf-label" style={{ color: "var(--ink)" }}>Gift cards</span></span>
              <span className="py-tile-line">{REGISTRY.find((r) => r.id === id)?.name ?? id}<br />{stateOf(id, shopAsk(id)) ?? sentLine(id) ?? ""}</span>
            </button>
          ))}
        </div>
      )}
      {/* Always one row to add more (D38), one fixed label (the robot's walk); it reads nothing (D33) and opens "What's
          available" for the person's bank country (D36). Home names no company there (Security's review). */}
      <button className="py-row py-row--tap" style={{ marginTop: 14, borderTop: "1px solid var(--line)" }} onClick={onAdd}>
        <span />
        <div><div className="t">{cardLive ? "Add a card, bank or exchange" : "Add a bank or exchange"}</div><div className="d">Cards, bank accounts, exchanges and gift cards from other companies</div></div>
        <span className="v">›</span>
      </button>
      <div className="zf-label" style={{ marginTop: 24 }}>Recent</div>
      <Recent onPerson={onPerson} />
    </div>
  );
}
