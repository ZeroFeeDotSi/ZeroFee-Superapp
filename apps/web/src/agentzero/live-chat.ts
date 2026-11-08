// The real account's chat: the agent package's useChatTurn (the person's own key, or ZeroFee's free reading through the relay;
// the guard and the tools live there) as the screen's ChatSource. Stop is its stop(): the request is aborted (the
// relay fetch and the SDK stream), so no more of the answer is read. The screen frees Send at once on Stop, says a turn
// that failed outside the stream, and ends a turn when the person leaves the tab (review L2 M1, M2).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { CHAT_SECRETS, relayBase, sendId, thinkingLine, useChatTurn } from "@zerofee/agent/chat/use-chat-turn";
import { KEY_LINE, NEEDS_LINE, keyController, type KeySaved } from "@zerofee/agent/chat/ai-key";
import type { NeedsKey, ReplyOwed } from "@zerofee/agent/chat/turn";
import { claudeChoice, modelStore, type ClaudeChoice } from "@zerofee/agent/chat/model";
import { OWN_KEY_ON } from "@zerofee/agent/chat/own-key";
import type { ChatSource, KeysSource, ModelSource } from "./AgentZeroChat.tsx";
import { WATCH_MS, fromItems, quietLine } from "./chat-items.ts";
import { moneyReader } from "./money-reader.ts";
import { ACTIVITY_PRIVACY, activityPrivacy } from "./fact-text.ts";
import { failLine, withMoney } from "./fail-line.ts";
import { walletFlag } from "./wallet-flag.ts";
import { LIMITS, withinOr } from "@zerofee/agent/chat/wait";
import { mayAsk, useAgentWallet, type WalletSource } from "./use-agent-wallet.ts";
import { streamMicros } from "./meter.ts";
import { webWallet } from "@zerofee/shell-api/release.ts";
import { setBrowsePay } from "@zerofee/agent/robot/relay-think";

/** Funded wallet only (product decision, 3 Nov; D152; D37 prepaid): no free try, no credit. A message goes only when
 *  AgentZero's own money covers it (mayAsk); each reply is paid right after it, exactly, from AgentZero's own wallet. */
export const FREE_TRY = false;
/** Off (AGENTZERO_WALLET), no wallet at all: not one more call than before. */
const noWallet = (_b: Bridge): WalletSource | null => null;

