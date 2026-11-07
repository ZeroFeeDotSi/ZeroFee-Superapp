// The AgentZero tab as a chat (D122). A real account talks to the agent package's chatTurn (useLiveChat); the Sim (the sample
// demo, D157) runs the same chatTurn on the Sim's own bridge and money, its Claude the relay's Sim route (SimChat).
import { Suspense, lazy, useEffect, useState } from "react";
import { MAIL_RECEIVE_LIVE, inboxShown } from "./inbox-gate.ts";
import type { AppModule } from "@zerofee/shell-api/app-module.ts";
// The agent package's screens, loaded when Jobs and limits is first opened (AgentApp keeps its own chunk)
const AgentZeroSettings = lazy(() => import("@zerofee/agent/app/AgentZeroSettings.tsx").then((m) => ({ default: m.AgentZeroSettings })));
import { Inbox } from "./Inbox.tsx";
import { AppFrame, PushedFrame, useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { MODE } from "../mode.ts";
import { webWallet } from "@zerofee/shell-api/release.ts";
import { OPEN_MODELS_LINE, registerMailbox } from "./az-web.ts";
import { AzMark, type MarkMood } from "./AzMark.tsx";
// the Sim's chat (D157): the real engine on the Sim's bridge, loaded with this tab (never in Home's first load)
const SimChat = lazy(() => import("./SimChat.tsx").then((m) => ({ default: m.SimChat })));
// the real account's chat (the agent package's engine, the relay's turn) loads only on a real account, never with the sample
// demo; the public build (the sample-money demo only, main.tsx) leaves it out altogether, read inline so the bundler
// drops it: no relay turn, no Anthropic SDK and no key path ships there (deploy-app.sh checks)
// D157: the Chrome extension is a real account's home (D152's per-reply payment is in): its build keeps the live chat
// W7 (product decision, 5 Nov): the web wallet is a real account's home too, so the public build keeps the live chat; its own-key
// path stays out (turn.ts, ai-key.ts: inline public flags; deploy-app.sh refuses the key path's marks)
const LiveChat = lazy(() => import("./LiveChat.tsx").then((m) => ({ default: m.LiveChat })));
/** Where the live chat runs: every build but the public one's Real mode (its Safe isn't on the web), and in the public
 *  build the web wallet (W7) and the Chrome extension. Read inline, so the bundler folds it. */
const liveHere = (): boolean => import.meta.env?.VITE_ZEROFEE_PUBLIC !== "1" || import.meta.env?.VITE_ZEROFEE_TARGET === "extension" || webWallet();

/** The public web build's Real mode (UI, 3 Nov): the live chat stays out of that build until D152's per-reply payment
 *  lands, so a real account there gets one plain line, never the sample chat on real money. */
export const AZ_WEB_SOON = "AgentZero opens on the web soon. It works on the ZeroFee iPhone app today.";
function WebSoon() {
  return <div style={{ height: "100%", display: "grid", placeItems: "center", padding: "0 28px" }}><p className="zf-small" style={{ textAlign: "center" }}>{AZ_WEB_SOON}</p></div>;
}

// D157: never in the Chrome extension (no Sim at all; read inline so the Sim chat and its sample money don't ship)
const SAMPLE = !(import.meta.env?.VITE_ZEROFEE_TARGET === "extension" && import.meta.env?.VITE_ZEROFEE_EXTENSION_CHECK !== "1") && "page" in MODE && MODE.page === "demo";

type Menu = { menu: boolean; onMenu: (open: boolean) => void; onJobs: () => void; onMood: (m: MarkMood) => void };

type Section = "chat" | "inbox" | "settings";
const CHAT = { id: "chat" as const, label: "Chat" }, INBOX = { id: "inbox" as const, label: "Inbox" };

/** The app's own sections (D122): the chat and AgentZero's inbox (L5). Jobs and limits (L6: the agent package's
 *  AgentZeroSettings: jobs, limits, receipts, memory, the computer door) opens from the menu top left, next to Chats
 *  (product decision, 3 Nov), as a pushed screen with Back. Each is on the agent app's own bridge. */
function ChatRoot() {
  const { bridge, active } = useShell();
  const [section, setSection] = useState<Section>("chat");
  // AgentZero's living mark, at the top in the app's name's place (product decision, 3 Nov): what the chat is doing moves it
  const [mood, setMood] = useState<MarkMood>("rest");
  // A-4: Siri's "Ask AgentZero" opens the chat itself, whatever section was open
  const { requestedTab, requestSeq } = useShell();
  // D144: the Activity centre's tap on one of AgentZero's tasks: "ask" (a money ask) or "jobs" (a job or a routine)
  useEffect(() => { if (requestedTab === "ask") setSection("chat"); else if (requestedTab === "jobs") setSection("settings"); }, [requestSeq]);
  // the Inbox only once a person can use it (inbox-gate.ts): receiving is live, so the mailbox is registered and shown
  const [address, setAddress] = useState<string | null>(null);
  // W7: AgentZero's own mailbox is registered the first time AgentZero opens (once: the core keeps its name), so
  // read_mail has a box; a host that doesn't answer leaves read_mail out of the chat (use-chat-turn mailHands)
  useEffect(() => {
    if (!MAIL_RECEIVE_LIVE || SAMPLE) return;
    let live = true;
    void registerMailbox(bridge).then((a) => live && a && setAddress(a));
    return () => void (live = false);
  }, [bridge]);
  const sections = inboxShown(address) ? [CHAT, INBOX] : [CHAT];
  const [menu, setMenu] = useState(false);
  const m: Menu = { menu: menu && section === "chat", onMenu: setMenu, onJobs: () => setSection("settings"), onMood: setMood };
  const chatShown = section === "chat";
  // the chat stays mounted under the other sections, so a reply in progress is never lost
  // W7 (product decision, 5 Nov): the page's one line on the models, above the chat (words via the copy review)
  const thread = <div hidden={section === "settings" || !chatShown} style={{ height: "100%", flexDirection: "column", ...(section === "settings" || !chatShown ? {} : { display: "flex" }) }}><p className="zf-small azc-note azc-models">{OPEN_MODELS_LINE}</p><div style={{ flex: 1, minHeight: 0 }}>{SAMPLE ? <Suspense fallback={<p className="zf-small azc-note">Opening…</p>}><SimChat shown={chatShown} {...m} /></Suspense> : !liveHere() ? <WebSoon /> : <Suspense fallback={<p className="zf-small azc-note">Opening…</p>}><LiveChat shown={chatShown} {...m} /></Suspense>}</div></div>;
  return (
    <div className="azc-app">
      <AppFrame name="AgentZero" top={<AzMark mood={chatShown ? mood : "rest"} shown={active !== false && section !== "settings"} />} tray={sections} tab={section === "settings" ? "chat" : section} onTab={(t) => setSection(t)} menu={{ label: "Menu", open: () => (setSection("chat"), setMenu(true)) }}>
        {thread}
        {section === "inbox" && inboxShown(address) && <Inbox bridge={bridge} />}
      </AppFrame>
      {/* Jobs and limits over the chat, with Back (the chat stays mounted under it) */}
      {section === "settings" && <div className="azc-pushed"><PushedFrame name="Jobs and limits" onBack={() => setSection("chat")}><Suspense fallback={<p className="zf-small azc-note">Opening…</p>}><AgentZeroSettings bridge={bridge} /></Suspense></PushedFrame></div>}
    </div>
  );
}

export const agentZeroChatApp: AppModule = { id: "agent", name: "AgentZero", line: "Ask AgentZero for a job or a payment.", Root: ChatRoot };
