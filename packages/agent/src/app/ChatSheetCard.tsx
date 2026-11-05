// The chat's card for a ChatSheet (D122; UI's AgentZero chat): the core's own sheet for a job, a one-off payment (with
// its check and "Ask me first"), a job to stop, or an act (AGENT_ACT off: "AgentZero can't do this yet."). The person's
// own tap does the rest; nothing moves from the chat itself. The code lives in AgentApp.tsx, shared with AgentZeroAsk,
// Settings and the old tab (one engine per bridge). `bridge`: forApps(…, "agent").
export { ChatSheetCard } from "./AgentApp.tsx";
