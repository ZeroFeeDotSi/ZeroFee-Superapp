// Settings > Open source. Monument: hairlines, spaced capitals, air. Every notice is plain text (React children, never
// HTML); every link (TradingView's attribution, a licence kept in a package's repository) opens through the shell's browser sheet via `onOpenUrl`. No hooks, so
// the screen is the same tree on every render (each licence folds open with the platform's own <details>).
import { CODE_LABEL, NOTICES, POSITIONING, codeHref, noticeMeta, type Notices } from "./open-source.ts";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import "./open-source.css";

export function OpenSourceScreen({ onClose, onOpenUrl, notices = NOTICES, codeUrl }: { onClose: () => void; onOpenUrl?: (url: string) => void; notices?: Notices; codeUrl?: string | undefined }) {
  const tv = notices.tradingview;
  const code = codeHref(codeUrl);
  return (
    <Sheet title="Open source" onClose={onClose}>
      <div className="os">
        <p className="zf-body os__line os__line--first">{POSITIONING}</p>
        {/* the open code (product decision, 5 Nov late): the phone opens it in the browser sheet, a browser in a new tab */}
        {onOpenUrl ? (
          <button className="os__link os__code" onClick={() => onOpenUrl(code)}>{CODE_LABEL}</button>
        ) : (
          <a className="os__link os__code" href={code} target="_blank" rel="noopener noreferrer">{CODE_LABEL}</a>
        )}
        <div className="zf-label os__head">Third-party notices</div>
        <p className="zf-small os__sub">The open-source code inside this app, and the licence each comes with.</p>
        {onOpenUrl ? (
          <button className="os__tv" onClick={() => onOpenUrl(tv.url)}>
            <span>{tv.notice}</span>
            <span className="os__notice">{tv.noticeText}</span>
          </button>
        ) : (
          <div className="os__tv">
            <span>{tv.notice}</span>
            <span className="os__notice">{tv.noticeText}</span>
          </div>
        )}
        <ul className="os__list">
          {notices.packages.map((n) => (
            <li key={`${n.name}@${n.version}`} className="os__item">
              {n.licenceText || n.noticeText ? (
                <details>
                  <summary className="os__row">
                    <span className="os__name">{n.name}</span>
                    <span className="os__meta">{noticeMeta(n)}</span>
                  </summary>
                  {n.noticeText && <pre className="os__text">{n.noticeText}</pre>}
                  {n.licenceText && <pre className="os__text">{n.licenceText}</pre>}
                </details>
              ) : (
                <div className="os__row">
                  <span className="os__name">{n.name}</span>
                  <span className="os__meta">{noticeMeta(n)}</span>
                  {n.licenceUrl && onOpenUrl && <button className="os__link" onClick={() => onOpenUrl(n.licenceUrl!)}>Licence text</button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
