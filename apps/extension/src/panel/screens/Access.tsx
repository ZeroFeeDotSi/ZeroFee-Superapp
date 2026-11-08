// The screens around the wallet itself: locked, settings, linking the phone, adding money, and the passcode for one trade
// over the limit (the first run is ./Journey.tsx). Every vault answer that is a Problem goes to the Problem screen;
// nothing here writes error words.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Mark } from "@zerofee/design/Mark.tsx";
import { QrCode } from "@zerofee/design/QrCode.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import type { Problem } from "@zerofee/core/problem";
import { amount, usd } from "@zerofee/trade/app/format.ts";
import { CHAINS } from "@zerofee/trade/service.ts";
import { base64, fromBase64 } from "@zerofee/trade/sol/bytes.ts";
import { extProblems } from "../../problems.ts";
import type { Touch } from "../../vault/vault.ts";
import { ask, local, useLive, usePanel } from "../runtime.tsx";
import { enrol, NoPrf, prfFor, touchOffered } from "../touch.ts";
import { PHONE_LINK_SHOWN } from "../setup.ts";

type OnProblem = (p: Problem) => void;
const SHOW_MS = 30_000;

export function Passcode({ id, label, value, onChange, fresh, focus = true }: { id: string; label: string; value: string; onChange: (v: string) => void; fresh?: boolean; focus?: boolean }) {
  return (
    <div className="p-pass">
      <label className="zf-label" htmlFor={id}>{label}</label>
      <input id={id} className="p-field" type="password" autoComplete={fresh ? "new-password" : "current-password"} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={focus} />
    </div>
  );
}

/**
 * Locked: the passcode, or with Touch ID on, the one pill reads "Unlock with Touch ID" while the passcode field is empty.
 * A cancel or a failure goes straight to the passcode (Security's ruling: no retry loop).
 */
export function Unlock({ touch, onOpen, onProblem }: { touch?: Touch; onOpen: () => void; onProblem: OnProblem }) {
  const { svc } = usePanel();
  const [pass, setPass] = useState(""), [busy, setBusy] = useState(false), [forgot, setForgot] = useState(false);
  const [offered, setOffered] = useState(false), [tried, setTried] = useState(false);
  useEffect(() => { if (touch) void touchOffered().then(setOffered); }, [touch?.credId]);
  const byTouch = Boolean(touch && offered && !tried && pass.length === 0);
  const wallet = useLive(() => svc.wallets().then((ws) => ws.find((w) => w.chain === "sol")), []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    if (byTouch) {
      let prf: Uint8Array | undefined;
      try { prf = await prfFor(navigator.credentials, touch!.credId, fromBase64(touch!.salt)); } catch { /* a cancel, or no PRF */ }
      if (!prf) { setBusy(false); setTried(true); document.getElementById("pass")?.focus(); return; }
      const r = await ask<{ sol: string }>({ t: "vault.unlockTouch", prf: base64(prf) });
      prf.fill(0);
      setBusy(false);
      if ("problem" in r) onProblem(r.problem); else onOpen();
      return;
    }
    const r = await ask<{ sol: string }>({ t: "vault.unlock", passcode: pass });
    setBusy(false);
    setPass("");
    if ("problem" in r) onProblem(r.problem); else onOpen();
  };
  return (
    <form className="p-center zf-pad" onSubmit={submit}>
      <div className="zf-fill" />
      <div className="p-intro zf-enter">
        <Mark size={56} mode="still" />
        <h1 className="zf-title">Locked</h1>
        <p className="zf-small">{wallet.value ? `${amount(wallet.value.native, CHAINS.sol.decimals)} SOL · ${usd(wallet.value.nativeUsd)}` : " "}</p>
      </div>
      <div className="zf-fill" />
      <Passcode id="pass" label="Passcode" value={pass} onChange={setPass} />
      <div className="p-floor">
        <button className="zf-btn" type="submit" disabled={busy || (!byTouch && pass.length === 0)}>{byTouch ? "Unlock with Touch ID" : "Unlock"}</button>
        <p className="zf-small">{tried ? "Touch ID didn't open it. Type your passcode." : "It locks after an hour without a trade, and when Chrome closes."}</p>
        {forgot
          ? <p className="zf-small">Without the passcode, this browser can't open the wallet, and nobody can open it for you.</p>
          : <button className="zf-link" type="button" onClick={() => setForgot(true)}>I forgot the passcode</button>}
      </div>
    </form>
  );
}

/**
 * Linking the phone: the code the phone shows and the passcode, then the QR, shown at once for 30 seconds (and again on
 * "Show it again"), so the phone can scan it with no hand on the laptop. Alone it is useless: it opens only with the
 * phone's own code, which runs out in 5 minutes. The code
 * is typed here and never shown here. In Settings, and as the journey's last step (`journey`: "Not now", then "Done").
 * `onShown` runs the first time the QR is shown.
 */
