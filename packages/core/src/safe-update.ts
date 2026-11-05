// The Safe's update (product decision, 5 Nov): "Your Safe has an update", one line of what changed, Update → Face ID → a held
// screen the person can always find, with the contract's own ready time.
//
// Who can put it in front of a person: only this app's own build. The offer is the newest release compiled into the
// app (known-contracts.ts: offeredUpdateFor, by the code hash) against the code the account runs on chain (view_account's code_hash, or its
// global_contract_hash), and only once two nodes show that release published as a global contract under its pinned
// hash with its pinned sha256 (demo-core rulesInfo). Nothing here reads an inbox, a push, the relay or any server's
// message: a node can only say what the account runs, and the hash offered is always the compiled one
// (safe-update.test.ts). A waiting release whose hash this device's bundle doesn't know is "unknown": red, Cancel, never
// an update (MUST 1, QA).
import type { HeldRequest } from "./held.ts";
import { releaseNote } from "./release-notes.ts";

/** account.rules's answer (demo-core rulesInfo). */
export interface RulesInfo {
  release: number;
  current: number;
  update?: { waitSeconds: number; needsSecondDevice: boolean; listFirst?: true; thenWaitSeconds?: number; waiting?: { id: string; readyAtIso: string } };
}

export type SafeUpdate =
  | { state: "none" }
  /** An update can be asked for: one Face ID places both steps (the listing and the switch). The waits are the
   *  contract's, from its own views: the backup words' fallback wait when the phone asks alone, the floor when a second
   *  device on the account for that wait says yes. */
  | { state: "offer"; version: number; whatChanged: string; phoneOnlySeconds: number; withSecondDeviceSeconds: number | null; hasSecondDevice: boolean }
  /** Asked, waiting: the contract's ready time (the latest of its steps), the ids to cancel; `coSigned`: a second device
   *  said yes to every step, so a recovery's start keeps it (the backup words drop one the phone asked alone). */
  | { state: "held"; version: number; whatChanged: string; readyAtIso: string; ids: string[]; coSigned: boolean; hasSecondDevice: boolean }
  /** Every step's wait is over: Finish runs them (one Face ID). */
  | { state: "ready"; version: number; whatChanged: string; readyAtIso: string; ids: string[]; coSigned: boolean; hasSecondDevice: boolean }
  /** New code this device doesn't know is waiting: red, "Unknown code. Say no", Cancel. Never an update. */
  | { state: "unknown"; readyAtIso: string; ids: string[] };

/** Is this waiting request a release (AllowRelease or Upgrade)? */
const isRelease = (h: HeldRequest) => h.kind === "AllowRelease" || h.kind === "Upgrade" || h.release !== undefined;

/**
 * The Safe's update from what the core read: account.rules (the compiled offer against the code on chain) and the
 * contract's waiting requests (held.ts, with each release's hash checked against this bundle). Pure.
 */
/** `hasSecondDevice`: a second device whose yes makes it sooner (on the account for the fallback wait, R9-AL1). */
export function safeUpdateOf(rules: RulesInfo | null, held: readonly HeldRequest[], hasSecondDevice: boolean): SafeUpdate {
  const releases = held.filter(isRelease);
  const unknown = releases.filter((h) => !h.release || h.release.version === null);
  if (unknown.length) {
    const first = unknown.map((h) => h.readyAtIso).sort()[0]!;
    // Every waiting release step goes with the unknown one: a Cancel clears them all.
    return { state: "unknown", readyAtIso: first, ids: releases.map((h) => h.id) };
  }
  if (releases.length) {
    const version = Math.max(...releases.map((h) => h.release!.version!));
    const readyAtIso = releases.map((h) => h.readyAtIso).sort().at(-1)!;
    // The listing runs first, then the switch (the contract's finish refuses a switch to a release not on the list).
    const ids = [...releases].sort((a, b) => (a.kind === "AllowRelease" ? 0 : 1) - (b.kind === "AllowRelease" ? 0 : 1)).map((h) => h.id);
    const coSigned = releases.every((h) => h.coSigned === true);
    const ready = releases.every((h) => h.ready);
    return { state: ready ? "ready" : "held", version, whatChanged: releaseNote(version), readyAtIso, ids, coSigned, hasSecondDevice };
  }
  const u = rules?.update;
  // An offer is account.rules's `update` alone (offeredUpdateFor, by hash): a re-spun build of the same release counts.
  if (!rules || !u || u.waiting) return { state: "none" };
  return {
    state: "offer",
    version: rules.current,
    whatChanged: releaseNote(rules.current),
    phoneOnlySeconds: u.waitSeconds,
    // Release 9 on: a second device's yes lists the release at the switch's own wait (the floor) instead of the fallback.
    withSecondDeviceSeconds: u.listFirst && u.thenWaitSeconds !== undefined && u.thenWaitSeconds < u.waitSeconds ? u.thenWaitSeconds : null,
    hasSecondDevice,
  };
}
