// Social Trading (product decision, 2 Nov, ST1–ST2): ONE grid of tiles. A tile is the site and its money in one element: the logo,
// the name, and its wallet's dollars under it ("$0.00", "$2.91", "$3.00 on its way"). There are no rows above it and no
// separate Add: a $0.00 tile offers money first, and the site itself beside it.
// - A tap with $0.00 opens the site at once (product decision, 3 Nov, a test finding): its window says "Top up your pump.fun wallet
//   privately here." while it's empty, and that tap is the one money sheet's Add (the Safe → Spending's confidential
//   balance → the site's wallet, one Approve).
// - A tap while money is on its way: the one line ("$3.00 is on its way to pump.fun. About a minute."), never the site.
// - A tap with money in it: the site opens in ZeroFee's own window (SiteApp), signed in by AgentZero with its own wallet
//   (D65, D75): the wallet is made from your words when the account opens (prepareSites), its connection needs no sheet
//   on its own site, a plain sign-in is signed with no sheet, and every transaction still asks.
// - A long press, or the wallet pill in the site's window (its bar's $ pill, which closes onto this sheet): the wallet
//   sheet. Add · Take out · Show my address · the one-line rule · when AgentZero last signed you in · Export its key, last.
// - It paints at once from what it read last on this device (dollars and names only, never an address or a key), then
//   reads again. When an Add lands, one line says so ("You put money in pump.fun. It has $9.70."; AgentZero only from its own record, F5).
// - Product decision, 3 Nov: pump.fun and GMGN are apps of their own in the tray now (SiteWalletApp.tsx), so they have no tile here;
//   their address typed, linked or from History hands off to their app (openApp("social", site) lands there). Their
//   sign-in tasks, warm windows, Adds and Take outs live in their app; a tile stays only for another site's wallet that
//   still holds money (to take it out).
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingStatus, SpendingWallet } from "@zerofee/core/spending";
import { SOCIAL_HUB_NAME } from "@zerofee/core/app-store";
import { More } from "@zerofee/design/More.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { AppFrame, useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { usd } from "@zerofee/trade/app/format.ts";
import { PRESET_LOGO } from "../app/chains.tsx";
import { LISTED } from "./catalog.ts";
import { addLanded, addNotSeen } from "../site-tasks.ts";
import { READING, readAddTasks, saveAddTasks } from "./site-wallet.ts";
import { SiteApp } from "./SiteApp.tsx";
import { AddressBar, addressDeps } from "./AddressBar.tsx";
import { goAddress } from "./address.ts";
import { proofUrlOk } from "@zerofee/core/tx-proof";
import { HistoryPage, HistoryRow } from "./History.tsx";
import { PrivacyPage, PrivacyRow } from "./Privacy.tsx";
import { Favourites } from "./Favourites.tsx";
import { OpenPages } from "./OpenPages.tsx";
import { BROWSER_OFFLINE, hubAsOf, useOnline } from "./offline.ts";
import { OPEN_PAGES, closePage, readPages, showPage, type OpenPage } from "../tabs.ts";
import { loadBookmarks, removeBookmark, type Bookmark } from "../bookmarks.ts";
import { Recent } from "./Recent.tsx";
import { recentRows } from "./recent.ts";
import { remember, startPageRead } from "./start-read.ts";
import { loadHistory, recentOf, type Visit } from "../visits.ts";
import { logoUrl } from "@zerofee/design/logos.ts";
import { CHAIN_NAME, HUB_SITES, SITE_CHAINS, addEnded, addTaskAt, fundedLine, solOf, hubRows, keptHub, landedLine, landing, walletTitle, notCarried, pickable, readHub, readLanding, readPick, saveHub, saveLanding, savePick, tileTap, type AddRecord, type HubRow, type Landing, type SiteChain } from "./hub-state.ts";
import { stays, takeOutAlso, tooSmall } from "./take-out.ts";
import { words as WALLETS } from "./your-wallets.ts";
import "./social.css";

