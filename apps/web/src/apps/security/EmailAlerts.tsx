// Email alerts (the relay's Layer 2, apps/quotes/alerts.mjs): an email when something happens on the account, even if
// this device is lost or its app is wrong. Turned on by the link the relay emails, stopped by the link in every email:
// asking here only sends the link, so whoever holds this device can't silence them.
import { useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { More } from "@zerofee/design/More.tsx";

const EMAIL = /^[^\s@<>"'(),;:\\]{1,64}@[A-Za-z\d-]{1,63}(\.[A-Za-z\d-]{1,63}){0,4}\.[A-Za-z]{2,24}$/;

export function EmailAlerts({ bridge, onProblem }: { bridge: Bridge; onProblem: (p: Problem) => void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "asking" | "on-link" | "stop-link">("idle");
  const ok = EMAIL.test(email.trim());
  const ask = async (method: "account.alertsEmail" | "account.alertsEmailStop") => {
    if (!ok || state === "asking") return;
    setState("asking");
    const r = await bridge.call<{ asked: true } | { declined: true }>(method, { email: email.trim() });
    if ("problem" in r) {
      setState("idle");
      return onProblem(r.problem);
    }
    // Turning them on is signed for the account on its own sheet; Not now there leaves them as they were.
    if ("declined" in r.ok) return setState("idle");
    setState(method === "account.alertsEmail" ? "on-link" : "stop-link");
  };
  return (
    <div className="sec-alerts">
      {/* Its heading is the disclosure that holds it (SecurityApp's Recovery tab). */}
      <p className="zf-small">ZeroFee emails you when your account moves or a payment waits. The email reaches you even without this device.</p>
      {state === "on-link" || state === "stop-link" ? (
        <p className="zf-body" role="status" style={{ marginTop: 10 }}>
          {state === "on-link" ? `Open the link in ${email.trim()} to turn them on.` : `If ${email.trim()} gets these emails, it now has a link that stops them.`}
        </p>
      ) : (
        <>
          <input className="sec-alerts__input" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Your email" />
          <div className="sec-alerts__acts">
            <button className="zf-link" disabled={!ok || state === "asking"} onClick={() => void ask("account.alertsEmail")}>Email me</button>
            <button className="zf-link sec-alerts__stop" disabled={!ok || state === "asking"} onClick={() => void ask("account.alertsEmailStop")}>Stop emails</button>
          </div>
          {/* why the two are off (3 Nov e2e walk, 142: two disabled controls, nothing said) */}
          {!ok && <p className="zf-small">Type your email to use these.</p>}
        </>
      )}
      <More label="What we keep" className="sec-alerts__keeps" lines={["Your account moves to a new device, or a payment waits for you.", "ZeroFee keeps only your NEAR account and this email, to send these.", "Every email has a link to stop them. It removes your email too."]} />
    </div>
  );
}
