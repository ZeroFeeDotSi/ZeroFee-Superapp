// The one money sheet's host (Job 1, criterion 4 and 6): the shell renders this over whichever app asked
// (useShell().openMoney), on Wallet's own bridge, so Send, Top up, Put away and Add money open in place, never as a jump
// into Wallet. One sheet at a time: a sheet asked for over another replaces it (Top up's "Change" opens the cap).
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NextStep } from "@zerofee/core/problem";
import type { SpendingStatus } from "@zerofee/core/spending";
import { Sheet, SheetNote } from "@zerofee/design/Sheet.tsx";
import { SheetLine } from "@zerofee/design/MoneySheet.tsx";
import { SHEET_NEEDS, useServices } from "../services.ts";
import { ShellContext, useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { onApprovalAnswered } from "@zerofee/shell-api/approval-answered.ts";
import { moneyClosed } from "@zerofee/core/money-closed";
import { AWAY_SLOW_MS } from "@zerofee/design/MoneySheet.tsx";
import { sealBridge, sealShell } from "./seal.ts";
import { shortTime } from "@zerofee/core/clock";
import { STILL_MOVING, askFrom, filledNote, sayWent, type MoneyAsk, type MoneyEnd } from "@zerofee/shell-api/money.ts";
import { homePots, lines, safeLines } from "../format.ts";
import { WalletProvider, useWallet } from "../runtime.tsx";
import { potsOf } from "./pots.ts";
import { followSwap } from "./swap-follow.ts";
import { codeGate, didntLoad } from "./code-gate.ts";
import { chunkOffline, whenOnline } from "@zerofee/shell-api/chunk-reload.ts";
import { later } from "../later.tsx";
import { TEST_SHEETS, TEST_WORDS, testAccount } from "./dead-ends.ts";
import { webWallet } from "@zerofee/shell-api/release.ts";
import { WEB_SEND_OPEN } from "../screens/home-view.ts";
import { OnYourPhone } from "@zerofee/shell-api/OnYourPhone.tsx";

// Social trading's two sheets load when first asked for (speed, 2 Nov: never in Home's first load)
const SiteAddSheet = lazy(() => import("./SiteMoney.tsx").then((m) => ({ default: m.SiteAddSheet })));
const WebSend = lazy(() => import("./WebSendSheet.tsx").then((m) => ({ default: m.WebSendSheet })));
// Move (FLOW-V4) loads with its first tap or with the neighbours (preloadSheets): Home's first load stays inside its
// budget; once here it draws at once (later.tsx: never Suspense's 300 ms hold)
const MoveSheet = later<Parameters<typeof import("../screens/MoveSheet.tsx").MoveSheet>[0]>(
  () => import("../screens/MoveSheet.tsx").then((m) => m.MoveSheet),
  (p) => <LoadingSheet title="Move" kind="move" onClose={p.onClose} />,
  (p) => <LoadingSheet title="Move" kind="move" words={didntLoad("Move")} onClose={p.onClose} />,
);
const SiteBackSheet = lazy(() => import("./SiteMoney.tsx").then((m) => ({ default: m.SiteBackSheet })));

/**
 * `asker`: the app that opened the sheet, as the shell knows it (AppHost: the app on screen when openMoney was called),
 * never a field the app sets. A sheet the agent app opened filled in (MoneyAsk prefill) says AGENT_FILLED first, until
 * the person goes on to another sheet; its fields are only filled in, and every step and Face ID still ask.
 */
export function MoneyHost({ ask, onEnd, asker }: { ask: MoneyAsk; onEnd: (end: MoneyEnd) => void; asker?: string }) {
  const shell = useShell();
  const taken = useMemo(() => askFrom(ask, asker), [ask, asker]);
  const [same, setSame] = useState(true);
  const note = same ? filledNote(taken, asker) : null;
  // Close ALWAYS closes (phone test, 3 Nov sat on a slow quote and its ✕ did nothing):
  // from the person's Close on, nothing the sheet asked answers it (seal.ts) and nothing it started is signed
  // (moneyClosed: the ledger's next signature request is a No). A move that went keeps its own follow-up.
  const gone = useRef(false);
  // the sealed bridge is made once per bridge (never per render: the wallet's reads would start over each time)
  const sealedBridge = useMemo(() => sealBridge(shell.bridge, () => gone.current), [shell.bridge]);
  const sealed = useMemo(() => sealShell(shell, () => gone.current, sealedBridge), [shell, sealedBridge]);
  const approved = useRef(false);
  useEffect(() => onApprovalAnswered((yes) => { if (yes) approved.current = true; }), []);
  const end = (e: MoneyEnd) => {
    if (gone.current) return;
    if (!e.went) {
      gone.current = true;
      moneyClosed();
      // a Close after an Approve: the move is the core's now, and on its way; before one, nothing moved
      sayWent(approved.current ? "It's on its way." : "", "went");
    }
    onEnd(e);
  };
  // The shell's zf:home-root (the tab already on screen tapped again) is the person's Close, by the same path: a "not now",
  // sealed (nothing unsigned is signed after it), and a move already approved is on its way, never failed or cancelled.
  // A page script that sends the event can only do what ✕ does: decline and hide.
  const endRef = useRef(end);
  endRef.current = end;
  useEffect(() => {
    if (typeof window.addEventListener !== "function") return;
    const hear = (e: Event) => { if ((e as CustomEvent<{ app?: string }>).detail?.app === asker) endRef.current({ went: false }); };
    window.addEventListener("zf:home-root", hear);
    return () => window.removeEventListener("zf:home-root", hear);
  }, [asker]);
  // every figure a sheet gates or caps on is two nodes' agreed read, never one node's (review H1), as before D134
  return <ShellContext.Provider value={sealed}><WalletProvider bridge={sealedBridge} seedFrom={shell.bridge} money><SheetNote.Provider value={note}><Host ask={taken} onEnd={end} onSame={setSame} /></SheetNote.Provider></WalletProvider></ShellContext.Provider>;
}

function Host({ ask: first, onEnd, onSame }: { ask: MoneyAsk; onEnd: (end: MoneyEnd) => void; onSame: (same: boolean) => void }) {
  const shell = useShell();
  const { bridge } = shell;
  const { balances, balanceProblem, chains, earning, spending, spendingFresh, spendingAsOf, trading, tradingPartial, pocket, refresh } = useWallet();
  // UI's mainnet rehearsal (3 Nov): Move sat on "Reading your money…" for over 60 s with only Close. A sheet opens at once
  // on what Home read this session (runtime.tsx) and refines in place when its own read answers; one still on its way
  // after SEEN_SLOW_MS says so in one line, naming it, with when the figures are from.
  const slowLine = useSlowRead(!!spending && !spendingFresh, spendingAsOf);
  const [ask, setAsk] = useState<MoneyAsk>(first);
  useEffect(() => setAsk(first), [first]);
  // the filled-in line stays only on the sheet that was filled in (a Problem's Add, or the cap, is the person's own step)
  useEffect(() => onSame(ask === first), [ask, first]);
  // the Safe as Home counts it (D128: the private balance's coins under the Safe, Home.tsx's `safe`), so every sheet's Safe
  // figure is Home's (the review's walk, item 4: Move's left the pocket out). Send's top line adds the pocket itself.
  const safeOwn = balances ? lines(balances, chains, earning).totalUsd : null;
  const safeUsd = balances ? safeLines(balances, pocket, chains, earning).totalUsd : null;
  const pots = potsOf(safeUsd, spending);
  const done = (line: string, movementId?: string) => {
    if (line) sayWent(line);
    // a Move's "on its way" line ends in the same read that shows it landed (landing-notice.ts, loaded with its first use)
    if (line && movementId && STILL_MOVING.test(line)) void import("./landing-notice.ts").then((m) => m.endOnLanding(bridge, movementId, line, (t) => sayWent(t)), () => undefined);
    refresh();
    onEnd({ went: true, ...(movementId ? { movementId } : {}) });
  };
  /** A swap: its line stays "working on it" (busy, never a tick) until Spending has it, then says it went. */
  const swapped = (line: string, follow?: { id: string; words: string }) => {
    if (line) sayWent(line, follow ? "busy" : "went");
    if (follow) followSwap(bridge, follow);
    refresh();
    // its movement's id, so the app that asked can follow it (AgentZero)
    onEnd({ went: true, ...(follow?.id ? { movementId: follow.id } : {}) });
  };
  const close = () => onEnd({ went: false });
  /** A Problem's next step from a sheet: the cap is this host's own sheet; any other place is the shell's to open. */
  const open = (n: NextStep) => {
    if (n.kind !== "open") return;
    if (n.screen === "spending-cap") return setAsk({ kind: "cap" });
    if (n.screen === "receive" || n.screen === "wallet/receive") return setAsk({ kind: "receive" });
    close();
    if (n.screen === "activity") return shell.openApp("wallet", "activity");
    if (n.screen.includes("/")) {
      const [app, tab] = n.screen.split("/");
      shell.openApp(app as never, tab);
    }
  };

  // The web wallet (product decision, 4 Nov): no Safe, no private balance. Send and a site's top-up pay publicly from a
  // wallet's own key; Add shows each wallet's own address; Swap, Move, Put away, the cap and Move back (all through the
  // Safe or NEAR's private balance) aren't here: their buttons are hidden, and an ask for one closes at once.
  if (webWallet()) return <WebMoney ask={ask} close={close} done={done} end={(went, line) => { if (went) { sayWent(""); refresh(); } onEnd({ went, ...(line ? { line } : {}) }); }} />;
  // The grade (3 Nov, r-m01b..r-m04): on a TEST account Add, Send, Swap and Move were dead ends ("Add can't make an
  // address…" on every row, "Nothing to send" under a $27.73 Safe, "Nothing can move here yet." four times). Money can't
  // move on a test network (the swap service runs on mainnet only), so each says it once and opens sample money, where
  // all four work.
  if (testAccount(balances, balanceProblem) && TEST_SHEETS[ask.kind] && !("link" in ask && ask.link)) return <TestOnly title={TEST_SHEETS[ask.kind]!} onClose={close} />;
  // Send's top line is Home's own figures in Home's words: Safe · Wallets (home/words: never Hidden, Trading or Spending).
  if (ask.kind === "send") return <SendLater link={ask.link} wallet={ask.wallet} to={ask.to} chain={ask.chain} usd={ask.usd} note={ask.note} {...(ask.coin ? { coin: ask.coin } : {})} {...(ask.agentFilled ? { agentFilled: true } : {})} pots={homePots({ safeUsd: safeOwn, pocket, trading, tradingPartial, spending: spending !== null })} onClose={(went, id) => (went ? done("", id) : close())} onAddMoney={() => setAsk({ kind: "receive" })} {...(Number(safeUsd) >= 2 ? { onMove: () => setAsk({ kind: "move" }) } : {})} />;
  // Home's Add (V4 step 6): 1Click's coins, our rows first; a link (Pay's, a site's network) keeps the Safe's own Add.
  if (ask.kind === "receive") return ask.link ? <AddMoneyLater link={ask.link} onClose={close} /> : <AddLater onClose={close} {...(ask.wallet ?? ask.coin ? { wallet: ask.wallet ?? ask.coin } : {})} {...(ask.coin ? { coin: ask.coin } : {})} />;
  // Request money, filled in: Add's sheet opened straight on Request, its dollars, coin and note set
  if (ask.kind === "request") return <AddLater onClose={close} request={{ ...(ask.usd ? { usd: ask.usd } : {}), ...(ask.coin ? { coin: ask.coin } : {}), ...(ask.note ? { note: ask.note } : {}) }} />;
  // Social Trading's Add and Move back (a site's own wallet, privately)
  if (ask.kind === "siteadd" && ask.auto) {
    // ST11: no sheet of ours behind the site window: the move at once, its words back to the window
    return <Suspense fallback={null}><SiteAddSheet wallet={ask.wallet} name={ask.name} safeUsd={safeUsd} {...(ask.usd ? { askedUsd: ask.usd } : {})} auto onClose={() => onEnd({ went: false })} onDone={(l) => { sayWent(""); refresh(); onEnd({ went: true, line: l }); }} onAutoLine={(l) => { sayWent(""); onEnd({ went: false, line: l }); }} onHeld={(h) => { sayWent(""); shell.showWaiting(h); onEnd({ went: false, line: "Your money is on hold for your safety. Open ZeroFee to see it." }); }} onOpen={open} onAdd={() => onEnd({ went: false, line: "Your Safe has too little. Add money to it first." })} /></Suspense>;
  }
  if (ask.kind === "siteadd") return <Suspense fallback={<LoadingSheet title={`Put money in ${ask.name}`} kind="move" onClose={close} />}><SiteAddSheet wallet={ask.wallet} name={ask.name} {...(ask.network ? { network: ask.network } : {})} safeUsd={safeUsd} coins={balances} {...(ask.usd ? { askedUsd: ask.usd } : {})} {...(ask.canOpen ? { onOpenSite: () => onEnd({ went: false, open: true }) } : {})} onClose={close} onDone={(l) => done(l)} onHeld={(h) => shell.showWaiting(h)} onOpen={open} onAdd={() => setAsk({ kind: "receive" })} /></Suspense>;
  if (ask.kind === "siteback") return <Suspense fallback={<LoadingSheet title="Take out to your Safe" kind="move" onClose={close} />}>
    <SiteBackSheet wallet={ask.wallet} also={ask.also} name={ask.name} safeUsd={safeUsd} {...(ask.usd !== undefined ? { askedUsd: ask.usd } : {})}
      {...(ask.back ? { onBack: () => onEnd({ went: false, back: true }) } : {})}
      onClose={close} onDone={(l, id) => done(l, id)} />
  </Suspense>;
  // Top up, Put away, Swap and the cap need Spending's state; until it answers, the sheet is up with one line, never a
  // spinner (design review change 7).
  // Trading not read yet: the sheet is up with its title and one line, and a dead service it needs is named at once
  // (never-blocked rows: the line never waits on this read; it raced under load, 3 Nov)
  if (!spending) return <LoadingSheet title={ask.kind === "putaway" ? "Move to your Safe" : ask.kind === "move" ? "Move" : ask.kind === "cap" ? "Your NEAR wallet holds up to" : ask.kind === "swap" ? "Swap" : "Move to your NEAR wallet"} kind={ask.kind === "swap" || ask.kind === "putaway" ? ask.kind : ask.kind === "cap" ? "add" : "move"} slow="Your wallets didn't answer. Nothing has moved." onClose={close} retry={refresh} />;
  const status: SpendingStatus = spending;
  if (ask.kind === "swap") return <SwapLater status={status} safeUsd={safeUsd} slowLine={slowLine} balances={balances} {...(ask.wallet ? { wallet: ask.wallet } : {})} {...(ask.from || ask.to || ask.usd ? { prefill: { ...(ask.from ? { from: ask.from } : {}), ...(ask.to ? { to: ask.to } : {}), ...(ask.usd ? { usd: ask.usd } : {}) } } : {})} onClose={close} onDone={swapped} onHeld={(h) => shell.showWaiting(h)} onOpen={open} />;
  if (ask.kind === "move") return <MoveSheet status={status} safeUsd={safeUsd} slowLine={slowLine} {...(ask.source === "private" ? { wallet: "private" as const } : ask.wallet ? { wallet: ask.wallet } : {})} {...(ask.quick ? { quick: true } : {})} {...(ask.from && ask.to && (ask.all || Number(ask.usd) > 0) ? { prefill: { from: ask.from, to: ask.to, ...(ask.all ? { all: true as const } : { usd: Number(ask.usd) }), ...(ask.raised ? { raised: true as const } : {}) } } : {})} onClose={close} onDone={(l, id) => done(l, id)} onHeld={(h) => shell.showWaiting(h)} onOpen={open} onAdd={() => setAsk({ kind: "receive" })} />;
  if (ask.kind === "putaway") return <SpendLater title="Move to your Safe" onClose={close} draw={({ PutAwaySheet }) => <PutAwaySheet status={status} safeUsd={safeUsd} onClose={close} onDone={(l) => done(l)} onOpen={open} />} />;
  if (ask.kind === "cap") return <SpendLater title="Your NEAR wallet holds up to" onClose={close} draw={({ CapSheet }) => <CapSheet capUsd={status.capUsd} onClose={close} onDone={() => { refresh(); setAsk({ kind: "topup" }); }} />} />;
  return (
    <SpendLater title="Move to your NEAR wallet" onClose={close} draw={({ TopUpSheet }) => <TopUpSheet
      status={status}
      safeUsd={safeUsd}
      {...(ask.usd ? { askedUsd: ask.usd } : {})}
      testAccount={Boolean(balances?.some((b) => b.test))}
      onClose={close}
      onDone={(l) => done(l)}
      onHeld={(h) => shell.showWaiting(h)}
      onCap={() => setAsk({ kind: "cap" })}
      onOpen={open}
      onAdd={() => setAsk({ kind: "receive" })}
    />} />
  );
}

/** The web wallet's money asks (see MoneyHost): Send and a site's top-up from a wallet's own key, Add to its own address;
 *  every ask that needs the Safe or NEAR's private balance ends at once. `end`: the asker's own answer (a site's auto Add). */
function WebMoney({ ask, close, done, end }: { ask: MoneyAsk; close: () => void; done: (line: string) => void; end: (went: boolean, line?: string) => void }) {
  // web Send: private, open only where the build has its quote relay (home-view.ts WEB_SEND_OPEN); else its ask ends at once
  if (ask.kind === "send" && WEB_SEND_OPEN) return <Suspense fallback={<LoadingSheet title="Send" kind="send" onClose={close} />}><WebSend {...(ask.wallet ? { wallet: ask.wallet } : {})} {...(ask.to ? { to: ask.to } : {})} {...(ask.agentFilled ? { agentFilled: true } : {})} onClose={close} onDone={(l) => done(l)} /></Suspense>;
  // Trade's and the Browser's "top up" asks for money in the trading wallets, which here are the wallets themselves: Add
  if (ask.kind === "receive" || ask.kind === "request" || ask.kind === "topup") return <AddLater onClose={close} {...("wallet" in ask && ask.wallet ? { wallet: ask.wallet } : "coin" in ask && ask.coin ? { wallet: ask.coin } : {})} />;
  // a site's top-up is the phone app's on the web (sites can't be framed; a popup has no wallet)
  if (ask.kind === "siteadd") return <OnYourPhone reason="site" name={ask.name} onClose={() => (ask.auto ? end(false) : close())} />;
  return <WebNone onClose={close} />;
}

/** An ask the web wallet has no way to do: nothing shows, and it ends at once (its buttons are hidden on the web). */
function WebNone({ onClose }: { onClose: () => void }) {
  useEffect(() => { onClose(); }, []);
  return null;
}

function TestOnly({ title, onClose }: { title: string; onClose: () => void }) {
  return <Sheet title={title} onClose={onClose}><div className="wl-empty-wallet"><p className="wl-empty-wallet__line" role="status" data-testid="test-only">{TEST_WORDS.line}</p></div></Sheet>;
}

/**
 * A sheet whose code loads after Home (Add, Swap, Send): asked for as this host loads, never in Home's first load (speed);
 * kept once it is here. Until then the sheet paints its title with one line (never-blocked rows); a failed load (offline
 * mid-tap) is never kept: the sheet says "… didn't load. Try again." with Try again, which asks again (QA 3 Nov).
 */
function useLater<T>(code: ReturnType<typeof codeGate<T>>) {
  const [here, setHere] = useState(() => code.here());
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    if (!here) code.load().then((c) => live && setHere(() => c), () => live && setFailed(true));
    return () => { live = false; };
  }, [tries]);
  // offline (audit 12 C1): the sheet says so (didntLoad) and asks again by itself once the phone is back
  useEffect(() => (failed && !here ? whenOnline(() => { setFailed(false); setTries((n) => n + 1); }) : undefined), [failed, here]);
  // offline there is nothing to try (QA 16 on audit 12's C1 shot): no Try again; the sheet asks again by itself when back
  return { here, failed: failed ? (chunkOffline() ? {} : { retry: () => { setFailed(false); setTries((n) => n + 1); } }) : null };
}

