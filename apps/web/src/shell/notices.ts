// The shell's notices, one at a time (NoticeBar.tsx draws the one picked): what one is, which shows, and in what order.
import type { ReactNode } from "react";

export interface NoticeItem {
  /** What it says and since when: × hides this key, and a notice that changes is a new key that shows again. */
  key: string;
  /** Higher shows first. */
  rank: number;
  /** The one line. */
  line: string;
  /** What a tap on the line opens: the rest of what it says, its links, its buttons. */
  more?: ReactNode;
  /** One button that stays on the line (AgentZero's Stop). */
  act?: { label: string; run: () => void };
  /** Said as an alert (a payment freeze, a service that stopped), else a status. */
  alert?: boolean;
  /** Never hidden: no ×, it stays until it is resolved (a move to a new device under way: a possible takeover). */
  pinned?: true;
  /** Shown only while one of these apps is on screen (the freeze: Home and Security, whose Devices it is about), never
   *  over every app. Absent: over any app. */
  apps?: readonly string[];
  /** Its × is kept across reloads (the freeze after a stopped move: closed once, it stays closed until it changes). */
  remember?: true;
}

/** Where a remembered × is kept (this device only; its keys carry what the line said, so a change shows again). */
export const NOTICE_HIDDEN_STORE = "zf.notice.hidden";

/** The remembered ×s; nothing when storage can't be read (a private window): the line simply shows again. */
export function loadHidden(given?: Pick<Storage, "getItem">): Set<string> {
  try {
    const store = given ?? globalThis.localStorage;
    const v: unknown = JSON.parse(store?.getItem(NOTICE_HIDDEN_STORE) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((k): k is string => typeof k === "string").slice(-50) : []);
  } catch {
    return new Set();
  }
}

export function rememberHidden(key: string, given?: Pick<Storage, "getItem" | "setItem">): void {
  try {
    const store = given ?? globalThis.localStorage;
    store?.setItem(NOTICE_HIDDEN_STORE, JSON.stringify([...loadHidden(store), key].slice(-50)));
  } catch { /* storage is full or blocked: the × still holds until a reload */ }
}

/** The one to show: the highest rank not hidden with × (a pinned one never is) and meant for the app on screen (`here`);
 *  ties go to the first given. */
export function pickNotice(items: readonly (NoticeItem | null | undefined | false)[], hidden: ReadonlySet<string>, here?: string): NoticeItem | null {
  let best: NoticeItem | null = null;
  for (const n of items) {
    if (!n || (n.apps && !(here && n.apps.includes(here)))) continue;
    if ((n.pinned || !hidden.has(n.key)) && (!best || n.rank > best.rank)) best = n;
  }
  return best;
}

/** Ranks: what protects the money first, then AgentZero acting, then a move that just went, then a service's state. */
export const RANK = { freeze: 40, agent: 30, went: 20, service: 10, back: 5 } as const;
