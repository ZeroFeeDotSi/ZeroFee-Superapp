// The laptop as a second signer (/laptop, D54; /?laptop too). Its own core and key, apart from the phone's: before pairing it shows the
// code the phone scans and the key's fingerprint; once paired, what the account's rules are holding for its yes, read
// from the chain in the phone's own words, and its own approval sheet for each answer. It never holds money and never
// sees the phone's key.
import { useEffect, useState } from "react";
import type { BridgeResult } from "@zerofee/core/bridge";
import type { PlainWords } from "@zerofee/core/signer";
import type { Problem } from "@zerofee/core/problem";
import { SecondDeviceCore } from "@zerofee/core/second-device";
import { RpcChain } from "@zerofee/core/chain";
import { BrowserVault } from "@zerofee/core/vault";
import { Mark } from "@zerofee/design/Mark.tsx";
import { QrCode } from "@zerofee/design/QrCode.tsx";
import { More } from "@zerofee/design/More.tsx";
import { ProblemView } from "@zerofee/shell-api/ProblemView.tsx";
import { ApprovalSheetView } from "../shell/ApprovalSheetView.tsx";
import { LAPTOP_SAME_BROWSER, MAINNET, laptopRefusedHere, laptopVaultName } from "../mode.ts";
import { requireActivation } from "../unlock/activation.ts";
import { browserDevice } from "../unlock/device.ts";
import { LaptopRequestList, SAID_YES } from "./RecoveryRequest.tsx";
import { withinDeadline } from "./laptop-load.ts";
import { Loading } from "./LaptopLoading.tsx";
import { LAPTOP_START } from "../unlock/laptop-lock-words.ts";
import type { TxOutcome } from "@zerofee/core/signer";
import "./laptop.css";

// A vault of its own, so phone and laptop can share one browser in the demo without sharing a key; on mainnet another,
// so testnet and mainnet keys never mix.
// Its sheet's Approve counts only with a person's own tap (audit K-6).
// D143: the laptop's yes counts only with a fresh check that the person is there (its unlock passkey, the iPhone)
const core = requireActivation(new SecondDeviceCore({ chain: new RpcChain(MAINNET ? "mainnet" : "testnet"), vault: new BrowserVault(laptopVaultName(MAINNET)), stepUp: (reason) => import("../unlock/verify.ts").then((m) => m.webUserVerified(() => browserDevice().readRecord())(reason)) }));
const POLL_MS = 15_000;
/** Before it is added: looked for every 3 s, so the phone's yes shows here within seconds (grade 1 Nov, D9). */
const POLL_UNPAIRED_MS = 3_000;

type State = { code: string; fingerprint: string; accounts: string[] };
/** `kind` "Recovery" (release 7): the waiting move to a new device itself, answered with approve_recovery or refuse_recovery. */
type Request = { id: string; title: string; lines: string[]; readyAtIso: string; kind?: string; needsSecondDevice?: boolean; warning?: string };
type Waiting = { accountId: string; requests: Request[] };

/** The browser's IndexedDB names, or null when it can't list them. */
async function vaultNames(): Promise<string[] | null> {
  try {
    const dbs = await indexedDB.databases();
    return dbs.map((d) => d.name ?? "").filter(Boolean);
  } catch {
    return null;
  }
}