const addCode = codeGate(() => import("./AddSheet.tsx").then((m) => m.AddSheet));
const addSheetCode = () => addCode.load();
type AddProps = Parameters<typeof import("./AddSheet.tsx").AddSheet>[0];
function AddLater({ onClose, ...p }: AddProps) {
  const { here: Add, failed } = useLater(addCode);
  return Add ? <Add onClose={onClose} {...p} /> : <LoadingSheet title="Add money" kind="add" words={failed ? didntLoad("Add") : "Reading the coins…"} onClose={onClose} {...failed} />;
}

/** Another app's Add money on a network (a link: Pay's, a site's): its code loads with its first ask, outside Home's
 *  first load (the speed budget), as Add's own. */
const linkAddCode = codeGate(() => import("./AddMoney.tsx").then((m) => m.AddMoney));
function AddMoneyLater(p: { link?: string; onClose: () => void }) {
  const { here: Add, failed } = useLater(linkAddCode);
  return Add ? <Add {...p} /> : <LoadingSheet title="Add money" kind="add" onClose={p.onClose} {...(failed ? { words: didntLoad("Add"), ...failed } : {})} />;
}

type SwapProps = Parameters<typeof import("./SwapSheet.tsx").SwapSheet>[0];
const swapCode = codeGate(() => import("./SwapSheet.tsx").then((m) => m.SwapSheet));
const swapSheetCode = () => swapCode.load();
function SwapLater(p: SwapProps) {
  const { here: Swap, failed } = useLater(swapCode);
  return Swap ? <Swap {...p} /> : <LoadingSheet title="Swap" kind="swap" onClose={p.onClose} {...(failed ? { words: didntLoad("Swap"), ...failed } : {})} />;
}

