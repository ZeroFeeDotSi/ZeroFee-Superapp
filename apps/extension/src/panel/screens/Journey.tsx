// The first-run journey's screens (D21, the board UI approved): Welcome, 1 of 3 the trading wallet, 2 of 3 trading money,
// 3 of 3 linking the phone, You're set. One pill per screen. Nothing to sign up for: market data and the pools need no
// account, so there is no partner page. A person without a ZeroFee phone trades after two steps; the phone comes last.
import { useState, type FormEvent } from "react";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Back } from "@zerofee/design/icons.tsx";
import { Mark } from "@zerofee/design/Mark.tsx";
import type { Problem } from "@zerofee/core/problem";
import { amount, usd } from "@zerofee/trade/app/format.ts";
import { CHAINS } from "@zerofee/trade/service.ts";
import { MIN_PASSCODE } from "../../vault/seal.ts";
import { ask, useLive, usePanel } from "../runtime.tsx";
import type { SetupStep } from "../setup.ts";
import { AddMoney, Link, Passcode } from "./Access.tsx";

type OnProblem = (p: Problem) => void;

export function Journey({ step, sol, limitUsd, linked, onStep, onMade, onLinked, onProblem }: {
  step: Exclude<SetupStep, "done">; sol?: string; limitUsd: number; linked: boolean;
  onStep: (s: SetupStep) => void; onMade: () => void; onLinked: () => void; onProblem: OnProblem;
}) {
  const [adding, setAdding] = useState(false);
  if (step === "welcome") return <Welcome onStart={() => onStep("wallet")} />;
  if (step === "wallet") return <WalletStep onMade={() => { onStep("money"); onMade(); }} onProblem={onProblem} />;
  if (step === "money" && adding && sol) return (
    <>
      <header className="p-top">
        <button className="zf-icon-btn p-top-l" aria-label="Back" onClick={() => setAdding(false)}><Back /></button>
        <span className="zf-label p-title">Add money</span>
      </header>
      <main className="p-main p-main--pushed"><AddMoney address={sol} onDone={() => { setAdding(false); onStep("link"); }} /></main>
    </>
  );
  if (step === "money") return <MoneyStep linked={linked} onFromWallet={() => setAdding(true)} onLater={() => onStep("link")} />;
  if (step === "link") return <div className="p-main p-main--pushed"><Link onProblem={onProblem} onShown={onLinked} journey={{ onDone: () => onStep("set"), onNotNow: () => onStep("set") }} /></div>;
  return <SetStep limitUsd={limitUsd} onFinish={() => onStep("done")} />;
}

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="p-center zf-pad">
      <div className="zf-fill" />
      <div className="p-intro zf-enter">
        <Mark size={80} mode="once" />
        <h1 className="zf-title">Trade from this browser</h1>
        <p className="zf-body">Open a coin on pump.fun, Axiom or GMGN, and buy it here in one tap. Sell it the same way.</p>
        <p className="zf-small">On Solana, from a small wallet just for trading. Your main balance stays where it is.</p>
      </div>
      <div className="zf-fill" />
      <div className="p-floor"><button className="zf-btn" onClick={onStart}>Set up now</button></div>
    </div>
  );
}

function WalletStep({ onMade, onProblem }: { onMade: () => void; onProblem: OnProblem }) {
  const [pass, setPass] = useState(""), [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const r = await ask<{ sol: string }>({ t: "vault.create", passcode: pass });
    setBusy(false);
    if ("problem" in r) onProblem(r.problem); else { setPass(""); onMade(); }
  };
  return (
    <form className="p-center zf-pad" onSubmit={submit}>
      <div className="p-head zf-enter">
        <span className="zf-label">1 of 3</span>
        <h1 className="zf-title">A small wallet just for trading</h1>
        <p className="zf-body">It holds only what you move into it. Your main balance stays separate.</p>
      </div>
      <div className="zf-fill" />
      <Passcode id="new-pass" label="Choose a passcode" value={pass} onChange={setPass} fresh />
      <p className="zf-small p-left">At least {MIN_PASSCODE} characters. It unlocks this wallet in this browser. Nobody can reset it for you.</p>
      <div className="p-floor">
        <button className="zf-btn" type="submit" disabled={busy || pass.length === 0}>{busy ? "Making it…" : "Make my trading wallet"}</button>
        <p className="zf-small">Its keys are kept on this device, encrypted.</p>
      </div>
    </form>
  );
}

/** The plain choices there are: from another wallet, always; from the ZeroFee balance once a phone is linked (it's done there). */
function MoneyStep({ linked, onFromWallet, onLater }: { linked: boolean; onFromWallet: () => void; onLater: () => void }) {
  return (
    <div className="p-center zf-pad">
      <div className="p-head zf-enter">
        <span className="zf-label">2 of 3</span>
        <h1 className="zf-title">Add trading money</h1>
        <p className="zf-body">Your trading wallet is ready. Where should its SOL come from?</p>
      </div>
      <div className="p-rows">
        {linked && (
          <div className="zf-row tr-row">
            <CoinIcon symbol="SOL" icon="sol" size={30} />
            <span><span className="t">From my ZeroFee balance</span><span className="d">On your phone: Extension, then Add money</span></span>
            <span />
          </div>
        )}
        <button className="zf-row tr-row" onClick={onFromWallet}>
          <CoinIcon symbol="SOL" icon="sol" size={30} />
          <span><span className="t">From another wallet</span><span className="d">Send SOL to its address</span></span>
          <span className="tr-v">›</span>
        </button>
      </div>
      <div className="zf-fill" />
      <div className="p-floor"><button className="zf-link" onClick={onLater}>Later</button></div>
    </div>
  );
}

function SetStep({ limitUsd, onFinish }: { limitUsd: number; onFinish: () => void }) {
  const { svc } = usePanel();
  const w = useLive(() => svc.wallets().then((ws) => ws.find((x) => x.chain === "sol")), []).value;
  return (
    <div className="p-center zf-pad">
      <div className="zf-fill" />
      <div className="p-intro zf-enter">
        <Mark size={64} mode="once" />
        <h1 className="zf-title">You're set</h1>
        <p className="zf-body">{w && BigInt(w.native) > 0n ? `${amount(w.native, CHAINS.sol.decimals)} SOL is here: ${usd(w.nativeUsd)} to trade with.` : "Your trading wallet shows SOL as soon as it arrives."}</p>
        <p className="zf-small">Unlock once, then one tap a trade, up to ${limitUsd} a trade. Bigger trades ask for the passcode. It locks after an hour without a trade.</p>
      </div>
      <div className="zf-fill" />
      <div className="p-floor"><button className="zf-btn" onClick={onFinish}>Start trading</button></div>
    </div>
  );
}
