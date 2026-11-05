// The Extension app inside ZeroFee: link the ZeroFee panel in Chrome, see its small wallet just for trading, add money to
// it, and bring its SOL back. Linking: this phone's core makes a one-time code (subwallet.linkStart), shown here big with
// its countdown; the person types it into the panel; the panel shows a QR sealed under it; this app scans it (camera only
// while the app is on screen) and hands it to the core (subwallet.import), which keeps the key under the chip.
// Every Problem goes to the shell's Problem screen; its one next step is followed here.
import { useEffect, useRef, useState } from "react";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Face, TrayActivity, TrayOverview } from "@zerofee/design/icons.tsx";
import { Mark } from "@zerofee/design/Mark.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { ProblemError, type Problem } from "@zerofee/core/problem";
import type { AppModule } from "@zerofee/shell-api/app-module.ts";
import { AppFrame, PushedFrame, useShell, type TrayItem } from "@zerofee/shell-api/AppFrame.tsx";
import { browserCamera, watchCamera, type CameraState } from "@zerofee/pay/app/camera.ts";
import { ago, amount, usd } from "@zerofee/trade/app/format.ts";
import { nativeLogoUri } from "@zerofee/trade/market/logo.ts";
import { CHAINS } from "@zerofee/trade/service.ts";
import { isPanelCode, timeLeft } from "../link.ts";
import { appProblems } from "../problems.ts";
import { movementStatus } from "../status.ts";
import { ExtensionProvider, useExt, useLive } from "./runtime.tsx";
import "./extension.css";

type Tab = "wallet" | "activity" | "link";
const TrayLink = () => <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path className="zf-hl" d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></svg>;
const TRAY: TrayItem<Tab>[] = [
  { id: "wallet", label: "Wallet", icon: TrayOverview },
  { id: "activity", label: "Activity", icon: TrayActivity },
  { id: "link", label: "Link", icon: TrayLink },
];
const ADD_PRESETS = ["25", "50", "100", "250"];
type View = { kind: "tabs" } | { kind: "code"; code: string; expiresAtIso: string } | { kind: "scan" };

function Screens() {
  const shell = useShell();
  const { svc } = useExt();
  const [tab, setTab] = useState<Tab>((shell.requestedTab as Tab | undefined) ?? "wallet");
  const [view, setView] = useState<View>({ kind: "tabs" });
  const [adding, setAdding] = useState(false);
  const wallet = useLive(() => svc.wallets().then((ws) => ws.find((w) => w.chain === "sol")), []);
  const linked = Boolean(wallet.value?.address);
  // A wallet that can't be read is a Problem on the shell's screen, never a mark that loads for ever.
  useEffect(() => {
    if (wallet.value || !wallet.error) return;
    void problem(wallet.error instanceof ProblemError ? wallet.error.problem : appProblems.walletUnread()).then((again) => { if (again) wallet.reload(); });
  }, [wallet.error]);

  /** A Problem on the shell's screen; true when its next step asks to try again. */
  const problem = async (p: Problem) => (await shell.showProblem(p)).kind === "retry";
  const fail = (e: unknown) => { if (e instanceof ProblemError) void shell.showProblem(e.problem); };

  const start = async () => {
    const r = await shell.bridge.call<{ code: string; expiresAtIso: string }>("subwallet.linkStart", { kind: "extension" });
    if ("problem" in r) { if (await problem(r.problem)) void start(); return; }
    setView({ kind: "code", ...r.ok });
  };
  const scanned = async (text: string) => {
    if (!isPanelCode(text)) { if (!(await problem(appProblems.notPanelCode()))) setView({ kind: "tabs" }); return; }
    setView({ kind: "tabs" });
    const r = await shell.bridge.call("subwallet.import", { kind: "extension", sealed: text });
    if ("problem" in r) {
      await problem(r.problem);
      if (r.problem.code !== "security.link.declined") void start();   // expired or wrong: start again, with a new code; a No ends here
      return;
    }
    setTab("wallet");
    wallet.reload();
  };

  if (view.kind === "code") return (
    <PushedFrame name="Link" onBack={() => setView({ kind: "tabs" })}>
      <Code code={view.code} expiresAtIso={view.expiresAtIso} onScan={() => setView({ kind: "scan" })}
        onRanOut={async () => { setView({ kind: "tabs" }); if (await problem(appProblems.codeRanOut())) void start(); }} />
    </PushedFrame>
  );
  if (view.kind === "scan") return (
    <PushedFrame name="Scan" onBack={() => setView({ kind: "tabs" })}>
      <Scan active={shell.active} onCode={(t) => void scanned(t)}
        onCameraOff={async () => { setView({ kind: "tabs" }); if (await problem(appProblems.cameraOff())) setView({ kind: "scan" }); }} />
    </PushedFrame>
  );
  return (
    <div className="ea-app">
      <AppFrame name="Extension" tray={TRAY} tab={tab} onTab={setTab}>
        {!wallet.value ? <div className="ea-center"><Mark size={48} mode="loading" /></div>
          : tab === "wallet" ? (linked ? <Home onAdd={() => setAdding(true)} onProblem={fail} /> : <NotLinked onLink={() => void start()} />)
          : tab === "activity" ? <Activity />
          : <LinkTab linked={linked} address={wallet.value.address} onLink={() => void start()} />}
      </AppFrame>
      {adding && <AddSheet onClose={() => setAdding(false)} onProblem={(e) => { setAdding(false); fail(e); }} />}
    </div>
  );
}

