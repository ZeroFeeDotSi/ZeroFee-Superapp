// AgentZero's browser, on or off for this build (audit 14 E2): ONE flag that the chat (whether it offers "browse" at all)
// and the Browser (whether it shows "Send AgentZero") both read, so the chat never offers a door the build has shut.
// Off unless a build sets VITE_AGENT_BROWSER=1 (QA, 3 Nov: the test iPhone walk build only; the public build never sets
// it). Off: nothing about a browser shows anywhere. Its own file, so the first load carries only this constant.
export const AGENT_BROWSER: boolean = import.meta.env?.VITE_AGENT_BROWSER === "1";

/** b18 (4b): is AgentZero's wallet on hand to pay for a browse step? Its chat screen hands it in while it is open
 *  (agent robot/relay-think.ts setBrowsePay). A run starts only then, so it is never stopped unpaid half way. */
let payer = false;
export const browsePayReady = (): boolean => payer;
export const setBrowsePayReady = (on: boolean): void => void (payer = on);
