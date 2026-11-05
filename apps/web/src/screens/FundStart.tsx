// "Add money to start" (product decision, 2 Nov; D155, 3 Nov): a new account opens with any chain's own coin NEAR Intents takes. One
// page: the coins (searchable, the likely ones first), then that coin's one-time address behind "Show address" (a
// full-screen sheet with the QR and Copy, D135), the least in dollars, and one live line, waiting → here → opening →
// done; the account opens by itself. Every amount, address and state is the core's (account.fund.*); this file only
// draws them, in the words of ./fund.ts. The look (fund-start.css, the class names) is the UI revamp's.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { FundView } from "@zerofee/core/fund-start";
import type { Problem } from "@zerofee/core/problem";
import { SERVICE_NAMES, serviceOf, serviceSays } from "@zerofee/core/services";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Menu } from "@zerofee/design/icons.tsx";
import { More } from "@zerofee/design/More.tsx";
import type { CSSProperties } from "react";
import { QrCode } from "@zerofee/design/QrCode.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { PushedFrame, useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { ProblemView } from "../shell/ProblemView.tsx";
import { ADD_LINE, ADD_TITLE, ALL_HEAD, COPY_ADDRESS, LIKELY_HEAD, NEAR_LINE, NO_MATCH, PICK_OTHER, PRIVATE_LINE, SEARCH_LABEL, SEND_MORE_LINE, SHOW_ADDRESS, SWAP_OFF_LINE, coinIcon, coinsFound, fundCoinsShown, WAITS_LINE, WAITS_TITLE, addressGroups, asShown, depositTitle, depositUntil, depositWhere, dollars, fundLine, fundNext, fundTitle, liveOf, mayGoToApp, mayLeaveSetup, openCostLine, openingWords, setupProgress, showsChecklist, type FundCoinRow } from "./fund.ts";
import { ThreadBar } from "@zerofee/design/Thread.tsx";
import { homeProof } from "@zerofee/wallet/app/money/home-proof.ts";
import { threadOf } from "../shell/thread.ts";
import type { WinOffer } from "./first-win.ts";
import "./fund-start.css";
import { QUANTUM_WORDS } from "../apps/security/quantum.ts";

/** O-2b: the most "Open ZeroFee" waits for the first win's screen and its reads before going straight in. */
export const WIN_LOOK_MS = 4000;
/** O-2b: the first win's screen, loaded only when it is offered (never in the first load). */
const FirstWin = lazy(() => import("./FirstWin.tsx").then((m) => ({ default: m.FirstWin })));

export const FUND_POLL_MS = 4000;
/** B28: a refused coin is asked again by itself, sooner first, while it is still the one wanted. */
export const REFUSED_BACKOFF_MS = [15_000, 30_000, 60_000, 120_000];

/**
 * The tile's line for a coin 1Click won't change to NEAR right now (its "no" to the pair) or 1Click failing (by name),
 * or null for any other Problem (that keeps its own screen: an unknown coin, an account already open).
 */
export function refusedLine(p: Problem, coin: { id: string; symbol: string }): string | null {
  if (coin.id === "near") return null;
  if (p.code === "security.fund.price-refused") return `${SERVICE_NAMES.oneclick} won't change ${coin.symbol} right now. Asking again.`;
  if (serviceOf(p)) return `${serviceSays(p.service!, p.fault ?? "down")} Asking again.`;
  return null;
}
/** While an address waits for money (J2): read every 2 s, so the deposit watcher's word shows within seconds. */
export const FUND_WATCH_POLL_MS = 2000;

// ── The screens, as they draw (the gallery and the walk hold them still) ──────────────────────────────────────────

/** The top strip every funding screen has (so the mainnet chip sits above it, never on the title). */
function Top({ name }: { name: string }) {
  return (
    <header className="af-top">
      <span className="zf-label" style={{ color: "var(--ink)" }}>{name}</span>
    </header>
  );
}

