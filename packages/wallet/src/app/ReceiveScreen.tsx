// Wallet's one Receive screen, for another app to show in place (D29: Pay's tray is Send · Receive · Scan). It needs only
// that app's own bridge: the networks, the coin list and the address come from Wallet's ledger, and it opens on the
// network the person last picked in any app's Receive (ledger.receiveChain). "Ask for an amount" is the caller's own
// screen (Pay's Request). Every Problem goes to the caller, which shows it on the shell's Problem screen.
//
//   <ReceiveScreen bridge={bridge} onAskAmount={() => setView({ kind: "request" })} onProblem={(p) => void problem(p)} title="Receive" />
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { Waiting } from "./Waiting.tsx";
import type { Chain, Token } from "../types.ts";
import { Receive } from "./screens/Receive.tsx";
import { ChainSheet } from "./screens/Sheets.tsx";
import { receiveChains } from "./money/add-coins.ts";
import "./wallet.css";

export function ReceiveScreen({ bridge, onAskAmount, onProblem, chain: asked, title, amount, coin }: {
  bridge: Bridge;
  onAskAmount: () => void;
  onProblem: (p: Problem) => void;
  /** The screen's verb, "Receive" → "Receive on NEAR"; "Add money" when not given. */
  title?: string;
  /**
   * An amount to ask for (a decimal) in `coin` (an asset id the network takes, e.g. USDC on Base): "Asking for 2.00 USDC",
   * at least the bridge's minimum, and in the QR where the network has a standard (EIP-681, Solana Pay).
   */
  amount?: string;
  coin?: string;
  /** A network to open on this time (a coin's own, say), over the one remembered. */
  chain?: string;
}) {
  const [chains, setChains] = useState<Chain[]>([]);
  const [tokens, setTokens] = useState<Map<string, Token>>(new Map());
  const [chainId, setChainId] = useState<string | null>(asked ?? null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let live = true;
    void bridge.call<Chain[]>("ledger.chains").then((r) => {
      if (!live) return;
      // D115: our trading chains only (NEAR, Solana, Robinhood Chain) while Add's switch is off
      if ("ok" in r) setChains(receiveChains(r.ok));
      else onProblem(r.problem);
    });
    void bridge.call<Token[]>("ledger.tokens").then((r) => live && "ok" in r && setTokens(new Map(r.ok.map((t) => [t.assetId, t]))));
    // The remembered network, unless one was asked for (whichever answer comes first).
    void bridge.call<{ chain: string | null }>("ledger.receiveChain").then((r) => live && "ok" in r && r.ok.chain && setChainId((c) => c ?? r.ok.chain));
    return () => {
      live = false;
    };
  }, [bridge]);
  useEffect(() => {
    if (asked) setChainId(asked);
  }, [asked]);

  const pick = (c: Chain) => {
    setChainId(c.id);
    setPicking(false);
    void bridge.call("ledger.receiveChain", { chain: c.id });
  };
  const chain = chains.find((c) => c.id === chainId) ?? chains[0];
  if (!chain) return <Waiting size={44} text="Reading the networks…" />;
  return (
    <>
      <Receive bridge={bridge} tokens={tokens} chain={chain} chains={chains} onChange={() => setPicking(true)} onProblem={onProblem} onAskAmount={onAskAmount} title={title} ask={amount && coin ? { amount, coin } : undefined} coin={coin} />
      {picking && <ChainSheet chains={chains} current={chain.id} onPick={pick} onClose={() => setPicking(false)} />}
    </>
  );
}