/** K-8: before any key is made here, refuse a browser that already holds the account (it can't be its own second device). */
export function Laptop() {
  const [refused, setRefused] = useState<boolean | null>(null);
  useEffect(() => {
    void vaultNames().then((names) => setRefused(laptopRefusedHere(names, MAINNET)));
  }, []);
  if (refused === null) return <Loading />;
  if (refused) {
    return (
      <div className="lp">
        <ProblemView problem={{ code: "shell.laptop.same-browser", whatHappened: LAPTOP_SAME_BROWSER, money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Open ZeroFee" } }} onNext={() => location.assign("/")} />
      </div>
    );
  }
  return <LaptopPage />;
}
function LaptopPage() {
  const [state, setState] = useState<State | null>(null);
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  // One sheet at a time: a second request lines up behind the one showing and never replaces its words.
  const [sheets, setSheets] = useState<{ id: string; words: PlainWords }[]>([]);
  const sheet = sheets[0];
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // For a phone that can't read the dense code: copy it and paste it on the phone ("Or paste the code").
  const copyCode = async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const take = <T,>(res: BridgeResult<T>): T | null => {
    if ("problem" in res) {
      setProblem(res.problem);
      return null;
    }
    return res.ok;
  };
  const refresh = async () => {
    // a read that never answers ends as "NEAR didn't answer" with Try again (laptop-load.ts), never an endless mark
    const s = take(await withinDeadline(() => core.call<State>("secondDevice.state")));
    if (!s) return;
    // Just added (D9): said at once, by name, so the laptop never still says "Scan this" after the phone's yes.
    setState((before) => {
      const fresh = s.accounts.filter((a) => before && !before.accounts.includes(a));
      if (before && before.accounts.length === 0 && fresh.length) setAdded(fresh[0]!);
      return s;
    });
    if (s.accounts.length) {
      const w = take(await core.call<Waiting[]>("secondDevice.requests"));
      if (w) setWaiting(w);
    }
  };
  const [added, setAdded] = useState<string | null>(null);
  const unpaired = !state || state.accounts.length === 0;
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), unpaired ? POLL_UNPAIRED_MS : POLL_MS);
    return () => clearInterval(t);
  }, [unpaired]);
  useEffect(() => core.on<{ id: string; words: PlainWords }>("approval.needed", (p) => setSheets((q) => (q.some((x) => x.id === p.id) ? q : [...q, p]))), []);

  // `freeze` (R7-9): the refusal of a move while the phone's stop waits; the core takes it once the contract does.
  // H43: what the answer just did, said at once (the list then shows a yes that still waits, until it goes).
  const [said, setSaid] = useState<string | null>(null);
  const answer = async (accountId: string, id: string, approve: boolean, freeze?: boolean) => {
    setBusy(id);
    setSaid(null);
    const out = take(await core.call<TxOutcome>("secondDevice.answer", { accountId, id, approve, ...(freeze !== undefined ? { freeze } : {}) }));
    setBusy(null);
    // A move to a new device (and the phone's stop of one) says its own outcome on its card; a declined sheet (you closed
    // it) changed nothing.
    const kind = waiting.find((w) => w.accountId === accountId)?.requests.find((r) => r.id === id)?.kind;
    if (out && out.status === "problem") setProblem(out.problem);
    else if (out && kind !== "Recovery" && kind !== "CancelRecovery" && out.status !== "declined") setSaid(!approve ? SAID_YES.no : out.status === "done" ? SAID_YES.sent : SAID_YES.waiting);
    await refresh();
  };

  if (problem) return <div className="lp"><ProblemView problem={problem} onNext={() => setProblem(null)} /></div>;
  if (!state) return <Loading />;
  const paired = state.accounts.length > 0;
  const open = waiting.flatMap((w) => w.requests.map((r) => ({ ...r, accountId: w.accountId })));
  return (
    <div className="lp">
      <header className="lp-top"><Mark size={28} mode="still" /><span className="zf-label" style={{ color: "var(--ink)" }}>ZeroFee on this laptop</span></header>
      {!paired ? (
        <main className="lp-main lp-center zf-enter">
          <h1 className="zf-title">Scan this with your main device</h1>
          <p className="zf-body" style={{ marginTop: 10, maxWidth: 380 }}>{LAPTOP_START.pairOn}</p>
          <More label="What this laptop will do" lines={["Payments above the amount you choose there need its yes too.", "So does moving your account to a new device."]} />
          <div className="lp-qr" data-code={state.code}><QrCode value={state.code} size={740} label="Pairing code" /></div>
          <button className="zf-link" style={{ marginTop: 10 }} onClick={copyCode}>{copied ? "Copied" : "Or copy the code and paste it on your main device"}</button>
          <div className="zf-label" style={{ marginTop: 22 }}>This laptop's key</div>
          <div className="lp-fp">{state.fingerprint}</div>
          <p className="zf-small" style={{ marginTop: 8 }}>Your main device shows these letters too. If they differ, stop.</p>
          <p className="zf-small" role="status" style={{ marginTop: 14 }}>This page updates by itself once you approve.</p>
        </main>
      ) : (
        <main className="lp-main zf-enter">
          <div className="zf-label">Guarding</div>
          {state.accounts.map((a) => <div key={a} className="lp-account">{a}</div>)}
          {added && <p className="zf-body lp-said-now" role="status" style={{ marginTop: 24 }}>Added to {added} ✓ Keep this tab: it's how this laptop says yes.</p>}
          {said && <p className="zf-body lp-said-now" role="status" style={{ marginTop: 24 }}>{said}</p>}
          <div className="zf-label" style={{ marginTop: 34 }}>Waiting for your yes</div>
          {open.length === 0 && <p className="zf-small" style={{ marginTop: 10 }}>Nothing right now. This page checks every 15 seconds.</p>}
          <LaptopRequestList requests={open} busy={busy} onAnswer={(accountId, id, approve, freeze) => void answer(accountId, id, approve, freeze)} />
          <p className="zf-small" style={{ marginTop: 30 }}>This laptop only says yes or no.</p>
          <More label="What it answers" lines={["What your main device asks. Also any move of your account to a new device.", "It can't start a payment or change your rules."]} />
        </main>
      )}
      {sheet && (
        <div className="lp-sheet">
          <ApprovalSheetView key={sheet.id} id={sheet.id} words={sheet.words} onAnswer={(approve) => { void core.call("approval.answer", { id: sheet.id, approve }); setSheets((q) => q.filter((x) => x.id !== sheet.id)); }} />
        </div>
      )}
    </div>
  );
}
