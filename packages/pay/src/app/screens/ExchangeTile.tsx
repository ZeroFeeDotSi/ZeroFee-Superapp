// "Your exchange" tile's page (D29): your own account at an exchange. Not set up: its name and the USDC deposit
// address you copied there (the network read from the address; its memo if the network needs one), saved once. Set up: one pill sends
// USDC there at your last amount; the exchange sells it into your own bank, and you pay the bank code from your bank app.
import { useEffect, useRef, useState } from "react";
import type { Problem } from "@zerofee/core/problem";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { isPositive } from "@zerofee/design/keypad.ts";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { chain as chainInfo, chainsForAddress, shortAddress, chainName } from "../../chains.ts";
import { EXCHANGE_PRESETS, FIRST_SEND_MAX, exchangeNetworks, keepTest, presetFor, removeExchange, saveExchange, testLeft, type ExchangePreset, type SavedExchange } from "../../partners/exchange.ts";
import { payProblems } from "../../pay-problems.ts";
import { usePay } from "../runtime.tsx";
import { Address } from "./Address.tsx";
import { forgetSent } from "../../receipts.ts";
import { PasteField, usePaste } from "./PasteField.tsx";
import { ProviderFacts } from "./ProviderFacts.tsx";
import { RemoveSheet } from "./RemoveSheet.tsx";

const SELLS = "Your exchange sells it into your own bank account. Then pay the bank code from your bank app.";

interface Props {
  exchange: SavedExchange | null;
  onExchange: (e: SavedExchange | null) => void;
  onSend: (e: SavedExchange, amount: string) => void;
  onOpen: (url: string) => void;
  onProblem: (p: Problem) => void;
  /** Opened for one exchange from "What's available" (D36): its name is already there. */
  start?: ExchangePreset["id"];
  /** The country's exchanges, for the one-tap names. */
  only?: readonly string[];
  /** Money back (D38): Pay's Receive on its network, with its own page one tap away. */
  onWithdraw: (from: { name: string; url: string; chain: string; coin: string }) => void;
  /** A test send went out and the person hasn't said whether it arrived: ask again. */
  onAsk: (e: SavedExchange) => void;
  /** A Problem's "Copy it again": the address field comes back empty. */
  fix?: { field: string; n: number };
}

