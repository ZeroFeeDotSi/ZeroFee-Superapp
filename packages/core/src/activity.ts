// The account's own history, in plain words: what it signed, when, and with which key.
//
// This is the security log: it shows every transaction the account signed, including ones from another phone or from
// the backup words ("Started moving the account to a new device — by your backup words"). It comes from an index, so it
// is for reading only; nothing here is ever used to decide what to sign.
import { keyHandle } from "./key-handle.ts";
import { toBase58 } from "@fastnear/utils";
import type { ChainKey, PastAction, PastTx } from "./chain.ts";
import { explorerUrl } from "./chain.ts";
import { ACCOUNT_POLICY, RECOVERY_POLICY, policyVersion } from "./known-contracts.ts";
import type { Network } from "./signer.ts";
import { formatNear, sentToOf } from "./words.ts";
import { coinShort } from "./coin-short.ts";
import { unwrapExecute } from "./dev-signer.ts";
import type { DecodedTx } from "./tx-decode.ts";

export interface ActivityItem {
  atIso: string;
  /** e.g. "Sent 0.01 NEAR to bob.testnet" */
  title: string;
  /** Every step, when there is more than one. */
  lines: string[];
  /** Which key signed: "This phone" (the screen says this device's own name), "Your backup words", "Another device", … */
  by: string;
  /** False if it didn't go through (only the fee was used). Judged by its main outcome (chain.ts pastOutcome). */
  ok: boolean;
  /** It went through, but a later step it caused didn't. */
  partly?: true;
  txHash: string;
  explorerUrl: string;
  /** A send of NEAR to one other account, straight or through the account's rules: who and how much (decimal NEAR), so
   *  Wallet's Activity and Send's recent people are built from this same record (grade 02f, item 4). */
  sent?: { to: string; near: string };
}

/** The one NEAR transfer a transaction made to another account, if that is all it did. */
export function sentOf(tx: PastTx): ActivityItem["sent"] {
  if (tx.actions.length !== 1) return undefined;
  let a = tx.actions[0], to = tx.receiverId;
  if (a.kind === "call" && a.method === "execute" && tx.receiverId === tx.signerId) {
    const inner = unwrapExecute({ ...tx, actions: [a] } as unknown as DecodedTx);
    if (!inner || inner.actions.length !== 1) return undefined;
    a = inner.actions[0] as PastAction;
    to = inner.receiverId;
  }
  return a.kind === "transfer" && to !== tx.signerId && a.yocto > 0n ? { to, near: formatNear(a.yocto).replace(/,/g, "") } : undefined;
}

/**
 * Everyone a past transaction sent money to, NEAR or any coin (words.ts sentToOf), straight or through the account's
 * rules: the past-sends list the first-time warning reads (security review 2 Nov: a coin send was never "sent before").
 * No quote or own-wallet facts here: a 1Click deposit address counts too, and only ever quiets a warning for itself.
 */
export function recipientsOf(tx: PastTx): string[] {
  let actions: readonly PastAction[] = tx.actions, to = tx.receiverId;
  if (actions.length === 1 && actions[0].kind === "call" && actions[0].method === "execute" && tx.receiverId === tx.signerId) {
    const inner = unwrapExecute({ ...tx, actions } as unknown as DecodedTx);
    if (!inner) return [];
    actions = inner.actions as PastAction[];
    to = inner.receiverId;
  }
  return [...new Set(actions.map((a) => sentToOf(a, { signerId: tx.signerId, receiverId: to })).filter((x): x is string => x !== null))];
}

const handleOf = keyHandle;

/** NEAR's own coin and service contracts, by the names a person knows (mainnet rehearsal, 3 Nov: "Used
 *  aaaaaa20…factory.bridge.near, paying 0.000000000000000000000001 NEAR" on a row). */
const NAMED: Record<string, string> = {
  "wrap.near": "wrapped NEAR",
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": "USDC",
  "usdt.tether-token.near": "USDT",
};
/** An account or contract on a row, in a person's words: a known coin by its name, a bridged coin as one, NEAR Intents
 *  as the Safe it is, a NEAR account with no name as one, a named account by its name. The explorer link has the id. */
export function nameOf(id: string): string {
  if (NAMED[id]) return NAMED[id]!;
  if (id === "intents.near") return "your Safe";
  if (/\.(omft|bridge)\.near$/.test(id)) return "a bridged coin";
  if (/^[0-9a-f]{64}$/.test(id)) return "a NEAR account";
  return id;
}
/** NEAR on a row: at most 4 places (rounded up: what was paid is never said as less). */
const nearShort = (yocto: bigint) => `${coinShort(yocto, 24, "up").text} NEAR`;
/** A coin contract's own steps, by what they do (never a method's name). */
const COIN_STEP: Record<string, (coin: string) => string> = {
  ft_transfer: (c) => `Moved ${c}`,
  ft_transfer_call: (c) => `Moved ${c}`,
  storage_deposit: (c) => `Set up ${c} on your account`,
  near_deposit: () => "Turned NEAR into wNEAR",
  near_withdraw: () => "Turned wNEAR back into NEAR",
};

