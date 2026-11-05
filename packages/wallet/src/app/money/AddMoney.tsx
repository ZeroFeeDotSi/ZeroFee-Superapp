// Another app's Add money on a network (a link: Pay's Receive, a site's network), in place over Home: loaded with its
// first ask by the money host (MoneyHost.tsx AddMoneyLater), never in Home's first load (the speed budget). Moved from
// MoneyHost.tsx as it was.
import { Suspense, lazy, useEffect, useState } from "react";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { SheetLine } from "@zerofee/design/MoneySheet.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { BACKOFF_MS, SHEET_NEEDS, sheetLineOf, useServices } from "../services.ts";
import { receiveChainFor } from "../format.ts";
import { useWallet } from "../runtime.tsx";
import { ChainSheet } from "../screens/Sheets.tsx";
import { Waiting } from "../Waiting.tsx";

// Receive (another network's address) loads when opened.
const Receive = lazy(() => import("../screens/Receive.tsx").then((m) => ({ default: m.Receive }), () => ({ default: () => <p className="zf-small" role="status">Receive didn't load. Close it and open it again.</p> })));

/** Add money to the Safe, in place: the address on the network asked for (another app's coin), NEAR otherwise. A service
 *  that fails (B28: NEAR Intents' bridge for another chain's address) is one line here, read again by itself with
 *  backoff; "Change network" stays, and NEAR's own address never needs the bridge. */
export function AddMoney({ link, onClose }: { link?: string; onClose: () => void }) {
  const shell = useShell();
  const { bridge, chains, tokens } = useWallet();
  const [chainId, setChainId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (chainId || chains.length === 0) return;
    setChainId(receiveChainFor(link, chains, tokens) ?? chains.find((c) => c.id === "near")?.id ?? chains[0]!.id);
  }, [chains, tokens, link]);
  useEffect(() => {
    setLine(null);
    setTries(0);
  }, [chainId]);
  const chain = chains.find((c) => c.id === chainId);
  const services = useServices(bridge, chain && chain.id !== "near" ? SHEET_NEEDS.addOtherChain : SHEET_NEEDS.add, "Add");
  useEffect(() => {
    if (!line) return;
    const t = setTimeout(() => setTries((n) => n + 1), BACKOFF_MS[Math.min(tries, BACKOFF_MS.length - 1)]);
    return () => clearTimeout(t);
  }, [line, tries]);
  const problem = (p: Parameters<typeof sheetLineOf>[0]) => {
    const said = sheetLineOf(p);
    if (said) return setLine(said);
    void shell.showProblem(p).then(onClose);
  };
  return (
    <>
      <Sheet title="Add money" onClose={onClose}>
        <SheetLine text={line ?? services.line} />
        {chain ? <Suspense fallback={<Waiting size={44} text="Opening…" />}><Receive key={`${chain.id}:${tries}`} bridge={bridge} tokens={tokens} chain={chain} chains={chains} onChange={() => setPicking(true)} onProblem={problem} onAddress={() => setLine(null)} /></Suspense> : <Waiting text="Reading the networks…" />}
      </Sheet>
      {picking && chain && <ChainSheet chains={chains} current={chain.id} onPick={(c) => { setChainId(c.id); setPicking(false); void bridge.call("ledger.receiveChain", { chain: c.id }); }} onClose={() => setPicking(false)} />}
    </>
  );
}

