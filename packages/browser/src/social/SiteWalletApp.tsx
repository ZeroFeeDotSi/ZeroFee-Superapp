// A site's own app in the tray (product decision, 3 Nov: pump.fun and GMGN left the Browser). It opens on the site's WALLET page,
// one page in Home's look (HOME-VISUAL, D136): the big number is the wallet's dollars; Add and Take out under it (the one
// money sheet's site Add and Take out, unchanged); its coins; its address with Copy and a QR (a full-screen sheet, D135);
// its last moves, with every move provable on Solana's explorer; any slow or refused line at the bottom; then the one
// big button, "Open pump.fun", which opens the site's window exactly as the Browser's tile did (SiteApp: device.openSite
// with the wallet's pill on the phone; a new tab on the web).
// It runs on the Browser's bridge (app id "social"), where the site's wallet, its rights and its sign-in always were.
// Its Activity tasks (D144): an Add until it lands, a Take out followed home, and the site's automatic sign-in.
// D146: its sheets show only while this app is on screen (the shell's openMoney); the site's window is shown only then.
import { stillOpen } from "./take-out-resume.ts";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingActivity, SpendingStatus, SpendingWallet } from "@zerofee/core/spending";
import { onPhone } from "@zerofee/shell-api/approval-words.ts";
import { simPage } from "@zerofee/shell-api/release.ts";
import { Copy } from "@zerofee/design/icons.tsx";
import { logoUrl } from "@zerofee/design/logos.ts";
import { mark } from "@zerofee/design/tap.ts";
import { QrCode } from "@zerofee/design/QrCode.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { AppFrame, PushedFrame, useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { usd } from "@zerofee/trade/app/format.ts";
import { PRESET_LOGO } from "../app/chains.tsx";
import { SIGN_IN_TASK_MS, addLanded, addNotSeen, showsSignIn, signInStuck, signInTask, type SignInState } from "../site-tasks.ts";
import { LISTED } from "./catalog.ts";
import { CHAIN_NAME, SITE_CHAINS, addEnded, addTaskAt, hubRows, keptHub, landedLine, landing, pickable, readHub, readLanding, saveHub, saveLanding, solOf, walletTitle, type HubRow, type Landing } from "./hub-state.ts";
import { READING, madeFor, groupAddress, proofUrl, readAddTasks, readingWho, saveAddTasks, shortAddress, solanaDownOf, walletView, type SiteBack, type SiteCoin } from "./site-wallet.ts";
import { shortTime } from "@zerofee/core/clock";
import type { ServiceStatus } from "@zerofee/core/services";
import { every } from "@zerofee/shell-api/rest.ts";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import { SiteApp } from "./SiteApp.tsx";
import { addVisit } from "../visits.ts";
import { takeOutAlso } from "./take-out.ts";
import "./social.css";

const QrGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3.25" y="3.25" width="7" height="7" rx="1.8" /><rect x="13.75" y="3.25" width="7" height="7" rx="1.8" /><rect x="3.25" y="13.75" width="7" height="7" rx="1.8" /></g>
    <g fill="currentColor"><rect x="5.5" y="5.5" width="2.5" height="2.5" rx=".6" /><rect x="16" y="5.5" width="2.5" height="2.5" rx=".6" /><rect x="5.5" y="16" width="2.5" height="2.5" rx=".6" /><rect x="13.5" y="13.5" width="3" height="3" rx=".7" /><rect x="18" y="18" width="3" height="3" rx=".7" /></g>
  </svg>
);
const Plus = () => <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path className="zf-hl" d="M12 5v14M5 12h14" /></svg>;
const Out = () => <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path className="zf-hl" d="M12 19V5M6 11l6-6 6 6" /></svg>;

/** The window's wallet pill: the Solana wallet's dollars as last read (the one the window's ask fills). */
const pillOf = (r: HubRow | undefined): string | undefined => { const n = solOf(r); return n !== null ? usd(n) : undefined; };

