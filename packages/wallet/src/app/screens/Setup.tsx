// The first-run set-up journey (D21), on the board UI approved: Welcome → Add money → (Set up Private?) → You're set. No
// partner and no sheet: Receive for a wallet or exchange (it asks for the backup first, through the shell's own flow).
// Cards and banks are postponed (D48: Pay folds into Wallet). Private (D27) is step 2 only where this phone can use it.
// Every step can be put off; Wallet keeps only which step is done.
import { Check } from "@zerofee/design/icons.tsx";
import { Mark } from "@zerofee/design/Mark.tsx";
import { useState } from "react";
import { webWallet } from "@zerofee/shell-api/release.ts";
import { PRIVATE_HOW, PRIVATE_MORE, PRIVATE_SEEN, PRIVATE_WORDS } from "../format.ts";
import { More } from "@zerofee/design/More.tsx";
import { PrivateMark } from "../icons.tsx";
import { SETUP_MONEY_LEAD, chooseMoney, choosePrivate, finish, later, nextStep, start, type MoneyChoice, type SetupState } from "../setup.ts";

interface Props {
  state: SetupState;
  /** This phone can use Private and it isn't set up yet (D27). */
  offerPrivate: boolean;
  onState: (s: SetupState) => void;
  onReceive: () => void;
  /** Makes the pocket; false when it couldn't (the Problem is shown by the caller). */
  onSetUpPrivate: () => Promise<boolean>;
  /** Pay's Private switch starts on, or not (kept on this phone). */
  onPrivateDefault: (on: boolean) => Promise<void>;
  onDone: () => void;
}

