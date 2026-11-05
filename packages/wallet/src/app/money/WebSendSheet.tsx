// The web wallet's Send (product decision, 4 Nov: superapp.zerofee.si as a normal wallet, no Safe). Private (the HARD
// RULE, 4 Nov: every money move through NEAR Confidential; QA's real path, 5 Nov): ONE confidential 1Click
// quote from the wallet straight to the payee, no pocket (subwallet.sendPrivate: the core asks the quote itself, reads
// back what 1Click signed, and pays it). SOL from the SOL wallet to a Solana address, ETH from the ETH (RH) wallet to a
// Robinhood Chain address, each landing as that coin. To an address not the person's own, the core's own sheet every time:
// the full address, what they get and the fee, and the password with Approve (decision A; the web's approval sheet and
// its 700 ms arm), so this sheet never asks it too. A no there is said. A site's top-up is the phone app's on the web
//: MoneyHost shows the On your phone page.
// The phone's Send shape (SendForm.tsx, D135): From, To and the amount full width on the sheet's grid, the amount's
// dollars beside it, Send pinned at the bottom. Once sent, the sheet is its receipt (QA, 4 Nov: a sent SOL
// vanished with no words and no Activity row): what went, its dollars, the transaction's short id with Copy and View, and
// Done. The send is an Activity row with that proof (webSendTask).
import { useContext, useEffect, useState } from "react";
import { SheetNote } from "@zerofee/design/Sheet.tsx";
import { filledAddressLine } from "@zerofee/shell-api/money.ts";
import { intentsPaid } from "@zerofee/core/zero-fee";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { TxProofLine } from "@zerofee/shell-api/TxProofLine.tsx";
import { amountOf } from "../format.ts";
import { useWallet } from "../runtime.tsx";
import { WEB_SEND_FROM, WEB_SEND_TOKENS, WEB_SEND_WORDS, amountTyped, webCoinHas, webSendAsk, webSendFroms, webSendGo, webSendUsd, webSendMax, webSendWhy, type WebSendFrom, type WebSent } from "./web-send.ts";
import { SEND_CANT } from "./send-words.ts";
import "./send.css";
import "./web-send.css";

