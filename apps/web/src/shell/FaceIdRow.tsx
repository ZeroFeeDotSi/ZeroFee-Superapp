// Settings' Face ID row on the iPhone (H54: it was static "On"). It reads the phone's own state (device.phoneCheck) and
// says it plainly; a tap first warns what changing Face ID does to the key (H15), then opens ZeroFee's page in Settings.
// In a browser there is no Face ID, so there is no row.
import { useEffect, useState } from "react";
import type { IosHost } from "../host/ios.ts";
import { openSettings } from "../host/phone-check.ts";

/** The row's value for each phone-check answer. */
export function faceIdState(blocker: string | null): string {
  switch (blocker) {
    case null: return "On";
    case "security.faceid.off": return "Off for ZeroFee";
    case "security.faceid.locked": return "Locked";
    case "security.faceid.not-set-up": return "Not set up";
    case "security.passcode.not-set": return "No passcode";
    case "security.chip.missing": return "Not on this iPhone";
    default: return "";
  }
}

/** The one warning before anything that changes Face ID (H15), the same words wherever it shows. */
export const FACE_ID_CHANGE_WARNING =
  "Changing Face ID stops your key on this iPhone for good. That includes adding a face or an Alternate Appearance. Your 24 words bring it back after your recovery wait.";

export function FaceIdRow({ host }: { host: IosHost }) {
  const [blocker, setBlocker] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () => void host.call<{ blocker: string | null }>("device.phoneCheck").then((r) => live && setBlocker("ok" in r ? r.ok.blocker : undefined));
    read();
    // Back from Settings: read it again.
    const back = () => document.visibilityState === "visible" && read();
    document.addEventListener("visibilitychange", back);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", back);
    };
  }, [host]);
  if (blocker === undefined) return null;
  return (
    <>
      <button className="set__row set__row--btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>Face ID</span>
        <span>{faceIdState(blocker)}</span>
      </button>
      {open && (
        <div className="set__faceid">
          <p className="zf-small">{FACE_ID_CHANGE_WARNING}</p>
          <button className="zf-link set__faceid-go" onClick={() => void openSettings(host)}>Open Settings</button>
        </div>
      )}
    </>
  );
}