/** pump.fun and GMGN: apps of their own (product decision, 3 Nov); the hub leaves their wallets, tasks and windows to them. */
const ownApp = (site: string) => LISTED.some((a) => a.id === site);

/** Your wallets (the Browser thesis, part 3): its page loads when its row is first pressed, never with the start page. */
const loadWallets = () => import("./YourWallets.tsx");
const YourWalletsPage = lazy(() => loadWallets().then((m) => ({ default: m.YourWalletsPage })));

/** How long a press is a long press (the wallet sheet), as iOS's own. */
const LONG_PRESS_MS = 500;

export function SocialHub({ browser }: { browser?: Bridge }) {
  const shell = useShell();
  const { bridge, active } = shell;
  const [rows, setRows] = useState<HubRow[]>(() => readHub());
  const [read, setRead] = useState<"first" | "ok" | "failed">("first");
  /** When the tiles' dollars were last read (this open's read, else the kept copy's): offline they say "As of 7:40 AM". */
  const [readAt, setReadAt] = useState<number | null>(() => { const k = Object.values(keptHub()); return k.length ? Math.max(...k.map((x) => x.at)) : null; });
  const [site, setSite] = useState<string | null>(null);
  /** The site whose wallet sheet is open (a long press on its tile, or its window's pill). */
  const [sheet, setSheet] = useState<string | null>(null);
  /** When each site wallet last signed a site in with no sheet (the core's record), said on its wallet sheet. */
  const [signIns, setSignIns] = useState<{ wallet: string; site: string; atIso: string }[]>([]);
  useEffect(() => {
    if (!sheet) return;
    let live = true;
    void bridge.call<{ wallet: string; site: string; atIso: string }[]>("subwallet.site.signIns").then((r) => live && "ok" in r && setSignIns(r.ok));
    return () => void (live = false);
  }, [bridge, sheet]);
  const [tick, setTick] = useState(0);
  /** The wallet sheet's address was just copied (its "Copied" for a moment). */
  const [copied, setCopied] = useState(false);
  /** The hub's own one line (on its way, landed): the shell's "it went" line stays the money sheet's alone (Job 1, M1). */
  const [line, setLine] = useState("");
  const online = useOnline();
  const lineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((text: string) => {
    setLine(text);
    if (lineTimer.current) clearTimeout(lineTimer.current);
    lineTimer.current = setTimeout(() => setLine(""), 4000);
  }, []);
  useEffect(() => () => { if (lineTimer.current) clearTimeout(lineTimer.current); }, []);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // a site asked for by name (an old link to "pump.fun", the tray's search): its tile's tap
  const asked = useRef<string | null>(null);
  useEffect(() => {
    const want = shell.requestedTab;
    if (want && LISTED.some((a) => a.id === want)) asked.current = want;
  }, [shell.requestedTab, shell.requestSeq]);

  /** Money on its way to each site's wallet (an Add not landed yet), in dollars, by site. */
  const [moving, setMoving] = useState<Record<string, number>>(() => Object.fromEntries(Object.entries(readLanding()).map(([s, m]) => [s, m.usd])));
  /** What was on its way at the last read (with the dollars the wallet had then), to say when it lands. */
  const wasMoving = useRef<Record<string, Landing>>(readLanding());
  useEffect(() => bridge.on("spending.changed", refresh), [bridge, refresh]);
  // D144: a listed site's automatic sign-in task is its own app's now (SiteWalletApp.tsx), never published twice
  useEffect(() => {
    if (!active) return;
    let live = true;
    // both reads, then one paint: the tile's dollars and its "on its way" never disagree
    void Promise.all([bridge.call<SpendingWallet[]>("spending.wallets"), bridge.call<SpendingStatus>("spending.status"), bridge.call<AddRecord[]>("spending.activity").catch(() => null)]).then(([w, st, act]) => {
      if (!live) return;
      const next = "ok" in w ? hubRows(w.ok) : null;
      if (next) {
        setRows(next);
        saveHub(next);
        setRead("ok");
        setReadAt(Date.now());
      } else setRead("failed");
      if (!("ok" in st)) return;
      const { moving: by, landed, stopped } = landing(st.ok.onItsWay, wasMoving.current, next, Date.now(), act && "ok" in act && Array.isArray(act.ok) ? act.ok : null);
      // an Add that landed in the site's wallet (it holds more than when it started): said once (D75), naming who did it
      // from Spending's record (F5): AgentZero only when the record says its act door started it
      for (const s of landed) {
        if (ownApp(s)) continue; // said in its own app
        const now = next?.find((r) => r.site === s);
        if (now && now.usd !== null) say(landedLine(wasMoving.current[s]?.by, now.name, now.site));
      }
      // D144: an Add's task ends when it lands, or says it wasn't seen once the hub stops following it
      const open = readAddTasks();
      for (const s of Object.keys(open)) {
        if (ownApp(s)) continue; // its own app ends its task (SiteWalletApp.tsx)
        const name = next?.find((r) => r.site === s)?.name ?? LISTED.find((a) => a.id === s)?.preset.name ?? s;
        // its task made once nothing was on its way any more: Spending's record says how it ended (SiteWalletApp's too)
        const ended = !by[s] && !landed.includes(s) && !stopped[s] ? addEnded(act && "ok" in act && Array.isArray(act.ok) ? act.ok : null, s, addTaskAt(open[s]!) ?? Date.now()) : null;
        if (ended && "stopped" in ended) stopped[s] = ended.stopped;
        if (landed.includes(s) || (ended && "landed" in ended)) {
          shell.tasks?.update(open[s]!, addLanded(name, Date.now()));
          shell.tasks?.end(open[s]!, "done", addLanded(name, Date.now()).detail);
        } else if (stopped[s]) shell.tasks?.end(open[s]!, "failed", stopped[s]); // finding 61: Spending's record says it stopped
        else if (!by[s]) shell.tasks?.end(open[s]!, "stopped", addNotSeen(name));
        else continue;
        delete open[s];
      }
      saveAddTasks(open);
      wasMoving.current = by;
      saveLanding(by);
      setMoving(Object.fromEntries(Object.entries(by).map(([s, m]) => [s, m.usd])));
    });
    return () => void (live = false);
  }, [active, bridge, tick]);
  // while an Add is on its way, look again often: the dollars change the moment it lands
  useEffect(() => {
    if (!active || !Object.keys(moving).length) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [active, moving, refresh]);

  /** ST13: the site whose "Which coins will you trade?" is open (only when two or more of its networks fill). */
  const [picking, setPicking] = useState<string | null>(null);
  const add = (r: HubRow, chain?: SiteChain, fromTile?: true) => {
    // never a second Add while one is on its way (review ST11 M4)
    if (!r.wallet || moving[r.site] !== undefined) return;
    // ST13: the question only when there is a choice (the auditor's rule: never a choice that can't be chosen)
    const can = pickable(r.site);
    if (!chain && can.length >= 2) return setPicking(r.site);
    const c = chain ?? can[0] ?? "sol";
    // the wallet's id from the hub's own read of the core's list, never from a page
    const id = c === "sol" ? r.wallet : r.wallets?.find((w) => w.network === c)?.id;
    if (!id) return;
    if (chain) savePick(r.site, c);
    const perNetwork = (SITE_CHAINS[r.site]?.length ?? 1) > 1;
    // a test finding: from a $0.00 tile the sheet offers the site itself too ("Open pump.fun"): money is a choice, never a gate
    shell.openMoney({ kind: "siteadd", wallet: id, name: r.name, ...(perNetwork ? { network: CHAIN_NAME[c] } : {}), ...(fromTile ? { canOpen: true as const } : {}) }, (end) => {
      // the Add's one row is its job (SiteMoney.tsx startJob, then Home's own row for the move): never a second task here
      // (QA, 5 Nov: three tasks for one top-up)
      if (!end.went && end.open) setSite(r.site);
      refresh();
    });
  };
  const back = (r: HubRow, fromSheet?: true) => {
    if (!r.wallet) return;
    // the money sheet follows the move to the Safe and says when it lands (SiteMoney.tsx followMoveBack)
    // ST13: one Take out sweeps every funded wallet of the site home (GMGN's BNB beside its Solana); a network ZeroFee
    // doesn't carry stays and the sheet says so
    const also = takeOutAlso(r);
    // a test finding: opened from the wallet sheet, its Back returns there
    shell.openMoney({ kind: "siteback", wallet: r.wallet, name: r.name, ...(also.length ? { also } : {}), ...(fromSheet ? { back: true as const } : {}) }, (end) => {
      // a Take out that went: its one row is Home's own job (wallet site-back.ts: Now, its tracker, the Activity centre)
      if (!end.went && end.back) setSheet(r.site);
      refresh();
    });
  };
  /** A tile's tap (tileTap decides): its money sheet, its line, or the site. */
  const tap = useCallback((r: HubRow) => {
    if (!LISTED.some((a) => a.id === r.site)) return setSheet(r.site); // a site no longer here: its wallet, to take it out
    const t = tileTap(r, moving[r.site], read);
    if (t.kind === "add") return add(r, undefined, true);
    if (t.kind === "line") return say(t.line);
    if (t.kind === "open") return setSite(r.site);
    // "wait": its wallet isn't read yet; the tile says so and the next read makes it tappable
  }, [moving, read, say]); // eslint-disable-line react-hooks/exhaustive-deps
  // the asked-for site, once its tile can be tapped
  useEffect(() => {
    const want = asked.current;
    const r = want ? rows.find((x) => x.site === want) : undefined;
    if (r && r.wallet) {
      asked.current = null;
      tap(r);
    }
  }, [rows, tap]);

  // Instant open (product decision, 3 Nov): pump.fun's and GMGN's windows are warmed by their own apps now (SiteWalletApp.tsx)

  /** The History page (D118 follow-up: the old Browser page's history and Clear history live here now). */
  const [history, setHistory] = useState(false);
  /** D131: the Privacy screen, and the favourites saved from History (kept on this phone, bookmarks.ts). */
  const [privacy, setPrivacy] = useState(false);
  /** Your wallets: every site wallet, on the whole screen (D135). */
  const [wallets, setWallets] = useState(false);
  const [favs, setFavs_] = useState<Bookmark[]>(() => (browser && startPageRead(browser)?.favs) || []);
  const setFavs = useCallback((b: Bookmark[]) => { setFavs_(b); if (browser) remember(browser, { favs: b }); }, [browser]);
  /** Product decision, 3 Nov: the newest pages beside pump.fun and GMGN (never a listed site or a favourite again). */
  const [visits, setVisits] = useState<Visit[] | null>(() => (browser && startPageRead(browser)?.visits) || null);
  // read when the page first shows (while the shell's slide is still moving, D145), and again each time it comes back
  const readOnce = useRef(false);
  useEffect(() => {
    if (!browser || history || (!active && readOnce.current)) return;
    readOnce.current = true;
    let live = true;
    void loadBookmarks(browser).then((b) => live && setFavs(b));
    void loadHistory(browser).then((h) => { if (!live) return; setVisits(h); remember(browser, { visits: h }); });
    return () => void (live = false);
  }, [browser, active, history, setFavs]);
  const recent = recentOf(visits ?? [], [...LISTED.flatMap((a) => a.preset.hosts), ...favs.map((f) => f.host)]);
  // D131: the phone's open pages (tabs), read again whenever a page comes back to the start page
  const [pages, setPages_] = useState<OpenPage[]>(() => (browser && startPageRead(browser)?.pages) || []);
  const setPages = useCallback((p: OpenPage[]) => { setPages_(p); if (browser) remember(browser, { pages: p }); }, [browser]);
  const pagesOnce = useRef(false);
  useEffect(() => {
    if (!browser || (!active && pagesOnce.current)) return;
    pagesOnce.current = true;
    let live = true;
    const read = () => void readPages(browser).then((p) => live && setPages(p));
    read();
    const off = browser.on("device.returned", read);
    return () => { live = false; off(); };
  }, [browser, active, setPages]);
  const listedIds = LISTED.map((a) => a.id);
  // product decision, 3 Nov: pump.fun or GMGN typed, linked or picked from History hands off to its own app (its wallet page first)
  const onSiteId = (id: string) => shell.openApp("social", id);
  // A proof handed over (Activity's View, a site app's move: openApp("browser", undefined, url)): an explorer's page
  // only (core tx-proof.ts proofUrlOk), opened as the address bar opens it; anything else handed over opens nothing
  const handed = useRef(0);
  useEffect(() => {
    const link = shell.requestedLink;
    if (!link || !browser || handed.current === shell.requestSeq || !proofUrlOk(link)) return;
    handed.current = shell.requestSeq ?? 0;
    void goAddress(link, addressDeps(browser, listedIds, onSiteId, say));
  }, [shell.requestedLink, shell.requestSeq, browser]); // eslint-disable-line react-hooks/exhaustive-deps
  if (history && browser) return <HistoryPage browser={browser} {...(visits ? { first: { list: visits, saved: favs } } : {})} onBack={() => setHistory(false)} onVisit={(url) => { setHistory(false); void goAddress(url, addressDeps(browser, listedIds, onSiteId, say)); }} />;
  if (privacy && browser) return <PrivacyPage browser={browser} onBack={() => setPrivacy(false)} />;

  // A site's window; its own Back and Close come back here, and its $ pill (the phone's bar) opens its wallet sheet here
  if (site) return <SiteApp site={site} {...(browser ? { browser } : {})} pill={read === "ok" ? pillOf(rows.find((r) => r.site === site)) : undefined} {...(rows.find((r) => r.site === site)?.wallet ? { wallet: rows.find((r) => r.site === site)!.wallet! } : {})} onLeave={(why) => {
    setSite(null);
    const r = rows.find((x) => x.site === site);
    // ST10: the window's "Top up … privately here": Social trading's own Top up for that wallet (the one money sheet)
    if (why === "topup" && r) add(r);
    else if (why === "settings") setSheet(site);
    refresh();
  }} />;

  const open = sheet ? rows.find((r) => r.site === sheet) : undefined;
  const copyAddress = (a: string) => {
    void navigator.clipboard?.writeText(a).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  // builder 22's item 3: no "…" while a tile's dollars are unread: its kept figure, else (builder 25, item 2) "Reading"
  const dollarsOf = (r: HubRow) => (r.usd === null ? (read === "failed" ? "Solana didn't answer" : keptHub()[r.site] ? usd(keptHub()[r.site]!.usd) : READING) : usd(r.usd));
  // the listed sites, and any other site whose wallet still holds money or can't be read (hubRows): its sheet, to take it out
  // pump.fun and GMGN are apps of their own (product decision, 3 Nov): no tile here
  const tiles = rows.filter((r) => !ownApp(r.site));
  return (
    // D118: the person's own browser: an address on top (never a search), pinned over the tiles (bug report, 4 Nov: the
    // address bar stays put while the page under it scrolls)
    <AppFrame name={SOCIAL_HUB_NAME} tray={[]} tab="all" onTab={() => {}} pinned={<AddressBar {...(browser ? { browser } : {})} listed={listedIds} onSite={onSiteId} onLine={say} />}>
      <div className="st-page">
        <p className="zf-small sh-line" role="status" aria-live="polite" data-testid="sh-line">{online ? line : BROWSER_OFFLINE}</p>
        {browser && <OpenPages pages={pages} onShow={(id) => void showPage(browser, id).then((ok) => !ok && (say(OPEN_PAGES.gone), void readPages(browser).then(setPages)))} onClose={(id) => void closePage(browser, id, pages).then(setPages)} />}
        {tiles.length > 0 && <ul className="sh-tiles sh-grid" aria-label="Sites">
          {tiles.map((r) => (
            <li key={r.site}>
              <Tile r={r} dollars={moving[r.site] !== undefined ? ((r.usd ?? 0) >= 0.01 ? `${usd(r.usd!)} · ${usd(moving[r.site]!)} coming` : `${usd(moving[r.site]!)} on its way`) : dollarsOf(r)} ready={Boolean(r.wallet)} onTap={() => tap(r)} onHold={() => setSheet(r.site)} />
            </li>
          ))}
        </ul>}
        {/* builder 22's item 3: offline, the tiles are the last read with its time once, and no Retry (nothing can answer) */}
        {!online && readAt !== null && rows.some((r) => r.usd !== null) && <p className="zf-small sh-note" data-testid="hub-as-of">{hubAsOf(readAt)}</p>}
        {online && read === "failed" && <p className="zf-small sh-note" role="status">Solana didn't answer, so these are from the last read. <button className="zf-link" onClick={refresh}>Retry</button></p>}
        {/* D131: favourites (saved from History's star), opened the way the address bar opens a site */}
        {browser && <Favourites list={favs} onOpen={(url) => void goAddress(url, addressDeps(browser, listedIds, onSiteId, say))} onRemove={(url) => void removeBookmark(browser, url).then(setFavs)} />}
        {/* concept v3.1: Recent is one card, the signed-in sites (their own apps) with their wallet's dollars, then the pages */}
        {browser && <Recent rows={recentRows(rows.filter((r) => ownApp(r.site)).map((r) => ({ site: r.site, name: r.name, usd: r.usd, ...(r.wallet ? { wallet: r.wallet } : {}), ...(r.usd === null && keptHub()[r.site] ? { kept: keptHub()[r.site]! } : {}), hosts: LISTED.find((a) => a.id === r.site)?.preset.hosts ?? [] })), recent)} onOpen={(url) => void goAddress(url, addressDeps(browser, listedIds, onSiteId, say))} onSite={onSiteId} />}
        <div className="zf-group sh-group sh-group--pages">
        {/* Your wallets: every site's own wallet, its money, and Move back to Safe */}
        <button className="zf-row sh-history-row" data-testid="browser-wallets-row" onPointerDown={() => void loadWallets()} onFocus={() => void loadWallets()} onClick={() => setWallets(true)}>
          <span>
            <span className="t">{WALLETS.title}</span>
            <span className="d">{WALLETS.row}</span>
          </span>
          <span className="v" aria-hidden="true">›</span>
        </button>
        {/* D118 follow-up: the old Browser page's History and Clear history, one row here */}
        {browser && <HistoryRow onOpen={() => setHistory(true)} />}
        {/* D131: private browsing, history and site data */}
        {browser && <PrivacyRow browser={browser} onOpen={() => setPrivacy(true)} />}
        </div>
      </div>
      {wallets && <Suspense fallback={null}><YourWalletsPage onClose={() => setWallets(false)} /></Suspense>}
      {open && (
        <Sheet title={walletTitle(open.name)} onClose={() => setSheet(null)}>
          <p className="sh-sheet-usd">{dollarsOf(open)}</p>
          {/* ST13: a site with a wallet per network lists the ones with money ("Solana $10.00") */}
          {(SITE_CHAINS[open.site]?.length ?? 1) > 1 && fundedLine(open) && <p className="zf-small sh-sheet-note" data-testid="hub-funded">{fundedLine(open)}</p>}
          <div className="sh-sheet-acts">
            {/* product decision, 3 Nov: with money in it, Take out comes first (back to the Safe, privately) */}
            {(() => {
              const canTakeOut = Boolean(open.wallet) && ((solOf(open) ?? 0) >= 2 || takeOutAlso(open).length > 0);
              const addBtn = <button key="add" className={canTakeOut ? "zf-btn st-line-btn" : "zf-btn"} disabled={!open.wallet || moving[open.site] !== undefined || !LISTED.some((a) => a.id === open.site)} onClick={() => { setSheet(null); add(open); }}>Add</button>;
              const outBtn = <button key="out" className={canTakeOut ? "zf-btn" : "zf-btn st-line-btn"} disabled={!canTakeOut} onClick={() => { setSheet(null); back(open, true); }}>Take out</button>;
              return canTakeOut ? [outBtn, addBtn] : [addBtn, outBtn];
            })()}
          </div>
          {/* review ST13 L5: a funded wallet Take out can't move is said, never swept silently */}
          {stays(open).map((c) => <p key={c} className="zf-small sh-sheet-note">{notCarried(c)} Take out leaves your {open.name} {CHAIN_NAME[c]} wallet as it is.</p>)}
          {tooSmall(open).map((c) => <p key={`small-${c}`} className="zf-small sh-sheet-note">Your {open.name} {CHAIN_NAME[c]} wallet has under $2, so Take out leaves it.</p>)}
          {open.address && (
            <More label="Show my address">
              {/* every address is tap-to-copy: the whole address goes to the clipboard, "Copied" for a moment */}
              <button className="zf-small sh-address" style={{ all: "unset", cursor: "pointer", display: "block", width: "100%", overflowWrap: "anywhere" }} aria-label={`Copy your ${open.name} wallet's address`} data-testid="hub-copy-address" onClick={() => copyAddress(open.address!)}>
                {copied ? "Copied" : open.address.match(/.{1,4}/g)!.join(" ")}
              </button>
            </More>
          )}
          <p className="zf-small sh-sheet-note">Only {open.name} pays from this. Your Safe never does.</p>
          <p className="zf-small sh-sheet-note">To take money out, use Take out here.</p>
          {(() => {
            const last = signIns.find((x) => x.wallet === open.wallet);
            return last ? <p className="zf-small sh-sheet-note">AgentZero signed you in to {last.site} at {new Date(last.atIso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p> : null;
          })()}
          <button className="zf-link sh-export" onClick={() => { setSheet(null); shell.openApp("wallet", "details"); }}>Export its key</button>
        </Sheet>
      )}
      {picking && (() => {
        const r = rows.find((x) => x.site === picking);
        const can = pickable(picking);
        const last = readPick(picking);
        if (!r || can.length < 2) return null;
        return (
          <Sheet title="Which coins will you trade?" onClose={() => setPicking(null)}>
            <div className="sh-pick" role="group" aria-label="Which coins will you trade?">
              {[last, ...can.filter((c) => c !== last)].map((c) => (
                <button key={c} className={`sh-pick-coin${c === last ? " is-picked" : ""}`} aria-pressed={c === last} onClick={() => { setPicking(null); add(r, c); }}>
                  <img src={logoUrl(c)} alt="" width={56} height={56} />
                  <span>{CHAIN_NAME[c]}</span>
                </button>
              ))}
            </div>
          </Sheet>
        );
      })()}
    </AppFrame>
  );
}

/** The window's wallet pill: the site's dollars as the hub last read them, or nothing when not read. */
// ST13 (review M2): the Solana wallet's own dollars, the wallet the window's ask and banner fill
const pillOf = (r: HubRow | undefined): string | undefined => { const n = solOf(r); return n !== null ? usd(n) : undefined; };

/** One tile: a tap, or a long press for its wallet sheet (the press's own tap doesn't also fire). */
function Tile({ r, dollars, ready, onTap, onHold }: { r: HubRow; dollars: string; ready: boolean; onTap: () => void; onHold: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const start = () => {
    held.current = false;
    timer.current = setTimeout(() => {
      held.current = true;
      onHold();
    }, LONG_PRESS_MS);
  };
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  return (
    <button
      className="sh-tile"
      aria-label={`${r.name}, ${dollars}`}
      aria-disabled={!ready}
      aria-description="Hold for its wallet"
      onKeyDown={(e) => { if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); onHold(); } }}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (held.current) return void (held.current = false);
        onTap();
      }}
    >
      <img className="st-app-logo" src={PRESET_LOGO[r.site]} alt="" width={64} height={64} style={{ width: 64, height: 64, borderRadius: 17 }} />
      <span className="sh-tile-name">{r.name}</span>
      <span className="sh-tile-usd" data-testid={`hub-usd-${r.site}`}>{dollars}</span>
    </button>
  );
}

export { HUB_SITES };
