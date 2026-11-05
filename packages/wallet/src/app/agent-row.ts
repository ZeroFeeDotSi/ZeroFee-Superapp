// AgentZero's own wallet as a row of Home's NEAR wallet ("AgentZero", as a site's wallet is a row of its chain's) and a
// part of Home's total (QA 5 Nov: after a $1.99 fill Home's total fell $21.01 → $18.93, the money counted
// nowhere). From the core's account.agent.balance, joined to Spending's wallets: Home's reads (home-reads.ts, its first
// ask in home-cache.ts askParts) and readBalanceParts. Never in Home's first load (speed budget).
import type { SpendingWallet } from "@zerofee/core/spending";

/** The core's answers that mean "no AgentZero wallet to read here", never "can't read it now". */
const NO_AGENT = new Set(["security.bridge.not-allowed", "security.web.no-safe", "security.request.not-allowed", "security.subwallet.refused", "security.method.unknown", "mock.unknown"]);

/** AgentZero's row, from the core's account.agent.balance answer: null when there is no AgentZero wallet here (a null
 *  answer, or a refusal: an app or a build that may not ask), "can't be read" when NEAR didn't answer (never $0). */
export function agentRow(r: unknown): SpendingWallet | null {
  const row = { id: "agentzero", role: "agent" as const, network: "near" as const, address: "", label: "AgentZero", current: true, inCap: false, keyExported: false };
  const a = r as { ok?: { usdcMicros?: unknown } | null; problem?: { code?: unknown } | null } | null;
  if (a && "ok" in a) {
    if (!a.ok) return null;
    const m = typeof a.ok.usdcMicros === "string" && /^\d{1,30}$/.test(a.ok.usdcMicros) ? a.ok.usdcMicros : null;
    return m === null ? { ...row, unread: true } : { ...row, cashUsd: (Number(m) / 1e6).toFixed(2), coinsUsd: "0.00" };
  }
  return NO_AGENT.has(String(a?.problem?.code ?? "")) ? null : { ...row, unread: true };
}

/** Spending's wallets with AgentZero's row after them (an unread Spending answer stays as it is; AgentZero's read
 *  failing is a row that can't be read, never Spending's list lost). */
export function joinAgent<W>(wallets: Promise<W>, agent: Promise<unknown>): Promise<W> {
  return Promise.all([wallets, agent.catch(() => null)]).then(([w, a]) => {
    const row = agentRow(a);
    const list = (w as { ok?: unknown } | null)?.ok;
    return Array.isArray(list) && row ? ({ ...w, ok: [...list, row] } as W) : w;
  });
}

/** Both asked now, together, then joined. */
export const walletsWithAgent = <W>(call: (m: string) => Promise<unknown>): Promise<W> => joinAgent(call("spending.wallets") as Promise<W>, call("account.agent.balance"));