/** Send's code (the form, the guard's hooks, Pay's engine screens), as Add's and Swap's (3 Nov trim). */
type SendProps = Parameters<typeof import("./SendSheet.tsx").SendSheet>[0];
const sendCode = codeGate(() => import("./SendSheet.tsx").then((m) => m.SendSheet));
const sendSheetCode = () => sendCode.load();
function SendLater(p: SendProps) {
  const { here: Send, failed } = useLater(sendCode);
  return Send ? <Send {...p} /> : <LoadingSheet title="Send" kind="send" onClose={() => p.onClose(false)} {...(failed ? { words: didntLoad("Send"), ...failed } : {})} />;
}

/** The Move sheets between the Safe and the NEAR wallet, and the cap's (screens/Spending.tsx), as Add's (speed budget). */
const spendCode = codeGate(() => import("../screens/Spending.tsx"));
function SpendLater({ title, onClose, draw }: { title: string; onClose: () => void; draw: (m: typeof import("../screens/Spending.tsx")) => ReactNode }) {
  const { here: m, failed } = useLater(spendCode);
  return m ? <>{draw(m)}</> : <LoadingSheet title={title} kind="putaway" onClose={onClose} {...(failed ? { words: didntLoad("Move"), ...failed } : {})} />;
}

/** The sheets whose code loads after Home (Add, Swap, Send, Move's, Move itself) and the readers they draw from (home-reads.ts): here once all have arrived. Tests wait on this, never on a clock. */
export const sheetsLoaded = (): Promise<unknown> => Promise.all([addSheetCode(), swapSheetCode(), sendSheetCode(), spendCode.load(), MoveSheet.loaded(), import("../home-reads.ts")]);
/** Every money sheet's code, asked for once Home is up and quiet (speed, D145: the shell calls it with the neighbours): a
 *  first tap on Add, Send, Swap or Move then draws from code already here, never waits on its download. */
