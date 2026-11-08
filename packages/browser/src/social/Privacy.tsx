// D131, the Browser's Privacy screen (one row on the start page): private browsing on or off (the phone's own setting,
// privacy.ts), the sites set to normal browsing, Clear history, Clear site data, and the plain fact that downloads are
// off. Turning private browsing off asks once, on the phone's own alert. With no Tor in the build (the web, the Sim, the
// phone today) private browsing is hidden: no switch, no line (b23, end to end or hidden).
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { PushedFrame } from "@zerofee/shell-api/AppFrame.tsx";
import { clearSiteData, PRIVACY, readPrivacy, setBlockTrackers, setNormalSite, setPrivate, type PrivacyView } from "../privacy.ts";
import { clearHistory } from "../visits.ts";
import { SIM_PRIVACY, simSitesOn } from "../sim/sites-data.ts";

/** The Sim: the phone's own view on sample data (sites-data.ts), never "isn't ready". */
const simView = (v: PrivacyView): PrivacyView => (simSitesOn() ? { ...SIM_PRIVACY, normalSites: [...SIM_PRIVACY.normalSites] } : v);

export function PrivacyRow({ browser, onOpen }: { browser: Bridge; onOpen: () => void }) {
  const [view, setView] = useState<PrivacyView | null>(null);
  useEffect(() => {
    let live = true;
    void readPrivacy(browser).then((v) => live && setView(simView(v)), () => live && simSitesOn() && setView(simView({ kind: "web" })));
    return () => void (live = false);
  }, [browser]);
  return (
    <button className="zf-row sh-history-row sh-privacy-row" onClick={onOpen} data-testid="browser-privacy-row">
      <span>
        <span className="t">{PRIVACY.row}</span>
        <span className="d">{PRIVACY.rowLine(view)}</span>
      </span>
      <span className="v" aria-hidden="true">›</span>
    </button>
  );
}

export function PrivacyPage({ browser, onBack }: { browser: Bridge; onBack: () => void }) {
  const [view, setView] = useState<PrivacyView | null>(null);
  const [line, setLine] = useState("");
  useEffect(() => {
    let live = true;
    void readPrivacy(browser).then((v) => live && setView(simView(v)), () => live && simSitesOn() && setView(simView({ kind: "web" })));
    return () => void (live = false);
  }, [browser]);
  const change = async (on: boolean) => {
    if (simSitesOn() && view?.kind === "phone") return setView({ ...view, private: on });
    // The phone's own alert asks before private browsing goes off (never this page's sheet); "Keep it private" changes nothing.
    const v = await setPrivate(browser, on).catch(() => null);
    if (!v || v.kind !== "phone") return setLine(PRIVACY.didntChange);
    setView(v);
    setLine("");
  };
  const phone = view?.kind === "phone" ? view : null;
  return (
    <PushedFrame name={PRIVACY.row} onBack={onBack}>
      <div className="st-page sh-privacy">
        {/* FB3 + b23 (end to end or hidden): no Tor in the build (the Sim says what the phone build has), no Private
            browsing switch, no sites on normal browsing and no line about it; the switch only where Tor is built */}
        {phone && phone.built && (
          <button className="zf-row sh-privacy-switch" role="switch" aria-checked={phone.private} data-testid="privacy-switch" onClick={() => void change(!phone.private)}>
            <span><span className="t">{PRIVACY.switchTitle}</span><span className="d">{PRIVACY.switchLine}</span></span>
            <span className={`sh-toggle${phone.private ? " on" : ""}`} aria-hidden="true"><span /></span>
          </button>
        )}
        {phone && phone.blockTrackers !== undefined && (
          <>
            <button className="zf-row sh-privacy-switch" role="switch" aria-checked={phone.blockTrackers} data-testid="trackers-switch" onClick={() => simSitesOn() ? setView({ ...phone, blockTrackers: !phone.blockTrackers }) : void setBlockTrackers(browser, !phone.blockTrackers).then((v) => (v.kind === "phone" && v.blockTrackers !== undefined ? (setView(v), setLine("")) : setLine(PRIVACY.trackersDidntChange)), () => setLine(PRIVACY.trackersDidntChange))}>
              <span><span className="t">{PRIVACY.trackersTitle}</span><span className="d">{PRIVACY.trackersLine}</span></span>
              <span className={`sh-toggle${phone.blockTrackers ? " on" : ""}`} aria-hidden="true"><span /></span>
            </button>
            <p className="zf-small sh-privacy-note">{PRIVACY.trackersCredit}</p>
          </>
        )}
        {phone && phone.built && phone.normalSites.length > 0 && (
          <>
            <div className="zf-label sh-privacy-head">{PRIVACY.normalHead}</div>
            <p className="zf-small sh-privacy-note">{PRIVACY.normalLine}</p>
            <ul className="sh-history" aria-label={PRIVACY.normalHead}>
              {phone.normalSites.map((h) => (
                <li key={h} className="zf-row sh-privacy-site">
                  <span className="t">{h}</span>
                  <button className="zf-link" onClick={() => simSitesOn() ? setView({ ...phone, normalSites: phone.normalSites.filter((x) => x !== h) }) : void setNormalSite(browser, h, false).then((v) => v && setView(v))}>{PRIVACY.normalRemove}</button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="sh-privacy-acts">
          <button className="zf-link" onClick={() => void clearHistory(browser).then(() => setLine(PRIVACY.historyCleared))}>{PRIVACY.clearHistory}</button>
          {phone && <button className="zf-link" onClick={() => simSitesOn() ? setLine("Site data cleared. Sites will ask you to sign in again.") : void clearSiteData(browser).then((l) => l && setLine(l))}>{PRIVACY.clearData}</button>}
        </div>
        <p className="zf-small sh-privacy-note" role="status" aria-live="polite">{line}</p>
        <p className="zf-small sh-privacy-fact">{PRIVACY.downloads}</p>
      </div>
    </PushedFrame>
  );
}