function NotLinked({ onLink }: { onLink: () => void }) {
  return (
    <div className="ea-page zf-enter">
      <div className="zf-fill" />
      <div className="ea-intro">
        <Mark size={96} mode="once" />
        <h1 className="zf-title">Trade from your laptop.</h1>
        <p className="zf-body">Add the ZeroFee panel to Chrome on your computer, then link it here.</p>
      </div>
      <div className="zf-fill" />
      <div className="ea-floor">
        <button className="zf-btn" onClick={onLink}>Link my laptop</button>
        <p className="zf-small">The panel has its own small wallet for trades, kept apart from your Safe.</p>
      </div>
    </div>
  );
}

/** The phone's one-time code, big, with what's left of its 5 minutes. */
function Code({ code, expiresAtIso, onScan, onRanOut }: { code: string; expiresAtIso: string; onScan: () => void; onRanOut: () => void }) {
  const [now, setNow] = useState(Date.now());
  const ranOut = useRef(onRanOut);
  ranOut.current = onRanOut;
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = timeLeft(expiresAtIso, now);
  useEffect(() => { if (left === "0:00") ranOut.current(); }, [left]);
  return (
    <div className="ea-page zf-enter">
      <div className="ea-intro ea-intro--top">
        <span className="zf-label">Link your laptop</span>
        <p className="zf-body">Type this code into the ZeroFee panel on your laptop.</p>
      </div>
      <div className="zf-fill" />
      <div className="ea-code" aria-label={`Code ${[...code].join(" ")}`}>{code}</div>
      <p className="zf-small ea-left">Works once · {left} left</p>
      <div className="zf-fill" />
      <div className="ea-floor">
        <button className="zf-btn" onClick={onScan}>Scan the panel's code</button>
        <p className="zf-small">The panel shows it after you type the code.</p>
      </div>
    </div>
  );
}