export const preloadSheets = (): void => {
  void sheetsLoaded().catch(() => undefined);
  MoveSheet.preload();
};

/** A sheet whose code is still on its way: its title, one line, and a service that's down named at once (never-blocked
 *  rows: the line can't wait for the sheet's code). */
/** How long a sheet open on what was known waits for the live read before it names the slow one. */
export const SEEN_SLOW_MS = 2_000;
/** "These figures are from 10:52.", once the live read is SEEN_SLOW_MS late: the last answer with its time (rule 9). Rule 9a
 *  (product decision, 5 Nov; QA's test, "Your wallets are slow to answer"): a late read is never blamed as slow; a
 *  service is named only when it is really down (the banner's one line). */
export const slowReadLine = (at: number): string => `These figures are from ${shortTime(at)}.`;
function useSlowRead(waiting: boolean, at: number | null): string | null {
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (!waiting) return;
    const t = setTimeout(() => setLate(true), SEEN_SLOW_MS);
    return () => clearTimeout(t);
  }, [waiting]);
  return waiting && late && at !== null ? slowReadLine(at) : null;
}

/**
 * A money sheet whose reads or code aren't here yet: its title, one line and Close, always. After AWAY_SLOW_MS (5 s)
 * the line says what didn't answer (`slow`), with Try again when there is one (`retry`); Close never waits on anything.
 */