/** The 2 pt line at the top of set-up's pages: how far along it is (0 to 1). */
const Progress = ({ p }: { p: number }) => <div className="fs-progress" style={{ "--p": p } as CSSProperties} aria-hidden="true" />;

/** One coin's row: its mark, its symbol, and its name where that says more (Bitcoin, Base). */
function CoinRow({ c, line, onPick }: { c: FundCoinRow; line?: string; onPick: (c: FundCoinRow) => void }) {
  return (
    <li>
      <button className="fs-coin" onClick={() => onPick(c)} {...(line ? { "aria-describedby": `fs-why-${c.id}` } : {})}>
        <span className="fs-coin__mark"><CoinIcon symbol={c.symbol} icon={coinIcon(c)} size={40} /></span>
        <span className="fs-coin__sym">{c.symbol}</span>
        <span className="fs-coin__name">{line ? <span id={`fs-why-${c.id}`} role="status">{line}</span> : c.name}</span>
      </button>
    </li>
  );
}

/**
 * The coins (D155): one page, every coin the core offers, searchable, the likely ones first. `onBack`: only when there
 * is somewhere to go back to (an address already asked for); the first page of set-up has none, and never leads into
 * the apps (QA 2 Nov, A3). `onRestore` / `onStartOver`: the ways to leave set-up while nothing was sent. `refused`: a
 * coin 1Click won't take right now (B28): its row says so in one line and ZeroFee asks again by itself.
 */
export function AddMoneyView({ coins, open, onPick, onBack, onRestore, onStartOver, waiting, refused = {}, proof = homeProof() }: { coins: FundCoinRow[]; open?: { near: string; usd?: string }; onPick: (c: FundCoinRow) => void; onBack?: () => void; onRestore?: () => void; onStartOver?: () => void; waiting?: { symbol: string; onShow: () => void }; wordsDone?: boolean; refused?: Record<string, string>; proof?: boolean }) {
  const [find, setFind] = useState("");
  // D125: the private route only in the test build; off, NEAR alone and the line that says why
  const shown = coinsFound(fundCoinsShown(coins, proof), find);
  const likely = shown.filter((c) => c.likely), rest = shown.filter((c) => !c.likely);
  const cost = open ? dollars(open.usd) ?? null : null;
  const body = (
    <>
      <Progress p={setupProgress("coins")} />
      <div className="fs-page zf-enter">
        <div className="fs-hero">
          <h1 className="fs-hero__title">{ADD_TITLE}</h1>
          <p className="fs-hero__line">{ADD_LINE}</p>
        </div>
        {!waiting && <p className="zf-small">{openCostLine(cost)}</p>}
        {!proof && <p className="zf-small" role="status" data-testid="fund-swap-off">{SWAP_OFF_LINE}</p>}
        {/* An address already waits (Back from it, J1): the way back to it, on the page, never only the arrow. */}
        {waiting && (
          <button className="fs-addr" onClick={waiting.onShow} aria-label={`Waiting for your ${waiting.symbol}. ${SHOW_ADDRESS}`}>
            <span className="fs-addr__text">Waiting for your {waiting.symbol}</span>
            <span className="fs-addr__go" aria-hidden="true">›</span>
          </button>
        )}
        {coins.length > 6 && <input className="fs-search" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={SEARCH_LABEL} aria-label={SEARCH_LABEL} autoComplete="off" spellCheck={false} />}
        {likely.length > 0 && (
          <>
            {rest.length > 0 && <p className="fs-group">{LIKELY_HEAD}</p>}
            <ul className="fs-coins fs-coins--likely">{likely.map((c) => <CoinRow key={c.id} c={c} onPick={onPick} {...(refused[c.id] ? { line: refused[c.id] } : {})} />)}</ul>
          </>
        )}
        {rest.length > 0 && (
          <>
            {likely.length > 0 && <p className="fs-group">{ALL_HEAD}</p>}
            <ul className="fs-coins">{rest.map((c) => <CoinRow key={c.id} c={c} onPick={onPick} {...(refused[c.id] ? { line: refused[c.id] } : {})} />)}</ul>
          </>
        )}
        {shown.length === 0 && <p className="zf-small" role="status">{NO_MATCH}</p>}
      </div>
      <div className="zf-fill" />
      {(onRestore || onStartOver) && (
        <div className="fs-floor zf-enter-2">
          {onRestore && <button className="zf-link" onClick={onRestore}>I already have an account</button>}
          {onStartOver && <button className="zf-link" onClick={onStartOver}>Start over</button>}
        </div>
      )}
    </>
  );
  if (onBack) return <PushedFrame name="Add money" onBack={onBack}>{body}</PushedFrame>;
  return (
    <div className="zf-screen">
      <Top name="Add money" />
      <main className="af-main af-main--pushed">{body}</main>
    </div>
  );
}

