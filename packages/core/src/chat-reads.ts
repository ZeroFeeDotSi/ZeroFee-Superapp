// What ZeroFee Chat reads from NEAR (J3 part 2): whether a key is still one of an account's own (a Chat name counts only
// while it is), a Sputnik DAO's roles (get_policy), a near.social profile, and the DAOs an account is in. Reads only,
// every one on two nodes at one final block (core/chain.ts). Wallet's ledger answers them for the app
// (ledger.accountKey, ledger.daoPolicy, ledger.nearProfile, ledger.daosOf); the sample demo's MockBridge reads real
// names the same way. Security review of the design (2 Nov): H1, M3, M5 below.
import type { Block, Chain, ChainKey, PastTx } from "./chain.ts";
import { isAccountId } from "./chat-near.ts";
import { keyHandle } from "./key-handle.ts";
import { readable } from "./signer.ts";

type Reads = Pick<Chain, "network" | "commonBlock" | "accessKey" | "view"> & Partial<Pick<Chain, "pastTransactions">>;

/** Which network a name lives on: `.testnet` names on the test network, every other on mainnet. */
export const networkOf = (accountId: string): "testnet" | "mainnet" => (accountId.endsWith(".testnet") ? "testnet" : "mainnet");

/** A key that speaks for the account in Chat (security review H1): full access, or the account's own device key: a
 *  function-call key to the account itself whose methods are exactly the contract's DEVICE_METHODS. Never a second device or a guardian (approve, decline…), the recovery key (start_recovery…) or an
 *  agent's key (agent_pay…): those are other people's keys, or narrower ones. */
export const speaksForAccount = (accountId: string, k: ChainKey | null): boolean =>
  !!k && (k.permission.kind === "full" || (k.permission.kind === "function-call" && k.permission.receiverId === accountId && DEVICE_METHOD_SETS.has([...k.permission.methods].sort().join(","))));

/** The device key's exact method lists, every release (contracts/account-policy/src/lib.rs DEVICE_METHODS, without and
 *  with modules). Exact, so a third-party contract's key that happens to name `execute` doesn't count (diff review L4). */
const DEVICE_METHODS_BASE = "execute,execute_many,run,cancel,set_protection,add_second_device,remove_key,set_recovery_key,cancel_recovery,upgrade";
const DEVICE_METHODS_MODULES = `${DEVICE_METHODS_BASE},legacy_setup,legacy_off,legacy_check_in,legacy_cancel_claim,agent_set,agent_set_budget,agent_add_order,agent_resume,agent_pause,agent_remove_order,agent_revoke,agent_renew_key,kids_set,kids_off`;
/** Release 10: the phone's key with Agent's four methods (set, budget, kill switch, refill). Agent's own key (agent_pay
 *  only) never matches. */
const DEVICE_METHODS_R10 = `${DEVICE_METHODS_BASE},agent_set,agent_set_budget,agent_revoke,agent_renew_key`;
const DEVICE_METHOD_SETS = new Set([DEVICE_METHODS_BASE, DEVICE_METHODS_MODULES, DEVICE_METHODS_R10].map((s) => s.split(",").sort().join(",")));

/** Is this key on the account now, as one that speaks for it? Throws when the nodes can't say. */
export async function keyOnAccount(chain: Reads, accountId: string, publicKey: string, block?: Block): Promise<boolean> {
  if (!isAccountId(accountId) || typeof publicKey !== "string" || publicKey.length > 3000) return false;
  let handle: string;
  try {
    handle = keyHandle(publicKey);
  } catch {
    return false;
  }
  return speaksForAccount(accountId, await chain.accessKey(accountId, handle, block ?? (await chain.commonBlock())));
}

/** A DAO's role, as Sputnik's get_policy says it: its name and its members. */
export interface DaoRole {
  name: string;
  members: string[];
}
const MAX_ROLES = 50;
const MAX_MEMBERS = 2000;
/** A role's name as Chat shows it (M5): plain letters, digits, spaces and . _ -, at most 24 characters. */
const ROLE_NAME = /^[A-Za-z0-9 _.-]{1,24}$/;

/** get_policy's answer, read defensively (M5): null when it isn't a Sputnik policy. Only Group roles name members;
 *  Everyone and token-weighted roles name no one. Over the caps, `capped`. */
export function readPolicy(raw: unknown): { roles: DaoRole[]; capped: boolean } | null {
  const roles = (raw as { roles?: unknown } | null)?.roles;
  if (!Array.isArray(roles)) return null;
  let capped = roles.length > MAX_ROLES;
  const out: DaoRole[] = [];
  for (const r of roles.slice(0, MAX_ROLES)) {
    const group = r?.kind && typeof r.kind === "object" && Array.isArray(r.kind.Group) ? (r.kind.Group as unknown[]) : null;
    if (!group) continue;
    const name = typeof r?.name === "string" && ROLE_NAME.test(r.name.trim()) ? r.name.trim() : "Member";
    if (group.length > MAX_MEMBERS) capped = true;
    out.push({ name, members: group.slice(0, MAX_MEMBERS).filter(isAccountId) });
  }
  return { roles: out, capped };
}