export function Link({ onProblem, onShown, journey }: { onProblem: OnProblem; onShown?: () => void; journey?: { onDone: () => void; onNotNow: () => void } }) {
  const [code, setCode] = useState(""), [pass, setPass] = useState(""), [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ qr: string; until: number } | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!link || !shown) return;
    const t = setTimeout(() => setShown(false), Math.max(0, link.until - Date.now()));
    return () => clearTimeout(t);
  }, [link?.until, shown]);
  const make = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await ask<{ qr: string }>({ t: "vault.linkCode", passcode: pass, code });
    setBusy(false);
    setPass("");
    if ("problem" in r) onProblem(r.problem); else { setCode(""); setLink({ qr: r.ok.qr, until: Date.now() + SHOW_MS }); setShown(true); onShown?.(); }
  };
  const again = () => { if (link) { setLink({ ...link, until: Date.now() + SHOW_MS }); setShown(true); } };
  if (!link) return (
    <form className="p-center" onSubmit={make}>
      {journey ? (
        <div className="p-head zf-enter">
          <span className="zf-label">3 of 3</span>
          <h1 className="zf-title">Link your phone</h1>
          <p className="zf-body">Then ZeroFee on your phone can add money here and bring it back.</p>
          <p className="zf-small">On your phone, open Extension and tap Link my laptop. Type the code it shows. You can link it any time from Settings.</p>
        </div>
      ) : (
        <div className="p-intro p-intro--top">
          <h1 className="zf-title">Link your phone.</h1>
          <p className="zf-body">On your phone, open ZeroFee, go to Extension and tap Link my laptop. Type the code it shows here.</p>
        </div>
      )}
      <div className="zf-fill" />
      <div className="p-pass">
        <label className="zf-label" htmlFor="link-code">Code on your phone</label>
        <input id="link-code" className="p-field p-field--code" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
      </div>
      <Passcode id="link-pass" label="Passcode" value={pass} onChange={setPass} focus={false} />
      <div className="p-floor">
        <button className="zf-btn" type="submit" disabled={busy || !code || !pass}>Make the link</button>
        {journey && <button className="zf-link" type="button" onClick={journey.onNotNow}>Not now</button>}
      </div>
    </form>
  );
  return (
    <div className="p-center">
      <div className="p-intro p-intro--top">
        <h1 className="zf-title">Link your phone.</h1>
        <p className="zf-body">{shown ? "Now hold your phone up to this code." : "Hidden again. Show it if your phone hasn't scanned it."}</p>
      </div>
      <div className="zf-fill" />
      <div className={`p-qr p-blur${shown ? " show" : ""}`} aria-hidden={!shown}><QrCode value={link.qr} size={180} label="Link code" /></div>
      <div className="zf-fill" />
      <div className="p-floor">
        {!shown && <button className="zf-btn" type="button" onClick={again}>Show it again</button>}
        <p className="zf-small">It carries this wallet's key, locked with your phone's code, so your phone can bring the money back. It shows for 30 seconds.</p>
        {journey && <button className="zf-link" type="button" onClick={journey.onDone}>Done</button>}
      </div>
    </div>
  );
}

export function Settings({ limitUsd, sol, touch, onLink, onLock, onChanged, onProblem }: { limitUsd: number; sol: string; touch?: Touch; onLink: () => void; onLock: () => void; onChanged: () => void; onProblem: OnProblem }) {
  const [editing, setEditing] = useState(false), [limit, setLimit] = useState(String(limitUsd)), [pass, setPass] = useState("");
  // raising the limit asks for the passcode in the same form (audit L25); lowering it never does
  const raising = Number(limit) > limitUsd;
  const [offered, setOffered] = useState(false), [touchSheet, setTouchSheet] = useState(false);
  useEffect(() => { void touchOffered().then(setOffered); }, []);
  const [dark, setDark] = useState(document.documentElement.dataset.theme === "dark");
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const usdValue = Number(limit);
    if (!(usdValue > 0) || (raising && !pass)) return;
    const r = await ask<true>(raising ? { t: "vault.limit", usd: usdValue, passcode: pass } : { t: "vault.limit", usd: usdValue });
    setPass("");
    if ("problem" in r) return onProblem(r.problem);
    setEditing(false);
    onChanged();
  };
  const look = async () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    await local.set("theme", next ? "dark" : "light");
  };
  return (
    <div className="zf-enter">
      {editing ? (
        <form className="zf-row p-row" onSubmit={save}>
          <label className="t" htmlFor="limit">One-tap limit, in dollars</label>
          <span className="p-inline"><input id="limit" className="p-field p-field--small" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ""))} autoFocus /><button className="zf-link" type="submit" disabled={raising && !pass}>Save</button></span>
          {raising && <Passcode id="limit-pass" label="Passcode, to raise it" value={pass} onChange={setPass} focus={false} />}
        </form>
      ) : (
        <Row title="One-tap limit" detail="Above it, a trade asks for your passcode" value={`$${limitUsd}`} onClick={() => setEditing(true)} />
      )}
      {PHONE_LINK_SHOWN && <Row title="Link your phone" detail="So your phone can bring the money back" onClick={onLink} />}
      {offered && <Row title="Unlock with Touch ID" detail="Your passcode keeps working too" value={touch ? "On" : "Off"} onClick={() => setTouchSheet(true)} />}
      <Row title="Look" detail="The panel and the button on the site" value={dark ? "Dark" : "Light"} onClick={() => void look()} />
      <Row title="Lock now" onClick={onLock} />
      {touchSheet && <TouchSheet on={!touch} sol={sol} onClose={() => setTouchSheet(false)} onDone={() => { setTouchSheet(false); onChanged(); }} onProblem={(p) => { setTouchSheet(false); onProblem(p); }} />}
    </div>
  );
}