/** Leaving set-up, said before it happens: what goes, that nothing is lost, and the one case to stay. */
export function LeaveSheet({ why, device, busy, declined, onGo, onClose }: { why: "restore" | "over"; device: string; busy: boolean; declined: boolean; onGo: () => void; onClose: () => void }) {
  const restore = why === "restore";
  return (
    <Sheet title={restore ? "Use your 24 words" : "Start over"} onClose={onClose}>
      <div className="fs-sheet">
        <p className="zf-body">{restore ? `Your words bring your account to ${device}. This new set-up is cleared first.` : `This clears the set-up on ${device} and goes back to the first screen.`}</p>
        <p className="zf-small">No money has arrived, so none is lost. Sent some to the address already? Stay: it reaches you only here.</p>
        {restore && <p className="zf-small">Then choose “I already have one”.</p>}
        {declined && <p className="zf-small" role="status">Nothing was cleared.</p>}
        <button className="zf-btn" disabled={busy} onClick={onGo}>{busy ? "Clearing…" : restore ? "Clear and use my words" : "Start over"}</button>
        <button className="zf-link" onClick={onClose}>Not now</button>
      </div>
    </Sheet>
  );
}

export function AskingView({ symbol, onBack }: { symbol: string; onBack: () => void }) {
  return (
    <PushedFrame name={`Add ${symbol}`} onBack={onBack}>
      <div className="zf-fill" />
      <div className="fs-wait" role="status"><span className="fs-spin" role="img" aria-label="Getting your address" /><p className="zf-body">Getting your address…</p></div>
      <div className="zf-fill" />
    </PushedFrame>
  );
}

/** The address's full-screen sheet (D135): the QR on its white tile, the whole address in groups of four, and Copy. */
function AddressSheet({ address, symbol, copied, onCopy, onClose }: { address: string; symbol: string; copied: boolean; onCopy: () => void; onClose: () => void }) {
  return (
    <Sheet title={`Your ${symbol} address`} onClose={onClose}>
      <div className="fs-qr"><QrCode value={address} size={240} label={`The address to send ${symbol} to`} /></div>
      <p className="fs-qr__addr" data-address={address} translate="no">{addressGroups(address)}</p>
      {/* the independent grade (§4.1): Copy is a chip beside the address, never a black slab */}
      <button className="zf-chip fs-copy" onClick={onCopy}>{copied ? "Copied" : COPY_ADDRESS}</button>
    </Sheet>
  );
}

/** The one live line (D155): waiting → here → opening → done, or a calm stop. */
const Live = ({ v }: { v: FundView }) => {
  const l = liveOf(v);
  return <div className={`fs-live ${l.cls}`} role="status"><span className="fs-live__ring" aria-hidden="true" /><p className="fs-live__line">{l.line}</p></div>;
};

