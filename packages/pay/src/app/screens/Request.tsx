// Ask for money: an amount, then a code and a link with everything inside it (no server). The payer's Pay reads it.
import { useState } from "react";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { QrCode } from "@zerofee/design/QrCode.tsx";
import { requestLink } from "../../request.ts";
import { shown as money } from "../format.ts";
import { Share } from "../icons.tsx";
import { usePay } from "../runtime.tsx";

export function Request() {
  const { flow, self } = usePay();
  const usdc = flow.tokens?.find("near", { symbol: "USDC" });
  const [amount, setAmount] = useState("0");
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const clean = amount.replace(/\.$/, "");
  const link = self && usdc ? requestLink({ to: self, ...(clean !== "0" ? { amount: clean } : {}), token: usdc.assetId }) : null;

  const share = async () => {
    if (!link) return;
    try {
      if (navigator.share) return await navigator.share({ text: link });
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // The person closed the share sheet: nothing to do.
    }
  };

  if (!shown || !link) {
    return (
      <div className="py py-col">
        <div className="py-center" style={{ paddingTop: 36 }}>
          <div className="zf-label">Ask for</div>
          <div className="py-big" style={{ marginTop: 18 }}>{amount} <small>USDC</small></div>
          <p className="zf-small" style={{ marginTop: 8 }}>Leave it at 0 to let them choose.</p>
        </div>
        <div className="zf-fill" />
        <Keypad value={amount} decimals={2} onChange={setAmount} />
        <div className="py-floor"><button className="zf-btn" disabled={!link} onClick={() => setShown(true)}>Show the code</button></div>
      </div>
    );
  }
  return (
    <div className="py py-col py-center">
      <div className="zf-label" style={{ marginTop: 30 }}>Ask for</div>
      <div className="py-mid" style={{ marginTop: 12 }}>{clean === "0" ? "Any amount" : <>{money(clean, 2)} <small style={{ fontSize: 18 }}>USDC</small></>}</div>
      <div className="py-qr"><QrCode value={link} size={208} label="Code for this request" /></div>
      <div className="py-mono" style={{ marginTop: 16 }}>{self}</div>
      <div className="zf-fill" />
      <button className="zf-link" style={{ display: "inline-flex", gap: 8, alignItems: "center", alignSelf: "center", color: "var(--ink)", fontWeight: 500, marginBottom: 12 }} onClick={share}>
        <Share />{copied ? "Link copied" : "Share"}
      </button>
    </div>
  );
}
