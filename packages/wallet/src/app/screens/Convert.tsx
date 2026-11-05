// Convert: a coin you hold into another, through 1Click. Pick both coins, type the amount on the shared Keypad, see what
// you get and the least 1Click promises, then one pill. Prices are dry quotes (nothing signed) until the pill; the ledger
// then takes a real quote and refuses one that promises less than what was shown. On the tray only once a route is open
// (CONVERT_ROUTES, after the test dust proof; D13).
import { useEffect, useState } from "react";
import type { Problem } from "@zerofee/core/problem";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { isPositive } from "@zerofee/design/keypad.ts";
import type { Balance, Movement, Quote, Token } from "../../types.ts";
import { amountOf, chainName, coins, placeOf } from "../format.ts";
import { Down } from "../icons.tsx";
import { useWallet } from "../runtime.tsx";

const SWAP = "M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5";

export function Convert({ from, to, onPickFrom, onPickTo, onDone, onProblem, onHeld }: {
  from: Balance | null;
  to: Token | null;
  onPickFrom: () => void;
  onPickTo: () => void;
  onDone: (m: Movement) => void;
  onProblem: (p: Problem) => void;
  onHeld: (held: NonNullable<Movement["held"]>) => void;
}) {
  const { bridge, chains, tokens } = useWallet();
  const [amount, setAmount] = useState("0");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fromSymbol = from?.symbol ?? "";
  const decimals = Math.min(6, from?.tokenId === "near" ? 24 : tokens.get(from?.tokenId ?? "")?.decimals ?? 6);

  useEffect(() => {
    setQuote(null);
    setWhy(null);
    if (!from || !to || !isPositive(amount)) return;
    let live = true;
    const t = setTimeout(() => {
      void bridge.call<Quote>("ledger.quoteConvert", { from: from.tokenId, to: to.assetId, amount }).then((r) => {
        if (!live) return;
        if ("ok" in r) setQuote(r.ok);
        else setWhy(r.problem.whatHappened);
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [bridge, from?.tokenId, to?.assetId, amount]);

  const go = async () => {
    if (!quote || busy) return;
    setBusy(true);
    const r = await bridge.call<Movement>("ledger.convert", { quoteId: quote.id });
    setBusy(false);
    if ("problem" in r) return onProblem(r.problem);
    if (r.ok.status === "waiting" && r.ok.held) return onHeld(r.ok.held);
    setAmount("0");
    onDone(r.ok);
  };

  return (
    <div className="wl wl-convert">
      <button className="wl-chain" onClick={onPickFrom}>
        {from ? <CoinIcon symbol={from.symbol} icon={from.icon} size={24} /> : null}
        <span>{from ? `${from.symbol}` : "Choose a coin"}</span>
        {from && <span className="zf-small wl-place">{placeOf(from, chains)}</span>}
        <span className="wl-change">{from ? amountOf(from.amount, from.symbol) : ""} <Down /></span>
      </button>
      <div className="wl-swap" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24"><path className="zf-hl" d={SWAP} /></svg></div>
      <button className="wl-chain" onClick={onPickTo}>
        {to ? <CoinIcon symbol={to.symbol} icon={to.icon} size={24} /> : null}
        <span>{to ? to.symbol : "Into which coin?"}</span>
        {to && <span className="zf-small wl-place">{chainName(chains, to.chain)}</span>}
        <span className="wl-change"><Down /></span>
      </button>

      <div className="wl-amount">
        <p className="wl-big">{coins(amount, decimals)} <small>{fromSymbol}</small></p>
        <p className="zf-small" aria-live="polite">
          {quote && to ? `You get about ${amountOf(quote.amountOut, to.symbol)} ${to.symbol} · at least ${amountOf(quote.minOut, to.symbol)}` : why ?? (isPositive(amount) && to ? "Getting a price…" : " ")}
        </p>
      </div>
      <Keypad value={amount} decimals={decimals} onChange={setAmount} />
      <div className="zf-floor">
        <button className="zf-btn" disabled={!quote || busy} onClick={() => void go()}>{busy ? "Converting…" : `Convert ${coins(amount, decimals)} ${fromSymbol}`.trim()}</button>
        {quote && <p className="zf-small">{quote.feeNote}</p>}
      </div>
    </div>
  );
}
