// Sending the chain's coin from another wallet straight to its trading wallet (SOL on Solana, ETH on Robinhood Chain): the
// full address, a small QR code, what to send, and the one pill, copy. The trading wallet is made here if there isn't one
// yet (the person asked for its address).
import { useEffect, useState } from "react";
import { Mark } from "@zerofee/design/Mark.tsx";
import { QrCode } from "@zerofee/design/QrCode.tsx";
import { ProblemError, type NextStep, type Problem } from "@zerofee/core/problem";
import { CHAINS } from "../../service.ts";
import type { ChainId } from "../../types.ts";
import { useTrade } from "../runtime.tsx";

export function Receive({ chain, onDone, onProblem }: { chain: ChainId; onDone: () => void; onProblem: (p: Problem) => Promise<NextStep> }) {
  const { svc } = useTrade();
  const [address, setAddress] = useState<string>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    svc.address(chain).then((a) => { if (live) setAddress(a); }, (e) => { if (live && e instanceof ProblemError) void onProblem(e.problem).then(onDone); });
    return () => { live = false; };
  }, [svc, chain]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = () => { if (address) void navigator.clipboard?.writeText(address).then(() => setCopied(true), () => undefined); };

  if (!address) return <div className="tr-center tr-tall"><Mark size={56} mode="loading" /></div>;
  const c = CHAINS[chain];
  // the web demo's address fails its chain's own check (MockBridge SAMPLE_SOL, SAMPLE_EVM), so a copy or a scan of it
  // can't send anything anywhere
  return (
    <div className="tr-receive zf-enter">
      <div className="zf-label">Your Spending wallet on {c.name}</div>
      <p className="tr-addr">{address}</p>
      <div className="tr-qr"><QrCode value={address} size={140} label={`The address of your ${c.symbol} wallet on ${c.name}`} /></div>
      <p className="zf-small tr-receive-note">Send only {c.symbol}, only on {c.name}.</p>
      {chain !== "sol" && <p className="zf-small tr-receive-note">{c.symbol} sent on Ethereum or any other network won't show up here.</p>}
      <div className="tr-floor">
        <button className="zf-btn" onClick={copy}>{copied ? "Copied" : "Copy the address"}</button>
        <button className="zf-link" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}
