// AgentZero as a chat (product decision, 3 Nov, D122), on ZeroFee's own primitives (QA: no new dependency): the thread, the
// composer, replies word by word, a thinking line before the first word, each tool step a card that opens and closes and
// changes in place, a scroll that stays at the bottom unless the person scrolled up, and Stop. The turn is the agent package's
// chatTurn (the person's own key or the relay's free reading; the guard and the tools live there): this file never
// calls a model and never moves money. A "needs-you" event is one line here; its sheet is the core's.
import { Suspense, createContext, lazy, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { asksMoney, type AzMessage, type AzPart } from "./chat-events.ts";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
// The agent package's sheet card, loaded with the first sheet (it lives in AgentApp's own chunk: never pulled into this one)
const ChatSheetCard = lazy(() => import("@zerofee/agent/app/ChatSheetCard.tsx").then((m) => ({ default: m.ChatSheetCard })));
import type { ChatSheet } from "@zerofee/agent/chat/turn";
// the live card loads with the first site to open (its browser session code stays out of the chat's first load)
const LiveCard = lazy(() => import("./LiveCard.tsx").then((m) => ({ default: m.LiveCard })));
// Home's own sheets, filled in (send, swap, move, add, request): the card loads with the first one
const MoneyCard = lazy(() => import("./MoneyCard.tsx").then((m) => ({ default: m.MoneyCard })));
const OldSheet = lazy(() => import("./MoneyCard.tsx").then((m) => ({ default: m.OldSheet })));
type CardWasView = { opened?: number; went?: boolean; closed?: boolean; movementId?: string };
import { ACTIVITY_SHORT, factSegments, hasMarks, type Facts } from "./fact-text.ts";
import { sheetUsd } from "./chat-items.ts";
import { MdText } from "./MdText.tsx";
// H-2: a figure's rows open in a sheet, loaded with the first tap (its Activity words stay out of the chat's first load)
const FactRows = lazy(() => import("./FactRows.tsx").then((m) => ({ default: m.FactRows })));
import type { ChatFact } from "@zerofee/agent/chat/turn";
import type { KeySaved } from "@zerofee/agent/chat/ai-key";
import type { ClaudeChoice } from "@zerofee/agent/chat/model";
// the AI key's card and sheet: the real account's only (the sample demo has no keys), loaded with it
const KeyCard = lazy(() => import("./KeySetup.tsx").then((m) => ({ default: m.KeyCard })));
const KeysChip = lazy(() => import("./KeySetup.tsx").then((m) => ({ default: m.KeysChip })));
// AgentZero's own wallet (L9, AGENTZERO_WALLET): its screens load only when the wallet is on (wallet-flag.ts)
const WalletChip = lazy(() => import("./AgentWallet.tsx").then((m) => ({ default: m.WalletChip })));
const WalletSheet = lazy(() => import("./AgentWallet.tsx").then((m) => ({ default: m.WalletSheet })));
const FundCard = lazy(() => import("./AgentWallet.tsx").then((m) => ({ default: m.FundCard })));
const WalletLine = lazy(() => import("./AgentWallet.tsx").then((m) => ({ default: m.WalletLine })));
import type { WalletSource } from "./use-agent-wallet.ts";
import { ChatsMenu, type ChatsSource } from "./ChatsMenu.tsx";
import { keyGate } from "./key-gate.ts";
import { localKeep, moneyTask, OWN_SHEETS, sheetAsk, sheetTitle, SHEET_OPEN, tasksOf, type MoneySheet } from "./az-tasks.ts";
// Jobs (product decision, 3 Nov): the top bar's Now, the Jobs sheet, the live card after a money sheet, AgentZero's email;
// one chunk, loaded with the chat's first paint (the Now count reads the core's moves), never in Home's first load
// D144: the shell's corner badge is the one "now"; AgentZero only keeps its jobs and routines there (draws nothing)
const AgentTasks = lazy(() => import("./Jobs.tsx").then((m) => ({ default: m.AgentTasks })));
const NowCount = lazy(() => import("./Jobs.tsx").then((m) => ({ default: m.NowCount })));
const MailHint = lazy(() => import("./Jobs.tsx").then((m) => ({ default: m.MailHint })));
const JobsSheet = lazy(() => import("./Jobs.tsx").then((m) => ({ default: m.JobsSheet })));
const MailSheet = lazy(() => import("./Jobs.tsx").then((m) => ({ default: m.MailSheet })));
const JobCard = lazy(() => import("./Jobs.tsx").then((m) => ({ default: m.JobCard })));
import type { MarkMood } from "./AzMark.tsx";
import { CHAT_LINE } from "@zerofee/agent/chat/chat-lines";
import type { Plan, PlanTag, StepEnd } from "@zerofee/agent/chat/plan";
import "./chat.css";

/** Try again's own word (the copywriter's). */
const RETRY_LABEL = CHAT_LINE.retry;
/** The ready screen's line and its three starters (approved design, 3 Nov). */
export const READY_LINE = "Ask me about your money, or give me a job.";
export const STARTERS = ["What did I spend this week?", "Copy a wallet on pump.fun", "Keep $50 ready in your SOL wallet"] as const;
/** A sheet open in the chat (the mark at the top dims behind it): each SheetCard says when its sheet opens and closes. */
const SheetOpen = createContext<(open: boolean) => void>(() => undefined);
/** A plan (plan.ts): its Start and Not now say the person's word into the chat; each step's card reports how it ended. */
type CardNews = { kind: "opened" } | { kind: "ended"; went: boolean; movementId?: string } | { kind: "landed" };
type PlanCtl = { say: (words: string) => void; stepEnded?: ((tag: PlanTag, end: StepEnd) => void) | undefined; check?: (() => void) | undefined; stop?: (() => void) | undefined; cardSaw?: ((card: string, e: CardNews) => void) | undefined };
const PlanOpen = createContext<PlanCtl>({ say: () => undefined });
/** Try again on a failed reply's line (live-chat.ts retry): null while a turn runs, or with nothing to send again. */
const RetryOpen = createContext<((o?: { fresh?: boolean }) => void) | null>(null);
/** Open Jobs at one move (a live card's tap), or at its list (null). */
const JobsOpen = createContext<(key: string | null) => void>(() => undefined);
/** The chat's sheets that start a move at once (a live card follows each): never a job, a stop, a browse, a memory, a
 *  routine, or an Add or a Request (those wait for money to come). */
const MOVES_NOW = new Set(["pay", "act", "send", "swap", "move"]);
/** The app's own chevron (the rows of ThreadBar and Settings). */
const Chevron = () => <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path className="zf-hl" d="m9 6 6 6-6 6" /></svg>;
/** Words as they stream: each its own span, fading in once (after the reply ends they are plain text again). */
const wordLeaf = (w: string, key: string): ReactNode => w.split(/(\s+)/).map((part, i) => (!part || /^\s+$/.test(part) ? part : <span key={`${key}:${i}`} className="azc-w">{part}</span>));
const wordsIn = (m: AzMessage | undefined) => (m?.role === "assistant" ? m.parts.reduce((n, p) => n + (p.type === "text" ? p.text.split(/\s+/).filter(Boolean).length : 0), 0) : 0);

/** Home's own sheet, filled in (home-ask.ts), narrowed: its ask and ZeroFee's own line. */
const isHome = (x: unknown): x is { kind: "home"; ask: import("@zerofee/agent/chat/home-ask").HomeAsk; line: string; plan?: PlanTag } => !!x && typeof x === "object" && (x as { kind?: unknown }).kind === "home" && typeof (x as { line?: unknown }).line === "string" && !!(x as { ask?: unknown }).ask;
/** A browse sheet from the turn (its task and the site), narrowed. */
const isBrowse = (x: unknown): x is { kind: "browse"; task: string; url: string | null } => !!x && typeof x === "object" && (x as { kind?: unknown }).kind === "browse" && typeof (x as { task?: unknown }).task === "string";


/** What the screen needs from a chat: its messages, whether a turn runs, send, stop, and a small note (the allowance). */
export interface ChatSource {
  /** `send` may answer later whether the words went (AgentZero's wallet: no money, no send; the words go back in the box). */
  messages: AzMessage[]; running: boolean; send: (words: string) => void | Promise<boolean>; stop: () => void; note?: string | null;
  /** H-2: said once under an answer that read the person's activity (who read it, and what it saw). */
  activityNote?: string;
  /** The real account's AI key (live-chat.ts): the Keys chip on top, and the card when there's no key to talk with. */
  keys?: KeysSource;
  /** The saved chats (the real account's; the sample demo has none) and New chat. */
  chats?: ChatsSource;
  newChat?: () => void;
  /** A plan step's card ended (plan.ts): the plan moves on. The real account's only. */
  stepEnded?: (tag: PlanTag, end: StepEnd) => void;
  /** The late card's Check again and Stop the plan (plan-runner.ts). */
  planCheck?: () => void;
  planStop?: () => void;
  /** A money card's news, kept with the chat (use-chat-turn cardSaw). */
  cardSaw?: (card: string, e: CardNews) => void;
  /** AgentZero's own wallet (L9), only when AGENTZERO_WALLET is on; and Continue after a reply paused for want of money. */
  wallet?: WalletSource | null;
  resume?: () => void;
  /** The ready screen's starters, when a chat has its own (the Sim's: what runs on its pretend money). */
  starters?: readonly string[];
  /** Try again (product decision, 4 Nov): the last words go once more, in the same bubble; `fresh`: a new sign-in first. */
  retry?: (o?: { fresh?: boolean }) => void;
}

/** The AI key, as the screen sees it: never the key, only its provider and last 4. */
export interface KeysSource {
  /** undefined while it's read; null with no key saved */
  saved: { provider: "Claude"; tail: string } | null | undefined;
  /** no key and no free reading: the chat shows the key card in place of the box */
  needed: boolean;
  /** why, when it's more than "no key yet" (free reading used up or full) */
  line: string | null;
  /** the last turn's or the sign-up's reason ("used-up": the relay said there's no money to think with) */
  why?: import("@zerofee/agent/chat/turn").NeedsKey | null;
  /** the person's own key is offered at all (own-key.ts: a developer build only) */
  own?: boolean;
  use: (raw: string) => Promise<KeySaved>;
  remove: () => Promise<boolean>;
  /** the Paste button's tap only (D33) */
  paste: () => Promise<string | null>;
  getKey: () => void;
  /** Which Claude the chat runs (product decision, 3 Nov: Opus 5.5 or Sonnet 5.5, and the effort meter), kept on this device. */
  model?: ModelSource;
}

/** The person's choice of Claude, as the Keys sheet sees it: undefined while it's read. */
export interface ModelSource {
  choice: ClaudeChoice | undefined;
  set: (c: ClaudeChoice) => void;
}

let n = 0;
const nextId = (p: string) => `${p}${Date.now().toString(36)}${(n++).toString(36)}`;
/** How close to the bottom still counts as "at the bottom" (px): the view follows new words only then. */
const STICK_PX = 48;

/** The screen: the thread, the composer, replies word by word, step cards, Stop; the scroll sticks to the bottom. */
/** `menu`: the menu top left is open (ChatRoot's AppFrame glyph); `onJobs`: its Jobs and limits. */
/** `onMood`: what AgentZero is doing, for the living mark at the top of the screen (ChatRoot's AppFrame). */
export function AgentZeroChat({ chat, menu = false, onMenu, onJobs, onMood }: { chat: ChatSource; shown?: boolean; menu?: boolean; onMenu?: (open: boolean) => void; onJobs?: () => void; onMood?: (m: MarkMood) => void }) {
  const { messages: thread, running } = chat;
  const [words, setWords] = useState("");
  // A-4: Siri's "Ask AgentZero" puts the words in the field; the person taps Send (host/intent.ts). Never sent by itself.
  const { requestedTab, requestedLink, requestSeq } = useShell();
  useEffect(() => {
    // what the person was typing stays: Siri's words go after it (review L4)
    if (requestedTab === "ask" && requestedLink) setWords((w) => (w.trim() ? `${w.trim()} ${requestedLink}` : requestedLink).slice(0, 500));
  }, [requestSeq]);
  // the scroll follows new words while the person is at the bottom; once they scroll up it stays where they are
  const view = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // one tap is one send (product decision, 4 Nov: one message went twice): locked from the tap until the send has said whether
  // it went, and while its turn runs; a second tap in the same frame (before `running` re-renders) finds it locked
  const sending = useRef(false);
  useEffect(() => { if (!running) sending.current = false; }, [running]);
  const send = () => {
    if (!words.trim() || running || sending.current) return;
    sending.current = true;
    stick.current = true;
    const said = words;
    const went = chat.send(words);
    setWords("");
    // AgentZero's wallet with no money to think with: the words come back to the box (§5: the message is kept)
    if (went instanceof Promise) void went.then((ok) => { sending.current = false; if (!ok) setWords((w) => w || said); }, () => void (sending.current = false));
  };
  const onScroll = () => {
    const el = view.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
  };
  useLayoutEffect(() => {
    const el = view.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
  }, [thread]);

  // the composer grows with its words, up to its CSS max height
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [words]);
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      send();
    }
  };

  const keys = chat.keys;
  // D152: no key of the person's own, AgentZero's wallet stands where the key chip and card were, from the first frame;
  // the key card and "Add key" only with the developer setting on (key-gate.ts)
  const gate = keyGate({ keys, wallet: !!chat.wallet, running });
  const wallet = gate.wallet ? chat.wallet! : null;
  const card = gate.card;
  const fundFirst = !!wallet && wallet.state === "fresh" && thread.length === 0 && !running;
  // the relay said there's no money to think with (402, D37: refused before Claude was asked): the refusal line, Add money
  const broke = !!wallet && (keys?.why === "used-up" || (!!keys?.needed && wallet.state === "fresh"));
  // D37: the chosen Claude, for the price of a message on the line above the box
  const chosen = keys?.model?.choice?.model;
  // what this chat's replies cost, together (the wallet's sheet: "This chat cost …")
  const chatUsd = thread.reduce((s, m) => s + (m.cost?.turnUsd ?? 0), 0);
  // the wallet's one sheet (Details, Add money, the limit, a key instead), opened from the meter, the first run, the line
  // above the box or the Claude chip; it lives here, so it stays open when the first run goes (money arrived)
  const [walletSheet, setWalletSheet] = useState<{ start: "details" | "fill" | "limit" | "key"; amount?: number | undefined; other?: boolean } | null>(null);
  const { bridge } = useShell();
  // Jobs (open at one move, or its list) and AgentZero's email, over the chat
  const [jobsAt, setJobsAt] = useState<{ open: string | null } | null>(null);
  const [mail, setMail] = useState(false);
  const openJobs = useCallback((key: string | null) => setJobsAt({ open: key }), []);
  const [sheets, setSheets] = useState(0);
  const onSheet = useCallback((open: boolean) => setSheets((n) => Math.max(0, n + (open ? 1 : -1))), []);
  const runningRef = useRef(running);
  runningRef.current = running;
  const planCtl = useMemo<PlanCtl>(() => ({ say: (w: string) => { if (runningRef.current) return; stick.current = true; void chat.send(w); }, stepEnded: chat.stepEnded, check: chat.planCheck, stop: chat.planStop, cardSaw: chat.cardSaw }), [chat]);
  const last = thread.at(-1);
  const replyWords = wordsIn(last);
  // the privacy line once a chat: under the first answer that read the person's activity
  const firstRead = thread.findIndex((m) => m.role === "assistant" && m.done && m.parts.some((p) => p.type === "step" && p.tool === "read_activity" && p.state === "done"));
  const thinking = running && last?.role === "assistant" && replyWords === 0 && !last.parts.some((p) => p.type === "needs" || p.type === "fault");
  // the living mark at the top: dim behind a sheet or the menu, turning while it thinks, pulsing while it answers
  const mood: MarkMood = sheets > 0 || menu || walletSheet || jobsAt || mail ? "sheet" : thinking ? "thinking" : running ? "answering" : "rest";
  useEffect(() => onMood?.(mood), [mood, onMood]);
  // the first word of a reply: one tap, never one per word
  const felt = useRef<string | null>(null);
  useEffect(() => {
    if (running && last?.role === "assistant" && replyWords > 0 && felt.current !== last.id) {
      felt.current = last.id;
      void bridge.call("device.haptic", { kind: "tap" });
    }
  }, [running, last, replyWords, bridge]);
  const start = (w: string) => {
    // a suggestion's tap is one send too (QA 5 Nov: two bubbles in the Sim)
    if (running || sending.current) return;
    void bridge.call("device.haptic", { kind: "tap" });
    stick.current = true;
    chat.send(w);
  };
  return (
    <div className="azc" data-s={mood}>
      {/* the meter's place is held from the first paint (robot walk 4 Nov: 0.123 CLS when it arrived after a tap) */}
      {wallet ? <div className="azw-meter-slot">{!fundFirst && <Suspense fallback={null}><WalletChip w={wallet} onOpen={() => setWalletSheet({ start: "details" })} /></Suspense>}</div> : gate.chip === "keys" && keys && <Suspense fallback={<div className="azc-keys" />}><KeysChip keys={keys} {...(chat.wallet ? { onFund: () => setWalletSheet({ start: "fill" }) } : {})} /></Suspense>}
      <Suspense fallback={null}><AgentTasks bridge={bridge} /></Suspense>
      {walletSheet && chat.wallet && <Suspense fallback={null}><WalletSheet w={chat.wallet} keys={keys} chatUsd={chatUsd} start={walletSheet.start} amount={walletSheet.amount} other={walletSheet.other ?? false} onClose={() => setWalletSheet(null)} /></Suspense>}
      <div className="azc-viewport" ref={view} onScroll={onScroll} role="log" aria-live={running ? "off" : "polite"} aria-label="AgentZero chat">
        {/* the first amount runs the wallet's set-up first (once per phone: the account's old AgentZero key revoked on the
            person's own sheet, if it holds one); then Add money */}
        {fundFirst && <Suspense fallback={null}><FundCard keys={keys?.own ? keys : undefined} onAmount={(usd) => wallet!.setup().then((r) => { if ("ok" in r) setWalletSheet({ start: "fill", amount: usd, other: usd === undefined }); return r; })} /></Suspense>}
        {thread.length === 0 && !card && !fundFirst && (
          <div className="azc-ready zf-enter">
            <p className="zf-body azc-lead">{READY_LINE}</p>
            <div className="azc-starters">{(chat.starters ?? STARTERS).map((w) => <button key={w} type="button" className="azc-starter zf-press" onClick={() => start(w)}><span>{w}</span><Chevron /></button>)}</div>
          </div>
        )}
        <SheetOpen.Provider value={onSheet}><JobsOpen.Provider value={openJobs}><PlanOpen.Provider value={planCtl}><RetryOpen.Provider value={!running && chat.retry ? chat.retry : null}>
          {thread.map((m, i) => (m.role === "user" ? <UserMessage key={m.id} m={m} /> : <AgentMessage key={m.id} m={m} activityNote={i === firstRead ? chat.activityNote : undefined} asked={askedMoney(thread[i - 1])} said={saidBefore(thread, i)} />))}
        </RetryOpen.Provider></PlanOpen.Provider></JobsOpen.Provider></SheetOpen.Provider>
        {card && <Suspense fallback={<p className="zf-small azc-thinking">Opening…</p>}><KeyCard keys={keys!} /></Suspense>}
      </div>
      {/* the first run's fund card is the one way in: no second "Add money" line under it (one call to action) */}
      {wallet ? !fundFirst && <Suspense fallback={null}><WalletLine w={wallet} busy={running} onSheet={(start) => setWalletSheet({ start })} {...(broke ? { state: "refused" as const } : {})} model={chosen} {...(chat.resume ? { onContinue: chat.resume } : {})} /></Suspense> : chat.note && <p className="zf-small azc-note">{chat.note}</p>}
      {menu && <ChatsMenu chats={chat.chats} onNew={() => { stick.current = true; setWords(""); chat.newChat?.(); }} onJobs={() => onJobs?.()} nowCount={<Suspense fallback={null}><NowCount bridge={bridge} /></Suspense>} onMail={() => setMail(true)} mail={<Suspense fallback={null}><MailHint bridge={bridge} /></Suspense>} onClose={() => onMenu?.(false)} />}
      {jobsAt && <Suspense fallback={null}><JobsSheet bridge={bridge} open={jobsAt.open} onAsk={(w) => start(w)} onClose={() => setJobsAt(null)} /></Suspense>}
      {mail && <Suspense fallback={null}><MailSheet bridge={bridge} onClose={() => setMail(false)} /></Suspense>}
      {/* first run, funded wallet only (no free try): "Fund AgentZero to start" and nothing else, so no box yet */}
      {!card && !(fundFirst && !keys?.own) && <form className="azc-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea ref={box} className="azc-input" rows={1} value={words} onChange={(e) => setWords(e.target.value)} onKeyDown={onKey} placeholder="Ask AgentZero" aria-label="Ask AgentZero" />
        {running ? (
          <button type="button" className="zf-btn azc-send azc-stop" onClick={chat.stop} aria-label="Stop"><i aria-hidden="true" /></button>
        ) : (
          <button type="submit" className="zf-btn azc-send" disabled={!words.trim()} aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg></button>
        )}
      </form>}
    </div>
  );
}

