// The Browser app's own bridge for AgentZero's live card (useLiveSession: PartnerBridge answers only Browser). App.tsx
// leaves a getter for it on start; the chat reads it when a card appears. Never an import of the shell's core from the
// lazy chat (that split the core into a chunk of its own and grew Home's first load by 3.9 KB, measured 3 Nov).
import type { Bridge } from "@zerofee/core/bridge";

export const browserBridge = (): Bridge | null => (globalThis as { zfBrowserBridge?: () => Bridge }).zfBrowserBridge?.() ?? null;
