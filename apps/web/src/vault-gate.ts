// More than $5,000 in the vault needs a second device (re-audit 2, N1 (C), product decision, 28 Oct). With the phone
// and the words alone, the words beat the phone (N1 (A)): leaked words can freeze the vault but take nothing, a stolen
// phone can't replace them. Above the limit the app asks for a third key first.
//
// - Add money and Receive (Wallet's Receive, Pay's buy and cash in: ledger.depositAddress from those apps) ask for a
//   second device first: security.vault.second-device, with Add my laptop / Add a guardian.
// - Money coming home (from Trading or Private) always goes: the vault is the safer place for it.
// - Money already in can't be stopped on chain (a deposit to the address): a vault over the limit with no second device,
//   or one not yet of age, shows the must-do banner instead (mustDo), until the device counts fully.
//
// The gate opens once a second device is on the account (UI, 28 Oct): until it is of age the account has (A)'s
// protection, as below the limit, and the banner says when it counts fully.
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { securityProblems } from "@zerofee/core/security-problems";
import { whenWords } from "./apps/security/rules.ts";
import { thisDevice } from "@zerofee/shell-api/approval-words.ts";
import type { SecondDevice } from "./apps/security/devices.ts";

/** The one limit: the vault above this many dollars needs a second device. */
export const VAULT_LIMIT_USD = 5_000;

/**
 * THE beta cap (approved direction, 1 Nov; SIMPLE-SUPERAPP 2b, decision 8): during the beta an account holds up to
 * this many dollars. Add money and Receive say so plainly when it is reached (betaCapRefusal); money already held is
 * never touched, and money coming home from Trading or Private always goes. The one place the number lives.
 */
export const BETA_CAP_USD = 1_000;

/** Add money or Receive `addUsd` more under a cap of `capUsd`: the Problem, or null when it may go. An unknown amount is
 *  refused only once the cap is reached (what comes in can't be stopped on chain; the next ask says so). */
export function betaCapRefusal(view: VaultView, addUsd = 0, capUsd = BETA_CAP_USD): Problem | null {
  const room = Math.max(0, capUsd - view.usd);
  if (view.usd >= capUsd) return securityProblems.betaCapReached(capUsd);
  if (addUsd > room) return securityProblems.betaCapOver(capUsd, room);
  return null;
}

/** Apps whose ledger.depositAddress is new money into the vault. Trade's is its move home; Pay's fee estimate passes
 *  `purpose: "estimate"` (nothing is received). */
// ZeroFee Chat's Request (D55) asks to be paid into the vault, so it is held to the same limit.
const RECEIVERS = new Set(["wallet", "pay", "chat"]);

export interface VaultView {
  /** The vault in dollars (Wallet's ledger.balances). */
  usd: number;
  devices: SecondDevice[];
}

/** Add money or Receive `addUsd` more (0 when the amount isn't known): the Problem, or null when it may go. */
export function receiveRefusal(view: VaultView, addUsd = 0): Problem | null {
  return view.devices.length === 0 && view.usd + addUsd > VAULT_LIMIT_USD ? securityProblems.vaultNeedsSecondDevice(VAULT_LIMIT_USD) : null;
}

/** A second device that counts fully now: on the account for a change's wait (account.secondDevices). */
const ofAge = (d: SecondDevice) => !d.countsFullyFromIso && !d.waitsForMove;

const name = (d: SecondDevice) => (d.kind === "laptop" || d.kind === "guardian" ? d.kind : "second device");

/** "Your laptop counts fully on Tue, 5 Nov, 2:00 PM": the first young device's moment, or null when one is of age. */
export function countsFullyLine(devices: readonly SecondDevice[], when: (iso: string) => string = (iso) => whenWords(iso)): string | null {
  if (devices.length === 0 || devices.some(ofAge)) return null;
  const dated = devices.filter((d) => d.countsFullyFromIso).sort((a, b) => Date.parse(a.countsFullyFromIso!) - Date.parse(b.countsFullyFromIso!))[0];
  if (dated) return `Your ${name(dated)} counts fully on ${when(dated.countsFullyFromIso!)}.`;
  return `Your ${name(devices[0]!)} counts again once the move to a new device ends.`;
}

/** The must-do banner: the vault over the limit with no second device of age. `add`: offer Add my laptop / a guardian. */
export function mustDo(view: VaultView | null, when?: (iso: string) => string): { text: string; also: string; add: boolean } | null {
  if (!view || !(view.usd > VAULT_LIMIT_USD)) return null;
  const limit = `$${VAULT_LIMIT_USD.toLocaleString("en-US")}`;
  if (view.devices.length === 0) {
    return { text: `More than ${limit} is in your Safe. Add a second device.`, also: "Then two of three must agree: this device, your words, the second device. Add money waits until then.", add: true };
  }
  const line = countsFullyLine(view.devices, when);
  return line ? { text: line, also: `Until then, only ${thisDevice()} and your words protect more than ${limit}.`, add: false } : null;
}

/**
 * The shell's bridge with the gate on Add money and Receive. `read` gives the vault and its second devices (the shell's
 * own calls); unreadable, the gate stays open: what comes in can't be stopped anyway, and the banner follows it.
 */
/** `betaCapUsd`: the beta cap (BETA_CAP_USD in the app), asked before the second-device limit; none, no cap. */
export function withVaultGate(bridge: Bridge, read: () => Promise<VaultView | null>, betaCapUsd?: number): Bridge {
  return {
    async call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
      if (method !== "ledger.depositAddress" || !params) return bridge.call<T>(method, params);
      const { purpose, usd, ...rest } = params;
      if (RECEIVERS.has(String(rest.caller)) && purpose !== "estimate") {
        const view = await read().catch(() => null);
        const add = Number(usd) > 0 ? Number(usd) : 0;
        const refusal = view && ((betaCapUsd !== undefined ? betaCapRefusal(view, add, betaCapUsd) : null) ?? receiveRefusal(view, add));
        if (refusal) return { problem: refusal };
      }
      return bridge.call<T>(method, rest);
    },
    on: (event, handler) => bridge.on(event, handler),
  };
}

/** The vault and its second devices, from the shell's own bridge (no app's caller stamp). Null if either is unreadable. */
export async function readVault(bridge: Bridge): Promise<VaultView | null> {
  const [balances, devices] = await Promise.all([bridge.call<{ usd?: string }[]>("ledger.balances"), bridge.call<SecondDevice[]>("account.secondDevices")]);
  if (!("ok" in balances) || !("ok" in devices)) return null;
  return { usd: balances.ok.reduce((sum, b) => sum + (Number(b.usd) || 0), 0), devices: devices.ok };
}