export function useLiveChat(bridge: Bridge): ChatSource {
  // H-2: read_activity reads the person's own Activity on this phone; a name is matched only if they typed it this turn
  const said = useRef("");
  const reader = useMemo(() => moneyReader(bridge, () => said.current), [bridge]);
  // AgentZero's own wallet (L9): only when AGENTZERO_WALLET is on (fixed for the app's life, so the hooks keep their order)
  const wallet = (walletFlag.on ? useAgentWallet : noWallet)(bridge);
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  // D152: before each further call of a tool loop, the last call is paid (the relay holds the next until it is); no
  // money, the reply pauses (§5). A payment takes a few seconds on NEAR: the wait is limited, late is a pause too.
  const beforeCall = useMemo(() => (wallet ? async () => {
    const w = walletRef.current!;
    const ok = await withinOr(w.settle(), LIMITS.core + 20_000, "AgentZero's wallet", false);
    if (ok) return true;
    w.setPaused(true);
    return false;
  } : undefined), [!!wallet]); // eslint-disable-line react-hooks/exhaustive-deps
  // D152: each call's cost owed goes to the wallet at once (it pays before the next call)
  const onOwed = useMemo(() => (wallet ? (o: ReplyOwed) => walletRef.current?.owe(o) : undefined), [!!wallet]); // eslint-disable-line react-hooks/exhaustive-deps
  // D37: the relay reads AgentZero's own account's USDC before each reply; read_meter says the true thinking meter
  const account = useMemo(() => (wallet ? () => walletRef.current?.account ?? null : undefined), [!!wallet]); // eslint-disable-line react-hooks/exhaustive-deps
  // QA: the proof that the sign-up's id is this AgentZero's own (the relay binds the id to its account)
  const bindFor = useMemo(() => (wallet ? (tok: string) => walletRef.current?.bindFor(tok) ?? Promise.resolve(null) : undefined), [!!wallet]); // eslint-disable-line react-hooks/exhaustive-deps
  const thinking = useMemo(() => (wallet ? () => {
    const w = walletRef.current;
    return w ? thinkingLine({ usedUsd: w.usedUsd, paidUsd: w.paidUsd, owedUsd: w.owedUsd, walletUsd: w.totalUsd, lastUsd: w.lastUsd }) : null;
  } : undefined), [!!wallet]); // eslint-disable-line react-hooks/exhaustive-deps
  // product decision, 4 Nov ("$0.000 used" after a reply): a paid reply's own cost when its closing line had no batch figure
  const onCost = useMemo(() => (wallet ? (micros: number) => walletRef.current?.cost(micros) : undefined), [!!wallet]); // eslint-disable-line react-hooks/exhaustive-deps
  // audit 14 E1: AgentZero's browser thinks on the same paid path: each step is paid from this wallet like a reply
  useEffect(() => (wallet ? setBrowsePay({ account: () => walletRef.current?.account ?? null, bindFor: (t) => walletRef.current?.bindFor(t) ?? Promise.resolve(null), settle: () => walletRef.current?.settle() ?? Promise.resolve(false), owe: (o) => walletRef.current?.owe(o), cost: (m) => walletRef.current?.cost(m) }) : undefined), [!!wallet]); // eslint-disable-line react-hooks/exhaustive-deps
  const chat = useChatTurn(bridge, { activity: reader.activity, ...(beforeCall ? { beforeCall } : {}), ...(onOwed ? { onOwed } : {}), ...(onCost ? { onCost } : {}), ...(account ? { account } : {}), ...(bindFor ? { bindFor } : {}), ...(thinking ? { thinking } : {}), ...(webWallet() ? { web: true } : {}) });
  /** Stopped by the person: Send is free again at once, whatever the request still does. */
  const [stopped, setStopped] = useState(false);
  /** A turn that threw outside the stream (the key read, the sign-up): said, never silent. */
  const [failedAt, setFailedAt] = useState<{ at: number; line: string } | null>(null);
  const stopRef = useRef(chat.stop);
  stopRef.current = chat.stop;
  // leaving the tab mid-turn ends the turn: no answer is read for a screen that's gone (no credits burn)
  useEffect(() => () => void stopRef.current(), []);
  /** Words tapped that haven't gone yet (AgentZero's wallet pays the last reply first): their bubble shows at once, and
   *  Send is locked (product decision, 4 Nov: a tap with nothing on screen, then the words twice). */
  const [queued, setQueuedState] = useState<{ id: string; text: string } | null>(null);
  const queuedRef = useRef<{ id: string; text: string } | null>(null);
  const setQueued = useCallback((q: { id: string; text: string } | null) => void ((queuedRef.current = q), setQueuedState(q)), []);
  /** The watchdog: the bubble whose answer is awaited, and whether WATCH_MS passed with nothing on screen for it. */
  const [waitId, setWait] = useState<string | null>(null);
  const [slowId, setSlowId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!waitId) return;
    const t = setTimeout(() => setSlowId(waitId), WATCH_MS);
    return () => clearTimeout(t);
  }, [waitId, attempt]);
  const running = (chat.busy && !stopped) || queued !== null;
  const messages = useMemo(() => {
    // Dead ends row 21: every fault names its cause (fail-line.ts) and says "Nothing moved."
    const m = fromItems(chat.items, chat.busy && !stopped).map((x) => (x.parts.some((p) => p.type === "fault") ? { ...x, parts: x.parts.map((p) => (p.type === "fault" ? { ...p, line: withMoney(p.line) } : p)) } : x));
    // words still on their way (the wallet pays first): their own bubble now, its reply thinking
    if (queued && !chat.items.some((i) => i.kind === "you" && i.id === queued.id)) {
      m.push({ id: queued.id, role: "user", parts: [{ type: "text", text: queued.text }], done: true });
      m.push({ id: `r${queued.id}`, role: "assistant", parts: [], done: false });
    }
    if (failedAt !== null && failedAt.at <= chat.items.length) m.push({ id: `fail${failedAt.at}`, role: "assistant", parts: [{ type: "fault", line: failedAt.line }], done: true });
    // the watchdog: nothing on screen for the last words (slow, or a turn that ended silent): a line and Try again
    const quiet = failedAt === null ? quietLine(chat.items, waitId, { running, slow: slowId !== null && slowId === waitId }) : null;
    if (quiet) {
      const last = m.at(-1);
      const line = { type: "fault" as const, line: withMoney(quiet), retry: true };
      if (last?.role === "assistant") m[m.length - 1] = { ...last, parts: [...last.parts, line] };
      else m.push({ id: `q${waitId}`, role: "assistant", parts: [line], done: !running });
    }
    // Try again only on the last reply's lines, and never while a turn runs
    return m.map((x, i) => (i === m.length - 1 && !running) || !x.parts.some((p) => p.type === "fault" && p.retry) ? x : { ...x, parts: x.parts.map((p) => (p.type === "fault" && p.retry ? { type: "fault" as const, line: p.line } : p)) });
  }, [chat.items, chat.busy, stopped, failedAt, queued, waitId, slowId, running]);
  /** How many cost items the thread had when this turn began (null between turns): only this turn's are noted. */
  const noting = useRef<number | null>(null);
  const go = useCallback((w: string, id: string) => {
    // what this message's calls cost, and the payments for them, are this message's (one receipt row per reply)
    walletRef.current?.turn(id);
    noting.current = chat.items.filter((i) => i.kind === "cost").length;
    setStopped(false);
    setFailedAt(null);
    said.current = w;
    const at = chat.items.length + 1;
    void chat.send(w, id).catch((e: unknown) => setFailedAt({ at, line: failLine(e) }));
  }, [chat]);
  /** The watchdog starts for these words (a send, a Try again, a held reply asked again). */
  const watch = useCallback((id: string) => {
    setWait(id);
    setSlowId(null);
    setAttempt((n) => n + 1);
  }, []);
  const keys = useKeys(bridge, chat);
  const ownKey = !!keys.saved;
  /** D152: AgentZero's wallet on and no key of the person's own: the last reply is paid first (the relay holds the next
   *  until it is). Nothing to pay with: the words go back to the box, and the line above it says why. A reply the relay
   *  held anyway (it knew of an unpaid one: a Stop, a crash) is paid, then the words go again, once. */
  /** A held reply's words went again once already for this Send (SR3 M6). */
  const resent = useRef(false);
  /** `id`: the bubble's own id (a Try again sends the same bubble's words again). */
  const sendAs = useCallback((w: string, id: string): void | Promise<boolean> => {
    // one send at a time (product decision, 4 Nov): a tap while words are still on their way, or a turn runs, is no second send
    if (queuedRef.current || chat.busy) return Promise.resolve(false);
    watch(id);
    if (!wallet || ownKey) return go(w, id);
    // D37 (QA 4 Nov: a $0 wallet got three paid replies): prepaid only. Unless AgentZero's own money covers the most a
    // reply can cost, nothing is sent and Claude is never asked: the words stay in the box and the line above it says
    // why (Add money beside it). Not read yet or unreadable: refused too, and read again.
    const no = mayAsk(wallet.state, wallet.totalUsd);
    if (no) {
      wallet.setRefused(no);
      if (no === "unread") wallet.refresh();
      setWait(null);
      return Promise.resolve(false);
    }
    // the bubble now, while the last reply is paid (a few seconds on NEAR)
    setQueued({ id, text: w.trim() });
    return (async () => {
      const ok = await withinOr(wallet.settle(), LIMITS.core + 20_000, "AgentZero's wallet", false);
      // Stopped while it paid: nothing goes, the words go back to the box
      if (queuedRef.current?.id !== id) return false;
      setQueued(null);
      if (!ok) {
        setWait(null);
        return false;
      }
      wallet.setRefused(null);
      wallet.setPaused(false);
      // SR3 M6: one paid-then-asked-again per Send, never a loop a relay could drive
      resent.current = false;
      go(w, id);
      return true;
    })();
  }, [wallet, ownKey, go, chat.busy, setQueued, watch]);
  const send = useCallback((w: string) => sendAs(w, sendId()), [sendAs]);
  /** Try again (product decision, 4 Nov): the last words once more, in their own bubble (never a second one). */
  /** `fresh` (QA: the relay can't read this phone's sign-in any more): the dead sign-in is forgotten first, so
   *  the words go on a new one (its own id, bound to AgentZero's account again; the account's slots still count). */
  const retry = useCallback((o?: { fresh?: boolean }) => {
    const you = [...chat.items].reverse().find((i): i is Extract<typeof i, { kind: "you" }> => i.kind === "you");
    if (!you) return;
    resent.current = false;
    const again = () => void sendAs(you.text, you.id ?? sendId());
    if (!o?.fresh) return again();
    void bridge.call("device.secret.set", { key: CHAT_SECRETS.token, value: null }).then(again, again);
  }, [chat.items, sendAs, bridge]);
  // the relay held a reply for an unpaid one: once it is paid, the person's words go again (once per held reply), in the
  // same bubble (product decision, 4 Nov: they showed twice)
  const held = chat.items.at(-1)?.kind === "unpaid" && !chat.busy;
  useEffect(() => {
    if (!held || !wallet || resent.current) return;
    const you = [...chat.items].reverse().find((i): i is Extract<typeof i, { kind: "you" }> => i.kind === "you");
    if (!you?.id) return;
    resent.current = true;
    const id = you.id;
    setQueued({ id, text: you.text });
    watch(id);
    void wallet.settle().then((ok) => {
      if (queuedRef.current?.id !== id) return;
      setQueued(null);
      if (ok) go(you.text, id);
    });
  }, [held]); // eslint-disable-line react-hooks/exhaustive-deps
  // product decision, 4 Nov: the meter on top rises while a reply streams (its words so far at the model's price), then the relay's
  // exact figure takes its place; a Stop keeps the estimate until the relay's next figure says it exactly
  const model = keys.model?.choice?.model;
  const live = streamMicros(chat.items, chat.busy && !stopped, model);
  const liveRef = useRef(live);
  liveRef.current = live;
  const setLive = wallet?.setLive;
  useEffect(() => setLive?.(ownKey ? 0 : live), [setLive, live, ownKey]);
  const stop = useCallback(() => {
    // words still on their way: they never go (the box gets them back)
    if (queuedRef.current) {
      setQueued(null);
      setWait(null);
    }
    if (wallet && !ownKey) wallet.stopped(liveRef.current);
    setStopped(true);
    chat.stop();
  }, [chat, wallet, ownKey, setQueued]);
  const note = chat.allowance ? `Free reading today: $${chat.allowance.usedUsd.toFixed(2)} of $${chat.allowance.limitUsd.toFixed(2)}` : null;
  // saved chats (chats.ts): a chat opened or started leaves no stop or fault line from the one before
  const fresh = useCallback(() => (setStopped(false), setFailedAt(null), setQueued(null), setWait(null), setSlowId(null)), [setQueued]);
  const chats = useMemo(() => ({
    list: chat.chats,
    current: chat.current,
    open: (id: string) => (fresh(), chat.open(id)),
    remove: (id: string) => chat.remove(id),
  }), [chat, fresh]);
  const newChat = useCallback(() => (fresh(), chat.newChat()), [chat, fresh]);
  // Continue after a reply paused for want of money (§5): the thread kept, AgentZero carries on
  const resume = useCallback(() => void send("Continue"), [send]);
  return { messages, running, send, retry, stop, note, activityNote: chat.via ? activityPrivacy(chat.via) : ACTIVITY_PRIVACY, keys, chats, newChat, stepEnded: chat.stepEnded, planCheck: chat.planCheck, planStop: chat.planStop, cardSaw: chat.cardSaw, ...(wallet ? { wallet, resume } : {}) };
}

