// The web demo's set-up, after the word check (3 Nov e2e walk, 05): it jumped from the check to a $5,460 Home, while
// Welcome had said "Then you add a little money" and the thread showed Money in, Protected and Second device still to
// come. This one screen shows what the demo did instead: the sample money, in figures; the Safe's rule, in figures; and
// the second device as the next step, any time. Each step is ticked only with its fact on screen (demo-money-in.ts,
// finding 50). Demo only: a real account's set-up has its own money screens (FundStart.tsx).
import type { Bridge } from "@zerofee/core/bridge";
import { ThreadBar } from "@zerofee/design/Thread.tsx";
import { useBalanceTotal } from "@zerofee/wallet/app/BalanceTotal.ts";
import { dollars } from "@zerofee/wallet/app/format.ts";
import { DEMO_MONEY_IN, demoMoneyThread } from "./demo-money-in.ts";
import { QUANTUM_WORDS } from "../apps/security/quantum.ts";

export { DEMO_MONEY_IN } from "./demo-money-in.ts";

export function DemoMoneyIn({ bridge, onDone }: { bridge: Bridge; onDone: () => void }) {
  const total = useBalanceTotal(bridge);
  const t = demoMoneyThread(total);
  return (
    <div className="zf-screen zf-pad">
      <div className="zf-top"><span style={{ width: 28 }} /><span className="zf-label" /><span style={{ width: 28 }} /></div>
      <ThreadBar steps={t.steps} line="" />
      <div className="ob-center zf-enter" style={{ marginTop: 40 }}>
        <h1 className="zf-title">{DEMO_MONEY_IN.title}</h1>
        <p className="zf-display" style={{ marginTop: 12 }} data-testid="demo-money-total">{total === null ? "…" : dollars(total)}</p>
        <p className="zf-body" style={{ marginTop: 12 }}>{DEMO_MONEY_IN.line}</p>
        {/* sign-up's last screen: one line, no new step (review, 5 Nov) */}
        <p className="zf-body" style={{ marginTop: 12, fontWeight: 500 }}>{QUANTUM_WORDS.signUp}</p>
      </div>
      <div className="ob-notes zf-enter-2" style={{ marginTop: 24 }}>
        <div className="zf-note" data-testid="demo-money-rule">{DEMO_MONEY_IN.rule} {DEMO_MONEY_IN.ruleWhere}</div>
        <div className="zf-note">{DEMO_MONEY_IN.next}</div>
      </div>
      <div className="zf-fill" />
      <div className="zf-floor zf-enter-3">
        <button className="zf-btn" onClick={onDone}>{DEMO_MONEY_IN.go}</button>
      </div>
    </div>
  );
}
