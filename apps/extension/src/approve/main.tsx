// D157: the extension's own approval window (approve.html#<ask id>), opened over the whole screen by the app's page
// (web host/extension.ts askWindow). It asks the app's page for its one ask, shows the sheet's words (the app's own
// ApprovalSheetView) or the passkey moment, runs that one WebAuthn request here (the person's iPhone), and hands the
// answer back. It decides nothing: the app's page checks the answer itself (verify.ts). Closing it is a no.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@zerofee/design/tokens.css";
import "@zerofee/design/ui.css";
import "@zerofee/design/motion.css";
import { applyTheme, savedTheme } from "../../../web/src/shell/theme.ts";
import { ApprovalSheetView } from "../../../web/src/shell/ApprovalSheetView.tsx";
import { IPHONE_KEY } from "../../../web/src/unlock/passkey.ts";
import { credentialToWire, fromWire, readAsk, type Answer, type Ask } from "../../../web/src/host/extension.ts";
import { momentWords } from "./words.ts";
import "./approve.css";

applyTheme(savedTheme());
const id = location.hash.slice(1);
const send = (answer: Answer) => chrome.runtime.sendMessage({ t: "zf.approve.answer", id, answer }).catch(() => undefined).finally(() => window.close());

async function run(ask: Ask): Promise<Answer> {
  try {
    const publicKey = fromWire(ask.publicKey) as PublicKeyCredentialRequestOptions & PublicKeyCredentialCreationOptions;
    const got = ask.kind === "create" ? await navigator.credentials.create({ publicKey }) : await navigator.credentials.get({ publicKey });
    if (!got) return { error: { name: "NotAllowedError", message: "Nothing came back." } };
    return { credential: credentialToWire(got as unknown as Parameters<typeof credentialToWire>[0]) };
  } catch (e) {
    return { error: { name: e instanceof DOMException ? e.name : "NotAllowedError", message: e instanceof Error ? e.message : "Stopped." } };
  }
}

function Approve() {
  const [ask, setAsk] = useState<Ask | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void chrome.runtime.sendMessage({ t: "zf.approve.ready", id }).then((m) => setAsk(readAsk(m)), () => setAsk(null));
  }, []);
  // an ask this window won't run (or none): the page hears a no at once
  useEffect(() => { if (ask === null) void chrome.runtime.sendMessage({ t: "zf.approve.answer", id, answer: { error: { name: "NotAllowedError", message: "Not allowed here." } } }).catch(() => undefined); }, [ask]);
  // a passkey moment without a sheet starts at once (the window opened focused for it)
  useEffect(() => { if (ask && !ask.words) { setBusy(true); void run(ask).then(send); } }, [ask]);
  if (ask === undefined) return null;
  if (ask === null) {
    return (
      <div className="zf-screen zf-pad approve-moment">
        <p className="zf-body">{momentWords.gone}</p>
        <button className="zf-btn" onClick={() => window.close()}>Close</button>
      </div>
    );
  }
  if (ask.words && !busy) {
    return <ApprovalSheetView words={ask.words} onAnswer={(yes) => { if (!yes) { void send({ declined: true }); return; } setBusy(true); void run(ask).then(send); }} />;
  }
  return (
    <div className="zf-screen zf-pad approve-moment" role="status">
      <h1 className="zf-title">{ask.words ? ask.words.title : momentWords.title(ask)}</h1>
      <p className="zf-body">{IPHONE_KEY}</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Approve /></StrictMode>);