/**
 * Turning Touch ID on or off: the passcode first, always (Security's ruling). On: the passcode is checked before Touch ID
 * is asked, so a wrong one leaves no passkey behind; then the one credential and its PRF seal the wallet a second way.
 */
function TouchSheet({ on, sol, onClose, onDone, onProblem }: { on: boolean; sol: string; onClose: () => void; onDone: () => void; onProblem: OnProblem }) {
  const [pass, setPass] = useState(""), [busy, setBusy] = useState(false);
  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (!pass || busy) return;
    setBusy(true);
    try {
      if (!on) {
        const r = await ask<true>({ t: "vault.touchOff", passcode: pass });
        if ("problem" in r) onProblem(r.problem); else onDone();
        return;
      }
      const checked = await ask<{ sol: string }>({ t: "vault.unlock", passcode: pass });
      if ("problem" in checked) { onProblem(checked.problem); return; }
      let t: Awaited<ReturnType<typeof enrol>>;
      try { t = await enrol(navigator.credentials, sol); } catch (err) { if (err instanceof NoPrf) onProblem(extProblems.touchUnavailable()); else onClose(); return; }
      const r = await ask<Touch>({ t: "vault.touchOn", passcode: pass, credId: t.credId, salt: base64(t.salt), prf: base64(t.prf) });
      t.prf.fill(0);
      if ("problem" in r) onProblem(r.problem); else onDone();
    } finally {
      setPass("");
      setBusy(false);
    }
  };
  return (
    <Sheet title={on ? "Turn on Touch ID" : "Turn off Touch ID"} onClose={onClose}>
      <form className="p-confirm" onSubmit={go}>
        <p className="zf-small">{on ? "Type your passcode first. Then Touch ID opens this wallet too, and your passcode keeps working." : "Type your passcode. Then only your passcode opens this wallet."}</p>
        <Passcode id="touch-pass" label="Passcode" value={pass} onChange={setPass} />
        <button className="zf-btn" type="submit" disabled={!pass || busy}>{on ? "Turn on" : "Turn off"}</button>
      </form>
    </Sheet>
  );
}

function Row({ title, detail, value, onClick }: { title: string; detail?: string; value?: ReactNode; onClick: () => void }) {
  return (
    <button className="zf-row tr-row p-row" onClick={onClick}>
      <span><span className="t">{title}</span>{detail && <span className="d">{detail}</span>}</span>
      <span className="tr-v">{value}</span>
    </button>
  );
}

/** Adding money: the one thing to do is copy the address (the pill), or scan it from a phone wallet. */
export function AddMoney({ address, onDone }: { address: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => { await navigator.clipboard.writeText(address).then(() => setCopied(true), () => undefined); };
  return (
    <div className="p-center">
      <div className="p-left p-intro--top">
        <div className="zf-label">Send SOL from any Solana wallet to</div>
        <p className="p-addr">{address}</p>
      </div>
      <div className="p-qr p-qr--address"><QrCode value={address} size={140} label="This wallet's Solana address" /></div>
      <div className="zf-fill" />
      <div className="p-floor">
        <button className="zf-btn" onClick={() => void copy()}>{copied ? "Copied" : "Copy the address"}</button>
        <button className="zf-link" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

/** Over the one-tap limit: the passcode, for this one trade. */
export function Confirm({ limitUsd, onPass, onClose }: { limitUsd: number; onPass: (passcode: string) => void; onClose: () => void }) {
  const [pass, setPass] = useState("");
  return (
    <Sheet title="Go above the limit" onClose={onClose}>
      <form className="p-confirm" onSubmit={(e) => { e.preventDefault(); if (pass) onPass(pass); }}>
        <p className="zf-small">This trade is over your one-tap limit of ${limitUsd}. Type your passcode to go ahead with it.</p>
        <Passcode id="confirm-pass" label="Passcode" value={pass} onChange={setPass} />
        <button className="zf-btn" type="submit" disabled={!pass}>Go ahead</button>
      </form>
    </Sheet>
  );
}