function UserMessage({ m }: { m: AzMessage }) {
  return <div className="azc-msg azc-user">{m.parts.map((p, i) => (p.type === "text" ? <p key={i}>{p.text}</p> : null))}</div>;
}

/** The person's words before a reply asked about their own money. */
const askedMoney = (m: AzMessage | undefined): boolean => m?.role === "user" && m.parts.some((p) => p.type === "text" && asksMoney(p.text));

/** The person's own words before reply i: a figure they said is theirs to see repeated (fact-text.ts). */
const saidBefore = (thread: readonly AzMessage[], i: number): string => thread.slice(0, i).filter((m) => m.role === "user").map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ")).join("\n");
function AgentMessage({ m, activityNote, asked, said = "" }: { m: AzMessage; activityNote?: string | undefined; asked: boolean; said?: string }) {
  const last = m.parts.at(-1);
  // the privacy line only after a read that went through (review L6)
  const read = m.parts.some((p) => p.type === "step" && p.tool === "read_activity" && p.state === "done");
  // an answer about the person's Activity or balances (QA's ruling): the question asked it, it read their activity, or
  // its words carry marks; there, a figure Claude typed reads "Not known"
  const strict = asked || m.parts.some((p) => (p.type === "text" && hasMarks(p.text)) || (p.type === "step" && p.tool === "read_activity"));
  // a payment proposal: the sheet's own amount stands wherever Claude typed a dollar figure; two sheets with different
  // amounts, or one with no figure the chat can show: every typed figure reads Not known (review 1)
  const amounts = [...new Set(m.parts.flatMap((p) => (p.type === "needs" ? [sheetUsd(p.sheet)] : [])).filter((x): x is string => x !== null))];
  const sheet = amounts.length === 1 ? amounts[0]! : null;
  const proposes = m.parts.some((p) => p.type === "needs" && sheetUsd(p.sheet) !== null);
  // while the words still come, a sheet may follow them: a figure waits ("…") until the reply is whole, so a typed "$50"
  // never shows before the sheet's own "$5.00" arrives
  const pending = !m.done && !strict && !proposes;
  const [open, setOpen] = useState<ChatFact | null>(null);
  // "working" while a step runs; "thinking" before the first word; nothing once words are flowing
  const working = !m.done && last?.type === "step" && last.state === "running";
  return (
    <div className="azc-msg azc-assistant" aria-busy={!m.done}>
      {m.parts.map((p, i) => (p.type === "text" && (strict || proposes || pending) ? <FactWords key={i} text={p.text} facts={p.facts ?? m.facts ?? {}} strict={strict || (proposes && !sheet)} sheet={pending ? "…" : sheet} streaming={!m.done && i === m.parts.length - 1} onOpen={setOpen} said={said} /> : <Part key={p.type === "step" ? `s:${p.id}` : i} p={p} streaming={!m.done && i === m.parts.length - 1} />))}
      {read && m.done && activityNote && <ActivityNote note={activityNote} />}
      {open && <Suspense fallback={null}><FactRows fact={open} onClose={() => setOpen(null)} /></Suspense>}
      {/* no "Thinking…" on screen: the mark at the top turns; the words stay for screen readers */}
      {/* the wait: one dot where the first word will start, breathing (the chat flow, 5 Nov: the thread's end was blank while the mark turned) */}
      {!m.done && m.parts.length === 0 && <><span className="azc-wait" aria-hidden="true" /><p className="azc-sr" role="status">AgentZero is thinking…</p></>}
      {working && <p className="azc-sr" role="status">AgentZero is working…</p>}
    </div>
  );
}