/** The coin's address page (D155): the least in dollars, where to send it, "Show address" (the sheet), whether it is
 *  private, until when the address works (the real time, said calmly), and the live line. `more` (O-2b): Hidden is open
 *  on this build, so it may say $2 more brings the first win. */
export function DepositView({ v, copied, onCopy, onBack, onRenew, more = false }: { v: FundView; copied: boolean; onCopy: () => void; onBack: () => void; onRenew: () => void; more?: boolean }) {
  const [sheet, setSheet] = useState(false);
  const d = v.deposit!;
  const { symbol, network } = v.coin;
  const near = v.coin.id === "near";
  if (v.state === "expired") {
    return (
      <PushedFrame name={`Add ${symbol}`} onBack={onBack}>
        <Progress p={setupProgress("deposit")} />
        <div className="fs-page zf-enter">
          <div className="fs-hero"><h1 className="fs-hero__title">{fundTitle("expired")}</h1><p className="fs-hero__line">{fundLine(v, false)}</p></div>
        </div>
        <div className="zf-fill" />
        <div className="fs-floor"><button className="zf-btn" onClick={onRenew}>Get a new address</button></div>
      </PushedFrame>
    );
  }
  return (
    <PushedFrame name={`Add ${symbol}`} onBack={onBack}>
      <Progress p={setupProgress("deposit")} />
      <div className="fs-page fs-deposit zf-enter">
        <div className="fs-hero">
          <span className="fs-hero__mark"><CoinIcon symbol={symbol} icon={coinIcon(v.coin)} size={40} /></span>
          {/* J2 (O5) and the design review (section 11): one figure, in dollars when priced */}
          <h1 className="fs-hero__title">{depositTitle(d, symbol)}</h1>
          <p className="fs-hero__line">{depositWhere(network, near)}</p>
        </div>
        <button className="zf-link" onClick={onBack}>{PICK_OTHER}</button>
        <button className="fs-addr" onClick={() => setSheet(true)}>
          <span className="fs-addr__text">{SHOW_ADDRESS}</span>
          <span className="fs-addr__go" aria-hidden="true">›</span>
        </button>
        {d.memo && <p className="zf-small">Memo (needed): <span className="fs-memo">{d.memo}</span></p>}
        <p className="zf-small">{near ? NEAR_LINE : PRIVATE_LINE}</p>
        {more && <p className="zf-small">{SEND_MORE_LINE}</p>}
        {!near && <p className="zf-small">{depositUntil(d.untilIso)}</p>}
      </div>
      <div className="zf-fill" />
      {/* the floor: no button while it waits, only the live line (the independent grade §4.1) */}
      <div className="fs-floor zf-enter-2"><Live v={v} /></div>
      {sheet && <AddressSheet address={d.address} symbol={symbol} copied={copied} onCopy={onCopy} onClose={() => setSheet(false)} />}
    </PushedFrame>
  );
}

/** Once money is seen (D155): the same page, its live line moving on by itself; one button only when there is a step. */
export function ChecklistView({ v: given, busy, onNext, onBack }: { v: FundView; busy?: boolean; onNext: () => void; onBack: () => void }) {
  const v = asShown(given);
  const stage = v.stage;
  const next = fundNext(v, stage);
  const failed = v.steps.some((s) => s.state === "failed") || v.state === "refunded" || v.state === "failed";
  // The swap's live ETA (O9) counts down between the core's reads.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!v.etaIso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [v.etaIso]);
  return (
    <PushedFrame name="Add money" onBack={onBack}>
      <Progress p={setupProgress(v.state)} />
      <div className="fs-page zf-enter">
        <div className="fs-hero">
          <h1 className="fs-hero__title">{v.waitsForWords ? WAITS_TITLE : fundTitle(v.state, stage, v.coin)}</h1>
          <p className={`fs-hero__line${failed ? " fs-line--alert" : ""}`} role={v.etaIso ? "timer" : undefined}>{v.waitsForWords ? WAITS_LINE : fundLine(v, stage === "ready", now)}</p>
          {/* Sign-up's last screen, "Your account is open": one line, no new step (review, 5 Nov) */}
          {!v.waitsForWords && (v.state === "opened" || v.state === "done") && stage !== "needs-backup" && <p className="fs-hero__q">{QUANTUM_WORDS.signUp}</p>}
        </div>
        {(v.state === "refunded" || v.state === "failed" || v.state === "short" || v.state === "expired") && v.refundTo && (
          <More label={`Your ${v.coin.network} wallet`} lines={[addressGroups(v.refundTo)]} />
        )}
      </div>
      <div className="zf-fill" />
      {/* J2: nothing to tap while the money is on its way or the account opens: it opens by itself. */}
      <div className="fs-floor zf-enter-2">
        <Live v={v} />
        {next.next !== "wait" && <button className="zf-btn" disabled={busy} onClick={onNext}>{busy ? "One moment…" : next.label}</button>}
      </div>
    </PushedFrame>
  );
}