/** Sputnik's DAO factories: a DAO's account ends with one of these, and nothing else is taken for a DAO (M5: any
 *  contract can answer get_policy). */
export const DAO_SUFFIXES = [".sputnik-dao.near", ".sputnik-v2.testnet"];
export const isDaoName = (s: string): boolean => isAccountId(s) && DAO_SUFFIXES.some((x) => s.endsWith(x) && s.length > x.length);
export const FACTORY: Record<"mainnet" | "testnet", string> = { mainnet: "sputnik-dao.near", testnet: "sputnik-v2.testnet" };

/** The DAO's roles, or null when the account isn't a Sputnik DAO. Throws when the nodes can't say. */
export async function daoPolicy(chain: Reads, dao: string): Promise<{ roles: DaoRole[]; capped: boolean } | null> {
  if (!isDaoName(dao)) return null;
  return readPolicy(await chain.view(dao, "get_policy", {}, await chain.commonBlock()));
}

/** The roles that name this account. */
export const rolesOf = (roles: readonly DaoRole[], accountId: string): string[] => roles.filter((r) => r.members.includes(accountId)).map((r) => r.name);

/** A factory this small is read whole (testnet's has 59 DAOs); mainnet's 2,000+ are found from the account's history. */
const SCAN_ALL = 120;

/**
 * The DAOs whose get_policy names this account now: candidates from the factory's own list when it is small, from the
 * account's own transactions to a DAO (a vote, a proposal) otherwise, plus `opened` (rooms opened on this device);
 * each one's membership read from get_policy, 6 at a time. A DAO whose policy can't be read is left out this time.
 */
export async function daosOf(chain: Reads, accountId: string, opened: readonly string[] = []): Promise<{ dao: string; roles: string[] }[]> {
  if (!isAccountId(accountId)) return [];
  const block = await chain.commonBlock();
  const net = chain.network === "testnet" ? "testnet" : "mainnet";
  const candidates = new Set(opened.filter(isDaoName));
  // Mainnet's list (2,000+) is never downloaded just to be dropped (diff review M-A): its history is read instead.
  const listed = net === "testnet" ? await chain.view(FACTORY[net], "get_dao_list", {}, block).catch(() => null) : null;
  if (Array.isArray(listed) && listed.length <= SCAN_ALL) {
    for (const d of listed) if (typeof d === "string" && isDaoName(d)) candidates.add(d);
  } else if (chain.pastTransactions) {
    const past: PastTx[] = await chain.pastTransactions(accountId, 100).catch(() => []);
    for (const t of past) if (isDaoName(t.receiverId)) candidates.add(t.receiverId);
  }
  const all = [...candidates].slice(0, SCAN_ALL);
  const found: { dao: string; roles: string[] }[] = [];
  for (let i = 0; i < all.length; i += 6) {
    const part = await Promise.all(all.slice(i, i + 6).map(async (dao) => {
      const read = await chain.view(dao, "get_policy", {}, block).then(readPolicy, () => null);
      return read ? { dao, roles: rolesOf(read.roles, accountId) } : null;
    }));
    for (const x of part) if (x && x.roles.length > 0) found.push(x);
  }
  return found.sort((a, b) => a.dao.localeCompare(b.dao));
}

/** A near.social profile, as Chat shows it: a display name, only on the person's sheet, never in place of the account
 *  (M3). No picture: a picture host would be a new host on the phone's approved list (NF-12, a Security decision), and
 *  near.social's IPFS gateway answered 403 on 2 Nov; an https url of the profile's own choosing is never fetched. */
export interface NearProfile {
  name?: string;
}
export const SOCIAL: Record<"mainnet" | "testnet", string> = { mainnet: "social.near", testnet: "v1.social08.testnet" };
/** Check marks, look-alike dots and the shape of a NEAR name are never in a display name (M1, M3). */
const MARKS = /[✓✔☑✅✔︎]/gu;

/** A display name or nickname with no check marks and no control or direction characters, at most `max`. */
export function plainName(raw: string, max = 32): string {
  return readable(raw).replace(MARKS, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** near.social's `get` answer for one account, read defensively. */
export function readProfile(raw: unknown, accountId: string): NearProfile {
  if (JSON.stringify(raw ?? null).length > 16_384) return {};
  const p = (raw as Record<string, { profile?: Record<string, unknown> }> | null)?.[accountId]?.profile;
  if (!p || typeof p !== "object") return {};
  const out: NearProfile = {};
  if (typeof p.name === "string") {
    const name = plainName(p.name);
    // a display name shaped like a NEAR name would read as someone's account: left out
    if (name && !/[.․．。｡·•]\s*(near|testnet|tg)\b/iu.test(name) && !/\s(near|testnet|tg)$/i.test(name)) out.name = name;
  }
  return out;
}

export async function nearProfile(chain: Reads, accountId: string): Promise<NearProfile> {
  if (!isAccountId(accountId)) return {};
  const net = chain.network === "testnet" ? "testnet" : "mainnet";
  const raw = await chain.view(SOCIAL[net], "get", { keys: [`${accountId}/profile/name`] }, await chain.commonBlock());
  return readProfile(raw, accountId);
}