export function ExchangeTile({ exchange, onExchange, onSend, onOpen, onProblem, start, only, onWithdraw, onAsk, fix }: Props) {
  const { bridge, flow } = usePay();
  const [name, setName] = useState(exchange?.name ?? presetFor(start)?.name ?? "");
  // The product presets (PEXX) by their name: its words, its page, its own networks. A preset is never a recipe.
  const preset = EXCHANGE_PRESETS.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  // One-tap names: the exchanges for the person's country (D36), else the product PEXX.
  const chips = (only ?? ["pexx"]).map((id) => presetFor(id as ExchangePreset["id"])).filter((p): p is ExchangePreset => Boolean(p));
  const networks = flow.tokens ? exchangeNetworks(flow.tokens, preset?.id) : [];
  const [address, setAddress] = useState(exchange?.address ?? "");
  const { paste, none } = usePaste(setAddress);
  const [memo, setMemo] = useState(exchange?.memo ?? "");
  const [chosen, setChosen] = useState<string | undefined>(exchange?.chain);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(!exchange);
  const [amount, setAmount] = useState(exchange?.lastAmount ?? "0");
  const [typingAmount, setTypingAmount] = useState(false);
  const [removing, setRemoving] = useState(false);
  /** Its page opened (or the person has an account already): the pill pastes. */
  const [opened, setOpened] = useState(Boolean(exchange));
  useEffect(() => bridge.on("device.returned", () => setOpened(true)), [bridge]);
  useEffect(() => {
    if (fix?.field === "exchange-address" && fix.n > 0) setAddress("");
  }, [fix?.n]);
  // The network comes from the address's own shape (Solana, NEAR, Tron …); only a 0x address, the same on every EVM
  // network, needs the person to say which (the robot's pass 3: Change only when the address can't tell).
  const read = address.trim() ? chainsForAddress(address.trim()).filter((id) => networks.includes(id)) : [];
  const net = read.length === 1 ? read[0] : chosen && read.includes(chosen) ? chosen : read[0];
  const info = net ? chainInfo(net) : undefined;
  // A good address names the exchange by its network ("Exchange on Solana"), so Save is live at once; the person's
  // own name, or PEXX, stays as typed (the robot's pass 5).
  const autoName = useRef<string | null>(null);
  useEffect(() => {
    const auto = info ? `Exchange on ${info.name}` : "";
    if (!name.trim() || name === autoName.current) setName(auto);
    autoName.current = auto || null;
  }, [info?.name]);
  const [why, setWhy] = useState<string | null>(null);

  const save = async () => {
    if (!net) return;
    const typed: SavedExchange = { name: preset?.name ?? name.trim(), ...(preset ? { preset: preset.id } : {}), chain: net, address: address.trim(), ...(memo.trim() ? { memo } : {}), ...(exchange?.lastAmount ? { lastAmount: exchange.lastAmount } : {}) };
    // The same account keeps its test and its answer; a new address or memo starts a new test (keepTest).
    const e = keepTest(exchange, typed);
    const problem = await saveExchange(bridge, e);
    if (problem) return onProblem(problem);
    onExchange(e);
    setEditing(false);
  };

  if (editing || !exchange) {
    return (
      <div className="py py-col">
        <h1 className="zf-title py-center" style={{ marginTop: 24 }}>Your exchange</h1>
        <p className="zf-body py-center" style={{ marginTop: 8 }}>{preset ? preset.how : "In your exchange: Deposit, USDC. Copy the address it shows."}</p>
        <label className="py-field" style={{ marginTop: 18 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Its name" aria-label="Your exchange's name" />
          {/* Each says what it is before the tap (PEXX: where it's registered, its own site). */}
          {(!name || name === autoName.current) && chips.map((p) => <button key={p.id} type="button" className="py-change" onClick={() => setName(p.name)}>{p.chip}</button>)}
        </label>
        {preset && <div className="py-row" style={{ marginTop: 6 }}><span /><div><div className="t">{preset.label}</div><div className="d">{preset.signup === "web" ? "You sign up on its page yourself." : "You sign up in its app yourself."}</div></div><span /></div>}
        <ProviderFacts id={preset?.id} name={preset?.name ?? "your exchange"} />
        <PasteField value={address} onChange={setAddress} none={none} label="The address your exchange shows" placeholder="Paste the address it shows" />
        {read.length === 1 && info && <p className="zf-small" style={{ marginTop: 8 }}>USDC on {info.name}: read from the address.</p>}
        {read.length > 1 && info && (
          <button className="py-row py-pick" style={{ marginTop: 10 }} onClick={() => setPicking(true)}>
            <CoinIcon symbol={info.name} icon={net!} size={24} />
            <span><span className="t" style={{ display: "block" }}>USDC on {info.name}</span><span className="d" style={{ display: "block" }}>This address works on several networks: pick the one your exchange shows.</span></span>
            <span className="v">Change</span>
          </button>
        )}
        {address.trim().length > 10 && read.length > 0 && <div style={{ marginTop: 8 }}><Address value={address.trim()} /><p className="zf-small" style={{ marginTop: 6 }}>Check the start and end match what your exchange shows.</p></div>}
        {info?.memo && <label className="py-field"><input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={info.memo === "tag" ? "Its tag" : "Its memo"} aria-label="Your exchange's memo" /></label>}
        <div className="zf-fill" />
        <div className="py-floor">
          {/* No address yet: the pill pastes it (the read happens on this tap only, D33). Then Save, grey until it can,
              and a tap on it still says what's missing, in one line. */}
          {why && address.trim() && <p className="zf-small" role="status">{why}</p>}
          {/* Like the card (robot pass 4): its own page first, then the paste; a bad address is a Problem screen. */}
          {!address.trim() && preset && !opened ? (
            <button className="zf-btn" onClick={() => { onOpen(preset.site); setOpened(true); }}>Open {preset.name}</button>
          ) : !address.trim() ? (
            <button className="zf-btn" onClick={() => void paste()}>Paste the address you copied</button>
          ) : (
            <button
              className="zf-btn"
              onClick={() => {
                if (!net) return onProblem(payProblems.exchangeAddressWrong(preset?.name ?? (name.trim() || "your exchange")));
                if (!name.trim()) return setWhy("Give your exchange a name first.");
                setWhy(null);
                void save();
              }}
            >
              Save my exchange
            </button>
          )}
          {!address.trim() && preset && !opened && <button className="zf-link" onClick={() => setOpened(true)}>I already have one</button>}
          {exchange && <button className="zf-link" onClick={() => setEditing(false)}>Cancel</button>}
        </div>
        {picking && (
          <Sheet title="Which network?" onClose={() => setPicking(false)}>
            <p className="zf-small" style={{ marginBottom: 8 }}>The one your exchange shows next to the address. Sending on another can lose the money.</p>
            <div className="py-rows">
              {read.map((id) => (
                <button key={id} className="py-row py-pick" onClick={() => { setChosen(id); setPicking(false); }}>
                  <CoinIcon symbol={chainName(id)} icon={id} size={24} />
                  <span className="t">{chainName(id)}</span>
                  <span />
                </button>
              ))}
            </div>
          </Sheet>
        )}
      </div>
    );
  }

  return (
    <div className="py py-col">
      <div className="py-card" style={{ gap: 12 }}>
        <span className="zf-label" style={{ color: "var(--ink)" }}>{presetFor(exchange.preset)?.label ?? exchange.name}</span>
        <div>
          <div className="zf-small">Your USDC address on {chainName(exchange.chain)}</div>
          <div className="py-mono" style={{ marginTop: 4 }}>{shortAddress(exchange.address)}{exchange.memo ? ` · memo ${exchange.memo}` : ""}</div>
        </div>
      </div>
      {typingAmount ? (
        <>
          <div className="py-center" style={{ paddingTop: 18 }}><div className="py-big">{amount} <small>USDC</small></div></div>
          <div className="zf-fill" />
          <Keypad value={amount} decimals={2} onChange={setAmount} />
          <div className="py-floor"><button className="zf-btn" disabled={!isPositive(amount)} onClick={() => setTypingAmount(false)}>Done</button></div>
        </>
      ) : (
        <>
          <div className="py-rows" style={{ marginTop: 14 }}>
            <button className="py-row py-pick" onClick={() => setTypingAmount(true)}><span /><span><span className="t" style={{ display: "block" }}>Amount</span><span className="d" style={{ display: "block" }}>{exchange.lastAmount ? "Starts at your last send" : "How much to send"}</span></span><span className="v">{amount} USDC</span></button>
            <button className="py-row py-pick" onClick={() => onWithdraw({ name: exchange.name, url: presetFor(exchange.preset)?.site ?? "", chain: exchange.chain, coin: "USDC" })}><span /><span><span className="t" style={{ display: "block" }}>Take money out</span><span className="d" style={{ display: "block" }}>Back to your Safe, from {exchange.name}</span></span><span /></button>
            {!exchange.confirmed && exchange.tested && <button className="py-row py-pick" onClick={() => onAsk(exchange)}><span /><span><span className="t" style={{ display: "block" }}>Did your test send arrive?</span><span className="d" style={{ display: "block" }}>Say so here, and Pay sends more than ${FIRST_SEND_MAX} there</span></span><span /></button>}
            <button className="py-row py-pick" onClick={() => setEditing(true)}><span /><span><span className="t" style={{ display: "block" }}>Change details</span><span className="d" style={{ display: "block" }}>Name, network, address</span></span><span /></button>
          </div>
          <p className="zf-small" style={{ marginTop: 12 }}>{presetFor(exchange.preset)?.after ?? SELLS}</p>
          <div className="zf-fill" />
          <div className="py-floor">
            {/* No amount yet: the pill asks for one, never "Send 0 USDC" (UI's closing check). */}
            {isPositive(amount)
              ? <button className="zf-btn" onClick={() => onSend(exchange, amount.replace(/\.$/, ""))}>Send {amount.replace(/\.$/, "")} USDC to {exchange.preset ? exchange.name : "my exchange"}</button>
              : <button className="zf-btn" onClick={() => setTypingAmount(true)}>Choose an amount</button>}
            {/* A new address is a test, up to $25 in total, until the person says a send arrived (the shop's words). */}
            <p className="zf-small">{testLeft(exchange) === null ? "You see the full address before it goes." : testLeft(exchange) === FIRST_SEND_MAX ? `Your first send to ${exchange.name}: a test, up to $${FIRST_SEND_MAX}.` : `Your test sends to ${exchange.name}: $${testLeft(exchange)} left, until you say one arrived.`}</p>
            <button className="zf-link" onClick={() => setRemoving(true)}>Remove this exchange</button>
          </div>
          {removing && <RemoveSheet name={exchange.name} line={`Pay forgets its address and what it sent there. Money already there stays with ${exchange.name}.`} onClose={() => setRemoving(false)} onRemove={async () => { setRemoving(false); await removeExchange(bridge); await forgetSent(bridge, exchange.preset ?? "exchange"); onExchange(null); }} />}
        </>
      )}
    </div>
  );
}
