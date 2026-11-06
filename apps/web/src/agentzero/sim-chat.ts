// AgentZero in the Sim (D157). The product prepaid rule (4 Nov): AgentZero thinks only on money it holds, and the Sim
// holds none, so its relay route refused every ask (a web test: "AgentZero's free reading refused that"; the
// preview's origin is not on the Sim route's list either). The Sim's AgentZero now answers its three suggestions with
// fixed sample answers, made here with no network call, each said to be a sample (the copywriter's words); anything
// typed gets one line. "What's my balance?" reads the Sim's own total (Home's sum, wallet BalanceTotal.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { simWords } from "@zerofee/agent/chat/sim";
import { readBalanceParts } from "@zerofee/wallet/app/BalanceTotal.ts";
import { dollars } from "@zerofee/wallet/app/format.ts";
import { CHAT_LINE } from "@zerofee/agent/chat/chat-lines";
import { sendId } from "@zerofee/agent/chat/use-chat-turn";
import type { AzMessage, AzPart } from "./chat-events.ts";
import { WATCH_MS } from "./chat-items.ts";
import type { ChatSource } from "./AgentZeroChat.tsx";

/** The Sim's ready screen: what runs on its pretend money (AgentZero's jobs are the iPhone app's). */
export const SIM_STARTERS = ["What can you do?", "Move $5 from my Safe to my SOL wallet", "What's my balance?"] as const;
/** The copywriter's tag on every sample answer. */
export const SIM_SAMPLE_TAG = "Sample answer";
/** The copywriter's one line for anything typed. */
export const SIM_ONLY_STARTERS = "In the Sim, AgentZero answers only a few questions. Ask your own on the ZeroFee iPhone app.";
/** The copywriter's sample answers, one line each, true to AgentZero's tools (packages/agent chat/tools.ts). */
export const SIM_ANSWERS: Readonly<Record<(typeof SIM_STARTERS)[number], readonly string[]>> = {
  "What can you do?": [
    "I can send, swap, move and add money, and buy or sell coins in Trade.",
    "I can tell you prices, what you hold, and what came in or went out.",
    "I can open a website and do a task there while you watch.",
    "I never move money myself. A sheet opens, and you tap Approve.",
  ],
  "Move $5 from my Safe to my SOL wallet": [
    "I'd open Move for you, filled in: $5 from your Safe to your SOL wallet.",
    "You check it and tap Approve. Only then does it move.",
    "Nothing moved. To try it here, go to Home and tap Move.",
  ],
  "What's my balance?": ["You have {total} in all.", "Home shows how much is in your Safe, your wallets and Private."],
};
/** QA (5 Nov): the questions people type most in the Sim, each with its sample answer (the copywriter's). */
/** hunt 5 Nov (005): each answer is true for any ask it matches. A send names only the dollar amount the person said
 *  ({amount}; none said, none named), a buy names no coin or amount ("buy 1000000 BONK with everything" got "$2 of the
 *  top coin"), the cost answer is only about AgentZero's own answers (never "how much does it cost to send $1000?", "how much did I
 *  spend?" or "what does bitcoin cost?"), and
 *  the balance answer hears its common phrasings ("What is my balance?", "How much money do I have?"). */
