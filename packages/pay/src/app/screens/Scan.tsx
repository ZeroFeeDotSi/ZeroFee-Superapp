// Scan: the camera reads any payment code; "From a photo" reads one in a picture from Photos; "Paste a code" takes one
// that arrived as text. All three go to the same Confirm.
// The camera (camera.ts) uses the browser's own BarcodeDetector where it has one, so no QR library ships for it. Where
// there's no camera or no detector, the screen says so and Paste becomes the one pill.
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { Problem } from "@zerofee/core/problem";
import { add } from "../../amount.ts";
import { isUsdStable } from "../../tokens.ts";
import { payProblems } from "../../pay-problems.ts";
import { browserCamera, readPhoto, watchCamera, type CameraState } from "../camera.ts";
import { readCopied } from "../clipboard.ts";
import { shown } from "../format.ts";
import { CameraOff } from "../icons.tsx";
import { usePay } from "../runtime.tsx";

/** `active`: Pay is the app on screen (useShell().active). Off screen, the camera is never asked for. */
export function Scan({ onCode, onProblem, active }: { onCode: (text: string) => void; onProblem: (p: Problem) => void; active: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const report = useRef(onCode);
  report.current = onCode;
  const [cam, setCam] = useState<CameraState>("off");
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const { balances, bridge } = usePay();
  // One quiet line before the scan: the coin that will be spent, and how much of it there is, across every chain.
  // Only coins the ledger can name: an unlisted coin calling itself "USDC" never counts.
  const listed = balances.filter((b) => b.listed !== false);
  const main = listed.some((b) => b.symbol === "USDC") ? "USDC" : listed.find((b) => isUsdStable(b.symbol))?.symbol;
  const total = main ? listed.filter((b) => b.symbol === main).reduce((sum, b) => add(sum, b.usd ?? b.amount), "0") : null;

  useEffect(
    () => watchCamera({ active, env: browserCamera(), video: () => video.current, onState: setCam, onCode: (c) => report.current(c) }),
    [active],
  );

  const paste = async () => {
    // What was copied, through the phone host where there is one; nothing readable: type or paste it into the field.
    const clip = await readCopied(bridge);
    if (clip) return onCode(clip);
    setPasting(true);
  };
  /** The picked photo, read once; the input is cleared so the same photo can be picked again. */
  const picked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const read = await readPhoto(file, browserCamera());
    if ("code" in read) return onCode(read.code);
    onProblem("none" in read ? payProblems.photoNoCode() : payProblems.photoUnsupported());
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) onCode(text.trim());
  };
  const camera = cam === "on" || cam === "starting" || cam === "off";

  return (
    <div className="py py-col">
      {camera ? (
        <div className="py-camera">
          <video ref={video} muted playsInline />
          <div className="py-frame" aria-hidden="true"><i /><i /><i /><i /></div>
          <span className="zf-label">Point at any payment code</span>
        </div>
      ) : (
        <div className="py-camera-off">
          <CameraOff />
          <p className="zf-body">{cam === "refused" ? "The camera is off for ZeroFee." : "This browser can't read codes with the camera."}</p>
          <p className="zf-small">{cam === "refused" ? "To scan, allow the camera in your settings." : "Paste the code instead."}</p>
        </div>
      )}
      {main && total && <p className="zf-small py-center" style={{ marginTop: 14 }}>Pays with {main} · ${shown(total, 2)}</p>}
      <div className="zf-fill" />
      {pasting ? (
        <form onSubmit={submit}>
          <label className="py-field">
            {/* A text area, so a pasted bank bill (SEPA or Swiss QR text, one field per line) keeps its lines. */}
            <textarea autoFocus rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="A payment code, link or address" aria-label="Payment code" />
          </label>
          <div className="py-floor"><button className="zf-btn" disabled={!text.trim()}>Read the code</button></div>
        </form>
      ) : camera ? (
        <div style={{ display: "flex", justifyContent: "center", gap: 28 }}>
          <button className="zf-link" onClick={() => photo.current?.click()}>From a photo</button>
          <button className="zf-link" onClick={paste}>Paste a code</button>
        </div>
      ) : (
        <div className="py-floor">
          <button className="zf-btn" onClick={paste}>Paste a code</button>
          <button className="zf-link" onClick={() => photo.current?.click()}>From a photo</button>
        </div>
      )}
      {/* The phone's own Photos sheet; nothing is uploaded, the picture is read on the phone. */}
      <input ref={photo} type="file" accept="image/*" hidden onChange={picked} aria-label="A photo with a payment code" />
    </div>
  );
}