/**
 * Which Claude the chat runs (product decision, 3 Nov), read once as the tab opens (so a send already knows it: useChatTurn reads the
 * same store's last-known choice) and kept on this device on each tap. Never with the key.
 */
function useModel(bridge: Bridge): ModelSource {
  const store = useMemo(() => modelStore(bridge), [bridge]);
  const [choice, setChoice] = useState<ClaudeChoice | undefined>(() => store.known());
  useEffect(() => {
    let live = true;
    void store.get().then((c) => live && setChoice(c));
    return () => void (live = false);
  }, [store]);
  const set = useCallback((c: ClaudeChoice) => {
    setChoice(claudeChoice(c));
    void bridge.call("device.haptic", { kind: "tap" });
    void store.set(c).catch(() => undefined);
  }, [store, bridge]);
  return useMemo(() => ({ choice, set }), [choice, set]);
}

/** Where to get a Claude key (on the allow-list: console.anthropic.com). */
const GET_KEY = "https://console.anthropic.com/settings/keys";

/**
 * The chat's AI key (product decision, 3 Nov): what it opens on (a saved key, the free reading, or the key card), the card again when
 * a turn finds no key and no free reading, and the Keys sheet's Replace and Remove. The chat reads the key fresh for each
 * turn (useChatTurn), so a key saved here is used by the very next message.
 */