/** The one thread over the apps while the account opens (money seen): Money in under way; tap it, the steps. */
export function FundThread({ v, onOpen }: { v: FundView; onOpen: () => void }) {
  const t = threadOf({ stage: v.stage, fund: asShown(v), wordsDone: v.wordsDone === true, moneyIn: null, protection: null, secondDevice: null });
  return <div className="fs-thread"><ThreadBar steps={t.steps} line={t.line} onOpen={onOpen} /></div>;
}

/**
 * What every app shows while the account opens (money seen; before that the apps aren't offered): what is happening,
 * where the money is, and one button back to the steps. Content, never a spinner (J1, 2 Nov); the menu reaches Settings.
 */
export function OpeningApp({ name, v, onOpen, onWords }: { name: string; v: FundView | null; onOpen: () => void; onWords: () => void }) {
  const shell = useShell();
  const w = v ? openingWords(v, name) : null;
  return (
    <div className="zf-screen">
      <header className="af-top">
        <button className="zf-icon-btn af-menu" onClick={() => shell.openMenu()} aria-label="Settings"><Menu /></button>
        <span className="zf-label" style={{ color: "var(--ink)" }}>{name}</span>
      </header>
      <main className="af-main fs-opening-main">
        {w && (
          <div className="fs fs-opening zf-enter">
            {/* The thread above says what is happening (Job 1): the page says where the money is, once. */}
            <p className="zf-body">{w.line}</p>
            {w.note && <p className="zf-small">{w.note}</p>}
          </div>
        )}
        <div className="zf-fill" />
        {w && (
          <div className="zf-floor fs-opening__floor zf-enter-2">
            <button className="zf-btn" onClick={w.words ? onWords : onOpen}>{w.button}</button>
          </div>
        )}
      </main>
    </div>
  );
}

// ── The flow ──────────────────────────────────────────────────────────────────────────────────────────────────────

type Screen =
  | { k: "loading" }
  | { k: "coins" }
  | { k: "asking"; coin: FundCoinRow; back: Screen }
  | { k: "deposit" }
  | { k: "checklist" }
  | { k: "problem"; problem: Problem; then: Screen }
  /** O-2b: the first win, after "Your account is open" and before the app. */
  | { k: "win"; offer: WinOffer };