/** Home's Send on the web: from the SOL or ETH (RH) wallet, to any address on its network, privately. */
export function WebSendSheet({ wallet, to, agentFilled, onClose, onDone }: { wallet?: string; to?: string; /** MoneyAsk's agentFilled: `to` is AgentZero's */ agentFilled?: true; onClose: () => void; onDone: (line: string) => void }) {
  const shell = useShell();
  const { bridge } = shell;
  const { spending } = useWallet();
  // every coin held that has a private route (W4): each wallet's own coin, then (the tokens' switch on) its pinned tokens,
  // as the core reads them on its own nodes (subwallet.sendCoins: Trade's positions know only coins traded here)
  const [held, setHeld] = useState<{ chain: string; address: string; amount: string }[] | null>(null);
  useEffect(() => {
    if (!WEB_SEND_TOKENS) return;
    let on = true;
    void bridge.call<{ chain: string; address: string; amount: string }[]>("subwallet.sendCoins", {}).then((r) => { if (on && "ok" in r && Array.isArray(r.ok)) setHeld(r.ok); }, () => undefined);
    return () => { on = false; };
  }, [bridge]);
  const froms: WebSendFrom[] = webSendFroms(WEB_SEND_TOKENS, held);
  const [from, setFrom] = useState<WebSendFrom>(() => WEB_SEND_FROM.find((f) => f.chain === wallet) ?? WEB_SEND_FROM[0]);
  const [who, setWho] = useState(to ?? "");
  // W7: the shell's own note (the agent app opened this Send), only while the address is still the one it filled in
  const agentLine = filledAddressLine(useContext(SheetNote), to, who, agentFilled === true);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [sent, setSent] = useState<WebSent | null>(null);
  const ask = webSendAsk(from.chain, who, amount, from);
  const net = (chain: string) => spending?.networks.find((n) => n.network === chain);
  const hasOf = (f: WebSendFrom) => (f.token ? webCoinHas(held, f) : net(f.chain)?.nativeAmount);
  const usd = from.token ? null : webSendUsd(amount, net(from.chain));
  const edit = (then: () => void) => { then(); setLine(null); };
  const go = async () => {
    if (!("ok" in ask) || !ready || busy) return;
    setBusy(true);
    setLine(null);
    // the core's subwallet.sendPrivate (web-send.ts webSendGo; its sheet asks the password); once sent, its Activity row
    // with its proof, followed to 1Click's end, then the receipt
    const r = await webSendGo({ call: (m, p) => bridge.call(m, p), ask: ask.ok, from, usd, ...(shell.tasks ? { tasks: shell.tasks } : {}) });
    setBusy(false);
    if ("line" in r) return setLine(r.line);
    setSent(r.sent);
  };
  const view = (url: string) => { try { globalThis.open?.(url, "_blank", "noopener,noreferrer"); } catch { /* no window to open */ } };
  if (sent) {
    return (
      <Sheet title={WEB_SEND_WORDS.title} onClose={() => onDone(sent.line)}>
        <div className="wl-send" data-testid="web-send">
          <div className="wl-send2 wl-websend__done" role="status" data-testid="web-send-done">
            <span className="wl-websend__tick" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 12.5 10 17.5 19 7.5" /></svg></span>
            <p className="wl-websend__sent">{sent.line}</p>
            {sent.usd && <p className="zf-small wl-websend__sentusd" data-testid="web-send-get">{sent.usd}</p>}
            {sent.tx && <TxProofLine tx={sent.tx} onView={view} className="wl-websend__proof" />}
            <button type="button" className="zf-btn wl-websend__ok" onClick={() => onDone(sent.line)} data-testid="web-send-ok">{WEB_SEND_WORDS.done}</button>
          </div>
        </div>
      </Sheet>
    );
  }
  // why Send is off, said (a web test): an empty wallet (with its Add), more than it holds, or the typed line
  const why = webSendWhy({ from, has: hasOf(from), who, amount, ask });
  const ready = "ok" in ask && !why;
  // the whole wallet less its fee (webSendMax): one tap to empty it
  const max = webSendMax(from.chain, hasOf(from), from);
  return (
    <Sheet title={WEB_SEND_WORDS.title} onClose={onClose}>
      <div className="wl-send" data-testid="web-send">
        <div className="wl-send2 wl-websend">
          <div className="wl-websend__from" role="radiogroup" aria-label={WEB_SEND_WORDS.from}>
            <span className="wl-send2__label">{WEB_SEND_WORDS.from}</span>
            <div className="wl-websend__wallets">
              {froms.map((f) => {
                const has = hasOf(f);
                return (
                  <button key={f.lands} type="button" role="radio" aria-checked={f.lands === from.lands} className={`wl-chip zf-press wl-websend__wallet${f.lands === from.lands ? " on" : ""}`} onClick={() => edit(() => setFrom(f))} data-chain={f.chain} data-coin={f.lands} disabled={busy}>
                    <b>{f.token ? f.symbol : f.wallet}</b>
                    {/* cut, never rounded up (webd-money2: "0.0075" for 0.007481, then refused) */}
                    {has !== undefined && <span className="zf-small">{`${amountOf(has, f.symbol)} ${f.symbol}`}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="wl-websend__field">
            <span className="wl-send2__label">{WEB_SEND_WORDS.to}</span>
            <input aria-label={WEB_SEND_WORDS.to} placeholder={WEB_SEND_WORDS.toHint(from.network)} value={who} onChange={(e) => { const v = e.currentTarget.value; edit(() => setWho(v)); }} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} data-testid="web-send-to" />
          </label>
          <label className="wl-websend__field wl-websend__amount">
            <input aria-label={WEB_SEND_WORDS.amount(from.symbol)} placeholder={WEB_SEND_WORDS.amount(from.symbol)} inputMode="decimal" autoComplete="off" value={amount}
              onChange={(e) => { const v = amountTyped(e.currentTarget.value); edit(() => setAmount(v)); }} disabled={busy} data-testid="web-send-amount" />
            {usd && <span className="wl-websend__usd" data-testid="web-send-usd">{usd}</span>}
            {max && <button type="button" className="wl-websend__max" onClick={() => edit(() => setAmount(max))} disabled={busy} data-testid="web-send-max">{WEB_SEND_WORDS.max}</button>}
          </label>
          {(line ?? why) && <p className="zf-small wl-websend__line" role="alert" data-testid="web-send-line">{line ?? why!.line}</p>}
          {!line && why?.empty && <button type="button" className="zf-btn zf-btn--quiet wl-websend__add" onClick={() => { onClose(); shell.openMoney({ kind: "receive", wallet: from.chain }); }} data-testid="web-send-add">{WEB_SEND_WORDS.add(from.symbol)}</button>}
          {/* AgentZero's line in the network line's slot, below the amount, while To is still the address it filled in (gone
              once the person edits To). The web's network line here is its privacy line (the audit's P6: a watcher can match the
              amount and time), so it stays under it, never replaced */}
          {agentLine && <p className="zf-small wl-websend__public" data-testid="web-send-agent-filled">{agentLine}</p>}
          <p className="zf-small wl-websend__public" data-testid="web-send-lands">{WEB_SEND_WORDS.lands(from.symbol, from.network)}</p>
          {/* a Solana token: 1Click's new token account's rent, said before the tap (the phone's rentLine words) */}
          {from.token && from.chain === "sol" && <p className="zf-small wl-websend__public" data-testid="web-send-rent">{SEND_CANT.rent(from.symbol, null)}</p>}
          {/* one tap (product decision, 5 Nov: the tap IS the action); the core's own sheet asks the password after it */}
          <button type="button" className="zf-btn wl-hold wl-websend__go" disabled={!ready || busy} onClick={() => void go()} data-testid="web-send-go">{WEB_SEND_WORDS.send}</button>
          {/* who gets the fee, under the one tap (product decision, 5 Nov: we are zero fee): the web's Send is one NEAR Intents quote */}
          <p className="zf-small wl-zerofee" data-testid="web-send-paid">{intentsPaid()}</p>
        </div>
      </div>
    </Sheet>
  );
}