function useKeys(bridge: Bridge, chat: { items: readonly { kind: string; why?: unknown }[]; note: (line: string) => void }): KeysSource {
  // own-key.ts: off in every build people get (never the saved key; probe only signs up for the relay)
  const ctl = useMemo(() => keyController(bridge, { relayBase: relayBase(), ownKey: OWN_KEY_ON }), [bridge]);
  const model = useModel(bridge);
  const [saved, setSaved] = useState<KeysSource["saved"]>(undefined);
  const [opened, setOpened] = useState<NeedsKey | null>(null);
  const probe = useCallback(() => {
    let live = true;
    void ctl.probe().then(
      (s) => {
        if (!live) return;
        setSaved("saved" in s ? s.saved : null);
        setOpened("needs" in s ? s.needs : null);
      },
      () => live && (setSaved(null), setOpened("off")),
    );
    return () => void (live = false);
  }, [ctl]);
  useEffect(probe, [probe]);
  // the last turn found no key and no free reading (after the last key saved): the card again
  const lastNeeds = [...chat.items].reverse().find((i) => i.kind === "needs-key" || i.kind === "note");
  const fromTurn = lastNeeds?.kind === "needs-key" ? (lastNeeds.why as NeedsKey) : null;
  const why = saved ? null : (fromTurn ?? opened);
  const { note } = chat;
  // on an empty chat the orb waking says it (the design: no grey "Claude is ready." line); mid-chat the line stays
  const midChat = useRef(false);
  midChat.current = chat.items.some((i) => i.kind === "you");
  const use = useCallback(async (raw: string): Promise<KeySaved> => {
    const r = await ctl.use(raw);
    void bridge.call("device.haptic", { kind: r.ok ? "success" : "warning" });
    if (r.ok) {
      setSaved({ provider: r.provider, tail: r.tail });
      setOpened(null);
      if (midChat.current) note(`${KEY_LINE.ready}.`);
    }
    return r;
  }, [ctl, note, bridge]);
  const remove = useCallback(async () => {
    if (!(await ctl.remove())) return false;
    setSaved(null);
    probe();
    return true;
  }, [ctl, probe]);
  return {
    saved,
    why,
    own: OWN_KEY_ON,
    needed: why !== null,
    line: why ? NEEDS_LINE[why] : null,
    use,
    remove,
    paste: ctl.paste,
    getKey: () => void bridge.call("device.openUrl", { url: GET_KEY, mode: "sheet" }),
    model,
  };
}
