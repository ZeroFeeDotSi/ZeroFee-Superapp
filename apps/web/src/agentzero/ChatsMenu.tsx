// AgentZero's menu, top left (product decision, 3 Nov): New chat, Jobs and limits (with what's happening now, its count: product decision, 3 Nov;
// QA 5 Nov: a second "Jobs" row opened Activity, the copywriter kept the one row),
// AgentZero's email (its address and mail's real state), and the saved chats like the Claude app's
// (newest first, titled by their first words; open one to carry on, delete one with its own button). The sample demo
// has no saved chats: its menu is New chat and Jobs and limits.
import type { ReactNode } from "react";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import type { ChatMeta } from "@zerofee/agent/chat/chats";

export interface ChatsSource {
  list: ChatMeta[];
  current: string;
  open: (id: string) => Promise<boolean> | void;
  remove: (id: string) => Promise<void> | void;
}

/** "9:41 AM" today, "Mon" this week, else "3 Nov". */
export function whenWords(atMs: number, nowMs: number = Date.now()): string {
  const at = new Date(atMs), now = new Date(nowMs);
  if (at.toDateString() === now.toDateString()) return at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (nowMs - atMs < 6 * 86_400_000) return at.toLocaleDateString("en-US", { weekday: "short" });
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** `onJobs`: Jobs and limits (`nowCount`: what is happening now, its count); `onMail`: AgentZero's email (`mail`: its address, or that there's none yet). */
export function ChatsMenu({ chats, onNew, onJobs, nowCount, onMail, mail, onClose }: { chats?: ChatsSource | undefined; onNew: () => void; onJobs: () => void; nowCount?: ReactNode; onMail?: () => void; mail?: ReactNode; onClose: () => void }) {
  const now = Date.now();
  return (
    <Sheet title="AgentZero" onClose={onClose}>
      <div className="azc-menu">
        <button className="azc-menu-row" onClick={() => (onNew(), onClose())}><span>New chat</span></button>
        <button className="azc-menu-row" onClick={() => (onJobs(), onClose())}><span>Jobs and limits</span>{nowCount}</button>
        {onMail && <button className="azc-menu-row azc-menu-row--two" onClick={() => (onClose(), onMail())}><span className="azc-menu-two"><span>AgentZero's email</span>{mail}</span></button>}
      </div>
      {chats && (
        <>
          <p className="zf-small azc-menu-head">Chats</p>
          {chats.list.length === 0 && <p className="zf-small azc-menu-none">Your chats show here.</p>}
          <ul className="azc-chats" aria-label="Chats">
            {chats.list.map((c) => (
              <li key={c.id} className={`azc-chat${c.id === chats.current ? " is-on" : ""}`}>
                <button className="azc-chat-open" onClick={() => void Promise.resolve(chats.open(c.id)).then(onClose)} aria-current={c.id === chats.current}>
                  <span className="azc-chat-title">{c.title}</span>
                  <span className="zf-small azc-chat-when">{whenWords(c.atMs, now)}</span>
                </button>
                <button className="azc-chat-del" onClick={() => void chats.remove(c.id)} aria-label={`Delete ${c.title}`}>Delete</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}
