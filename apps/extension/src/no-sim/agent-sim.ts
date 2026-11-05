// The extension's stand-in for packages/agent/src/chat/sim.ts: the extension's AgentZero is never the Sim's (chatTurn's
// `sim` is never set there), so the Sim's route, its lines and its word swaps aren't in the extension at all.
export const SIM_REAL_LINE = "";
export const SIM_RESTED_LINE = "";
export const SIM_REST_CODES: readonly string[] = [];
export const SIM_PATH = "";
export const SIM_HISTORY = { max: 0, to: 0 } as const;
export const simReal = (_words: string): boolean => false;
export const SIM_VISITOR_CODE = "";
export const SIM_VISITOR_LINE = "";
export const simWords = (text: string): string => text;