export const SIM_TYPED: readonly { key: string; test: RegExp; lines: readonly string[] }[] = [
  { key: "buy", test: /^(please )?buy\b/, lines: ["I'd open Trade for you.", "You pick the coin and how much, then tap Buy.", "Nothing was bought. To try it here, open Trade."] },
  // UX hunt 5 Nov (G9, 076): "Pay $5 to coffee.near for my coffee" got the one line, a dead end; the way on is Send (no pay
  // list while AgentZero can't pay anyone: jobs.ts payListRuns)
  { key: "pay", test: /^(please )?pay\b/, lines: ["I can't pay people yet.", "You can pay them yourself with Send.", "Nothing was paid. To try it here, go to Home and tap Send."] },
  { key: "sell", test: /^(please )?sell\b/, lines: ["I'd open Trade for you.", "You pick the coin and how much, then tap Sell.", "Nothing was sold. To try it here, open Trade."] },
  { key: "move", test: /^(please )?move\b/, lines: ["I'd open Move for you.", "You check how much and where it goes, then tap Approve.", "Nothing moved. To try it here, go to Home and tap Move."] },
  { key: "swap", test: /^(please )?swap\b/, lines: ["I'd open Swap for you.", "You pick the coins and how much, then tap Approve.", "Nothing was swapped. To try it here, go to Home and tap Swap."] },
  { key: "send", test: /^(please )?send\b/, lines: ["I'd open Send for you{amount}.", "You check who gets it and how much, then tap Approve.", "Nothing was sent. To try it here, go to Home and tap Send."] },
  { key: "cost", test: /^(?!.*\b(send|sending|sent|buy|buying|sell|selling|swap|swapping|move|moving|trade|trading|pay|paying)\b).*(\b(you|your|it|this|that|agentzero|agentzero's|answers?|replies|reply|asking|chat|chatting)\b.*\b(cost|costs)\b|\b(cost|costs)\b.*\b(you|agentzero|an answer|each answer|to ask|to chat|to use)\b)/, lines: ["Here in the Sim, my answers cost nothing.", "On the iPhone app, each answer costs a little.", "I pay it from my own wallet, at Claude's price."] },
  { key: "money", test: /^(show|what's|whats|what is|how much is|tell me) (me )?(all )?(of )?my (money|balance|wallets?|total)$|^my (money|balance)$|^how much (money )?(do i have|have i got)$/, lines: ["You have {total} in all.", "Go to Home to see what is in your Safe, your wallets and Private."] },
];
/** The dollar amount a send names ("send $50000 to ..." gives ", filled in with $50,000"), or nothing. */
export function sendAmount(words: string): string {
  const m = /^(?:please )?send\s+\$\s?(\d[\d,]*(?:\.\d{1,2})?)\b/i.exec(words.trim());
  const n = m ? Number(m[1]!.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? `, filled in with $${n.toLocaleString("en-US", Number.isInteger(n) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "";
}
const plain = (w: string) => w.trim().toLowerCase().replace(/[\s?.!]+$/g, "").replace(/\s+/g, " ").replace(/[’‘]/g, "'");
/** The suggestion these words are (as tapped, or typed the same), or null. */
export const starterOf = (words: string): (typeof SIM_STARTERS)[number] | null => SIM_STARTERS.find((s) => plain(s) === plain(words)) ?? null;

/**
 * The reply to `words`, made here: a suggestion's sample answer (its total read from the Sim's own money), else the one
 * line. Never a network call. The balance's figure is the Sim's own (a fact), so the screen shows it as read.
 */
export async function simReply(words: string, total: () => Promise<string | null>): Promise<AzPart[]> {
  const s = starterOf(words);
  const typed = s ? null : SIM_TYPED.find((t) => t.test.test(plain(words)));
  if (!s && !typed) return [{ type: "text", text: SIM_ONLY_STARTERS }];
  let lines = s ? SIM_ANSWERS[s] : typed!.lines.map((l) => l.replace("{amount}", sendAmount(words)));
  let facts: Record<string, { mark: string; shown: string; rows: string[] }> | undefined;
  if (lines.some((l) => l.includes("{total}"))) {
    const t = await total().catch(() => null);
    if (t === null) lines = lines.filter((l) => !l.includes("{total}"));
    else {
      facts = { f1: { mark: "f1", shown: dollars(t), rows: [] } };
      lines = lines.map((l) => l.replace("{total}", "{{f1}}"));
    }
  }
  return [{ type: "text", text: [`*${SIM_SAMPLE_TAG}*`, ...lines].join("\n\n"), ...(facts ? { facts } : {}) }];
}

/** What the Sim's screen shows of a reply, in the browser's approval words (no Face ID in a tab, D157). */
export const simMessage = (m: AzMessage): AzMessage => (m.role === "user" ? m : (JSON.parse(simWords(JSON.stringify(m))) as AzMessage));

/** The Sim's chat, kept with the sample account (its device store), so a reload keeps it (QA 5 Nov: wiped). */
export const SIM_CHAT_KEY = "agentzero.sim-chat.v1";
/** A kept chat: finished messages only (a reply cut by the reload is dropped; its question stays), at most the last 60. */
export function keptSimChat(raw: unknown): AzMessage[] {
  try {
    const j = typeof raw === "string" ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(j)) return [];
    return j.filter((m): m is AzMessage => !!m && typeof m === "object" && typeof (m as AzMessage).id === "string" && ((m as AzMessage).role === "user" || (m as AzMessage).role === "assistant") && Array.isArray((m as AzMessage).parts) && (m as AzMessage).done === true).slice(-60);
  } catch {
    return [];
  }
}

/** What the store keeps of the chat now: the finished messages (a question at once, its reply once done), the last 60. */
export const keepNow = (messages: readonly AzMessage[]): AzMessage[] => messages.filter((m) => m.done).slice(-60);

/** Home's whole total for the balance answer: read again while the wallets are still being read (a few seconds at
 *  most); still missing a part, no figure at all (never one that leaves money out). */
export async function wholeTotal(bridge: Bridge, tries = 6, waitMs = 500): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    const t = await readBalanceParts(bridge);
    if (t && !t.partial) return t.usd;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs));
  }
  return null;
}

/** A sample reply, or the watchdog's line after WATCH_MS with Try again (never "thinking…" forever). */
export async function simAnswer(words: string, total: () => Promise<string | null>, watchMs: number = WATCH_MS): Promise<AzPart[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<AzPart[]>((r) => (timer = setTimeout(() => r([{ type: "fault", line: CHAT_LINE.silent, retry: true }]), watchMs)));
  try {
    return await Promise.race([simReply(words, total).catch((): AzPart[] => [{ type: "fault", line: CHAT_LINE.silent, retry: true }]), late]);
  } finally {
    clearTimeout(timer);
  }
}

export function useSimChat(bridge: Bridge): ChatSource {
  const [messages, setMessages] = useState<AzMessage[]>([]);
  const [running, setRunning] = useState(false);
  // one tap is one bubble (QA 5 Nov: two bubbles, the first reply "thinking…" forever): a send while one is
  // answering is refused; a reply lands in its own bubble unless the chat was stopped or started anew since (`gen`)
  const busy = useRef(false);
  const gen = useRef(0);
  const live = useRef(true);
  const loaded = useRef(false);
  // set again on every mount: React's StrictMode (dev) unmounts and mounts once, which left this false and every reply
  // "thinking…" for good (UI audit 5 Nov)
  useEffect(() => {
    live.current = true;
    return () => void (live.current = false);
  }, []);
  useEffect(() => {
    void bridge.call<{ value: string | null }>("device.store.get", { key: SIM_CHAT_KEY }).then((r) => {
      const kept = "ok" in r ? keptSimChat(r.ok?.value) : [];
      if (live.current && kept.length) setMessages((m) => (m.length ? m : kept));
      loaded.current = true;
    }, () => void (loaded.current = true));
  }, [bridge]);
  // kept at every change, a reply still running too (its question is done, so it stays; the reply isn't): hunt 5 Nov,
  // a reload 5 ms after the send lost the question, the write having waited for the reply
  useEffect(() => {
    if (!loaded.current) return;
    void bridge.call("device.store.set", { key: SIM_CHAT_KEY, value: JSON.stringify(keepNow(messages)) }).catch(() => undefined);
  }, [bridge, messages]);
  const ask = useCallback((w: string, id: string) => {
    busy.current = true;
    const g = gen.current;
    const reply = `r${id}`;
    setMessages((m) => [...m.filter((x) => x.id !== reply), { id: reply, role: "assistant", parts: [], done: false }]);
    setRunning(true);
    void simAnswer(w, () => wholeTotal(bridge)).then((parts) => {
      if (!live.current || gen.current !== g) return;
      busy.current = false;
      setMessages((m) => m.map((x) => (x.id === reply ? { ...x, parts, done: true } : x)));
      setRunning(false);
    });
  }, [bridge]);
  const send = useCallback((w: string) => {
    if (!w.trim() || busy.current) return;
    const id = sendId();
    setMessages((m) => [...m, { id, role: "user", parts: [{ type: "text", text: w }], done: true }]);
    ask(w, id);
  }, [ask]);
  const retry = useCallback(() => {
    if (busy.current) return;
    const you = [...messages].reverse().find((m) => m.role === "user");
    const text = you?.parts.find((p) => p.type === "text");
    if (you && text && text.type === "text") ask(text.text, you.id);
  }, [messages, ask]);
  const stop = useCallback(() => {
    gen.current++;
    busy.current = false;
    setMessages((m) => m.filter((x) => x.done));
    setRunning(false);
  }, []);
  const newChat = useCallback(() => {
    gen.current++;
    busy.current = false;
    setMessages([]);
    setRunning(false);
  }, []);
  const shown = useMemo(() => messages.map(simMessage), [messages]);
  return { messages: shown, running, send, stop, note: null, newChat, starters: SIM_STARTERS, retry };
}
