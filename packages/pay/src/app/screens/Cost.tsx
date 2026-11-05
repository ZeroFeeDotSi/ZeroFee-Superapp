// "Before you start" (D37 step 3): what it costs and how long, before the provider's own page opens. The provider's
// own published costs, and Pay's part said plainly: a small network fee the approval sheet shows exactly before Face ID.
// The person is the provider's own customer; ZeroFee only opens its page and sends their money (the product principle).
// Three lines before the pill (what it is, its costs, whose customer); the rest behind "What X says" (the robot's walk).
import { useEffect, useState } from "react";
import { providerLine } from "@zerofee/shell-api/provider-words.ts";
import type { Provider } from "../../countries.ts";
import { CARDS, coinToken } from "../../partners/cards.ts";
import { ESTIMATE_AMOUNT, estimateWords } from "../format.ts";
import { usePay } from "../runtime.tsx";
import { WhatItSays, costsLine } from "./ProviderFacts.tsx";

export function Cost({ provider, onStart }: { provider: Provider; onStart: () => void }) {
  const { flow } = usePay();
  // Pay's own move, priced now from a live quote (UI's gap list); nothing until it comes, never a guess.
  const [ours, setOurs] = useState<string | null>(null);
  useEffect(() => {
    const coin = provider.funding.coins[0];
    if (!provider.fundable || !coin || !flow.tokens) return;
    const product = provider.card ? CARDS.find((c) => c.id === provider.card) : undefined;
    const token = product ? coinToken(product, coin.coin, flow.tokens) : flow.tokens.find(coin.networks[0], { symbol: coin.coin });
    if (!token) return;
    let live = true;
    void flow.estimate(token, ESTIMATE_AMOUNT).then((e) => live && e && setOurs(estimateWords(e)));
    return () => {
      live = false;
    };
  }, [flow, flow.tokens, provider.id]);
  const sending = provider.fundable
    ? "Sending money there: you see its exact cost before you say yes."
    : "Its own page doesn't say which coin and network it takes, so ZeroFee only opens its page.";
  return (
    <div className="py py-col">
      <h1 className="zf-title py-center" style={{ marginTop: 24 }}>Before you start</h1>
      {/* Exactly three lines before the pill (the robot's final round): what it is with its domain, its costs, whose customer. */}
      <p className="zf-body py-center" style={{ marginTop: 8 }}>
        {provider.line.includes(provider.name) ? provider.line : `${provider.name}: ${provider.line}`}
        <br />
        <span className="zf-small py-mono">{provider.domain}</span>
      </p>
      <p className="zf-small" style={{ marginTop: 18 }}>{costsLine(provider)}{ours ? ` ${ours}` : ""}</p>
      <p className="zf-small" style={{ marginTop: 8 }}>{providerLine(provider.name)}</p>
      <WhatItSays provider={provider} name={provider.name} extra={[sending]} />
      <div className="zf-fill" />
      <div className="py-floor">
        {/* A provider Pay only opens says so on its pill (robot pass 4): no "Start" that leads back to the list. */}
        <button className="zf-btn" onClick={onStart}>{provider.signup === "app" || !provider.fundable ? `Open ${provider.name}` : "Start"}</button>
        {provider.signup === "app" ? <p className="zf-small">It's made in {provider.name}'s own app.</p> : !provider.fundable && <p className="zf-small">You set it up on its own page. ZeroFee only opens it.</p>}
      </div>
    </div>
  );
}