/** The privacy line, quiet: "Read without names or addresses."; a tap opens the whole sentence (the sample's own note is
 *  already short and shows as it is). */
function ActivityNote({ note }: { note: string }) {
  const [open, setOpen] = useState(false);
  if (note.startsWith("Sample money.")) return <p className="zf-small azc-system">{note}</p>;
  return (
    <>
      <button type="button" className="azc-quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{ACTIVITY_SHORT}</button>
      {open && <p className="zf-small azc-system">{note}</p>}
    </>
  );
}

/** AgentZero's words with each mark as the phone's own figure, a chip that opens its rows; a figure typed by Claude reads
 *  "Not known", or beside a payment proposal the sheet's own amount (fact-text.ts). */
function FactWords({ text, facts, strict, sheet, streaming, onOpen, said }: { text: string; facts: Facts; strict: boolean; sheet: string | null; streaming: boolean; onOpen: (f: ChatFact) => void; said: string }) {
  // a mark half arrived ("{{f1") waits until it's whole; then each run of plain words gets its figures (fact-text.ts)
  const body = streaming ? text.replace(/\{(?:\{(?:f\d{0,3}(?:\})?)?)?$/, "") : text;
  const leaf = useCallback((words: string, key: string) => factSegments(words, facts, strict, false, sheet, said).map((s, i) =>
    "text" in s ? <span key={`${key}:${i}`}>{s.text}</span>
      : "fact" in s ? (s.fact.rows.length ? <button key={`${key}:${i}`} type="button" className="azc-fact" onClick={() => onOpen(s.fact)} aria-label={`${s.fact.shown}. Show the moves it came from`}>{s.fact.shown}</button> : <span key={`${key}:${i}`} className="azc-fact azc-fact--sheet">{s.fact.shown}</span>)
      : "sheet" in s ? <span key={`${key}:${i}`} className="azc-fact azc-fact--sheet">{s.sheet}</span>
      : "unchecked" in s ? <span key={`${key}:${i}`}>{s.unchecked}<span className="azc-unchecked"> (not checked)</span></span>
      : <span key={`${key}:${i}`} className="azc-unchecked">(couldn't read it)</span>), [facts, strict, sheet, onOpen, said]);
  return <MdText text={body} streaming={streaming} leaf={leaf} />;
}

function Part({ p, streaming }: { p: AzPart; streaming: boolean }) {
  if (p.type === "text") return <MdText text={p.text} streaming={streaming} {...(streaming ? { leaf: wordLeaf } : {})} />;
  if (p.type === "step") return <StepCard p={p} />;
  // a browse sheet: the live card (the person's tap starts it; never a full screen)
  if (p.type === "needs" && isBrowse(p.sheet)) return <Suspense fallback={<p className="zf-small azc-thinking">Opening…</p>}><LiveCard task={p.sheet.task} url={p.sheet.url} /></Suspense>;
  // send, swap, move, add, request, trade: Home's own sheet, filled in, on the person's tap; followed to the end
  if (p.type === "needs" && isHome(p.sheet)) return <HomeCard ask={p.sheet.ask} line={p.sheet.line} tag={p.sheet.plan} stale={!!p.stale} card={p.card} />;
  // a money card from before a reload: what it saw, then what Activity says became of it
  if (p.type === "needs" && (p.sheet as { kind?: unknown } | undefined)?.kind === "old-sheet") return <Suspense fallback={<p className="zf-small azc-system">{p.why}</p>}><OldSheet line={p.why} was={(p.sheet as { was: CardWasView }).was} /></Suspense>;
  // a plan ZeroFee worked out (plan.ts): its facts, its steps, Start on the person's tap
  if (p.type === "needs" && isPlan(p.sheet)) return <PlanCard plan={p.sheet.plan} stale={!!p.stale} />;
  // a step that waited past the limit for its money: Check again, or Stop the plan (never silent)
  if (p.type === "needs" && (p.sheet as { kind?: unknown } | undefined)?.kind === "plan-late") return <PlanLate stale={!!p.stale} />;
  // job, pay, stop-job, act: the agent package's ChatSheetCard, the ONE way it becomes the core's own sheet on the person's tap
  if (p.type === "needs" && p.sheet) return <SheetCard sheet={p.sheet} line={p.why} />;
  // a failed reply's line with Try again beside it (the last reply's only: live-chat.ts marks it)
  if (p.type === "fault" && p.retry) return <FaultLine line={p.line} fresh={!!p.fresh} />;
  // a line from ZeroFee itself (a stop, a fault, a tap it needs): its own look, never the model's text (review L1)
  return <p className="zf-small azc-system">{p.type === "needs" ? p.why : p.line}</p>;
}

/** A fault's line and its Try again (none while a turn runs). */
function FaultLine({ line, fresh }: { line: string; fresh: boolean }) {
  const retry = useContext(RetryOpen);
  return (
    <div className="azc-retry" role="alert">
      <p className="zf-small azc-system">{line}</p>
      {retry && <button type="button" className="azc-act azc-act--quiet" onClick={() => retry(fresh ? { fresh: true } : undefined)}>{fresh ? CHAT_LINE.signInSend : RETRY_LABEL}</button>}
    </div>
  );
}

/** Home's sheet card: the mark dims while the sheet is up; a plan's step reports how it ended. */
function HomeCard({ ask, line, tag, stale, card }: { ask: import("@zerofee/agent/chat/home-ask").HomeAsk; line: string; tag?: PlanTag | undefined; stale: boolean; card?: string | undefined }) {
  const onSheet = useContext(SheetOpen);
  const { stepEnded, cardSaw } = useContext(PlanOpen);
  const onEnd = useMemo(() => (tag && stepEnded ? (e: StepEnd) => stepEnded(tag, e) : undefined), [tag?.id, tag?.step, stepEnded]); // eslint-disable-line react-hooks/exhaustive-deps
  const onCard = useMemo(() => (card && cardSaw ? (e: CardNews) => cardSaw(card, e) : undefined), [card, cardSaw]);
  return <Suspense fallback={<p className="zf-small azc-thinking">Opening…</p>}><MoneyCard ask={ask} line={line} onOpen={onSheet} stale={stale} {...(onEnd ? { onEnd } : {})} {...(onCard ? { onCard } : {})} /></Suspense>;
}

const isPlan = (x: unknown): x is { kind: "plan"; plan: Plan } => !!x && typeof x === "object" && (x as { kind?: unknown }).kind === "plan" && Array.isArray((x as { plan?: { steps?: unknown } }).plan?.steps);
function PlanLate({ stale }: { stale: boolean }) {
  const { check, stop } = useContext(PlanOpen);
  if (stale) return null;
  return <div className="azc-card azc-plan" data-testid="az-plan-late"><div className="azc-acts"><button type="button" className="azc-act" onClick={() => check?.()}>Check again</button><button type="button" className="azc-act-link" onClick={() => stop?.()}>Stop the plan</button></div></div>;
}

/** A plan ZeroFee worked out from the person's own wallets: the facts, the steps in order, and Start (the person's yes).
 *  Each step is Home's own sheet on their Face ID; nothing moves from this card. */
function PlanCard({ plan, stale }: { plan: Plan; stale: boolean }) {
  const { say } = useContext(PlanOpen);
  return (
    <div className="azc-card azc-plan" data-testid="az-plan">
      {plan.facts && <p className="zf-small azc-system">{plan.facts}</p>}
      <p className="azc-card-line">Plan:</p>
      <ol className="azc-plan-steps">{plan.steps.map((s, i) => <li key={i}>{s.line}</li>)}</ol>
      {!stale && plan.state === "proposed" && <div className="azc-acts"><button type="button" className="azc-act" onClick={() => say("Start")}>Start</button><button type="button" className="azc-act-link" onClick={() => say("No")}>Not now</button></div>}
    </div>
  );
}

/** A sheet AgentZero needs a tap for: the agent package's card (the core's own sheet opens on the tap); its line, once done. */
function SheetCard({ sheet, line }: { sheet: unknown; line: string }) {
  const { bridge } = useShell();
  // the sheet opens only on the person's own tap on Review, never by itself when the card appears (review L2 Low)
  const [state, setState] = useState<"ask" | "open" | "done">("ask");
  // when Review was tapped: the live card follows the move that started after it (Jobs.tsx JobCard)
  const [since, setSince] = useState(0);
  const shell = useShell();
  const task = useRef<ReturnType<typeof moneyTask> | null>(null);
  const openJobs = useContext(JobsOpen);
  const kind = String((sheet as { kind?: unknown } | null)?.kind ?? "");
  const moves = MOVES_NOW.has(kind);
  // the mark at the top dims while this sheet is open
  const onSheet = useContext(SheetOpen);
  useEffect(() => {
    if (state !== "open") return;
    onSheet(true);
    return () => onSheet(false);
  }, [state, onSheet]);
  if (state === "done") return moves ? <><p className="zf-small azc-system">{line}</p><Suspense fallback={null}><JobCard bridge={bridge} since={since} onOpen={openJobs} task={task.current} pay={kind === "pay"} /></Suspense></> : <p className="zf-small azc-system">{line}</p>;
  // D144: Review starts this money sheet's task in the app's one Activity centre (what and how much, never who)
  const review = () => {
    setSince(Date.now());
    // one task per move: only a pay sheet is AgentZero's own (an act sheet's move is Spending's row, Home's task)
    if (OWN_SHEETS.has(kind) && !task.current) {
      const s = sheet as MoneySheet;
      task.current = moneyTask(tasksOf(shell), sheetAsk(s), { keep: localKeep(), title: sheetTitle(s), openLabel: SHEET_OPEN, sheet: "pay" });
      task.current.to("opened");
    }
    setState("open");
  };
  if (state === "ask") return <div className="azc-card"><p className="azc-card-line">{line}</p><div className="azc-acts"><button type="button" className="azc-act" onClick={review}>Review</button></div></div>;
  return <div className="azc-sheet"><Suspense fallback={<p className="zf-small azc-thinking">Opening…</p>}><ChatSheetCard bridge={bridge} sheet={sheet as ChatSheet} onDone={() => setState("done")} /></Suspense></div>;
}

/** One tool step: its line and state, and why (a refusal), in a card that opens for the detail and closes again. */
function StepCard({ p }: { p: Extract<AzPart, { type: "step" }> }) {
  const state = p.state === "done" ? "Done" : p.state === "refused" ? "Stopped" : "Working";
  return (
    <details className={`azc-step azc-step--${p.state === "done" || p.state === "refused" ? p.state : "running"}`}>
      <summary><span className="azc-step-line">{p.line}</span><span className="zf-small azc-step-state">{state}</span></summary>
      <p className="zf-small">{p.why ?? (p.state === "running" ? "AgentZero is on this step." : p.state === "done" ? "This step is done." : "This step stopped.")}</p>
    </details>
  );
}