/** The account contract's own methods, in plain words (release 9's device, second-device and recovery-key methods). */
const OWN: Record<string, string> = {
  new: "Turned on the recovery rules",
  start_recovery: "Started moving the account to a new device",
  finish_recovery: "Moved the account to a new device",
  cancel_recovery: "Stopped a move to a new device",
  // done at once; one the account saved to wait reads SAVED below until it is finished (UX walk 2 Nov)
  set_protection: "Changed your protection",
  execute: "Sent through your account's rules",
  execute_many: "Sent through your account's rules",
  run: "Finished a change that waited",
  cancel: "Cancelled a waiting change",
  add_second_device: "Added a second device",
  remove_key: "Removed a key",
  set_recovery_key: "Set your backup words",
  upgrade: "Updated your account's rules",
  approve: "Said yes to a waiting change",
  decline: "Said no to a waiting change",
  approve_recovery: "Said yes to a move to a new device",
  refuse_recovery: "Refused a move to a new device",
  refill_recovery_key: "Refilled your backup words' network fees",
  agent_pay: "Paid by AgentZero",
  agent_convert: "Converted by AgentZero",
  run_order: "Ran a standing order",
};

/** The account contract's own changes that can be saved to wait instead of done now (its `place`): what the row says
 *  while it is saved, before it is finished (UX walk 2 Nov: "Changed your protection" read as done while it waited). */
const SAVED: Record<string, string> = {
  set_protection: "Saved a change to your protection",
  add_second_device: "Saved adding a second device",
  remove_key: "Saved removing a key",
  set_recovery_key: "Saved new backup words",
  upgrade: "Saved an update to your account's rules",
};

function isRecoveryKey(k: ChainKey | undefined, accountId: string): boolean {
  const p = k?.permission;
  return p?.kind === "function-call" && p.receiverId === accountId && p.methods.join() === RECOVERY_POLICY.recoveryKeyMethods.join();
}

/**
 * One step in a person's words: a key is named by what it is (this phone's, your backup words, the setup key), never by
 * its id; the explorer link has the rest. `mine`: this device's key handle.
 */
