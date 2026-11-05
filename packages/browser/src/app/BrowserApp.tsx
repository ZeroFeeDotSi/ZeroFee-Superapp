// The Browser app (board approved by UI, 26 Oct): Browse · Sites · Wallet, inside the shell's frame.
// - Browse: type a site or scan its code, or tap a preset. The site opens in ZeroFee's own window on the phone, with its
//   real host in our bar and the Browser wallet built in (device.openSite); the web demo opens it in a plain browser
//   window, without the wallet, and says so. fomo is the exception: it has no phone web app, so on the phone it opens
//   in fomo's own app (or its App Store page), as from Social trading (social/fomo-app.ts).
// - Sites: who can see the Browser wallet's address, with one-tap Disconnect; history on this phone only.
// - Wallet: one wallet per network (D55), shared with Trade, Apps and Chat: they are all in Wallet's Details.
// The connect sheet and every signature are native (the host's and Security's); nothing here draws them. Every Problem
// goes to the shell's Problem screen.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Problem } from "@zerofee/core/problem";
import { Mark } from "@zerofee/design/Mark.tsx";
import type { AppModule } from "@zerofee/shell-api/app-module.ts";
import { AppFrame, PushedFrame, useShell, type TrayItem } from "@zerofee/shell-api/AppFrame.tsx";
import { browserCamera, watchCamera, type CameraState } from "@zerofee/pay/app/camera.ts";
import { browserProblems } from "../browser-problems.ts";
import { PRESETS, presetForHost, type Preset } from "../presets.ts";
import { siteUrl } from "../sites.ts";
import { proofUrlOk } from "@zerofee/core/tx-proof";
import { addVisit, clearHistory, loadHistory, openSite, type Visit } from "../visits.ts";
import { FOMO_STORE_LINE_BROWSER, hasPhoneHost, openFomoApp } from "../social/fomo-app.ts";
import { CHAIN, Logo, PRESET_LOGO, when } from "./chains.tsx";
import { Scan, TrayBrowse, TraySites, TrayWallet } from "./icons.tsx";
import { SiteRow, useConnections } from "./SiteRows.tsx";
import "./browser.css";

// "Send AgentZero" (D79, BR1–BR3): its own cloud browser, loaded only when opened, shown only behind AGENT_BROWSER.
// A local copy of agent/flag.ts's (a test keeps them equal): the bundler folds a constant of this file away, so while it's
// false the Browser tab's first load carries none of this; an imported one it kept (+0.24 KB on Home).
const AGENT_BROWSER = (import.meta.env?.VITE_AGENT_BROWSER === "1") as boolean;
const LiveView = AGENT_BROWSER ? lazy(() => import("./LiveView.tsx")) : null;

type Tab = "browse" | "sites" | "wallet";
const TRAY: TrayItem<Tab>[] = [
  { id: "browse", label: "Browse", icon: TrayBrowse },
  { id: "sites", label: "Sites", icon: TraySites },
  { id: "wallet", label: "Wallet", icon: TrayWallet },
];
const TABS = TRAY.map((t) => t.id);

function BrowserScreens() {
  const shell = useShell();
  const asked = shell.requestedTab as Tab | undefined;
  const [tab, setTab] = useState<Tab>(asked && TABS.includes(asked) ? asked : "browse");
  const [scanning, setScanning] = useState(false);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (asked && TABS.includes(asked)) setTab(asked);
  }, [asked, shell.requestSeq]);

  const problem = async (p: Problem, retry?: () => void) => {
    const step = await shell.showProblem(p);
    if (step.kind === "retry") retry?.();
    if (step.kind === "fix-input") field.current?.focus();
  };

  const open = async (url: string) => {
    const host = new URL(url).host;
    const preset = presetForHost(host);
    // fomo (its preset, typed or from history) has no phone web app: on the phone it opens in fomo's own app, never a
    // window (fomo-app.ts; the host accepts fomo.family only).
    if (preset?.ownApp && hasPhoneHost()) {
      const r = await openFomoApp(shell.bridge);
      if ("problem" in r) return problem(r.problem, () => void open(url));
      await addVisit(shell.bridge, url);
      setNote(r.opened === "store" ? FOMO_STORE_LINE_BROWSER : null);
      return;
    }
    const r = await openSite(shell.bridge, url, preset?.desktop ?? false);
    if ("problem" in r) return problem(browserProblems.siteUnreachable(host), () => void open(url));
    await addVisit(shell.bridge, url);
    const phoneWay = preset?.ownApp ? `${preset.name} opens in its own app` : "your wallet is built in";
    setNote(r.opened === "plain" ? `${host} opened without your wallet. In the phone app, ${phoneWay}.` : null);
  };

  // a transaction's page another app handed over (Home's Activity proof, product decision, 3 Nov): opened here in the normal mode,
  // never Safari; only a known explorer's page (core tx-proof.ts PROOF_HOSTS), never any other site handed over this way
  useEffect(() => {
    const link = shell.requestedLink;
    if (link && proofUrlOk(link)) void open(link);
  }, [shell.requestedLink, shell.requestSeq]);

  const go = (text: string) => {
    const r = siteUrl(text);
    if ("url" in r) return void open(r.url);
    void problem(r.problem === "insecure" ? browserProblems.addressInsecure(r.host ?? text) : browserProblems.addressInvalid());
  };

  if (AGENT_BROWSER && LiveView && sending) {
    return (
      <PushedFrame name="Send AgentZero" onBack={() => setSending(false)}>
        <Suspense fallback={null}>
          <LiveView onClose={() => setSending(false)} />
        </Suspense>
      </PushedFrame>
    );
  }

  if (scanning) {
    return (
      <PushedFrame name="Scan a site" onBack={() => setScanning(false)}>
        <ScanSite
          active={shell.active}
          onCode={(code) => {
            setScanning(false);
            go(code);
          }}
          onCameraOff={() => setScanning(false)}
        />
      </PushedFrame>
    );
  }

  return (
    <AppFrame name="Browser" tray={TRAY} tab={tab} onTab={setTab}>
      {tab === "browse" && (
        <div className="br-page zf-enter">
          <form
            className="br-field"
            onSubmit={(e) => {
              e.preventDefault();
              go(typed);
            }}
          >
            <input
              ref={field}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type a site or scan"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              aria-label="A site's address"
            />
            <button type="button" className="zf-icon-btn" onClick={() => setScanning(true)} aria-label="Scan a site's code">
              <Scan />
            </button>
          </form>
          {note && <p className="zf-note br-note">{note}</p>}
          {AGENT_BROWSER && (
            <button className="zf-btn zf-btn--quiet" onClick={() => setSending(true)}>Send AgentZero</button>
          )}
          <div className="zf-label br-head">Ready to open</div>
          {PRESETS.map((p) => (
            <PresetRow key={p.id} preset={p} onOpen={() => void open(p.url)} />
          ))}
        </div>
      )}
      {tab === "sites" && <Sites onOpen={(url) => void open(url)} />}
      {tab === "wallet" && (
        <div className="br-page zf-enter">
          <button className="zf-row" onClick={() => shell.openApp("wallet", "details")}><span><span className="t">Your wallets are in Wallet, Details</span><span className="d">One per network: the same wallets Trade, your apps and Chat use</span></span></button>
        </div>
      )}
    </AppFrame>
  );
}