export function LoadingSheet({ title, kind, words = "Reading your money…", slow, onClose, retry }: { title: string; kind: "add" | "swap" | "move" | "putaway" | "send"; words?: string; slow?: string; onClose: () => void; retry?: () => void }) {
  const { bridge } = useShell();
  const services = useServices(bridge, SHEET_NEEDS[kind]!, kind === "swap" ? "Swap" : kind === "add" ? "Add" : kind === "send" ? "Send" : "Move");
  const [late, setLate] = useState(false);
  // each try gets its own AWAY_SLOW_MS: a Try again that still doesn't answer says so again (real money, 4 Nov: after one
  // Try again the timer never re-armed, and Move and Swap sat on "Reading your money…" for over 90 s)
  const [tries, setTries] = useState(0);
  useEffect(() => { const t = setTimeout(() => setLate(true), AWAY_SLOW_MS); return () => clearTimeout(t); }, [tries]);
  const said = late && slow ? slow : late && !retry ? "Still reading. You can close this." : words;
  const again = retry && (late || words !== "Reading your money…") ? retry : undefined;
  return <Sheet title={title} onClose={onClose}><SheetLine text={services.line} /><p className="zf-small wl-sheet-lead" role={again ? "alert" : "status"} data-testid="loading-line">{said}</p>{again && <button className="zf-btn" onClick={() => { setLate(false); setTries((n) => n + 1); again(); }}>Try again</button>}</Sheet>;
}