export function Setup({ state, offerPrivate, onState, onReceive, onSetUpPrivate, onPrivateDefault, onDone }: Props) {
  const step = nextStep(state, false, offerPrivate);
  const withPrivate = offerPrivate || state.private !== undefined;
  const total = withPrivate ? 2 : 1;
  if (step === "welcome") {
    return (
      <div className="wl wl-setup">
        <div className="zf-fill" />
        <div className="wl-setup-head zf-enter">
          <Mark size={96} mode="still" />
          <h1 className="zf-title">Your money, in one place</h1>
          <p className="zf-body">Coins from any network, added up in one total. {total === 2 ? "Two quick steps." : "One quick step."}</p>
        </div>
        <div className="wl-setup-rows zf-enter-2">
          <div className="wl-row"><span className="zf-label wl-step">1</span><div><div className="t">Add money</div><div className="d">From a wallet or exchange you already use</div></div><span /></div>
          {total === 2 && <div className="wl-row"><span className="zf-label wl-step">2</span><div><div className="t">Private</div><div className="d">A small separate wallet the public can't see into</div></div><span /></div>}
        </div>
        <p className="zf-small wl-setup-note zf-enter-2">You can skip {total === 2 ? "any step" : "it"} and do it later.</p>
        <div className="zf-fill" />
        <div className="zf-floor">
          <button className="zf-btn" onClick={() => onState(start(state))}>Set up now</button>
          <button className="zf-link" onClick={() => { onState(later(state)); onDone(); }}>Later</button>
        </div>
      </div>
    );
  }
  if (step === "money") return <MoneyStep total={total} onChoose={(m) => onState(chooseMoney(state, m))} onReceive={onReceive} />;
  if (step === "private") return <PrivateStep onChoose={(c) => onState(choosePrivate(state, c))} onSetUp={onSetUpPrivate} onDefault={onPrivateDefault} />;
  return <SetupDone state={state} withPrivate={withPrivate} onDone={() => { onState(finish(state)); onDone(); }} />;
}

function PrivateStep({ onChoose, onSetUp, onDefault }: { onChoose: (c: "set" | "skipped") => void; onSetUp: () => Promise<boolean>; onDefault: (on: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  // One screen, one pill (Alpha metric 3): whether Pay starts paying from Private is a tick on the same screen (D27,
  // "easiest for people"), left to the person, and changeable on the Private screen.
  const [byDefault, setByDefault] = useState(false);
  const setUp = async () => {
    setBusy(true);
    const ok = await onSetUp();
    if (ok && byDefault) await onDefault(true);
    setBusy(false);
    if (ok) onChoose("set");
  };
  return (
    <div className="wl wl-setup">
      <div className="zf-label wl-setup-step">Step 2 of 2</div>
      <div className="wl-setup-head wl-setup-mark"><PrivateMark size={56} /></div>
      <h1 className="zf-title wl-setup-title">Set up Private?</h1>
      <p className="zf-body wl-setup-lead">{PRIVATE_WORDS}</p>
      <More label="What to know about Private" lines={[...PRIVATE_MORE, PRIVATE_SEEN, ...PRIVATE_HOW, "You can add money any time."]} />
      <div className="wl-setup-rows">
        <button className="wl-row wl-pick" onClick={() => setByDefault(!byDefault)} aria-pressed={byDefault}>
          <span className={`zf-tick${byDefault ? " on" : ""}`}>{byDefault && <Check />}</span>
          <div><div className="t">Use it for payments by default</div><div className="d">Pay uses Private first. You can switch per payment.</div></div>
          <span />
        </button>
      </div>
      <div className="zf-fill" />
      <div className="zf-floor">
        <button className="zf-btn" disabled={busy} onClick={() => void setUp()}>{busy ? "Setting up…" : "Set up Private"}</button>
        <button className="zf-link" onClick={() => onChoose("skipped")}>Not now</button>
      </div>
    </div>
  );
}

function MoneyStep({ total, onChoose, onReceive, web = webWallet() }: { total: number; onChoose: (m: MoneyChoice) => void; onReceive: () => void; web?: boolean }) {
  return (
    <div className="wl wl-setup">
      <div className="zf-label wl-setup-step">Step 1 of {total}</div>
      <h1 className="zf-title wl-setup-title">Add money</h1>
      <p className="zf-body wl-setup-lead">{web ? SETUP_MONEY_LEAD.web : SETUP_MONEY_LEAD.phone}</p>
      <div className="zf-fill" />
      <div className="zf-floor">
        <button className="zf-btn" onClick={() => { onChoose("receive"); onReceive(); }}>Show my address</button>
        <button className="zf-link" onClick={() => onChoose("skipped")}>Skip for now</button>
      </div>
    </div>
  );
}

function SetupDone({ state, withPrivate, onDone }: { state: SetupState; withPrivate: boolean; onDone: () => void }) {
  const added = state.money === "receive" || state.money === "pay-cash";
  const how = state.money === "receive" ? "From a wallet or exchange" : state.money === "pay-cash" ? "With a card or bank, in Pay" : "Skipped. Add money any time from Balance.";
  return (
    <div className="wl wl-setup">
      <div className="zf-fill" />
      <div className="wl-setup-head zf-enter">
        <svg className="wl-setup-tick" width="96" height="96" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8.2" />
          <path d="M8.4 12.3 11 14.9 15.8 9.4" />
        </svg>
        <h1 className="zf-title">You're set</h1>
        <p className="zf-body">Money shows here once the network sees it.</p>
      </div>
      <div className="wl-setup-rows">
        <div className="wl-row"><span className={`zf-tick ${added ? "on" : "off"}`}>{added && <Check />}</span><div><div className="t">Add money</div><div className="d">{how}</div></div><span /></div>
        {withPrivate && (
          <div className="wl-row"><span className={`zf-tick ${state.private === "set" ? "on" : "off"}`}>{state.private === "set" && <Check />}</span><div><div className="t">Private</div><div className="d">{state.private === "set" ? "Set up. Add money to it any time from Balance." : "Not now. Set it up any time from Balance."}</div></div><span /></div>
        )}
      </div>
      <div className="zf-fill" />
      <div className="zf-floor"><button className="zf-btn" onClick={onDone}>Go to Balance</button></div>
    </div>
  );
}