function step(a: PastAction, tx: PastTx, mine: string, waiting?: ReadonlySet<string>, network?: Network): string {
  const self = tx.receiverId === tx.signerId;
  switch (a.kind) {
    case "transfer":
      return `Sent ${nearShort(a.yocto)} to ${nameOf(tx.receiverId)}`;
    case "call": {
      if (self) {
        // A Send through the account's rules says what it sent, in Wallet Activity's word (grade 01d Q1).
        const inner = a.method === "execute" ? unwrapExecute({ ...tx, actions: [a] } as unknown as DecodedTx) : null;
        if (inner?.actions.length === 1) return step(inner.actions[0] as PastAction, { ...tx, receiverId: inner.receiverId }, mine, undefined, network);
        // Saved to wait, not done: "…, waiting" while the account still holds it; once it doesn't, its own later row
        // says how it ended ("Finished a change that waited", or "Cancelled a waiting change").
        if (tx.held && tx.actions.length === 1 && SAVED[a.method]) return `${SAVED[a.method]}${waiting?.has(tx.held) ? ", waiting" : ""}`;
        if (OWN[a.method]) return OWN[a.method];
      }
      // Never a method's own name on screen (grade 1 Nov c, P4): what it was for, or plainly "used"; See it has the rest.
      // A coin's one-yocto confirmation is no payment: only NEAR worth saying (0.0001 or more) is "paying".
      const paid = a.depositYocto >= 10n ** 20n ? `, paying ${nearShort(a.depositYocto)}` : "";
      if (self) return `Used your account's rules${paid}`;
      if (tx.receiverId === "intents.near") return `Moved money in your Safe${paid}`;
      const coinStep = COIN_STEP[a.method];
      const named = nameOf(tx.receiverId);
      if (coinStep && named !== tx.receiverId) return `${coinStep(named)}${a.method === "near_deposit" || a.method === "storage_deposit" ? "" : paid}`;
      return `Used ${named}${paid}`;
    }
    case "add-key": {
      const p = a.permission;
      if (p.kind === "full") {
        if (a.publicKey.type !== "ml-dsa-65") return "Added an older kind of key. Future computers could break it.";
        return a.publicKey.handle === mine ? "Gave this device its key" : "Added a key for another device";
      }
      if (p.receiverId === tx.signerId && p.methods.join() === RECOVERY_POLICY.recoveryKeyMethods.join()) return "Added your backup words";
      // A device's key goes through the account's own rules (a key limited to the account itself): named as a device's
      // key, never "Gave zf-….testnet a key that works only there" (copy walk 2 Nov).
      if (p.receiverId === tx.signerId) return a.publicKey.handle === mine ? "Gave this device its key" : "Added a key for another device";
      return `Added a key that only works with ${nameOf(p.receiverId)}`;
    }
    case "delete-key":
      if (a.publicKey.handle === mine) return "Removed this device's key";
      if (a.publicKey.text === tx.signerKey && tx.signerKey.startsWith("ed25519:")) return "Removed the set-up key";
      return "Removed a key, so it can't sign for you any more";
    case "deploy":
      // No ids on a row (UX walk 2 Nov: "fingerprint 2328d9e6"); code ZeroFee doesn't know is said to be that.
      // A NEAR code hash is the code's sha256: one of ZeroFee's releases is named as one (a short-waits build off mainnet
      // only: on mainnet it is never ZeroFee's, audit core integrity 3).
      if (a.codeSha256Hex === RECOVERY_POLICY.sha256Hex) return "Put old recovery rules on your account"; // legacy, unsafe (RECOVERY_POLICY)
      return /^[0-9a-f]{64}$/.test(a.codeSha256Hex) && policyVersion(toBase58(Uint8Array.from(a.codeSha256Hex.match(/../g)!, (h) => parseInt(h, 16))), network)
        ? "Put ZeroFee's rules on your account"
        : "Put rules ZeroFee doesn't know on your account";
    case "use-global": {
      const version = policyVersion(toBase58(a.codeHash), network);
      return toBase58(a.codeHash) === ACCOUNT_POLICY.codeHashBase58 ? "Put ZeroFee's rules on your account" : version ? `Put version ${version} of ZeroFee's rules on your account` : "Put rules ZeroFee doesn't know on your account";
    }
    case "create-account":
      return `Created ${tx.receiverId}`;
    case "delete-account":
      return `Closed the account. Everything went to ${nameOf(a.beneficiaryId)}.`;
    case "stake":
      return `Staked ${nearShort(a.yocto)}`;
    case "other":
      return "A step ZeroFee can't describe yet";
  }
}

/**
 * One past transaction → an activity row. `keys` is the account's current key list (two nodes agreed), `mine` the
 * handle of this device's key: together they say which key signed. `waiting`: the ids of the changes the account still
 * holds (waiting_requests), so a saved change says "waiting" only while it is.
 */
/** `keys` null: the account's keys couldn't be read (NEAR's nodes busy). The rows still show, from the history index; a
 *  row this device didn't sign then says "Another key", never a guess at which (k-security crawl, 4 Nov, S3; the
 *  Copywriter, 5 Nov: "by not this phone" was broken English). The set-up request is known from itself: "Set-up". */
export function activityItem(tx: PastTx, keys: ChainKey[] | null, mine: string, network: Network, waiting?: ReadonlySet<string>): ActivityItem {
  const signer = handleOf(tx.signerKey);
  const current = keys?.find((k) => k.handle === signer);
  // The one set-up request: signed by the set-up key, which it removes (with a full key, or a device key under the
  // account's rules, as releases since 9 make it). Its row says so, never its first step "and 3 more" (copy walk 2 Nov).
  const isSetup = tx.signerKey.startsWith("ed25519:") && tx.actions.some((a) => a.kind === "delete-key" && a.publicKey.text === tx.signerKey) && tx.actions.some((a) => a.kind === "add-key");
  const by =
    signer === mine
      ? "This phone"
      : isSetup
        ? "Set-up"
        : keys === null
        ? "Another key"
        : isRecoveryKey(current, tx.signerId)
        ? "Your backup words"
        : current
          ? "Another device"
          : tx.signerKey.startsWith("ed25519:")
            ? "Set-up"
            : "A key you removed later";

  const steps = tx.actions.map((a) => step(a, tx, mine, waiting, network));
  const title = isSetup ? "Set up your account" : steps.length > 1 ? `${steps[0]}, and ${steps.length - 1} more` : steps[0] ?? "A request with no steps";
  const sent = sentOf(tx);
  return { atIso: tx.atIso, title, lines: steps.length > 1 ? steps : [], by, ok: tx.ok, ...(tx.ok && tx.partly ? { partly: true as const } : {}), txHash: tx.hash, explorerUrl: explorerUrl(network, tx.hash), ...(sent ? { sent } : {}) };
}
