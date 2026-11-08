// On once the operator's Browser Use Cloud key is on the relay (D79). Off: nothing of AgentZero's browser shows. Its own file,
// so the Browser tab's first load carries only this constant (the bundler drops what it guards while it's false).
// Off unless a build sets VITE_AGENT_BROWSER=1 (QA, 3 Nov: the test iPhone walk build only; the public build never sets it).
// E2: the one flag, shared with the chat (shell-api agent-browser.ts).
export { AGENT_BROWSER } from "@zerofee/shell-api/agent-browser.ts";
/** The cloud browser's live-view origins (audit L30): the only pages LiveView's frame may show, from the build's
 *  VITE_AGENT_LIVE_ORIGINS (comma-separated https origins, set beside the relay's Browser Use key). None when unset. */
export const LIVE_ORIGINS: readonly string[] = String(import.meta.env?.VITE_AGENT_LIVE_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
