// The Browser tab's address bar (D118, D122): type a site's address and go. A listed site opens as its tile (ST1), fomo
// in its own app on the phone (fomo-app.ts, as the old Browser's fomo row did), any other https site in ZeroFee's own
// window on the phone (device.openSite on the Browser engine's bridge, its visit kept on the phone), or a new tab on the
// web. Words that aren't an address search DuckDuckGo, in the same window (D131).
import { useEffect, useState } from "react";
import { SimSitePage } from "../sim/SimSitePage.tsx";
import { simSitesOn } from "../sim/sites-data.ts";
import type { Bridge } from "@zerofee/core/bridge";
import { onPhone } from "@zerofee/shell-api/approval-words.ts";
import { addVisit, openSite } from "../visits.ts";
import { goAddress } from "./address.ts";
import { openFomoApp } from "./fomo-app.ts";

/** Go's effects for the bar and the History page alike (one way to open an address). */
export function addressDeps(browser: Bridge | undefined, listed: readonly string[], onSite: (site: string) => void, onLine: (line: string) => void): Parameters<typeof goAddress>[1] {
  return {
    listed, phone: onPhone(), onSite, onLine, ...(simSitesOn() ? { quiet: true } : {}),
    // Sim (D157): never a new tab; our own page says where the real web opens (the bar shows it: SIM_WEB_EVENT)
    openTab: (url) => (simSitesOn() ? void globalThis.dispatchEvent?.(new CustomEvent(SIM_WEB_EVENT, { detail: url })) : void window.open(url, "_blank", "noopener,noreferrer")),
    ...(browser ? { openSite: (url: string) => openSite(browser, url, false), openApp: () => openFomoApp(browser), addVisit: (url: string) => addVisit(browser, url) } : {}),
  };
}

/** Sim: an address that isn't a listed site asks for this page, inside the app (the History, Favourites and links too). */
export const SIM_WEB_EVENT = "zf-sim-web";

export function AddressBar({ browser, listed, onSite, onLine }: { browser?: Bridge; listed: readonly string[]; onSite: (site: string) => void; onLine: (line: string) => void }) {
  const [text, setText] = useState("");
  const [simWeb, setSimWeb] = useState<string | null>(null);
  useEffect(() => {
    if (!simSitesOn()) return;
    const show = (e: Event) => setSimWeb(String((e as CustomEvent).detail ?? ""));
    globalThis.addEventListener?.(SIM_WEB_EVENT, show);
    return () => globalThis.removeEventListener?.(SIM_WEB_EVENT, show);
  }, []);
  const go = async () => {
    const r = await goAddress(text, addressDeps(browser, listed, onSite, onLine));
    if (r === "site" || r === "app" || r === "phone") setText("");
  };
  return (
    <>
    {simWeb !== null && <SimSitePage kind="web" url={simWeb} onClose={() => setSimWeb(null)} />}
    <form className="sh-address-bar" role="search" aria-label="Search or type a site" onSubmit={(e) => { e.preventDefault(); void go(); }}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search or type a site" aria-label="Search or type a site" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go" />
      <button type="submit" className="zf-link" disabled={!text.trim()}>Go</button>
    </form>
    </>
  );
}
