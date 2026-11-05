// S-1, the Safe's guard (Layer 1, the phone): what's new on the account since it was last asked, in plain words, each told
// once, minus what this phone started itself. A new key on the account; a change waiting under the account's rules.
// Loaded only when the alerts are asked for (Home's first load stays lean). Pure: the core reads the chain, this decides.
import type { Chain, ChainKey, ChainPermission } from "./chain.ts";
import { codeOf } from "./chain.ts";
import { handleOf } from "./dev-signer.ts";
import { isAccountPolicy, isKnownRelease } from "./known-contracts.ts";
import { heldRequests } from "./held.ts";
import { AGENTZERO_WALLET } from "./agent-route.ts";
import { ownWalletWords } from "./own-wallet-words.ts";
import type { Vault } from "./vault.ts";

const MINE = "alerts-mine";
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
async function readJson<T>(vault: Vault, name: string, empty: T): Promise<T> {
  const raw = await vault.get(name);
  try {
    return raw ? { ...empty, ...JSON.parse(new TextDecoder().decode(raw)) } : empty;
  } catch {
    return empty;
  }
}

/** Remembers what this phone started (a waiting change's id, a key it added), at most the last 32 of each. */
export async function noteMine(vault: Vault, add: { held?: string; key?: string }): Promise<void> {
  const m = await readJson(vault, MINE, { held: [] as string[], keys: [] as string[] });
  if (add.held) m.held = [...m.held, add.held].slice(-32);
  if (add.key) m.keys = [...m.keys, handleOf(add.key)].slice(-32);
  await vault.put(MINE, enc(m));
}

/** The phone's own account: new keys and waiting changes since `seen`, minus this phone's own. */
export async function phoneGuard(o: { chain: Chain; vault: Vault; accountId: string; held: GuardHeld[]; seen: GuardSeen; when: (iso: string) => string; rules?: boolean }) {
  const block = await o.chain.commonBlock().catch(() => null);
  const [keys, agentView, mine] = await Promise.all([
    block ? o.chain.accessKeys(o.accountId, block).catch(() => null) : null,
    block ? o.chain.view(o.accountId, "agent", {}, block).catch(() => null) : null,
    readJson(o.vault, MINE, { held: [] as string[], keys: [] as string[] }),
  ]);
  return guardNews({ accountId: o.accountId, keys, held: o.held, seen: o.seen, mine, agentPerDayUsd: agentPerDayUsd(agentView), when: o.when, rules: o.rules === true });
}

/** A waiting request as the guard reads it (held.ts's HeldRequest has these). */
export interface GuardHeld {
  id: string;
  title: string;
  readyAtIso: string;
  kind?: string;
  release?: { shaHex: string | null; version: number | null };
}
export const UNKNOWN_CODE_TITLE = "Unknown code is waiting on your account";
/** An AllowRelease or Upgrade whose hash this device's own bundle doesn't list (isKnownRelease, compiled in). */
export const unknownCode = (h: GuardHeld): boolean => (h.kind === "AllowRelease" || h.kind === "Upgrade" || h.release !== undefined) && !isKnownRelease(h.release?.shaHex ?? null);

/** The second device: what waits or is added on each account it guards, told once; its own key is never news. */
export async function deviceGuard(o: { chain: Chain; vault: Vault; publicKey: string; accounts: string[] }): Promise<GuardAlert[]> {
  const SEEN = "second-device-guard-seen";
  const seen = await readJson<Record<string, GuardSeen>>(o.vault, SEEN, {});
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const block = await o.chain.commonBlock();
  const out: GuardAlert[] = [];
  for (const accountId of o.accounts) {
    const [held, keys, acct] = await Promise.all([heldRequests(o.chain, accountId).catch(() => null), o.chain.accessKeys(accountId, block).catch(() => null), o.chain.account(accountId, block).catch(() => null)]);
    if (!held) continue;
    const rules = isAccountPolicy(codeOf(acct), o.chain.network);
    const news = guardNews({ accountId, keys, held, seen: seen[accountId] ?? {}, mine: { keys: [handleOf(o.publicKey)], held: [] }, agentPerDayUsd: null, when, rules });
    for (const a of news.alerts) out.push({ ...a, id: `${accountId}:${a.id}`, title: a.red ? "A key on an account you guard can bypass its rules" : a.kind === "key" ? "A new key was added to an account you guard" : a.unknownCode ? "Unknown code is waiting on an account you guard" : "Something is waiting on an account you guard", body: `On ${accountId}: ${a.body}` });
    seen[accountId] = news.seen;
  }
  await o.vault.put(SEEN, enc(seen));
  return out;
}

export interface GuardAlert {
  kind: "key" | "held";
  id: string;
  title: string;
  body: string;
  /** New code whose hash this device doesn't know: the alert is red and says no (MUST 1). */
  unknownCode?: true;
  /** Red: a full-access key on an account with rules, which bypasses the contract entirely (audit, 5 Nov). */
  red?: true;
}