/** The camera, only while the app is on screen (Pay's watchCamera: the browser's own QR reader, no library). */
function Scan({ active, onCode, onCameraOff }: { active: boolean; onCode: (text: string) => void; onCameraOff: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [cam, setCam] = useState<CameraState>("off");
  const report = useRef({ onCode, onCameraOff });
  report.current = { onCode, onCameraOff };
  useEffect(() => watchCamera({
    active, env: browserCamera(), video: () => video.current,
    onState: (s) => { setCam(s); if (s === "refused" || s === "unsupported") report.current.onCameraOff(); },
    onCode: (t) => report.current.onCode(t),
  }), [active]);
  return (
    <div className="ea-page">
      <div className="ea-viewfinder">
        <video ref={video} className="ea-video" muted playsInline aria-label="Camera" />
        {cam !== "on" && <div className="ea-center ea-over"><Mark size={40} mode="loading" /></div>}
      </div>
      <p className="zf-small ea-hint">Point the camera at the square code in the panel.</p>
    </div>
  );
}

function Home({ onAdd, onProblem }: { onAdd: () => void; onProblem: (e: unknown) => void }) {
  const { svc } = useExt();
  const wallet = useLive(() => svc.wallets().then((ws) => ws.find((w) => w.chain === "sol")), []);
  const [bringing, setBringing] = useState(false);
  const w = wallet.value;
  const bring = async () => {
    setBringing(true);
    try { await svc.withdraw("sol", "all"); } catch (e) { onProblem(e); } finally { setBringing(false); }
  };
  if (!w) return <div className="ea-center"><Mark size={48} mode="loading" /></div>;
  const empty = BigInt(w.native) === 0n;
  return (
    <div className="ea-page zf-enter">
      <div className="zf-label ea-head">On your laptop</div>
      <div className="ea-total">{usd(w.nativeUsd)}</div>
      <div className="zf-small ea-native"><CoinIcon symbol="SOL" src={nativeLogoUri("sol")} size={16} /> {amount(w.native, CHAINS.sol.decimals)} SOL</div>
      <p className="zf-small ea-note">A small wallet for trades, in the ZeroFee panel in Chrome.</p>
      <div className="zf-fill" />
      <div className="ea-floor">
        <button className="zf-btn" onClick={onAdd}>Add money</button>
        {!empty && <button className="zf-link" disabled={bringing} onClick={() => void bring()}>{bringing ? "Bringing it back…" : "Bring the SOL back"}</button>}
        {!empty && <p className="zf-small">Sell coins in the panel first to bring them back too.</p>}
      </div>
    </div>
  );
}

function AddSheet({ onClose, onProblem }: { onClose: () => void; onProblem: (e: unknown) => void }) {
  const { svc, market } = useExt();
  const { showWaiting } = useShell();
  const [value, setValue] = useState("50");
  const [busy, setBusy] = useState(false);
  const px = useLive(() => market.nativeUsd("sol"), []);
  const main = useLive(() => svc.mainBalance("sol"), []);
  const add = async () => {
    setBusy(true);
    // a fund the account's protection holds (D17) goes to the shell's Waiting screen; nothing has moved yet
    try { const rec = await svc.fund("sol", Number(value)); if (rec.held) showWaiting(rec.held); onClose(); } catch (e) { onProblem(e); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Add to your laptop" onClose={onClose}>
      <div className="ea-big">${value}</div>
      <div className="ea-presets">
        {ADD_PRESETS.map((v) => <button key={v} className={v === value ? "on" : ""} onClick={() => setValue(v)}>${v}</button>)}
      </div>
      <div className="ea-kvs">
        <div className="ea-kv"><span>Arrives as</span><span>{px.value ? `about ${(Number(value) / px.value).toFixed(3)} SOL` : ""}</span></div>
        <div className="ea-kv"><span>From</span><span>Your Safe{main.value ? ` · ${usd(main.value.usd)}` : ""}</span></div>
      </div>
      <div className="ea-floor">
        <button className="zf-btn" disabled={busy} onClick={() => void add()}><Face />{busy ? "Adding…" : `Add $${value}`}</button>
        <p className="zf-small">Face ID, then it lands in the panel on your laptop.</p>
      </div>
    </Sheet>
  );
}

function Activity() {
  const { svc } = useExt();
  const list = useLive(() => svc.activity(), []);
  if (!list.value) return <div className="ea-center"><Mark size={48} mode="loading" /></div>;
  const rows = list.value.filter((r) => r.kind === "fund" || r.kind === "withdraw");
  if (rows.length === 0) return <p className="zf-small ea-none">Money you add to the laptop, or bring back, appears here.</p>;
  return (
    <div className="zf-enter">
      {rows.map((r) => (
        <div key={r.id} className="zf-row ea-row">
          <CoinIcon symbol="SOL" src={nativeLogoUri("sol")} size={30} />
          <span><span className="t">{r.kind === "fund" ? "Added to the laptop" : "Brought back"}</span><span className="d">{movementStatus(r)}</span></span>
          <span className="ea-right"><span className="v">{usd(r.amountUsd)}</span><span className="d">{ago(r.startedAt)}</span></span>
        </div>
      ))}
    </div>
  );
}

function LinkTab({ linked, address, onLink }: { linked: boolean; address?: string; onLink: () => void }) {
  if (!linked) return <NotLinked onLink={onLink} />;
  return (
    <div className="ea-page zf-enter">
      <div className="zf-label ea-head">Linked</div>
      <p className="zf-body ea-linked">The ZeroFee panel in Chrome on your laptop.</p>
      <p className="ea-addr">{address}</p>
      <div className="zf-fill" />
      <div className="ea-floor">
        <button className="zf-link" onClick={onLink}>Link again</button>
        <p className="zf-small">For a new browser, or after a reinstall.</p>
      </div>
    </div>
  );
}

function Root() {
  const shell = useShell();
  return <ExtensionProvider bridge={shell.bridge} active={shell.active}><Screens /></ExtensionProvider>;
}

export const extensionApp: AppModule = { id: "extension", name: "Extension", line: "Trade on your laptop", Root };
