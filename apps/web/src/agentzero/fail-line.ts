// Dead ends row 21 (3 Nov): every failed AgentZero turn read "AgentZero didn't answer. Nothing moved.", whatever the
// cause. Now the cause is named, by name, with the one thing to do, and "Nothing moved." stays: a chat turn never moves
// money by itself (a payment needs the person's tap on its sheet).
//
// It reads only an error's shape (the Anthropic SDK's errors carry `status`; a failed fetch or chunk load is a
// TypeError), so the SDK never loads to read its own failure.

import { isTimedOut, timedOutLine } from "@zerofee/agent/chat/wait";

export const NOTHING_MOVED = "Nothing moved.";
export const OFFLINE = "This phone can't reach Claude. Check it's online.";
export const KEY_REFUSED = "Claude didn't accept your key. Change it in Settings.";
export const NO_CREDIT = "Your Claude account has no credit left. Add some at Anthropic.";
export const BUSY = "Claude is busy. Try again in a minute.";
export const DOWN = "Claude is down right now. Try again soon.";
export const UNKNOWN = "AgentZero didn't answer. Try again.";

/** A turn that threw outside the stream, in one line. `online`: navigator.onLine where there is one. */
export function failLine(e: unknown, online: boolean | undefined = globalThis.navigator?.onLine): string {
  if (online === false) return withMoney(OFFLINE);
  // a wait of AgentZero's own that ran out (wait.ts): what didn't answer, by name
  if (isTimedOut(e)) return timedOutLine(e.service);
  const status = typeof (e as { status?: unknown } | null)?.status === "number" ? (e as { status: number }).status : null;
  const text = e instanceof Error ? `${e.name} ${e.message}` : String(e ?? "");
  if (status === 401 || status === 403) return withMoney(KEY_REFUSED);
  if (status === 402 || (status === 400 && /credit balance/i.test(text))) return withMoney(NO_CREDIT);
  if (status === 429) return withMoney(BUSY);
  if (status !== null && status >= 500) return withMoney(DOWN);
  if (/APIConnection|Failed to fetch|NetworkError|Load failed|dynamically imported module|network/i.test(text)) return withMoney(OFFLINE);
  return withMoney(UNKNOWN);
}

/** Every fault line says where the money is: "Nothing moved." once, never twice. */
export function withMoney(line: string): string {
  // a line that says where the money is already ("Nothing was paid."), or that is still waiting or paying, has none added
  return /nothing (moved|else ran|was sent|was paid)|isn't paid yet|hasn't answered yet/i.test(line) ? line : `${line.replace(/\s+$/, "")} ${NOTHING_MOVED}`;
}