/** the audit (5 Nov): the words for a full-access key on an account with rules, here and on Security's Quantum-safe card. */
export const BYPASS_LINE = "This key can bypass your Safe's rules.";

/** A key on the account, in words: what it can do, never the key itself. */
export function keyWords(accountId: string, p: ChainPermission, agentPerDayUsd: number | null, wallet: boolean = AGENTZERO_WALLET): string {
  if (p.kind === "full") return "a new key that can do anything";
  if (p.receiverId !== accountId) return `a new key that can use ${p.receiverId.slice(0, 64)}`;
  // AgentZero spends only from its own wallet: the core never adds an agent_pay key to the Safe (agent-door.ts
  // SAFE_KEY_DOORS), so one that shows up is a real warning, said as one (copywriter, 5 Nov)
  if (p.methods.includes("agent_pay")) return ownWalletWords(wallet).keyAlert;
  if (p.methods.includes("execute")) return "a new phone key that can run your account";
  if (p.methods.includes("approve")) return "a new second device for your account";
  if (p.methods.length === 0) return "a new key that can call anything on your account";
  return "a new key that can use your account";
}

export interface GuardSeen {
  /** Key handles seen last time; absent until a round has read them (that round only learns). */
  keys?: string[];
  held?: string[];
}

/**
 * The news since `seen`: new keys (unless this phone added them: `mine.keys`) and new waiting changes (unless this phone
 * placed them: `mine.held`). `keys` null: NEAR's key list couldn't be read; the last seen list is kept.
 */
export function guardNews(o: {
  accountId: string;
  keys: ChainKey[] | null;
  held: GuardHeld[];
  seen: GuardSeen;
  mine: { keys: string[]; held: string[] };
  agentPerDayUsd: number | null;
  when: (iso: string) => string;
  /** The account contract is on the account: a full-access key there bypasses it. */
  rules?: boolean;
}): { alerts: GuardAlert[]; seen: GuardSeen } {
  const alerts: GuardAlert[] = [];
  let unknownFirst = 0;
  // the audit: a full-access key on an account with rules bypasses the contract entirely. Red, told once, even on the round that
  // only learns the key list and even if this phone added it (set-up never leaves one, so one there is always news).
  const bypass = (k: ChainKey) => o.rules === true && k.permission.kind === "full";
  for (const k of o.keys ?? []) {
    if (!bypass(k) || (o.seen.keys ?? []).includes(k.handle)) continue;
    alerts.push({ kind: "key", id: `key:${k.handle}`, title: "A key can bypass your Safe's rules", body: `${BYPASS_LINE} If it wasn't you, open ZeroFee now.`, red: true });
  }
  if (o.keys && Array.isArray(o.seen.keys)) {
    for (const k of o.keys) {
      if (bypass(k)) continue;
      if (o.seen.keys.includes(k.handle) || o.mine.keys.includes(k.handle)) continue;
      const words = keyWords(o.accountId, k.permission, o.agentPerDayUsd);
      alerts.push({ kind: "key", id: `key:${k.handle}`, title: "A new key was added to your account", body: `${words.charAt(0).toUpperCase()}${words.slice(1)} was added. If it wasn't you, open ZeroFee now.` });
    }
  }
  for (const h of o.held) {
    // MUST 1 (QA, 5 Nov, the thief): new code for the account whose hash this device's own bundle doesn't list
    // is said in red words, whoever placed it (a thief with the phone places it as "mine" too), never as an update.
    if (unknownCode(h)) {
      if ((o.seen.held ?? []).includes(h.id)) continue;
      // Always first, above every other alert.
      alerts.splice(unknownFirst++, 0, { kind: "held", id: `held:${h.id}`, unknownCode: true as const, title: UNKNOWN_CODE_TITLE, body: `Say no. Open ZeroFee and cancel it before ${o.when(h.readyAtIso)}.` });
      continue;
    }
    if ((o.seen.held ?? []).includes(h.id) || o.mine.held.includes(h.id)) continue;
    // A lock screen is read by whoever holds the phone: what it is, how much and to whom stay inside the app (audit 11).
    alerts.push({ kind: "held", id: `held:${h.id}`, title: "A payment or change is waiting on your account", body: `It can go ${o.when(h.readyAtIso)}. If it wasn't you, open ZeroFee and cancel it before then.` });
  }
  const keys = o.keys ? o.keys.map((k) => k.handle) : o.seen.keys;
  return { alerts, seen: { ...(keys ? { keys } : {}), held: o.held.map((h) => h.id) } };
}

/** AgentZero's day limit in dollars from the account's agent view (USDC's per_day), when it's set. */
export function agentPerDayUsd(view: unknown): number | null {
  const coins = (view as { budget?: { coins?: { coin?: string; per_day?: string }[] } } | null)?.budget?.coins;
  const usdc = coins?.find((c) => /17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1/.test(String(c.coin)));
  const n = usdc?.per_day ? Number(usdc.per_day) / 1e6 : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
