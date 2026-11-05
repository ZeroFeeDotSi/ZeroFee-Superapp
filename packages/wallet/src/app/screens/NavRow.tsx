// One row that opens a screen: its name, one short line, and a chevron. The account's rows behind Home's menu glyph
// (Protection, Devices, Recovery, Activity, Details, Settings) are these. `icon` names its leading line icon (§2.3 G1:
// a 30 pt tile, an 18 pt line), drawn in CSS (wallet.css .wl-nav[data-ic]) so Home's first load carries no SVG for it.
import { Chevron } from "@zerofee/design/icons.tsx";

export type NavIcon = "shield" | "shield-check" | "phone" | "words" | "clock" | "code" | "dials";

/** `tone` "red": a danger the row names (Security's Quantum-safe row when a key can bypass the Safe's rules). */
export function NavRow({ title, line, value, icon, tone, onClick }: { title: string; line?: string; value?: string; icon?: NavIcon; tone?: "red"; onClick: () => void }) {
  return (
    <button className="wl-row wl-pick wl-nav" data-ic={icon} data-tone={tone} onClick={onClick}>
      {icon && <span className="wl-nav-ic" aria-hidden="true" />}
      <div><div className="t">{title}</div>{line && <div className="d">{line}</div>}</div>
      <div className="r">{value && <div className="vd">{value}</div>}</div>
      <span className="wl-nav-chev" aria-hidden="true"><Chevron /></span>
    </button>
  );
}
