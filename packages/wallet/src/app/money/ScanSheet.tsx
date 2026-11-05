// H-5 Scan to pay: the camera fills this sheet, with one line. It loads on the first tap of Send's scan glyph. The first
// code it reads is turned into Send filled in, or one line (scan.ts), and the sheet closes: closing it, any way, stops the
// camera (watchCamera's stop runs when this unmounts). It never sends anything: Send stays the person's to check and
// approve. The camera runs only while the app is on screen (useShell().active), as Pay's and Browser's do.
import { useEffect, useRef, useState } from "react";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { browserCamera, watchCamera, type CameraState } from "@zerofee/pay/app/camera.ts";
import type { TokenDirectory } from "@zerofee/pay/tokens";
import { SCAN_LINE, readScan, type ScanResult } from "./scan.ts";

export function ScanSheet({ tokens, self, onResult, onClose }: { tokens: TokenDirectory | undefined; self?: string; onResult: (r: ScanResult) => void; onClose: () => void }) {
  const { active } = useShell();
  const video = useRef<HTMLVideoElement>(null);
  const [cam, setCam] = useState<CameraState>("off");
  const report = useRef(onResult);
  report.current = onResult;
  // the page goes out of sight (another tab, the phone locked): the sheet closes, and the camera with it (review L6)
  const shut = useRef(onClose);
  shut.current = onClose;
  useEffect(() => {
    const away = () => document.visibilityState === "hidden" && shut.current();
    document.addEventListener("visibilitychange", away);
    return () => document.removeEventListener("visibilitychange", away);
  }, []);
  const ctx = useRef({ tokens, self });
  ctx.current = { tokens, self };
  useEffect(
    () => watchCamera({ active, env: browserCamera(), video: () => video.current, onState: setCam, onCode: (code) => report.current(readScan(code, ctx.current)) }),
    [active],
  );
  const off = cam === "refused" || cam === "unsupported";
  return (
    <Sheet title="Scan" onClose={onClose}>
      {off ? (
        <div className="py-camera-off" data-testid="scan-off">
          <p className="zf-body">{cam === "refused" ? "The camera is off for ZeroFee." : "The camera can't read codes here."}</p>
          <p className="zf-small">{cam === "refused" ? "Allow it in Settings, or paste the address." : "Paste the address instead."}</p>
        </div>
      ) : (
        <div className="py-camera" data-testid="scan-camera">
          <video ref={video} muted playsInline aria-label="Camera" />
          <div className="py-frame" aria-hidden="true"><i /><i /><i /><i /></div>
          <span className="zf-label" style={{ padding: "0 16px" }}>{SCAN_LINE}</span>
        </div>
      )}
    </Sheet>
  );
}
