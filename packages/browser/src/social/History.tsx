// The Browser tab's History (D118 follow-up): the old Browser page's "History, on this phone only" and its Clear history,
// now behind one "History" row on the tab's start page. The visits are the Browser engine's own (device.store on its
// bridge, visits.ts): kept on this phone, never sent anywhere. A row opens its site the way the address bar does
// (goAddress: a listed site is its tile's tap, fomo its own app, any other site ZeroFee's window).
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { PushedFrame } from "@zerofee/shell-api/AppFrame.tsx";
import { thisDevice } from "@zerofee/shell-api/approval-words.ts";
import { PRESET_LOGO, when } from "../app/chains.tsx";
import { presetForHost } from "../presets.ts";
import { clearHistory, loadHistory, type Visit } from "../visits.ts";
import { simHistory, simSitesOn } from "../sim/sites-data.ts";
import { addBookmark, isSaved, loadBookmarks, removeBookmark, type Bookmark } from "../bookmarks.ts";
import { Mark, Star, initialOf } from "./Favourites.tsx";

// "this phone" in the iPhone app, "this device" in a browser (D17: never "this phone" where it isn't one)
export const HISTORY_ROW = { title: "History", line: (phone?: boolean) => `Sites you opened. Kept on ${thisDevice(phone)} only.` };
export const HISTORY_EMPTY = (phone?: boolean) => `Sites you open show here. They stay on ${thisDevice(phone)} only.`;

/** The start page's one row into History. */
export function HistoryRow({ onOpen }: { onOpen: () => void }) {
  return (
    <button className="zf-row sh-history-row" onClick={onOpen} data-testid="browser-history-row">
      <span>
        <span className="t">{HISTORY_ROW.title}</span>
        <span className="d">{HISTORY_ROW.line()}</span>
      </span>
      <span className="v" aria-hidden="true">›</span>
    </button>
  );
}

/** `first`: the start page's own last read of the history and favourites, painted at once (D145), then read again. */
export function HistoryPage({ browser, onBack, onVisit, first }: { browser: Bridge; onBack: () => void; onVisit: (url: string) => void; first?: { list: Visit[]; saved: Bookmark[] } }) {
  const [list, setList] = useState<Visit[] | null>(first?.list ?? null);
  // D131: a star on each row saves the site to the start page's favourites
  const [saved, setSaved] = useState<Bookmark[]>(first?.saved ?? []);
  const [line, setLine] = useState("");
  useEffect(() => {
    let live = true;
    void loadBookmarks(browser).then((b) => live && setSaved(b));
    return () => void (live = false);
  }, [browser]);
  const star = async (url: string) => {
    if (isSaved(saved, url)) return setSaved(await removeBookmark(browser, url));
    const r = await addBookmark(browser, url);
    if ("line" in r) return setLine(r.line);
    setSaved(r.list);
    setLine("");
  };
  useEffect(() => {
    let live = true;
    void loadHistory(browser).then((v) => live && setList(v.length || !simSitesOn() ? v : simHistory()));
    return () => void (live = false);
  }, [browser]);
  return (
    <PushedFrame name="History" onBack={onBack}>
      <div className="st-page">
        {list && !list.length && <p className="zf-small sh-history-empty" data-testid="browser-history-empty">{HISTORY_EMPTY()}</p>}
        {list && list.length > 0 && (
          <>
            <p className="zf-small sh-history-note">On {thisDevice()} only.</p>
            <ul className="sh-history" aria-label="History">
              {list.map((v) => {
                const logo = PRESET_LOGO[presetForHost(v.host)?.id ?? ""];
                return (
                  <li key={v.host} className="sh-history-item">
                    <button className="zf-row sh-history-visit" onClick={() => onVisit(v.url)}>
                      <span className="sh-history-logo"><Mark logo={logo} letter={initialOf(v.host)} size={30} /></span>
                      <span className="t">{v.host}</span>
                      <span className="v">{when(v.atIso)}</span>
                    </button>
                    <Star saved={isSaved(saved, v.url)} host={v.host} onToggle={() => void star(v.url)} />
                  </li>
                );
              })}
            </ul>
            {line && <p className="zf-small sh-history-note" role="status">{line}</p>}
            <button className="zf-link sh-history-clear" onClick={() => void clearHistory(browser).then(() => setList([]))}>Clear history</button>
          </>
        )}
      </div>
    </PushedFrame>
  );
}