/** A Take out still going: its row read again this often. */
const BACK_READ_MS = 5_000;

/** `page`: the shell's page this shows on (Social trading's, S17), whose reads run only while it is on screen.
 *  `onBack`: given (Social trading's list), the bar's Back goes there. */
export function SiteWalletApp({ site, browser, page, onBack }: { site: string; browser?: Bridge; page?: string; onBack?: () => void }) {
  const shell = useShell();
  const { bridge, active } = shell;
  const app = LISTED.find((a) => a.id === site);
  const name = app?.preset.name ?? site;
  const hosts = app?.preset.hosts ?? [];
  const [row, setRow] = useState<HubRow | undefined>(() => readHub().find((r) => r.site === site));
  /** Every coin each of the site's wallets holds (the core's subwallet.coins, kept 15 s there), read while shown. */
  const [coins, setCoins] = useState<{ network: string; coins: SiteCoin[] }[]>([]);
  /** The coin list has answered (or waited long enough): until then the page holds its figures, so total, Coins and Take out never disagree. */
  const [coinsIn, setCoinsIn] = useState(false);
  useEffect(() => { if (!active) return; const t = setTimeout(() => setCoinsIn(true), 4000); return () => clearTimeout(t); }, [active]); // never held longer than 4 s
  const [read, setRead] = useState<"first" | "ok" | "failed">("first");
  // audit 15 FB1: the last figure read on this device (before this page's own read saves over it) and Solana's state
  const [kept, setKept] = useState(() => keptHub()[site]);
  const [solanaDown, setSolanaDown] = useState(false);
  useEffect(() => {
    if (!active) return;
    const look = () => void bridge.call<ServiceStatus[]>("ledger.status").then((r) => setSolanaDown("ok" in r && Array.isArray(r.ok) && solanaDownOf(r.ok)), () => undefined);
    look();
    return every(30_000, look, page ?? `site:${site}`);
  }, [active, bridge, site]);
  const [adds, setAdds] = useState<SpendingActivity[]>([]);
  const [backs, setBacks] = useState<SiteBack[]>([]);
  const was = useRef<Landing | undefined>(readLanding()[site]);
  const [moving, setMoving] = useState<Landing | undefined>(was.current);
  const [windowOpen, setWindowOpen] = useState(false);
  const [qr, setQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  /** One line at the bottom (it landed, a refusal), for a moment. */
  const [line, setLine] = useState("");
  const lineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((text: string) => {
    setLine(text);
    if (lineTimer.current) clearTimeout(lineTimer.current);
    lineTimer.current = setTimeout(() => setLine(""), 6000);
  }, []);
  useEffect(() => () => { if (lineTimer.current) clearTimeout(lineTimer.current); }, []);
  useEffect(() => bridge.on("spending.changed", refresh), [bridge, refresh]);
  // the shell's jobs: an Add's job is its row in Moves on the frame "Job created." shows (never "Nothing yet" meanwhile)
  const [jobs, setJobs] = useState(() => taskStore().list());
  useEffect(() => { const st = taskStore(); setJobs(st.list()); return st.subscribe(() => setJobs(st.list())); }, []);

  // the wallet, what is on its way, and its moves: read each time the page shows, and again on a change
  useEffect(() => {
    if (!active) return;
    let live = true;
    void Promise.all([
      bridge.call<SpendingWallet[]>("spending.wallets"),
      bridge.call<SpendingStatus>("spending.status"),
      bridge.call<SpendingActivity[]>("spending.activity").catch(() => null),
      bridge.call<SiteBack[]>("subwallet.site.moveBacks").catch(() => null),
    ]).then(([w, st, act, mb]) => {
      if (!live) return;
      const rows = "ok" in w ? hubRows(w.ok) : null;
      const mine = rows?.find((r) => r.site === site);
      if (rows && mine) {
        setRow(mine);
        saveHub(rows);
        setKept(keptHub()[site]);
        setRead("ok");
      } else setRead("failed");
      if (act && "ok" in act && Array.isArray(act.ok)) setAdds(act.ok);
      if (mb && "ok" in mb && Array.isArray(mb.ok)) setBacks(mb.ok);
      if (!("ok" in st)) return;
      const acts = act && "ok" in act && Array.isArray(act.ok) ? act.ok : null;
      const { moving: by, landed, stopped } = landing(st.ok.onItsWay.filter((a) => a.site === site), was.current ? { [site]: was.current } : {}, rows, Date.now(), acts);
      const now = by[site];
      // an Add that landed: said once, naming who did it from Spending's record (F5); its Activity task ends
      const task = readAddTasks()[site];
      // its task made once nothing was on its way any more (Done tapped after it landed): Spending's record says how it ended
      const ended = task && !now && !landed.includes(site) && !stopped[site] ? addEnded(acts, site, addTaskAt(task) ?? Date.now()) : null;
      if (ended && "stopped" in ended) stopped[site] = ended.stopped;
      if (landed.includes(site) || (ended && "landed" in ended)) {
        if (mine && mine.usd !== null) { mark("landed"); say(landedLine(was.current?.by, name, site)); }
        if (task) { shell.tasks?.update(task, addLanded(name, Date.now())); shell.tasks?.end(task, "done", addLanded(name, Date.now()).detail); }
      } else if (task && stopped[site]) shell.tasks?.end(task, "failed", stopped[site]); // finding 61: Spending's record says it stopped
      else if (task && !now) shell.tasks?.end(task, "stopped", addNotSeen(name));
      if (task && (landed.includes(site) || !now)) { const open = readAddTasks(); delete open[site]; saveAddTasks(open); }
      was.current = now;
      const kept = readLanding();
      if (now) kept[site] = now; else delete kept[site];
      saveLanding(kept);
      setMoving(now);
    });
    return () => void (live = false);
  }, [active, bridge, site, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  // a Take out still going is read again until it ends (browser-sites crawl F8: its row said "On its way to your Safe."
  // after the toast said it was in the Safe), from the core's own record
  const backOpen = backs.some((b) => b.back.site === site && stillOpen(b));
  useEffect(() => {
    if (!active || !backOpen) return;
    const t = setTimeout(refresh, BACK_READ_MS);
    return () => clearTimeout(t);
  }, [active, backOpen, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  // the coins the site's wallets hold (the site's buys too): on show, then every 15 s while this app is on screen
  const walletIds = (row?.wallets ?? []).map((w) => `${w.network}:${w.id ?? ""}`).join(",");
  // each wallet's figure as Spending read it: a Take out or Add that landed changes it (its job's own landed read), and the
  // coins are read again at once, fresh past the core's 15 s keep (test, MUST 9: "SOL $35.00" stayed ~8 s after Take out)
  const walletFigures = (row?.wallets ?? []).map((w) => `${w.id ?? ""}:${w.usd ?? ""}:${w.holds ?? ""}`).join(",");
  useEffect(() => {
    if (!active || !row) return;
    const wallets = (row.wallets ?? []).filter((w) => w.id).map((w) => ({ network: w.network, id: w.id! }));
    if (!wallets.length) return;
    let live = true;
    const read = (fresh = false) => void Promise.all(wallets.map((w) => bridge.call<SiteCoin[]>("subwallet.coins", { id: w.id, ...(fresh ? { fresh: true } : {}) }).then((r) => ("ok" in r && Array.isArray(r.ok) ? { network: w.network, coins: r.ok } : null), () => null)))
      .then((all) => {
        if (!live) return;
        const got = all.filter((x): x is { network: string; coins: SiteCoin[] } => x !== null);
        if (got.some((w) => w.coins.some((c) => /[1-9]/.test(c.amount)))) setCoinsIn(true); // an empty first answer is not yet the list
        if (got.length) setCoins(got); // a wallet the chain can't read keeps what was shown (a Problem is never "no coins")
      });
    read(true);
    const stop = every(15_000, () => read(), page ?? `site:${site}`); // only while this site's page is on screen (heat: never hidden or covered)
    return () => { live = false; stop(); };
  }, [active, bridge, walletIds, walletFigures]); // eslint-disable-line react-hooks/exhaustive-deps
  // while an Add is on its way, look again often: the dollars change the moment it lands
  useEffect(() => {
    if (!active || !moving) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [active, moving, refresh]);

  // D144: the site's automatic sign-in (its window's own states) is a task in the Activity centre, one per sign-in
  // Phone test, 3 Nov: a warm window's background sign-in (frozen 3 s after load) left tasks on "Signing in…" for hours.
  // Only a sign-in in a window the person opened is a task; it ends when the sign-in does, when the window closes, or at
  // SIGN_IN_TASK_MS at the latest ("didn't finish, nothing moved").
  const signing = useRef<string | undefined>(undefined);
  const onScreen = useRef(false);
  onScreen.current = windowOpen;
  const hardEnd = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endSigning = useCallback((state: "done" | "failed" | "stopped", detail?: string) => {
    if (hardEnd.current) { clearTimeout(hardEnd.current); hardEnd.current = null; }
    const open = signing.current;
    if (!open) return;
    signing.current = undefined;
    shell.tasks?.end(open, state, detail);
  }, [shell.tasks]);
  useEffect(() => bridge.on<{ host?: string; state?: string }>("device.site.signin", (e) => {
    const state = e?.state as SignInState | undefined;
    if (typeof e?.host !== "string" || !hosts.includes(e.host) || !state || !["signing", "signed", "signing-again", "failed"].includes(state)) return;
    if (!showsSignIn(state, onScreen.current, signing.current !== undefined)) return;
    const open = signing.current;
    const t = signInTask(name, state, Date.now(), state === "signing-again" ? open : undefined);
    if (t.publish) {
      if (open && state === "signing") endSigning("stopped");
      if (shell.tasks?.publish(t.publish)) {
        signing.current = t.publish.id;
        if (hardEnd.current) clearTimeout(hardEnd.current);
        hardEnd.current = setTimeout(() => endSigning("failed", signInStuck(name)), SIGN_IN_TASK_MS);
      }
    } else if (open && t.end) endSigning(t.end.state, t.end.detail);
  }), [bridge, shell.tasks, name, hosts.join(), endSigning]); // eslint-disable-line react-hooks/exhaustive-deps
  // the window closed (or was dropped) mid-sign-in: the task goes quietly, never left "…"
  useEffect(() => { if (!windowOpen) endSigning("stopped"); }, [windowOpen, endSigning]);
  useEffect(() => () => endSigning("stopped"), [endSigning]);

  // Instant open (product decision, 3 Nov): once the wallet is read, the phone builds the site's window off screen, so Open shows the
  // live site at once. Once per showing of this page; again after the window was used. The web has no phone: nothing.
  const warmed = useRef(false);
  useEffect(() => {
    if (windowOpen) { warmed.current = false; return; }
    if (warmed.current || read !== "ok" || !row?.wallet || !app || !onPhone()) return;
    warmed.current = true;
    const pill = pillOf(row);
    void bridge.call("device.warmSite", { url: app.preset.url, ...(pill ? { pill } : {}) }).catch(() => undefined);
  }, [bridge, read, row, app, windowOpen]);

  /** Add: the one money sheet's site Add (Home's own, unchanged), into the wallet Spending fills. */
  const add = () => {
    if (!row?.wallet || moving) return;
    const c = pickable(site)[0] ?? "sol";
    const id = c === "sol" ? row.wallet : row.wallets?.find((w) => w.network === c)?.id;
    if (!id) return;
    const perNetwork = (SITE_CHAINS[site]?.length ?? 1) > 1;
    // its one row is its job (SiteMoney.tsx startJob, then Home's row for the move), never a second task (QA, 5 Nov)
    shell.openMoney({ kind: "siteadd", wallet: id, name, ...(perNetwork ? { network: CHAIN_NAME[c] } : {}) }, () => refresh());
  };
  /** Take out: the one money sheet's site Take out (Home's own, unchanged): every funded wallet of the site, home. */
  const back = () => {
    if (!row?.wallet) return;
    const also = takeOutAlso(row);
    shell.openMoney({ kind: "siteback", wallet: row.wallet, name, ...(also.length ? { also } : {}) }, (end) => {
      // a Take out that went: its one row is Home's own job (wallet site-back.ts: Now, its tracker, the Activity centre)
      refresh();
    });
  };
  // a proof opens in ZeroFee's own Browser, as Activity's does (only an explorer's page is opened this way)
  const view = (url: string) => shell.openApp("browser", undefined, url);
  // Sim pass (4 Nov): the Sim's wallet addresses are made up, so no explorer link (it opened a dead page)
  const explorer = !simPage();
  const copy = (a: string) => {
    void navigator.clipboard?.writeText(a).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
  };

  /** Open: the site's window; the visit kept in the Browser's History (crawl F11: "No sites yet" after both were opened) */
  const openWindow = () => {
    if (browser && app) void addVisit(browser, app.preset.url).catch(() => undefined);
    setWindowOpen(true);
  };
  if (!app) return null;
  // the site's window, exactly as the Browser's tile opened it; every way out comes back to this page
  if (windowOpen) return <SiteApp site={site} {...(browser ? { browser } : {})} pill={read === "ok" ? pillOf(row) : undefined} {...(row?.wallet ? { wallet: row.wallet } : {})} onLeave={(why) => {
    setWindowOpen(false);
    // the window's "Top up … privately here": this wallet's Add
    if (why === "topup") add();
    refresh();
  }} />;

  const settling = !coinsIn && (row?.usd ?? 0) >= 0.01;
  const v0 = walletView({ site, name, ...(row ? { row } : {}), read, ...(moving ? { moving } : {}), adds, backs, line, now: Date.now(), coins, jobs, ...(kept ? { kept } : {}), solanaDown });
  // builder 25 (item 2): while its coins are read, the kept figure with its time, else "Reading" and who reads it; never "…"
  const v = settling ? { ...v0, ...(kept ? { dollars: usd(kept.usd), asOf: `As of ${shortTime(kept.at)}` } : { dollars: READING, asOf: readingWho(name) }), coins: [], canAdd: false, canTakeOut: false, totalNote: undefined } : v0;
  return (
    <Frame name={name} onBack={onBack}>
      <div className="sw-page" data-testid={`site-wallet-${site}`}>
        <section className="sw-top">
          <img className="st-app-logo sw-logo" src={PRESET_LOGO[site]} alt="" width={56} height={56} />
          <p className="sw-big" data-testid="sw-usd">{v.dollars}</p>
          {v.asOf && <p className="zf-small sw-total-note" data-testid="sw-as-of">{v.asOf}</p>}
          {v.totalNote && <p className="zf-small sw-total-note">{v.totalNote}</p>}
          <p className="zf-small sw-sub">{walletTitle(name)}</p>
          <p className="zf-small sw-sub" data-testid="sw-made-for">{madeFor(name)}</p>
        </section>
        <div className="sw-acts">
          <button className="sw-act" disabled={!v.canAdd} onClick={add}><span className="sw-act__dot"><Plus /></span><span className="sw-act__word">Add</span></button>
          <button className="sw-act" disabled={!v.canTakeOut} onClick={back}><span className="sw-act__dot"><Out /></span><span className="sw-act__word">Take out</span></button>
        </div>

        <h2 className="sw-h">Coins</h2>
        {v.coins.length ? v.coins.map((c) => (
          // one row per coin (SOL and BONK share a network: the key is both; UI audit 5 Nov, React's duplicate-key error)
          <div className="sw-row" key={`${c.network}:${c.symbol}`}>
            {/* the network's own coin (the core's "native" mark, never a symbol: the audit wears its logo; any other
                coin its letter (never the network's mark on a BONK or on a spam "SOL" mint, logos.ts) */}
            {c.native ? <img className="sw-row__logo" src={logoUrl(c.network)} alt="" width={40} height={40} /> : <span className="sw-row__logo sw-row__letter" aria-hidden="true">{(c.symbol || c.name).charAt(0).toUpperCase()}</span>}
            <div><div className="t">{c.name}</div><div className="d">{c.symbol}</div></div>
            <div className="v">{c.dollars}</div>
          </div>
        )) : settling || v.dollars === READING ? null : <p className="zf-small sw-empty">No coins yet.</p>}

        {v.address && <>
          <h2 className="sw-h">Address</h2>
          <div className="sw-row sw-row--addr">
            <img className="sw-row__logo" src={logoUrl("sol")} alt="" width={40} height={40} />
            <div><div className="t sw-mono">{shortAddress(v.address)}</div><div className="d">{copied ? "Copied" : "Solana"}</div></div>
            <div className="sw-row__btns">
              <button className="zf-icon-btn" aria-label={`Copy your ${name} address`} data-testid="sw-copy" onClick={() => copy(v.address!)}><Copy /></button>
              <button className="zf-icon-btn" aria-label={`Show the QR code of your ${name} address`} data-testid="sw-qr" onClick={() => setQr(true)}><QrGlyph /></button>
            </div>
          </div>
        </>}

        <h2 className="sw-h">Moves</h2>
        {v.moves.length ? v.moves.map((m) => (
          <div className="sw-row sw-row--move" key={m.id}>
            <span className={`sw-dot sw-dot--${m.state}`} aria-hidden="true" />
            <div><div className="t">{m.title}</div><div className="d">{m.detail}</div></div>
            {/* its transaction on the explorer (Activity's proof, core tx-proof.ts), in ZeroFee's own Browser */}
            {explorer && m.url && <button className="sw-view" aria-label={`View ${m.title} on Solscan`} onClick={() => view(m.url!)}>View</button>}
          </div>
        )) : <p className="zf-small sw-empty">Nothing yet. Money you add or take out shows here.</p>}
        {explorer && v.address && <button className="sw-proof" onClick={() => view(proofUrl(v.address!))}>See every move on Solscan</button>}

        {v.lines.map((l) => <p key={l} className="zf-small sw-line" role="status">{l}</p>)}
        {read === "failed" && <button className="sw-proof" onClick={refresh}>Look again</button>}

        <div className="sw-open">
          <button className="zf-btn sw-open-btn" data-testid="sw-open" onClick={openWindow}>{v.open}</button>
        </div>
      </div>
      {qr && v.address && (
        <Sheet title={walletTitle(name)} onClose={() => setQr(false)}>
          <div className="sw-qr" data-testid="sw-qr-sheet">
            <img className="st-app-logo" src={PRESET_LOGO[site]} alt="" width={40} height={40} style={{ width: 40, height: 40, borderRadius: 11 }} />
            <div className="sw-qr__code"><QrCode value={v.address} size={256} label={`QR code of your ${name} address`} /></div>
            <p className="sw-qr__addr" data-testid="sw-qr-address">{groupAddress(v.address)}</p>
            <button className="zf-btn sw-qr__copy" onClick={() => copy(v.address!)}>{copied ? "Copied" : "Copy"}</button>
            <p className="zf-small sw-qr__only">Send SOL on Solana only.</p>
          </div>
        </Sheet>
      )}
    </Frame>
  );
}

/** The page's bar: the site's name alone (copy review, S17); with a way back (Social trading's list), Back to it. */
function Frame({ name, onBack, children }: { name: string; onBack: (() => void) | undefined; children: ReactNode }) {
  return onBack ? <PushedFrame name={name} onBack={onBack}>{children}</PushedFrame> : <AppFrame name={name} tray={[]} tab="all" onTab={() => {}}>{children}</AppFrame>;
}
