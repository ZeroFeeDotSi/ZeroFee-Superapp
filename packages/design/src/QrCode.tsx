// A QR code: always dark squares on a white tile, in both themes, because many phone scanners can't read an inverted
// code. In dark mode it sits as a white rounded tile on the black page. Used for receive addresses, payment requests and
// pairing codes. The quiet zone is part of the code: don't crop it.
import { useMemo } from "react";
import qrcode from "qrcode-generator";

export function QrCode({ value, size = 220, label }: { value: string; size?: number; label?: string }) {
  const cells = useMemo(() => {
    // Alphanumeric mode (digits, capitals, space $%*+-./:) packs 45% tighter, so long codes like a laptop's pairing
    // key fit; they also drop to error level L, the only level that holds them.
    const alnum = /^[0-9A-Z $%*+\-./:]+$/.test(value);
    const qr = qrcode(0, value.length > 1200 ? "L" : "M");
    qr.addData(value, alnum ? "Alphanumeric" : "Byte");
    qr.make();
    const n = qr.getModuleCount();
    const dark: string[] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark.push(`M${c + 4} ${r + 4}h1v1h-1z`);
    return { n: n + 8, path: dark.join("") };
  }, [value]);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${cells.n} ${cells.n}`} role="img" aria-label={label ?? "QR code"} shapeRendering="crispEdges">
      <rect width={cells.n} height={cells.n} rx={2} fill="#ffffff" />
      <path d={cells.path} fill="#0b0b0c" />
    </svg>
  );
}
