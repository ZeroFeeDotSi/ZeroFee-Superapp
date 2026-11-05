// Requests the account contract is holding (waiting, or for the second device), in the same plain words the approval
// sheet showed: decoded from what the contract itself holds, read on two nodes. The phone lists them, and the second
// device reads them here before it says yes, so neither has to trust the other's screen.
import { describeModuleCall, gatherModuleFacts, moduleChangeCall } from "./account-modules.ts";
import type { Block, Chain } from "./chain.ts";
import { gatherCoinFacts } from "./coins.ts";
import { unwrapExecute, unwrapExecuteMany } from "./dev-signer.ts";
import { gatherIntentsFacts } from "./intents.ts";
import { coinAmount, hasModules, knownRelease, ownAccountCall, releaseShaHex } from "./known-contracts.ts";
import { codeOf } from "./chain.ts";
import type { DecodedTx } from "./tx-decode.ts";
import { readable, type Details } from "./signer.ts";
import { availableYocto } from "./near-available.ts";
import { bandsCountFewCoins } from "./every-coin.ts";
import { Unnamed } from "./format.ts";
import { plainWords, plainWordsMany } from "./words.ts";
import type { WordsContext } from "./words.ts";

export interface HeldRequest {
  id: string;
  title: string;
  lines: string[];
  /** Long parts of its words (a rule's every coin), under a label; the Waiting screen shows them as a disclosure. */
  details?: Details[];
  readyAtIso: string;
  /** It still needs the second device's yes. */
  needsSecondDevice: boolean;
  /** It needed the second device's yes, and the device gave it (H43): both devices say so, never a silent change. */
  secondDeviceSaidYes?: true;
  /** Its wait is over and nothing else is missing: it can run. */
  ready: boolean;
  /** A change to the account's rules or keys (not a payment): it waits a change's wait, and the backup words can stop it. */
  change: boolean;
  /** The account contract's own name for it ("Spend", "SetProtection", "CancelRecovery", …). */
  kind: string;
  /** Something to fear: code ZeroFee doesn't know, say. The Waiting row and screen show it in red with these words. */
  warning?: string;
  /** The gas a yes that runs it needs (plain gas units): the steps' own, the chain's links, and the contract's own work. */
  yesGas: number;
  /** A key removal (RemoveKey): the key it removes, as the contract holds it (base64 of its borsh form). */
  removesKey?: string;
  /** A change to the rules that counts every coin (its first band lists wNEAR, H01): the change a Top up on older rules
   *  waits for. */
  countsEveryCoin?: true;
  /** An Upgrade or AllowRelease: the release it names, by its sha256 (hex, from the contract's base64 code_hash), so a
   *  second device can check it against its own known-contracts (QA, 5 Nov). Unreadable: "". */
  releaseSha256Hex?: string;
  /** An AllowRelease or Upgrade: the release it names (its sha256, hex), and that release's number in THIS device's own
   *  bundle (knownRelease), or null: unknown code, said in red and never as an update. */
  release?: { shaHex: string | null; version: number | null };
  /** A second device said yes to it (the contract's `approved`): a recovery's start keeps it (lib.rs start_recovery drops
   *  only what no second device approved). */
  coSigned?: true;
}
/** The sha256 (hex) an Upgrade or AllowRelease names, from the contract's base64 code_hash; "" when unreadable. */
export function releaseShaOf(change: any): string | undefined {
  const named = change?.Upgrade ?? change?.AllowRelease;
  if (!named) return undefined;
  try {
    const bin = atob(String(named.code_hash));
    return bin.length === 32 ? Array.from(bin, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("") : "";
  } catch {
    return "";
  }
}

const T = 1_000_000_000_000;
/** What the contract reserves for the check that follows a key it adds: a second device's and the words'
 *  (DEVICE_KEY_CHECK_GAS, lib.rs) and Agent's (AGENT_CALLBACK_GAS, agent.rs). Release 10 round 4c: 40 Tgas each (20
 *  before, 10 in release 8). release8.test.ts reads both from the contract's source. */
export const KEY_CHECK_GAS = 40 * T;
/** A yes, or the phone's own call, that adds a key and runs that check: 75 Tgas. The 5 Nov audit measured such a finish
 *  at 26.2-26.3 Tgas with 10 reserved, so ~16.3 of the contract's own work; with 40 reserved that is ~56.3, and 75 leaves
 *  at least 17 over it (the audit's bar: 14). Never more than 75: four second devices refill in one transaction (4 x 75 = 300). */
const KEY_ADD_GAS = 75 * T;
/** The gas a yes (approve) carries for each held kind, and the phone's own call that finishes one at once (the first
 *  backup words, a refilled or first-day second device, a first-day Agent): one table. `finishTgas` is what the finish
 *  costs: the contract's work, the fees it prepays for the receipts it makes, and the gas it attaches to them (its
 *  reserves). Every gas is that plus at least 14 Tgas (held.test.ts, the audit's bar). A payment's steps and a chain's links
 *  come on top (yesGasFor). */
export const YES_GAS: Record<string, { gas: number; finishTgas: number }> = {
  // finish (lib.rs), set_protection's change: state only, no reserve. Measured 3.5 Tgas of the contract's own work on the
  // pinned sandbox (release 6); a full queue (64 KB waiting) adds ~4.4 to load and store: in the margin (21.5).
  SetProtection: { gas: 25 * T, finishTgas: 3.5 },
  // finish (lib.rs), AllowRelease: the release list, state only, no reserve. Margin 21.5.
  AllowRelease: { gas: 25 * T, finishTgas: 3.5 },
  // finish_agent_change (agent.rs), AgentSetBudget: Agent's state only, no key add, no reserve. Margin 21.5.
  AgentSetBudget: { gas: 25 * T, finishTgas: 3.5 },
  // finish (lib.rs), CancelRecovery: end_recovery, state only, no reserve. Margin 21.5.
  CancelRecovery: { gas: 25 * T, finishTgas: 3.5 },
  // finish (lib.rs), RemoveKey: state, plus one DeleteKey receipt (delete_key; no callback, no reserve; its fees well
  // under 1 Tgas). Not measured alone. Margin 21.
  RemoveKey: { gas: 25 * T, finishTgas: 4 },
  // finish (lib.rs), Spend: group_promise; its steps' own gas comes on top (yesGasFor). Measured: a transfer ran whole at
  // 5 Tgas (release 6). Margin 20.
  Spend: { gas: 25 * T, finishTgas: 5 },
  // finish (lib.rs), SpendMany: dispatch_chain; its steps' gas and CHAIN_LINK_GAS (20 Tgas, on_group_done) per group come
  // on top (yesGasFor). Margin 20.
  SpendMany: { gas: 25 * T, finishTgas: 5 },
  // finish (lib.rs), AddSecondDevice: add_function_call_key, then on_second_device_key with DEVICE_KEY_CHECK_GAS (40 Tgas
  // reserved). Own work 16.2 (26.2 measured with 10 reserved, the 5 Nov audit) + 40. Margin 18.8.
  AddSecondDevice: { gas: KEY_ADD_GAS, finishTgas: 56.2 },
  // finish (lib.rs), SetRecoveryKey: the old words' delete_key, add_function_call_key, then on_recovery_words_key with
  // DEVICE_KEY_CHECK_GAS (40 Tgas reserved). Own work 16.3 (26.3 measured with 10 reserved) + 40. Margin 18.7.
  // 15 failed every laptop yes with GasExceeded.
  SetRecoveryKey: { gas: KEY_ADD_GAS, finishTgas: 56.3 },
  // finish_agent_change (agent.rs), AgentSet: add_function_call_key, then on_agent_key with AGENT_CALLBACK_GAS (40 Tgas
  // reserved), and Agent's state: as SetRecoveryKey plus ~1.5 of state (18) + 40. Not measured: bounded. Margin 17.
  AgentSet: { gas: KEY_ADD_GAS, finishTgas: 58 },
  // finish (lib.rs), Upgrade: use_global_contract + upgrade_check attached at UPGRADE_CHECK_GAS (50 Tgas, fixed), the
  // switch, ~3 of receipt fees and the yes's own work on a full queue (~8): bounded at 60. Measured (release 10 round 4c,
  // 13 key renewals, near-sandbox 2.13.4): the yes 4.7 Tgas burnt, upgrade_check 8.6 of its 50, 17.7 in all, with this
  // row's 80 prepaid. Margin 20 over the bound.
  Upgrade: { gas: 80 * T, finishTgas: 60 },
};
/** Any other kind (none in release 10 runs: the contract refuses it): state only, as SetProtection. */
const YES_GAS_ELSE = YES_GAS.SetProtection!;
/** The contract's CHAIN_LINK_GAS: what it attaches to each link of an execute_many chain, from the yes's own gas. */
const CHAIN_LINK_GAS = 20 * T;
/** NEAR's most gas for one transaction. */
export const MAX_TX_GAS = 300 * T;
/** The gas the phone's own call carries when it may finish that kind at once (set_recovery_key, add_second_device,
 *  agent_set): the same finish as a yes, so the same row. */
export const ownCallGas = (kind: "SetRecoveryKey" | "AddSecondDevice" | "AgentSet"): bigint => BigInt(YES_GAS[kind]!.gas);
/** The gas the phone's own key-adding calls carry by method (demo-core's KEY_CALL_GAS): the key-add row. */
export const KEY_CALL_GAS = BigInt(KEY_ADD_GAS);
type RawStep = { FunctionCall?: { gas?: string | number } } | { Transfer?: unknown };
const stepsGas = (steps: unknown): number => (Array.isArray(steps) ? steps : []).reduce((a: number, st: RawStep) => a + Number((st as { FunctionCall?: { gas?: string | number } }).FunctionCall?.gas ?? 0), 0);
/** The gas a second device's yes needs to run a held request: its kind's row in YES_GAS; a payment, its steps' gas too;
 *  a chain, each group's steps and a link for each group (the contract's dispatch), capped at a transaction's 300 Tgas. */
export function yesGasFor(change: any): number {
  const kind = typeof change === "string" ? change : Object.keys(change ?? {})[0] ?? "";
  let gas = (YES_GAS[kind] ?? YES_GAS_ELSE).gas;
  if (change?.Spend) gas += stepsGas(change.Spend.steps);
  else if (change?.SpendMany) {
    const groups: { steps?: unknown }[] = Array.isArray(change.SpendMany.groups) ? change.SpendMany.groups : [];
    gas += groups.reduce((a, g) => a + stepsGas(g.steps), 0) + CHAIN_LINK_GAS * groups.length;
  }
  return Math.min(gas, MAX_TX_GAS);
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Why a child's rules held a request (the contract's kids_why), in words. */
export function kidsReasonWords(reason: string): string {
  if (reason.startsWith("not-allowed:")) return `Not on the allowed list: ${reason.slice("not-allowed:".length)}`;
  const week = /^over-week:(.+):(\d+)$/.exec(reason);
  if (week) { const limit = coinAmount(week[1], week[2]); return limit === "a limit in another coin" ? "Over this week's limit for that coin" : `Over this week's ${limit}`; }
  if (reason === "log-full") return "Too many payments this week to count, so the parent is asked";
  return "ZeroFee can't measure this one, so the parent is asked";
}

/** The words-only fallback (`fallback_seconds`), never under a change's floor (the delay plus the lesser of it and a
 *  day), in nanoseconds: how long after asking the phone alone may put a release on the account's list (release 9). */
export async function listingWait(chain: Chain, accountId: string, block: Block): Promise<bigint> {
  const [fallback, delay] = await Promise.all([chain.view(accountId, "fallback_seconds", {}, block), chain.view(accountId, "delay_seconds", {}, block)]);
  const d = /^\d+$/.test(String(delay)) ? BigInt(String(delay)) : 0n;
  const f = /^\d+$/.test(String(fallback)) ? BigInt(String(fallback)) : 0n;
  const floor = d + (d < 86_400n ? d : 86_400n);
  return (f > floor ? f : floor) * 1_000_000_000n;
}

/** Every second device on the account is on it for the words-only fallback wait (the contract's second_device_yes_from:
 *  0 for each). No such view (release 9), no devices, or an unreadable answer: false. */
export async function allFallbackAged(chain: Chain, accountId: string, block: Block): Promise<boolean> {
  const view = await chain.view(accountId, "second_device_yes_from", {}, block).catch(() => null);
  return Array.isArray(view) && view.length > 0 && view.every((d) => Array.isArray(d) && String(d[1]) === "0");
}

/** When the contract really runs a waiting AllowRelease (lib.rs finish), in ns: never before its own `ready_at_ns` (its
 *  level's wait), and, unless a yes that counts (R9-AL1), never before `asked_at_ns` plus the listing's wait
 *  (`listingWait`: the fallback, never under the floor). The ONE rule, for account.waiting (here) and account.rules
 *  (demo-core rulesInfo), so the two never say different times (QA, 5 Nov: 8 days said for a 21-day wait).
 *  Not an AllowRelease, or unreadable: null. */
export function listingRunsAtNs(w: any, listingWaitNs: bigint, yesCounts: boolean): bigint | null {
  const l = w?.change?.AllowRelease;
  if (!l || !/^\d+$/.test(String(w.ready_at_ns))) return null;
  const level = BigInt(String(w.ready_at_ns));
  const alone = !yesCounts && /^\d+$/.test(String(l.asked_at_ns)) ? BigInt(String(l.asked_at_ns)) + listingWaitNs : 0n;
  return alone > level ? alone : level;
}

/** account.rules.update's answer, said as the contract runs it. The contract answers the switch it just placed with its
 *  level's time only (`ready_at_ns` = the ask + `levelSeconds`), but the switch runs no sooner than its listing (lib.rs
 *  finish refuses a release not yet on the list). Listing placed in the same transaction (`listedNow`): same block, so
 *  its run is the ask + `listSeconds`. A listing already waiting: its own runs-at (`listingReadyIso`). Otherwise the
 *  contract's own time, unchanged. */
export function updateRunsAtIso(switchReadyIso: string, w: { levelSeconds: number; listSeconds: number; listedNow: boolean; listingReadyIso?: string }): string {
  const own = Date.parse(switchReadyIso);
  if (!Number.isFinite(own)) return switchReadyIso;
  const behind = w.listedNow ? own - w.levelSeconds * 1000 + w.listSeconds * 1000 : w.listingReadyIso ? Date.parse(w.listingReadyIso) : NaN;
  return Number.isFinite(behind) && behind > own ? new Date(behind).toISOString() : switchReadyIso;
}

/** `nearUsd`: NEAR in dollars for the words only; a promise is awaited beside the reads (speed, 2 Nov), never before them. */
export async function heldRequests(chain: Chain, accountId: string, price: number | null | Promise<number | null> = null): Promise<HeldRequest[]> {
  const block = await chain.commonBlock();
  const [list, acct, nearUsd] = await Promise.all([chain.view(accountId, "waiting_requests", {}, block), chain.account(accountId, block), Promise.resolve(price).catch(() => null)]);
  // On a child's account (v4), why its rules held each request: it leads the words.
  const why = new Map<string, string>();
  if (hasModules(codeOf(acct), true, chain.network)) {
    for (const [id, reason] of ((await chain.view(accountId, "kids_why", {}, block)) as [string, string][] | null) ?? []) why.set(String(id), kidsReasonWords(String(reason)));
  }
  const self = (actions: DecodedTx["actions"]): DecodedTx => ({ signerId: accountId, publicKey: { type: "ml-dsa-65", text: "", handle: "" }, nonce: 0n, receiverId: accountId, blockHash: "", actions });
  const base = { network: chain.network, balanceYocto: acct?.balanceYocto ?? 0n, availableYocto: availableYocto(acct), gasPriceYocto: 0n, knownRecipients: new Set<string>(), nearUsd };
  /** The facts the sheet read for these steps (never 1Click: a held partner payment is refused before it's held). */
  const context = async (tx: DecodedTx): Promise<WordsContext> => {
    const [intents, coins, modules] = await Promise.all([
      gatherIntentsFacts(tx, chain, block, async () => null),
      gatherCoinFacts(tx, chain, block),
      gatherModuleFacts(tx, chain, block),
    ]);
    return { ...base, intents, coins, modules };
  };
  const now = Date.now();
  // Release 9: the phone alone lists a release no sooner than the words-only fallback after asking (never under a change's
  // floor), whatever its level's wait says; the contract refuses it before that, so it is never said ready before.
  // R9-AL1 (QA, 5 Nov): a yes makes a listing sooner than the fallback only from a second device on the
  // account for the FALLBACK wait (the contract's approver_on_for_fallback), not merely one of age. The approver isn't
  // in waiting_requests, so a yes counts only when EVERY second device is fallback-aged by the contract's own
  // second_device_yes_from (release 10); without that view (release 9), never: the time said is the fallback's.
  const approvedListing = ((list as any[]) ?? []).some((w) => w?.change?.AllowRelease && w.approved === true);
  const fallbackAged = approvedListing ? await allFallbackAged(chain, accountId, block) : false;
  const yesCounts = (w: any) => w.approved === true && fallbackAged;
  const listingWaitNs = ((list as any[]) ?? []).some((w) => w?.change?.AllowRelease && !yesCounts(w)) ? await listingWait(chain, accountId, block) : 0n;
  // Each waiting listing's own ready time, by the hash it lists, for the Upgrade that waits behind it.
  const listingReadyMs = new Map<string, number>();
  for (const w of ((list as any[]) ?? [])) {
    const at = listingRunsAtNs(w, listingWaitNs, yesCounts(w));
    if (at !== null) listingReadyMs.set(String(w.change.AllowRelease.code_hash), Number(at / 1_000_000n));
  }
  const out: HeldRequest[] = [];
  for (const w of ((list as any[]) ?? [])) {
    let readyAtMs = Number((listingRunsAtNs(w, listingWaitNs, yesCounts(w)) ?? BigInt(w.ready_at_ns)) / 1_000_000n);
    // An Upgrade behind its listing (an AllowRelease of the same hash still waiting) runs no sooner than that listing: the
    // contract's finish refuses a release not yet on the account's list (release 9's waiting_requests says only its own
    // level's time; release 10's says this itself, runs_at). One tap places both (account.rules.update).
    const behind = w?.change?.Upgrade ? listingReadyMs.get(String(w.change.Upgrade.code_hash)) : undefined;
    if (behind !== undefined && behind > readyAtMs) readyAtMs = behind;
    const needsSecondDevice = w.needs_device === true && w.approved !== true;
    let words: { title: string; lines: string[]; warnings?: { text: string }[]; details?: Details[] } = { title: "A change to your account", lines: [] };
    const change = w.change ?? {};
    if (change.Spend) {
      const inner = unwrapExecute(self([{ kind: "call", method: "execute", args: utf8(JSON.stringify(change.Spend)), gas: 0n, depositYocto: 0n }]));
      if (inner) {
        const pw = plainWords(inner, await context(inner));
        // What it pays, in dollars too (grade 02g, G11): first, on the Waiting screen and its Cancel and Send sheets. Its
        // disclosure (a coin it can't name: the id and exact amount) stays with it, on every screen that shows it.
        words = { title: pw.title, lines: [...(pw.amount ? [`Amount: ${pw.amount}`] : []), ...pw.lines.slice(0, -1)], ...(pw.details ? { details: pw.details } : {}) };
      }
    } else if (change.SpendMany) {
      // A chain: each group in its own words, in order.
      const outer = self([{ kind: "call", method: "execute_many", args: utf8(JSON.stringify(change.SpendMany)), gas: 0n, depositYocto: 0n }]);
      const groups = unwrapExecuteMany(outer);
      if (groups) {
        const pw = plainWordsMany(await Promise.all(groups.map(async (tx) => ({ tx, ctx: await context(tx) }))), outer, base);
        words = { title: pw.title, lines: [...(pw.amount ? [`Amount: ${pw.amount}`] : []), ...pw.lines.slice(0, -1)], ...(pw.details ? { details: pw.details } : {}) };
      }
    } else if (moduleChangeCall(change)) {
      const { method, args } = moduleChangeCall(change)!;
      const action = { kind: "call" as const, method, args: utf8(JSON.stringify(args)), gas: 0n, depositYocto: 0n };
      const facts = await gatherModuleFacts(self([action]), chain, block);
      const unnamed = new Unnamed();
      const d = describeModuleCall(action, self([]), { ...facts, account: true }, unnamed);
      if (d) words = unnamed.withDetails({ title: d.title, lines: d.lines.filter((l) => l !== d.title), ...(d.details ? { details: d.details } : {}) });
    } else if (change === "CancelRecovery" || change.CancelRecovery !== undefined) {
      // The phone's stop of a recovery (release 6): it waits a day, and a second device may let it go now or refuse it.
      words = {
        title: "Stop a move to a new device",
        lines: ["Your backup words started moving this account to a new device. The account's phone asked to stop it."],
      };
    } else if (change.AllowRelease) {
      // Release 9: the release goes on the account's list first; it runs with the second device's yes, or after the
      // backup words' fallback wait. The same known-or-unknown check as an upgrade's.
      const u = ownAccountCall("upgrade", change.AllowRelease)!;
      words = u.warnings ? u : { title: "Let your account's rules update", lines: [u.lines[0]!, "It needs your second device's yes, or the backup words' longer wait. Then the update itself can run."] };
    } else {
      const [kind, args] = Object.entries(change)[0] ?? [];
      const method = { SetProtection: "set_protection", AddSecondDevice: "add_second_device", RemoveKey: "remove_key", SetRecoveryKey: "set_recovery_key", Upgrade: "upgrade" }[String(kind)];
      const known = method ? ownAccountCall(method, args, nearUsd) : null;
      if (known) words = known;
    }
    const reason = why.get(String(w.id));
    if (reason) words = { ...words, lines: [reason, ...words.lines] };
    const isPayment = Boolean(change.Spend || change.SpendMany);
    const kindName = typeof change === "string" ? change : Object.keys(change)[0] ?? "";
    const warning = words.warnings?.[0]?.text !== undefined ? readable(words.warnings[0].text) : undefined;
    // Cleaned as every sheet is (readable: no direction marks or hidden characters), on the Waiting screen and the laptop too.
    out.push({
      id: String(w.id),
      title: readable(words.title),
      lines: words.lines.map(readable),
      ...(words.details?.length ? { details: words.details.map((d) => ({ label: readable(d.label), lines: d.lines.map(readable) })) } : {}),
      readyAtIso: new Date(readyAtMs).toISOString(),
      needsSecondDevice,
      ...(w.needs_device === true && w.approved === true ? { secondDeviceSaidYes: true as const } : {}),
      ready: now >= readyAtMs && !needsSecondDevice,
      change: !isPayment,
      kind: kindName,
      ...(warning ? { warning } : {}),
      yesGas: yesGasFor(change),
      ...(typeof change.RemoveKey?.public_key === "string" ? { removesKey: change.RemoveKey.public_key } : {}),
      ...(change.SetProtection && !bandsCountFewCoins(change.SetProtection.bands) ? { countsEveryCoin: true as const } : {}),
      ...(releaseShaOf(change) !== undefined ? { releaseSha256Hex: releaseShaOf(change)! } : {}),
      ...(change.AllowRelease || change.Upgrade ? { release: { shaHex: releaseShaHex((change.AllowRelease ?? change.Upgrade).code_hash), version: knownRelease((change.AllowRelease ?? change.Upgrade).code_hash) } } : {}),
      ...(w.approved === true ? { coSigned: true as const } : {}),
    });
  }
  // MUST 1 (QA, 5 Nov): new code this device's bundle doesn't know is always first, above any other warning.
  return [...out.filter(unknownRelease), ...out.filter((h) => !unknownRelease(h))];
}

/** A waiting AllowRelease or Upgrade whose hash this device's own bundle doesn't list. */
export const unknownRelease = (h: HeldRequest): boolean => h.release !== undefined && h.release.version === null;
