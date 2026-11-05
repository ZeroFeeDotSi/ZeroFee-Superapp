// What "Clear and start again" takes from this browser's localStorage (audit M5, 3 Nov): ZeroFee's keys on either
// network ("mainnet:" first on mainnet, mode.ts storeSlot), Trade's caches (zerofee-trade-*) and AgentZero's tasks; only
// the theme stays. The old rule matched "zf." and "zerofee." alone, so on mainnet every app's data stayed behind.
export const clearedOnStartAgain = (k: string) => k !== "zf.theme" && k !== "zf.theme.picked" && /^(mainnet:)?(zf|zerofee)[.:-]|^agentzero\./.test(k);