/** Reads the core's checklist every few seconds while it is on screen (and at once when the page shows again). */
export function useFundStatus(bridge: Bridge, on: boolean, everyMs = FUND_POLL_MS): [FundView | null, (v: FundView | null) => void, () => Promise<BridgeResult<FundView>>, boolean] {
  const [view, setView] = useState<FundView | null>(null);
  /** The core has no funding on record (none asked, or seen done): nothing to show. */
  const [gone, setGone] = useState(false);
  const busy = useRef(false);
  const read = async (): Promise<BridgeResult<FundView>> => {
    const res = await bridge.call<FundView>("account.fund.status");
    if ("ok" in res) setView(res.ok);
    setGone("problem" in res && res.problem.code === "security.fund.not-opening");
    return res;
  };
  useEffect(() => {
    if (!on) return;
    const tick = async () => {
      if (busy.current || document.visibilityState === "hidden") return;
      busy.current = true;
      try {
        await read();
      } finally {
        busy.current = false;
      }
    };
    void tick();
    const t = setInterval(() => void tick(), everyMs);
    const onShow = () => document.visibilityState === "visible" && void tick();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [bridge, on, everyMs]);
  return [view, setView, read, gone];
}

export function FundFlow({ bridge, wallet, everyMs = FUND_POLL_MS, onAway, onWords, onWordsFirst, onDone, onProblem, leave }: {
  bridge: Bridge;
  /** Wallet's bridge (kept for Job 2's private funding; the rest is no longer a step here). */
  wallet?: Bridge;
  everyMs?: number;
  /** Close: into the app, the bar showing the funding (only once money is seen). */
  onAway: () => void;
  /** The account is open: its backup words next. */
  onWords: () => void;
  /** O-2c: the NEAR waits for the words (not yet checked): to them; the account opens by itself after. Absent: onDone,
   *  whose reroute reads the core's wordsDue. */
  onWordsFirst?: () => void;
  /** All done (the record goes). */
  onDone: () => void;
  onProblem: (p: Problem) => void;
  /** Leaving set-up (the app's own clear: Reset on the phone, the browser's clear): `device` names where ("this iPhone");
   *  `go` answers false when the person said no (Face ID declined). The app then opens on its first screen. */
  leave?: { device: string; go: () => Promise<boolean> };
}) {
  const [screen, setScreen] = useState<Screen>({ k: "loading" });
  const [coins, setCoins] = useState<{ coins: FundCoinRow[]; open?: { near: string; usd?: string } } | null>(null);
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState<{ why: "restore" | "over"; busy: boolean; declined: boolean } | null>(null);
  /** B28: coins 1Click won't change right now, each with its one line; asked again by itself (refusedAgain). */
  const [refused, setRefused] = useState<Record<string, string>>({});
  /** The coin the person last picked: a retry that comes good opens its address only if it is still the one wanted. */
  const wanted = useRef<string | null>(null);
  /** The one retry waiting (security review M1), and what the screen and the funding are now, for it to check. */
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenNow = useRef<Screen["k"]>("loading");
  const depositNow = useRef(false);
  const stopRetry = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    wanted.current = null;
  };
  /** A retry may ask again only while the person is still on the coins for that coin, with no address already out. */
  const mayRetry = (coinId: string) => live.current && wanted.current === coinId && screenNow.current === "coins" && !depositNow.current;
  const watching = screen.k === "deposit" || screen.k === "checklist" || screen.k === "loading";
  const [view, setView, read] = useFundStatus(bridge, watching, screen.k === "deposit" ? Math.min(everyMs, FUND_WATCH_POLL_MS) : everyMs);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // O-2b: Hidden open on this build (Wallet's own read; no money read): the address may say "$2 more".
  const [hiddenOn, setHiddenOn] = useState(false);
  const finishing = useRef(false);
  /** "Open ZeroFee" said "One moment…" while the first win is looked up (at most WIN_LOOK_MS). */
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    if (!wallet) return;
    // canAdd (review H1): only where a move into Hidden can be priced on this build, or the line would promise nothing
    void wallet.call<{ available?: boolean; canAdd?: boolean }>("ledger.private").then((r) => live.current && setHiddenOn("ok" in r && r.ok.available === true && r.ok.canAdd === true), () => undefined);
  }, [wallet]);

  // The retry's view of now (review M1); leaving the coins ends it, and so does leaving set-up.
  screenNow.current = screen.k;
  depositNow.current = !!view?.deposit && view.state !== "expired" && view.state !== "refunded";
  useEffect(() => {
    if (screen.k !== "coins" && screen.k !== "asking") stopRetry();
  }, [screen.k]);
  useEffect(() => () => stopRetry(), []);

  // First look: an address already asked for (a restart, or back from the app) goes straight to it; else the coins.
  useEffect(() => {
    void (async () => {
      const res = await read();
      if (!live.current) return;
      if ("ok" in res && res.ok.deposit) return setScreen(showsChecklist(res.ok) ? { k: "checklist" } : { k: "deposit" });
      if ("problem" in res && res.problem.code !== "security.fund.not-opening") return onProblem(res.problem);
      await showCoins();
    })();
  }, []);

  // The address screen turns into the checklist the moment anything happens.
  useEffect(() => {
    if (view && screen.k === "deposit" && showsChecklist(view)) setScreen({ k: "checklist" });
  }, [view, screen.k]);

  async function showCoins() {
    const res = await bridge.call<{ coins: FundCoinRow[]; open?: { near: string; usd?: string } }>("account.fund.coins");
    if (!live.current) return;
    // O-2c: NEAR that came early opened the account the moment the words were checked: nothing waits for money any more,
    // so in, never "There's no account waiting for money" over an account that just opened.
    if ("problem" in res && res.problem.code === "security.fund.not-opening") return onDone();
    if ("problem" in res) return onProblem(res.problem);
    setCoins(res.ok);
    setScreen({ k: "coins" });
  }

  async function start(coin: FundCoinRow, back: Screen, tries = 0) {
    // D125: no swap coin is ever asked for while its route is off (the tiles don't offer one either)
    if (coin.id !== "near" && !homeProof()) return;
    if (tries === 0) {
      // a new pick ends any retry still waiting (security review M1: one at a time, never two orders racing)
      stopRetry();
      wanted.current = coin.id;
      setScreen({ k: "asking", coin, back });
    } else if (!mayRetry(coin.id)) return;
    const res = await bridge.call<FundView>("account.fund.start", { coin: coin.id });
    if (!live.current) return;
    // a retry that comes back after the person picked another coin, left the coins, or has an address waiting changes nothing
    if (tries > 0 && !mayRetry(coin.id)) return;
    // a first answer that comes late, after the person picked another coin, changes nothing either (re-review, Low)
    if (wanted.current !== coin.id) return;
    if ("problem" in res) {
      // O-2a: the words come first (the core's rule): the app's own Problem screen, whose one step goes to the words.
      if (res.problem.code === "security.fund.words-first") return onProblem(res.problem);
      const line = refusedLine(res.problem, coin);
      if (!line) return setScreen({ k: "problem", problem: res.problem, then: back });
      // B28 (QA, SOL → NEAR "not available"): a refused pair is a line on its tile, never a page; NEAR stays the way in
      setRefused((r) => ({ ...r, [coin.id]: line }));
      if (tries === 0) setScreen(back);
      const wait = REFUSED_BACKOFF_MS[Math.min(tries, REFUSED_BACKOFF_MS.length - 1)];
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        if (live.current) void start(coin, back, tries + 1);
      }, wait);
      return;
    }
    setRefused((r) => {
      const { [coin.id]: _gone, ...rest } = r;
      return rest;
    });
    setView(res.ok);
    setScreen({ k: "deposit" });
  }

  const pick = (c: FundCoinRow) => void start(c, { k: "coins" });
  const away = async () => {
    await bridge.call("account.fund.note", { away: true });
    onAway();
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText(view!.deposit!.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  async function next(v: FundView) {
    const n = fundNext(asShown(v), v.stage).next;
    if (n === "wait") return;
    if (n === "app") return void away();
    if (n === "words") return onWords();
    if (n === "wordsFirst") return (onWordsFirst ?? onDone)();
    if (n === "done") {
      // One "Open ZeroFee" at a time (review Low: a double tap ran this twice).
      if (finishing.current) return;
      finishing.current = true;
      setOpening(true);
      await bridge.call("account.fund.note", { finished: true });
      // O-2b: the first win, when it can work. Loading it and its reads are bounded together: anything slow goes in.
      if (wallet) {
        const look = import("./FirstWin.tsx").then((m) => m.readWin(bridge, wallet)).catch(() => null);
        const offer = await Promise.race([look, new Promise<null>((r) => setTimeout(() => r(null), WIN_LOOK_MS))]);
        if (offer && live.current) return setScreen({ k: "win", offer });
      }
      return onDone();
    }
    if (n === "deposit") return setScreen({ k: "deposit" });
    if (n === "retry") {
      await bridge.call("account.fund.note", { retry: true });
      return void read();
    }
    // A new address for the same coin (ran out), or another coin (it came back).
    // D115: a coin set-up no longer offers goes back to the coin list, never round to the expired screen (review 4)
    if (v.state === "expired" && (!coins || coins.coins.some((c) => c.id === v.coin.id))) return void start({ id: v.coin.id, symbol: v.coin.symbol, name: v.coin.name, network: v.coin.network }, { k: "deposit" });
    return void showCoins();
  }

  switch (screen.k) {
    case "loading":
      return <div className="zf-screen"><Top name="Add money" /><div className="zf-fill" /><div className="fs-wait" role="status"><span className="fs-spin" role="img" aria-label="One moment" /></div><div className="zf-fill" /></div>;
    case "coins": {
      // Back only to what was here before (the address, or its checklist), never into the apps (QA 2 Nov, A3).
      const before = view?.deposit ? view : null;
      const canLeave = !!leave && mayLeaveSetup(view);
      const ask = (why: "restore" | "over") => setLeaving({ why, busy: false, declined: false });
      const go = async () => {
        if (!leaving || !leave) return;
        setLeaving({ ...leaving, busy: true, declined: false });
        const done = await leave.go();
        // Done: the app opens on its first screen by itself. Not done: nothing changed, said on the sheet.
        if (!done && live.current) setLeaving({ ...leaving, busy: false, declined: true });
      };
      return (
        <>
          <AddMoneyView coins={coins?.coins ?? []} open={coins?.open} onPick={pick} wordsDone={view?.wordsDone === true} refused={refused}
            {...(before ? { onBack: () => setScreen(showsChecklist(before) ? { k: "checklist" } : { k: "deposit" }) } : {})}
            {...(before && before.state === "waiting" ? { waiting: { symbol: before.coin.symbol, onShow: () => setScreen({ k: "deposit" }) } } : {})}
            {...(canLeave ? { onRestore: () => ask("restore"), onStartOver: () => ask("over") } : {})} />
          {leaving && leave && <LeaveSheet why={leaving.why} device={leave.device} busy={leaving.busy} declined={leaving.declined} onGo={() => void go()} onClose={() => setLeaving(null)} />}
        </>
      );
    }
    case "asking":
      return <AskingView symbol={screen.coin.symbol} onBack={() => setScreen(screen.back)} />;
    case "deposit":
      return view?.deposit ? <DepositView v={view} copied={copied} onCopy={() => void copy()} onBack={() => void showCoins()} onRenew={() => void next(view)} more={hiddenOn} /> : null;
    case "checklist":
      return view ? <ChecklistView v={view} busy={opening} onNext={() => void next(view)} onBack={() => (view.stage !== "needs-funding" ? onAway() : mayGoToApp(view) ? void away() : setScreen({ k: "deposit" }))} /> : null;
    case "win":
      return <Suspense fallback={<div className="zf-screen" />}><FirstWin wallet={wallet!} offer={screen.offer} onDone={onDone} /></Suspense>;
    case "problem": {
      const then = screen.then;
      return <ProblemView problem={screen.problem} onBack={() => setScreen(then)} onNext={() => setScreen(then)} />;
    }
  }
}