function PresetRow({ preset, onOpen }: { preset: Preset; onOpen: () => void }) {
  const host = preset.hosts[0];
  const chains = preset.chains.map((c) => CHAIN[c].name).join(", ");
  // The board's lines: the real host unless the name already is it, and what is special about the site.
  const line = preset.ownApp ? `${host} · ${hasPhoneHost() ? "opens in its own app" : "its own app on the phone"}` : preset.desktop ? `${host} · the full website` : preset.name === host ? `${chains} · your wallet answers` : `${host} · ${chains}`;
  return (
    <button className="zf-row br-row" onClick={onOpen}>
      <Logo src={PRESET_LOGO[preset.id]} />
      <span>
        <div className="t">{preset.name}</div>
        <div className="d">{line}</div>
      </span>
      <span />
    </button>
  );
}

function Sites({ onOpen }: { onOpen: (url: string) => void }) {
  const { bridge, active } = useShell();
  const { list: connected, disconnect } = useConnections(bridge, active);
  const [history, setHistory] = useState<Visit[]>([]);
  useEffect(() => {
    if (active) void loadHistory(bridge).then(setHistory);
  }, [active, bridge]);

  if (!connected) return <div className="br-center"><Mark size={40} mode="loading" /></div>;
  if (!connected.length && !history.length) return <p className="zf-body br-empty zf-enter">No site can see your wallet.</p>;
  return (
    <div className="br-page zf-enter">
      {connected.length ? <div className="zf-label br-head">Can see your wallet</div> : <p className="zf-small br-head">No site can see your wallet.</p>}
      {connected.map((c) => (
        <SiteRow key={c.host} site={c} onDisconnect={() => disconnect(c.host)} />
      ))}
      {history.length > 0 && (
        <>
          <div className="zf-label br-head">History, on this phone only</div>
          {history.map((v) => (
            <button key={v.host} className="zf-row br-row" onClick={() => onOpen(v.url)}>
              <Logo src={PRESET_LOGO[presetForHost(v.host)?.id ?? ""]} />
              <span className="t">{v.host}</span>
              <span className="v">{when(v.atIso)}</span>
            </button>
          ))}
          <button className="zf-link br-clear" onClick={() => void clearHistory(bridge).then(() => setHistory([]))}>Clear history</button>
        </>
      )}
    </div>
  );
}

/** The camera, only while the app is on screen (Pay's watchCamera: the browser's own QR reader, no library). */
function ScanSite({ active, onCode, onCameraOff }: { active: boolean; onCode: (text: string) => void; onCameraOff: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [cam, setCam] = useState<CameraState>("off");
  const report = useRef({ onCode, onCameraOff });
  report.current = { onCode, onCameraOff };
  useEffect(
    () =>
      watchCamera({
        active,
        env: browserCamera(),
        video: () => video.current,
        onState: (s) => {
          setCam(s);
          if (s === "refused" || s === "unsupported") report.current.onCameraOff();
        },
        onCode: (t) => report.current.onCode(t),
      }),
    [active],
  );
  return (
    <div className="br-page">
      <div className="br-viewfinder">
        <video ref={video} className="br-video" muted playsInline aria-label="Camera" />
        {cam !== "on" && <div className="br-center br-over"><Mark size={40} mode="loading" /></div>}
      </div>
      <p className="zf-small br-line">Point the camera at a site's code.</p>
    </div>
  );
}

export const browserApp: AppModule = { id: "browser", name: "Browser", line: "fomo, pump.fun and more", Root: BrowserScreens };
